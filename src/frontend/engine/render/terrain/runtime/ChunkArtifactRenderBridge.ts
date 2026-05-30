import type { IRenderBackend } from '@render/backend/IRenderBackend'
import { Frustum } from '@render/core/scene/Frustum'
import { RenderQueueBuilder } from '@render/queue/RenderQueueBuilder'
import type { ChunkArtifactPayloadArenaReleaseHandle } from '@/engine/world/chunk/domain'
import type { RenderObject } from '@render/queue/RenderObject'
import { SectionVisibilityGraph } from '@render/terrain/SectionVisibilityGraph'
import { TerrainClusterArena } from '@render/terrain/TerrainClusterArena'
import { TerrainUploadPacketBuilder } from '@render/terrain/TerrainUploadPacketBuilder'
import {
  TerrainResidentUploadExecutor,
  type TerrainResidentUploadExecutionBackend,
} from '@render/terrain/TerrainResidentUploadExecutor'
import { TerrainUploadCoordinator } from '@render/terrain/TerrainUploadCoordinator'
import {
  TerrainUploadPlanner,
  type TerrainClusterUploadPlan,
} from '@render/terrain/TerrainUploadPlanner'
import {
  forEachTerrainDescriptorItemData,
  getTerrainIndexByteLength,
  type TerrainChunkBuildArtifactInput,
  type TerrainItemRemoval,
  type TerrainPendingClusterUpload,
  type TerrainResidentCommitSource,
} from '@render/terrain/types'
import {
  mergeResidentCommitStateImpl,
  processRebuildWorkImpl,
  processResidentCommitWorkImpl,
  queueResidentCommitImpl,
  sealResidentCommitsImpl,
} from './commit'
import { dispatchResidentFrameBudgetImpl } from './dispatch'
import type {
  ChunkArtifactItem,
  ResidentFrameBudgetDispatchOptions,
  ResidentFrameBudgetPolicy,
  ResidentWorkIntent,
} from './types'
import type {
  ClusterRenderEntry,
  CommitWorkItem,
  PendingChunkArtifactUploadEntry,
  PendingResidentCommitState,
  QueuedResidentUploadState,
  UploadWorkItem,
} from './internals'
import {
  collectVisibleChunkKeys,
  performCull,
  rebuildClusterEntryResidentImpl,
  rebuildRenderObjectsCache,
  releaseClusterEntryImpl,
} from './render'
import {
  buildCommitWorkItems,
  buildUploadWorkItems,
  computeBgUploadByteBudget,
  computeRebuildStarvationScore,
  computeReservedBackgroundBudgetMs,
  getSchedulerStateImpl,
  scaleUploadByteBudget,
} from './scheduling'
import {
  applyPendingClusterUploadsImpl,
  buildUploadPlanImpl,
  dequeuePendingResidentUploadsImpl,
  enqueuePendingResidentUploadsImpl,
  upsertChunkArtifactsImpl,
} from './upload'

/**
 * 区块构建产物到 resident 渲染主线的桥接层。
 *
 * 负责承接 Worker 回传的区块构建结果，并把它们转化为 terrain resident runtime 可消费的状态：
 * 1. 主线通过 `TerrainUploadCoordinator` 消费 `descriptor + resolver`，而不是直接依赖完整 artifact 结构。
 * 2. upload、commit、rebuild、visible cull 与 render object cache 都在该桥接层内串联。
 * 3. 该类是 terrain 主线进入 renderer 的统一汇聚点。
 * 4. 入口只接受 worker 产出的 payload-carrying envelope。
 */

export type {
  ChunkArtifactItem,
  ResidentFrameBudgetDispatchOptions,
  ResidentFrameBudgetPolicy,
  ResidentWorkIntent,
} from './types'

export type ChunkArtifactRenderBridgeDebugSnapshot = {
  chunkCount: number
  sectionCount: number
  clusterEntryCount: number
  pendingResidentUploadCount: number
  readyResidentCommitCount: number
  pendingResidentCommitCount: number
  renderObjectCount: number
  visibleRenderObjectCount: number
  runtimeStats: ReturnType<TerrainResidentUploadExecutor['getRuntimeStats']>
}

