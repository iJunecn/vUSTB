import {
  createTerrainSectionKey,
  forEachTerrainDescriptorItemData,
  getArtifactDescriptorSectionsByKey,
  terrainSectionKeyToString,
  type TerrainItemRemoval,
  type TerrainPendingClusterUpload,
  type TerrainResidentCommitSource,
} from '@render/terrain/types'
import { TerrainUploadCoordinator } from '@render/terrain/TerrainUploadCoordinator'
import {
  TerrainUploadPlanner,
  type TerrainClusterUploadPlan,
} from '@render/terrain/TerrainUploadPlanner'
import { TerrainUploadPacketBuilder } from '@render/terrain/TerrainUploadPacketBuilder'
import { TerrainResidentUploadExecutor } from '@render/terrain/TerrainResidentUploadExecutor'
import type { ChunkArtifactItem, ResidentWorkIntent } from './types'
import type {
  PendingChunkArtifactUploadEntry,
  QueuedResidentUploadState,
  UploadWorkItem,
} from './internals'

export interface UpsertBridgeContext {
  uploadCoordinator: TerrainUploadCoordinator
  chunkSections: Map<string, Set<string>>
  getChunkKey(chunkX: number, chunkZ: number): string
  getSectionKey(chunkX: number, sectionY: number, chunkZ: number): string
  enqueuePendingResidentUploads(uploads: TerrainPendingClusterUpload[]): void
}

export function upsertChunkArtifactsImpl(
  context: UpsertBridgeContext,
  entries: readonly PendingChunkArtifactUploadEntry[],
): void {
  const uploads: TerrainPendingClusterUpload[] = []

  for (const entry of entries) {
    const entryUploads = context.uploadCoordinator.stageArtifact(
      entry.artifact,
      entry.dirtySectionYs,
    )

    if (!entry.dirtySectionYs || entry.dirtySectionYs.length === 0) {
      const previousSectionKeys = new Set(
        context.chunkSections.get(context.getChunkKey(entry.chunkX, entry.chunkZ)) ?? [],
      )
      const nextSectionKeys = new Set<string>()
      for (const section of getArtifactDescriptorSectionsByKey(entry.artifact).values()) {
        nextSectionKeys.add(context.getSectionKey(section.chunkX, section.sectionY, section.chunkZ))
      }

      for (const sectionKey of previousSectionKeys) {
        if (nextSectionKeys.has(sectionKey)) {
          continue
        }

        const [sectionChunkX, sectionY, sectionChunkZ] = sectionKey.split(',').map(Number)
        const removalUploads = context.uploadCoordinator.stageSectionRemoval(
          createTerrainSectionKey(sectionChunkX, sectionY, sectionChunkZ),
        )
        entryUploads.push(...removalUploads)
      }
    }

    uploads.push(...entryUploads)
  }

  if (uploads.length > 0) {
    context.enqueuePendingResidentUploads(uploads)
  }
}

export function buildUploadPlanImpl(
  uploadPlanner: TerrainUploadPlanner,
  uploads: TerrainPendingClusterUpload[],
): TerrainClusterUploadPlan[] {
  return uploadPlanner.build(uploads)
}

export interface ApplyUploadBridgeContext {
  uploadPacketBuilder: TerrainUploadPacketBuilder
  residentUploadExecutor: TerrainResidentUploadExecutor
  sectionEntries: Set<string>
  chunkSections: Map<string, Set<string>>
  visibilityGraph: {
    removeSection(chunkX: number, sectionY: number, chunkZ: number): void
  }
  getResidentWorkIntent(clusterKey: string): ResidentWorkIntent
  getChunkKey(chunkX: number, chunkZ: number): string
  queueResidentCommit(
    clusterKey: string,
    dirtyItems: ReadonlySet<ChunkArtifactItem> | null,
    commitSource: TerrainResidentCommitSource,
    estimatedCost: number,
  ): void
  releasePayloadArenas(
    handles: readonly import('@/engine/world/chunk/domain').ChunkArtifactPayloadArenaReleaseHandle[],
  ): void
  estimateUploadCommitCost(upload: TerrainPendingClusterUpload): number
}