export class ChunkArtifactRenderBridge {
  private readonly chunkSections = new Map<string, Set<string>>()
  private readonly sectionEntries = new Set<string>()
  private readonly clusterEntries = new Map<string, ClusterRenderEntry>()
  private readonly clusterArena: TerrainClusterArena
  private readonly uploadCoordinator: TerrainUploadCoordinator
  private readonly uploadPlanner = new TerrainUploadPlanner()
  private readonly uploadPacketBuilder = new TerrainUploadPacketBuilder()
  private readonly residentUploadExecutor: TerrainResidentUploadExecutor
  private readonly renderQueueBuilder = new RenderQueueBuilder()
  private readonly frustum = new Frustum()
  private readonly visibilityGraph = new SectionVisibilityGraph()
  private renderObjectsCache: RenderObject[] = []
  private visibleRenderObjectsCache: RenderObject[] = []
  private visibleChunkKeysCache: string[] = []
  private readonly lastVisibleClusterPriority = new Map<string, number>()
  private hasVisibleCache = false
  private cacheDirty = true
  private pendingResidentUploads = new Map<string, QueuedResidentUploadState>()
  private readyResidentCommits = new Map<string, PendingResidentCommitState>()
  private pendingResidentCommits = new Map<string, PendingResidentCommitState>()
  private rebuildBacklogSinceMs: number | null = null
  private rebuildDeferredFrames = 0

  constructor(
    private readonly backend: IRenderBackend,
    clusterArena: TerrainClusterArena,
    executionBackend: TerrainResidentUploadExecutionBackend,
    private readonly releasePayloadArenas: (
      handles: readonly ChunkArtifactPayloadArenaReleaseHandle[],
    ) => void = () => {},
  ) {
    this.clusterArena = clusterArena
    this.uploadCoordinator = new TerrainUploadCoordinator(clusterArena)
    this.residentUploadExecutor = new TerrainResidentUploadExecutor(executionBackend)
  }

  public upsertChunkArtifact(
    chunkX: number,
    chunkZ: number,
    artifact: TerrainChunkBuildArtifactInput,
    dirtySectionYs?: number[],
  ): void {
    this.upsertChunkArtifacts([{ chunkX, chunkZ, artifact, dirtySectionYs }])
  }

  public upsertChunkArtifacts(entries: readonly PendingChunkArtifactUploadEntry[]): void {
    upsertChunkArtifactsImpl(
      {
        uploadCoordinator: this.uploadCoordinator,
        chunkSections: this.chunkSections,
        getChunkKey: (chunkX, chunkZ) => this.getChunkKey(chunkX, chunkZ),
        getSectionKey: (chunkX, sectionY, chunkZ) => this.getSectionKey(chunkX, sectionY, chunkZ),
        enqueuePendingResidentUploads: uploads => this.enqueuePendingResidentUploads(uploads),
      },
      entries,
    )
  }

  private processResidentUploadWork(
    maxBytes: number,
    maxClusters: number = Number.POSITIVE_INFINITY,
    mode: 'all' | 'foreground' | 'background' | 'first-visible' | 'visible-refresh' = 'all',
  ): { processedClusters: number; consumedBytes: number } {
    if (maxBytes <= 0 || maxClusters <= 0 || this.pendingResidentUploads.size === 0) {
      return { processedClusters: 0, consumedBytes: 0 }
    }

    const now = performance.now()
    const selectedUploads = this.dequeuePendingResidentUploads(
      this.getUploadWorkItems(now).filter(item => {
        if (mode === 'foreground') {
          return item.visible
        }
        if (mode === 'background') {
          return !item.visible
        }
        if (mode === 'first-visible') {
          return item.intent === 'first-visible'
        }
        if (mode === 'visible-refresh') {
          return item.intent === 'visible-refresh'
        }
        return true
      }),
      maxBytes,
      maxClusters,
    )
    if (selectedUploads.length === 0) {
      return { processedClusters: 0, consumedBytes: 0 }
    }

    const consumedBytes = this.applyPendingClusterUploads(selectedUploads)
    return { processedClusters: selectedUploads.length, consumedBytes }
  }

  public removeChunk(chunkX: number, chunkZ: number): void {
    const uploads = this.uploadCoordinator.removeChunk(chunkX, chunkZ)
    this.visibilityGraph.removeChunk(chunkX, chunkZ)
    this.enqueuePendingResidentUploads(uploads)
  }

  public clear(): void {
    for (const clusterKey of this.clusterEntries.keys()) {
      this.releaseClusterEntry(clusterKey)
    }

    this.chunkSections.clear()
    this.sectionEntries.clear()
    this.clusterEntries.clear()
    this.uploadCoordinator.clear()
    this.residentUploadExecutor.clear()
    this.visibilityGraph.clear()
    this.pendingResidentUploads.clear()
    this.readyResidentCommits.clear()
    this.pendingResidentCommits.clear()
    this.invalidateCaches()
  }

  private processRebuildWork(maxItems: number): number {
    return processRebuildWorkImpl(
      this.residentUploadExecutor,
      (clusterKey, dirtyItems, commitSource, estimatedCost) =>
        this.queueResidentCommit(clusterKey, dirtyItems, commitSource, estimatedCost),
      clusterKey => this.estimateRebuildCommitCost(clusterKey),
      maxItems,
    )
  }

  private processResidentCommitWork(maxClusters: number = Number.POSITIVE_INFINITY): number {
    return processResidentCommitWorkImpl(
      this.readyResidentCommits,
      (queue, now) => this.getCommitWorkItems(queue, now),
      (clusterKey, state) => {
        this.clusterArena.commitPendingResidentSegmentsForCluster(clusterKey, state.commitSource)
        this.rebuildClusterEntryResident(clusterKey, state.dirtyItems ?? undefined)
      },
      () => this.invalidateCaches(),
      maxClusters,
    )
  }

  public sealResidentCommits(): void {
    sealResidentCommitsImpl(
      this.pendingResidentCommits,
      this.readyResidentCommits,
      (target, dirtyItems, commitSource, estimatedCost) =>
        this.mergeResidentCommitState(target, dirtyItems, commitSource, estimatedCost),
    )
  }

  public dispatchResidentFrameBudget(options: ResidentFrameBudgetDispatchOptions): void {
    dispatchResidentFrameBudgetImpl(
      {
        getSchedulerState: now => this.getSchedulerState(now),
        getReadyResidentCommitCount: () => this.readyResidentCommits.size,
        getPendingResidentCommitCount: () => this.pendingResidentCommits.size,
        computeReservedBackgroundBudgetMs: (
          state,
          policy,
          remainingBudgetMs,
          commitBacklog,
          pendingChunkUploads,
        ) =>
          this.computeReservedBackgroundBudgetMs(
            state,
            policy,
            remainingBudgetMs,
            commitBacklog,
            pendingChunkUploads,
          ),
        scaleUploadByteBudget: (uploadByteBudget, remainingBudgetMs, reservedBackgroundBudgetMs) =>
          this.scaleUploadByteBudget(
            uploadByteBudget,
            remainingBudgetMs,
            reservedBackgroundBudgetMs,
          ),
        computeBgUploadByteBudget: (
          totalUploadByteBudget,
          state,
          reservedBackgroundBudgetMs,
          remainingBudgetMs,
        ) =>
          this.computeBgUploadByteBudget(
            totalUploadByteBudget,
            state,
            reservedBackgroundBudgetMs,
            remainingBudgetMs,
          ),
        processResidentUploadWork: (maxBytes, maxClusters, mode) =>
          this.processResidentUploadWork(maxBytes, maxClusters, mode),
        sealResidentCommits: () => this.sealResidentCommits(),
        processResidentCommitWork: maxClusters => this.processResidentCommitWork(maxClusters),
        computeRebuildStarvationScore: state => this.computeRebuildStarvationScore(state),
        processRebuildWork: maxItems => this.processRebuildWork(maxItems),
        onRebuildProcessed: rebuiltItems => {
          this.rebuildDeferredFrames = rebuiltItems > 0 ? 0 : this.rebuildDeferredFrames + 1
        },
        onRebuildDeferred: () => {
          this.rebuildDeferredFrames += 1
        },
      },
      options,
    )
  }

  public getRenderObjects(): RenderObject[] {
    this.rebuildCachesIfNeeded()
    return this.hasVisibleCache ? this.visibleRenderObjectsCache : this.renderObjectsCache
  }

  public cull(
    viewProjection: Float32Array,
    cameraPosition?: Float32Array,
    reverseZ: boolean = false,
    _maxDistanceSq: number = 256 * 256,
  ): void {
    this.rebuildCachesIfNeeded()
    const { visibleObjects, visibleChunkKeys, visibleRegionPriority } = performCull(
      this.clusterEntries,
      this.frustum,
      viewProjection,
      cameraPosition,
      reverseZ,
    )

    this.visibleRenderObjectsCache = visibleObjects
    this.visibleChunkKeysCache = visibleChunkKeys
    this.lastVisibleClusterPriority.clear()
    for (const [clusterKey, priority] of visibleRegionPriority) {
      this.lastVisibleClusterPriority.set(clusterKey, priority)
    }
    this.residentUploadExecutor.setVisibleClusterPriority(visibleRegionPriority)
    this.hasVisibleCache = true
  }