export function applyPendingClusterUploadsImpl(
  context: ApplyUploadBridgeContext,
  uploads: TerrainPendingClusterUpload[],
  plans: TerrainClusterUploadPlan[],
): number {
  const packets = context.uploadPacketBuilder.build(plans, (clusterKey, _item) =>
    context.getResidentWorkIntent(clusterKey),
  )

  const executeStats = context.residentUploadExecutor.applyPackets(packets)
  const releaseHandles = new Map<
    string,
    import('@/engine/world/chunk/domain').ChunkArtifactPayloadArenaReleaseHandle
  >()

  for (const upload of uploads) {
    for (const handle of upload.payloadArenaReleaseHandles) {
      releaseHandles.set(`${handle.workerId}:${handle.arenaId}:${handle.generation}`, handle)
    }

    for (const update of upload.sectionUpdates) {
      const sectionKey = terrainSectionKeyToString(update.key)
      const chunkKey = context.getChunkKey(update.key.chunkX, update.key.chunkZ)
      context.sectionEntries.add(sectionKey)

      let chunkSections = context.chunkSections.get(chunkKey)
      if (!chunkSections) {
        chunkSections = new Set<string>()
        context.chunkSections.set(chunkKey, chunkSections)
      }
      chunkSections.add(sectionKey)
    }

    for (const removal of upload.sectionRemovals) {
      const sectionKey = terrainSectionKeyToString(removal.key)
      const chunkKey = context.getChunkKey(removal.key.chunkX, removal.key.chunkZ)
      context.sectionEntries.delete(sectionKey)
      context.visibilityGraph.removeSection(
        removal.key.chunkX,
        removal.key.sectionY,
        removal.key.chunkZ,
      )

      const chunkSections = context.chunkSections.get(chunkKey)
      if (chunkSections) {
        chunkSections.delete(sectionKey)
        if (chunkSections.size === 0) {
          context.chunkSections.delete(chunkKey)
        }
      }
    }

    context.queueResidentCommit(
      upload.clusterKey,
      new Set(upload.dirtyItems),
      'upload',
      context.estimateUploadCommitCost(upload),
    )
  }

  if (releaseHandles.size > 0) {
    context.releasePayloadArenas([...releaseHandles.values()])
  }

  return executeStats.vertexBytes + executeStats.indexBytes
}

export interface EnqueueResidentUploadsContext {
  pendingResidentUploads: Map<string, QueuedResidentUploadState>
  countQueuedResidentUploadItemRemovals(upload: QueuedResidentUploadState): number
  estimateQueuedResidentUploadBytes(upload: QueuedResidentUploadState): number
  estimateUploadTaskCost(upload: QueuedResidentUploadState): number
}