  public getVisibleChunkKeys(): string[] {
    if (this.hasVisibleCache) {
      return this.visibleChunkKeysCache
    }

    return collectVisibleChunkKeys(this.clusterEntries)
  }

  public getDebugSnapshot(): ChunkArtifactRenderBridgeDebugSnapshot {
    return {
      chunkCount: this.chunkSections.size,
      sectionCount: this.sectionEntries.size,
      clusterEntryCount: this.clusterEntries.size,
      pendingResidentUploadCount: this.pendingResidentUploads.size,
      readyResidentCommitCount: this.readyResidentCommits.size,
      pendingResidentCommitCount: this.pendingResidentCommits.size,
      renderObjectCount: this.renderObjectsCache.length,
      visibleRenderObjectCount: this.visibleRenderObjectsCache.length,
      runtimeStats: this.residentUploadExecutor.getRuntimeStats(),
    }
  }

  public buildRenderQueues() {
    return this.renderQueueBuilder.build(this.getRenderObjects())
  }

  private getSchedulerState(now: number) {
    const next = getSchedulerStateImpl(
      this.residentUploadExecutor,
      this.pendingResidentUploads,
      clusterKey => this.getResidentWorkIntent(clusterKey),
      runtimeStats => this.estimateRebuildBacklogCost(runtimeStats),
      this.rebuildBacklogSinceMs,
      this.rebuildDeferredFrames,
      now,
    )
    this.rebuildBacklogSinceMs = next.rebuildBacklogSinceMs
    this.rebuildDeferredFrames = next.rebuildDeferredFrames
    return next.state
  }

  private getUploadWorkItems(now: number): UploadWorkItem[] {
    return buildUploadWorkItems(
      this.pendingResidentUploads,
      now,
      clusterKey => this.getResidentWorkIntent(clusterKey),
      (enqueuedAtMs, currentNow) => this.getQueuedTaskAgeMs(enqueuedAtMs, currentNow),
    )
  }

  private getCommitWorkItems(
    queue: ReadonlyMap<string, PendingResidentCommitState>,
    now: number,
  ): CommitWorkItem[] {
    return buildCommitWorkItems(
      queue,
      now,
      clusterKey => this.getResidentWorkIntent(clusterKey),
      (clusterKey, state) => this.estimateCommitTaskCost(clusterKey, state),
      (enqueuedAtMs, currentNow) => this.getQueuedTaskAgeMs(enqueuedAtMs, currentNow),
    )
  }

  private getResidentWorkIntent(clusterKey: string): ResidentWorkIntent {
    if (!this.lastVisibleClusterPriority.has(clusterKey)) {
      return 'background-consolidation'
    }

    const existingEntry = this.clusterEntries.get(clusterKey)
    return existingEntry && existingEntry.objects.length > 0 ? 'visible-refresh' : 'first-visible'
  }

  public hasChunk(chunkX: number, chunkZ: number): boolean {
    return this.chunkSections.has(this.getChunkKey(chunkX, chunkZ))
  }

  private applyPendingClusterUploads(uploads: TerrainPendingClusterUpload[]): number {
    const plans = this.buildUploadPlan(uploads)
    return applyPendingClusterUploadsImpl(
      {
        uploadPacketBuilder: this.uploadPacketBuilder,
        residentUploadExecutor: this.residentUploadExecutor,
        sectionEntries: this.sectionEntries,
        chunkSections: this.chunkSections,
        visibilityGraph: this.visibilityGraph,
        getResidentWorkIntent: clusterKey => this.getResidentWorkIntent(clusterKey),
        getChunkKey: (chunkX, chunkZ) => this.getChunkKey(chunkX, chunkZ),
        releasePayloadArenas: handles => this.releasePayloadArenas(handles),
        queueResidentCommit: (clusterKey, dirtyItems, commitSource, estimatedCost) =>
          this.queueResidentCommit(clusterKey, dirtyItems, commitSource, estimatedCost),
        estimateUploadCommitCost: upload => this.estimateUploadCommitCost(upload),
      },
      uploads,
      plans,
    )
  }

  private buildUploadPlan(uploads: TerrainPendingClusterUpload[]): TerrainClusterUploadPlan[] {
    return buildUploadPlanImpl(this.uploadPlanner, uploads)
  }

  private enqueuePendingResidentUploads(uploads: TerrainPendingClusterUpload[]) {
    enqueuePendingResidentUploadsImpl(
      {
        pendingResidentUploads: this.pendingResidentUploads,
        countQueuedResidentUploadItemRemovals: upload =>
          this.countQueuedResidentUploadItemRemovals(upload),
        estimateQueuedResidentUploadBytes: upload => this.estimateQueuedResidentUploadBytes(upload),
        estimateUploadTaskCost: upload => this.estimateUploadTaskCost(upload),
      },
      uploads,
    )
  }

  private dequeuePendingResidentUploads(
    workItems: readonly UploadWorkItem[],
    maxBytes: number,
    maxRegions: number,
  ): TerrainPendingClusterUpload[] {
    return dequeuePendingResidentUploadsImpl(
      this.pendingResidentUploads,
      upload => this.flattenQueuedItemRemovals(upload),
      workItems,
      maxBytes,
      maxRegions,
    )
  }

  private rebuildClusterEntryResident(
    clusterKey: string,
    dirtyItems?: ReadonlySet<ChunkArtifactItem>,
  ): void {
    rebuildClusterEntryResidentImpl(
      {
        clusterArena: this.clusterArena,
        clusterEntries: this.clusterEntries,
        visibilityGraph: this.visibilityGraph,
        residentUploadExecutor: this.residentUploadExecutor,
        backend: this.backend,
        getChunkKey: (chunkX, chunkZ) => this.getChunkKey(chunkX, chunkZ),
        releaseClusterEntry: clusterKeyToRelease => this.releaseClusterEntry(clusterKeyToRelease),
      },
      clusterKey,
      dirtyItems,
    )
  }

  private releaseClusterEntry(clusterKey: string): void {
    releaseClusterEntryImpl(this.clusterEntries, this.backend, clusterKey)
  }

  private invalidateCaches(): void {
    this.cacheDirty = true
    this.visibleChunkKeysCache = []
    this.residentUploadExecutor.setVisibleClusterPriority(null)
    this.hasVisibleCache = false
  }

  private queueResidentCommit(
    clusterKey: string,
    dirtyItems: ReadonlySet<ChunkArtifactItem> | null,
    commitSource: TerrainResidentCommitSource,
    estimatedCost: number,
  ) {
    queueResidentCommitImpl(
      this.readyResidentCommits,
      this.pendingResidentCommits,
      (target, nextDirtyItems, nextCommitSource, nextEstimatedCost) =>
        this.mergeResidentCommitState(target, nextDirtyItems, nextCommitSource, nextEstimatedCost),
      clusterKey,
      dirtyItems,
      commitSource,
      estimatedCost,
    )
  }

  private mergeResidentCommitState(
    target: PendingResidentCommitState,
    dirtyItems: ReadonlySet<ChunkArtifactItem> | null,
    commitSource: TerrainResidentCommitSource,
    estimatedCost: number,
  ) {
    mergeResidentCommitStateImpl(target, dirtyItems, commitSource, estimatedCost)
  }

  private countQueuedResidentUploadItemRemovals(upload: QueuedResidentUploadState) {
    let itemRemovalCount = 0

    for (const removals of upload.itemRemovals.values()) {
      itemRemovalCount += removals.size
    }

    return itemRemovalCount
  }

  private estimateQueuedResidentUploadBytes(upload: QueuedResidentUploadState) {
    let totalBytes = 0

    for (const update of upload.sectionUpdates.values()) {
      forEachTerrainDescriptorItemData(
        update.descriptor,
        update.resolver,
        (_itemName, indexMode, _layoutId, _vertexStride, vertexBytes, indexBytes, vertexCount) => {
          totalBytes += vertexBytes.byteLength
          totalBytes += getTerrainIndexByteLength(indexMode, vertexCount, indexBytes)
        },
      )
    }

    return totalBytes
  }

  private flattenQueuedItemRemovals(upload: QueuedResidentUploadState): TerrainItemRemoval[] {
    const removals: TerrainItemRemoval[] = []

    for (const [item, entries] of upload.itemRemovals) {
      for (const removal of entries.values()) {
        removals.push({ item, removal })
      }
    }

    return removals
  }