export function enqueuePendingResidentUploadsImpl(
  context: EnqueueResidentUploadsContext,
  uploads: TerrainPendingClusterUpload[],
) {
  for (const upload of uploads) {
    let queued = context.pendingResidentUploads.get(upload.clusterKey)
    if (!queued) {
      queued = {
        cluster: upload.cluster,
        clusterKey: upload.clusterKey,
        dirtyItems: new Set<ChunkArtifactItem>(),
        sectionUpdates: new Map(),
        sectionRemovals: new Map(),
        itemRemovals: new Map(),
        payloadArenaReleaseHandles: new Map(),
        updatedSectionCount: 0,
        removedSectionCount: 0,
        itemRemovalCount: 0,
        estimatedBytes: 0,
        estimatedCost: 0,
        enqueuedAtMs: performance.now(),
      }
      context.pendingResidentUploads.set(upload.clusterKey, queued)
    }

    for (const item of upload.dirtyItems) {
      queued.dirtyItems.add(item)
    }

    for (const handle of upload.payloadArenaReleaseHandles) {
      queued.payloadArenaReleaseHandles.set(
        `${handle.workerId}:${handle.arenaId}:${handle.generation}`,
        handle,
      )
    }

    for (const update of upload.sectionUpdates) {
      const sectionKey = terrainSectionKeyToString(update.key)
      queued.sectionRemovals.delete(sectionKey)
      queued.sectionUpdates.set(sectionKey, update)

      forEachTerrainDescriptorItemData(update.descriptor, update.resolver, itemName => {
        const itemRemovals = queued.itemRemovals.get(itemName)
        if (!itemRemovals) {
          return
        }

        itemRemovals.delete(sectionKey)
        if (itemRemovals.size === 0) {
          queued.itemRemovals.delete(itemName)
        }
      })
    }

    for (const removal of upload.sectionRemovals) {
      const sectionKey = terrainSectionKeyToString(removal.key)
      queued.sectionUpdates.delete(sectionKey)
      queued.sectionRemovals.set(sectionKey, removal)
      for (const [item, itemRemovals] of queued.itemRemovals) {
        itemRemovals.delete(sectionKey)
        if (itemRemovals.size === 0) {
          queued.itemRemovals.delete(item)
        }
      }
    }

    for (const itemRemoval of upload.itemRemovals) {
      const sectionKey = terrainSectionKeyToString(itemRemoval.removal.key)
      if (queued.sectionRemovals.has(sectionKey)) {
        continue
      }

      let itemRemovals = queued.itemRemovals.get(itemRemoval.item)
      if (!itemRemovals) {
        itemRemovals = new Map()
        queued.itemRemovals.set(itemRemoval.item, itemRemovals)
      }
      itemRemovals.set(sectionKey, itemRemoval.removal)
    }

    queued.updatedSectionCount = queued.sectionUpdates.size
    queued.removedSectionCount = queued.sectionRemovals.size
    queued.itemRemovalCount = context.countQueuedResidentUploadItemRemovals(queued)
    queued.estimatedBytes = context.estimateQueuedResidentUploadBytes(queued)
    queued.estimatedCost = context.estimateUploadTaskCost(queued)
  }
}

export function dequeuePendingResidentUploadsImpl(
  pendingResidentUploads: Map<string, QueuedResidentUploadState>,
  flattenQueuedItemRemovals: (upload: QueuedResidentUploadState) => TerrainItemRemoval[],
  workItems: readonly UploadWorkItem[],
  maxBytes: number,
  maxRegions: number,
): TerrainPendingClusterUpload[] {
  const selectedClusterKeys: string[] = []
  let selectedBytes = 0
  let selectedRegionCount = 0

  for (const item of workItems) {
    if (selectedRegionCount >= maxRegions) {
      break
    }

    const nextBytes = selectedBytes + item.estimatedBytes
    if (selectedRegionCount > 0 && nextBytes > maxBytes) {
      continue
    }

    selectedClusterKeys.push(item.clusterKey)
    selectedBytes = nextBytes
    selectedRegionCount += 1
  }

  const uploads: TerrainPendingClusterUpload[] = []
  for (const clusterKey of selectedClusterKeys) {
    const queued = pendingResidentUploads.get(clusterKey)
    if (!queued) {
      continue
    }

    uploads.push({
      cluster: queued.cluster,
      clusterKey: queued.clusterKey,
      dirtyItems: [...queued.dirtyItems],
      sectionUpdates: [...queued.sectionUpdates.values()],
      sectionRemovals: [...queued.sectionRemovals.values()],
      itemRemovals: flattenQueuedItemRemovals(queued),
      payloadArenaReleaseHandles: [...queued.payloadArenaReleaseHandles.values()],
    })

    pendingResidentUploads.delete(clusterKey)
  }

  return uploads
}