  private estimateCommitTaskCost(clusterKey: string, state: PendingResidentCommitState) {
    const sectionCount = this.clusterArena.getClusterSections(clusterKey).length
    const residentItemCount = this.clusterEntries.get(clusterKey)?.itemEntries.size ?? 0
    const dirtyItemCount = state.dirtyItems?.size ?? Math.max(1, residentItemCount)
    const sourceCost = state.commitSource === 'upload' ? 4 : 2
    const clusterCost = Math.min(12, sectionCount) + residentItemCount * 2

    return Math.max(1, state.estimatedCost + dirtyItemCount * 3 + sourceCost + clusterCost)
  }

  private estimateUploadTaskCost(upload: QueuedResidentUploadState) {
    const byteCost = Math.max(1, Math.ceil(upload.estimatedBytes / 131072))
    const sectionCost = upload.updatedSectionCount * 3 + upload.removedSectionCount * 2
    const removalCost = upload.itemRemovalCount
    const dirtyItemCost = upload.dirtyItems.size * 3

    return Math.max(1, byteCost + sectionCost + removalCost + dirtyItemCost)
  }

  private estimateUploadCommitCost(upload: TerrainPendingClusterUpload) {
    const dirtyItemCost = upload.dirtyItems.length * 3
    const sectionCost = upload.sectionUpdates.length * 3 + upload.sectionRemovals.length * 2
    const removalCost = upload.itemRemovals.length

    return Math.max(1, dirtyItemCost + sectionCost + removalCost)
  }

  private estimateRebuildCommitCost(clusterKey: string) {
    const sectionCount = this.clusterArena.getClusterSections(clusterKey).length
    const residentItemCount = this.clusterEntries.get(clusterKey)?.itemEntries.size ?? 0
    return Math.max(1, 4 + Math.min(12, sectionCount) + residentItemCount * 2)
  }

  private estimateRebuildBacklogCost(
    runtimeStats: ReturnType<TerrainResidentUploadExecutor['getRuntimeStats']>,
  ) {
    const deadBytes = runtimeStats.topDeadVertexBytes
    const deadCost = Math.floor(deadBytes / 131072)

    return Math.max(0, runtimeStats.rebuildCandidateItems * 2 + deadCost)
  }

  private getQueuedTaskAgeMs(enqueuedAtMs: number, now: number) {
    return Math.max(0, now - enqueuedAtMs)
  }

  private rebuildCachesIfNeeded(): void {
    if (!this.cacheDirty) {
      return
    }

    this.renderObjectsCache = rebuildRenderObjectsCache(this.clusterEntries)
    this.cacheDirty = false
  }

  private getChunkKey(chunkX: number, chunkZ: number): string {
    return `${chunkX},${chunkZ}`
  }

  private getSectionKey(chunkX: number, sectionY: number, chunkZ: number): string {
    return `${chunkX},${sectionY},${chunkZ}`
  }

  private computeRebuildStarvationScore(
    state: ReturnType<ChunkArtifactRenderBridge['getSchedulerState']>,
  ): number {
    return computeRebuildStarvationScore(state)
  }

  private computeReservedBackgroundBudgetMs(
    state: ReturnType<ChunkArtifactRenderBridge['getSchedulerState']>,
    policy: ResidentFrameBudgetPolicy,
    remainingBudgetMs: number,
    commitBacklog: number,
    pendingChunkUploads: number,
  ): number {
    return computeReservedBackgroundBudgetMs(
      state,
      policy,
      remainingBudgetMs,
      commitBacklog,
      pendingChunkUploads,
    )
  }

  private scaleUploadByteBudget(
    uploadByteBudget: number,
    remainingBudgetMs: number,
    reservedBackgroundBudgetMs: number,
  ): number {
    return scaleUploadByteBudget(uploadByteBudget, remainingBudgetMs, reservedBackgroundBudgetMs)
  }

  private computeBgUploadByteBudget(
    totalUploadByteBudget: number,
    state: ReturnType<ChunkArtifactRenderBridge['getSchedulerState']>,
    reservedBackgroundBudgetMs: number,
    remainingBudgetMs: number,
  ): number {
    return computeBgUploadByteBudget(
      totalUploadByteBudget,
      state,
      reservedBackgroundBudgetMs,
      remainingBudgetMs,
    )
  }
}
