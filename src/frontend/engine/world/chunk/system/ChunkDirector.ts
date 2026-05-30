/**
 * @file ChunkDirector.ts
 * @brief 区块主调度器
 *
 * 说明：
 *  - 协调区块加载、重网格、卸载与错误恢复
 *  - 串联 ChunkState、ChunkScheduler、WorkerPool 与 SharedVoxelStore
 *  - 对外暴露区块结果回调与运行时状态
 */
import WorldWorker from '../compute/world.worker?worker'
import { GAME_CONFIG, type ResourceDefinition } from '@/engine/config'
import { DEBUG_FLAGS, debugLog } from '@/config/debug'
import { getEngineRuntimeChunkConfig, type EngineRuntimeLightingConfig } from '@/config/runtime'
import { resolveResourceEndpoints } from '@/resource/endpoints'
import { loadResourceBinary } from '@/resource/resourceBinary'
import { RegionManager } from '../io'
import { SECTIONS_PER_CHUNK } from '../memory/Layout'
import { BLOCK_SIZE, SharedVoxelStore } from '../memory/SharedVoxelStore'
import { ChunkScheduler } from './ChunkScheduler'
import { ChunkState } from './ChunkState'
import { WorkerPool, MessageRouter, type WorkerStatsPayload } from '../compute/pool'
import { LightCache } from '../memory/LightCache'
import { FailureTracker } from './FailureTracker'
import type {
  BlockUpdateRequest,
  ChunkArtifactDescriptorInput,
  ChunkArtifactEnvelopeWithPayload,
  ChunkArtifactPayloadArenaReleaseHandle,
  ChunkGeometryData,
  ChunkRemeshReason,
  DirtySectionRemeshRequest,
  WorkerMessage,
} from '../domain'
import {
  getChunkArtifactItemCount,
  getChunkArtifactSectionCount,
  resolveChunkArtifactDescriptor,
} from '../domain'

interface PendingEditDiagnostic {
  traceId: number
  worldX: number
  worldY: number
  worldZ: number
  blockStateId: number
  recordedAtMs: number
}

interface PendingDescribeBlockStateRequest {
  timeoutId: number
  resolve: (blockState: string | null) => void
}

const INVALID_WORKER_ID = -1
const SAB_START_SECTION_Y = -4

function createFullChunkSectionYs() {
  return Array.from({ length: SECTIONS_PER_CHUNK }, (_, index) => SAB_START_SECTION_Y + index)
}

function normalizeResolvableBlockState(blockState: string) {
  const normalized = blockState.trim()
  if (!normalized || normalized.startsWith('#')) {
    return null
  }

  return normalized
}

export class ChunkDirector {
  /** 状态管理器 */
  public readonly state = new ChunkState()

  public cacheMissCount = 0
  private readonly lightCache = new LightCache()
  private readonly failureTracker = new FailureTracker()
  private readonly artifactStatsByChunk = new Map<
    string,
    {
      sectionCount: number
      itemCount: number
    }
  >()
  private readonly dirtySectionsByChunk = new Map<string, Set<number>>()
  private readonly dirtyRemeshReasons = new Map<string, ChunkRemeshReason>()
  private readonly syncedBlockStates = new Set<string>()
  private lightingConfig: EngineRuntimeLightingConfig = {
    enablePointLights: GAME_CONFIG.RENDER.LIGHTING.ENABLE_POINT_LIGHTS,
    enableVertexLighting: GAME_CONFIG.RENDER.LIGHTING.ENABLE_VERTEX_LIGHTING,
    enableSmoothLighting: GAME_CONFIG.RENDER.LIGHTING.ENABLE_SMOOTH_LIGHTING,
  }
  private readonly pendingEditDiagnostics = new Map<string, Map<number, PendingEditDiagnostic>>()
  private readonly pendingDescribeBlockStateRequests = new Map<
    number,
    PendingDescribeBlockStateRequest
  >()
  private nextEditTraceId = 1

  /** 内存图集管理器 */
  public readonly sabManager = new SharedVoxelStore(GAME_CONFIG.CHUNK.SAB_SIZE_MB)
  /** 集中式 Region 管理器（主线程运行） */
  public readonly regionManager: RegionManager

  // 运行参数
  private MAX_CONCURRENT_REQUESTS = 32
  private readonly RETRY_DELAY = 5000
  private readonly REQUEST_TIMEOUT = 30000
  private readonly DESCRIBE_BLOCKSTATE_TIMEOUT = 3000
  private readonly UNLOAD_CHECK_INTERVAL = 200

  // 运行时状态
  private isWorkerReady = false
  private checkTimeoutInterval: number = 0
  private lastUnloadCheckTime = 0
  private isInitialLoad = true // 控制初始加载突发阶段的迟滞行为

  // 玩家与相机位置
  private currentPlayerChunk: { x: number; z: number } = { x: 0, z: 0 }
  private lastPlayerChunk: { x: number; z: number } | null = null
  private currentLoadDistance = getEngineRuntimeChunkConfig().loadDistance
  private currentGeneration = 0

  // 容量收缩保护
  private constrainedDistance: number = -1
  private constrainedUntil: number = 0

  // 对外回调
  public onChunkLoaded?: (
    chunkX: number,
    chunkZ: number,
    geometry: ChunkGeometryData | null,
    artifact?: ChunkArtifactEnvelopeWithPayload,
    dirtySectionYs?: number[],
  ) => void
  public onChunkUnloaded?: (chunkX: number, chunkZ: number) => void
  public onWorkerInit?: () => void

  get pendingCount() {
    return this.state.getPendingCount()
  }

  private workerPool: WorkerPool
  private messageRouter: MessageRouter
  private basePath: string | null = null
  private regionUrlResolver: ((regionX: number, regionZ: number) => string) | null = null

  /** 状态指示器 */
  private nextRequestId = 1
  private requestStartTimes = new Map<number, number>()

  /** 调度器 */
  private scheduler!: ChunkScheduler

  constructor(basePath?: string) {
    if (basePath) {
      this.basePath = basePath
    }

    this.regionManager = new RegionManager(this.basePath)

    // 定期检查请求超时。
    this.checkTimeoutInterval = window.setInterval(() => this.checkTimeouts(), 1000)

    if (this.basePath) {
      this.regionUrlResolver = (rx, rz) => `${this.basePath}/r.${rx}.${rz}.mca`
      this.regionManager.setRegionUrlResolver(this.regionUrlResolver)
    }

    this.messageRouter = new MessageRouter({
      onChunkLoaded: data => this.handleChunkLoaded(data),
      onParseComplete: data => this.handleParseComplete(data),
      onTaskAborted: data => this.handleTaskAborted(data),
      onInitComplete: idx => this.handleInitComplete(idx),
      onChunkUpdate: data => this.handleChunkUpdate(data),
      onBlockStateSyncResult: data => this.handleBlockStateSyncResult(data),
      onDescribeBlockStateResult: data => this.handleDescribeBlockStateResult(data),
      onBackpressure: backlog => this.handleBackpressure(backlog),
      onWorkerStats: payload => this.handleWorkerStats(payload),
      onChunkRetry: data => this.handleChunkRetry(data),
      onAllocRequest: (data, index) => this.handleAllocRequest(data, index),
      onError: msg => console.error('[ChunkManager] Worker reported error:', msg),
    })

    // 初始化 Worker 池，并限制最大并发核心数，避免挤占主线程。
    const logicalProcessors = navigator.hardwareConcurrency || 4
    const workerCount = Math.max(1, Math.min(8, logicalProcessors))

    // 按 Worker 数量推导请求并发上限。
    this.MAX_CONCURRENT_REQUESTS = Math.min(workerCount * 128, 2048)

    this.workerPool = new WorkerPool({
      workerCount,
      workerFactory: () => new WorldWorker(),
      onMessage: (e, idx) => {
        // 拦截内部控制消息，其余消息交给 MessageRouter。
        if (e.data && e.data.type === 'WORKER_PAUSED') {
          this.onWorkerPaused?.(idx)
          return
        }
        this.messageRouter.handle(e, idx)
      },
      onWorkerCreate: (worker, idx) => {
        worker.postMessage({
          type: 'initSAB',
          sab: this.sabManager.sab,
          maxSlots: GAME_CONFIG.CHUNK.SAB_MAX_SLOTS,
        })
        worker.postMessage({ type: 'setWorkerId', workerId: idx })
      },
    })

    console.log(
      `[ChunkDirector] Init with ${workerCount} workers. Optimal Scheduler Enabled. Max Concurrent: ${this.MAX_CONCURRENT_REQUESTS}`,
    )

    // 初始化调度器。
    this.scheduler = new ChunkScheduler({
      loadedChunks: this.state.getLoadedChunksSet(),
      inflightChunks: this.state.getInflightChunksSet(),
      allocatedSlots: this.state.getAllocatedSlots(),
      getChunkKey: this.getChunkKey.bind(this),
      shouldLoadChunk: this.shouldLoadChunk.bind(this),
      calculateMeshValue: this.calculateMeshValue.bind(this),
      dispatchMeshTask: task => this.dispatchMeshTask(task),
      dispatchParseTask: task => this.dispatchParseTask(task),
      effectiveMaxConcurrent: () => this.effectiveMaxConcurrent,
      getActiveRequestCount: () => this.state.getPendingCount(),
    })

    this.scheduler.start()
  }

  private createMesherOptions() {
    const vertexLighting = this.lightingConfig.enableVertexLighting
    const smoothLighting = vertexLighting && this.lightingConfig.enableSmoothLighting
    const vertexAO =
      vertexLighting &&
      smoothLighting &&
      GAME_CONFIG.RENDER.LIGHTING.ENABLE_VERTEX_AO &&
      !GAME_CONFIG.RENDER.LIGHTING.ENABLE_SSAO

    return {
      vertexLighting,
      smoothLighting,
      vertexAO,
    }
  }

  public setLightingConfig(lightingConfig: EngineRuntimeLightingConfig) {
    this.lightingConfig = {
      enablePointLights: lightingConfig.enablePointLights,
      enableVertexLighting: lightingConfig.enableVertexLighting,
      enableSmoothLighting:
        lightingConfig.enableVertexLighting && lightingConfig.enableSmoothLighting,
    }
  }

  public applyRuntimeLoadDistance(loadDistance: number) {
    const nextDistance = Math.max(2, Math.round(loadDistance))
    this.currentLoadDistance = nextDistance
    this.constrainedDistance = -1
    this.constrainedUntil = 0
    this.scheduler.setState(
      this.currentPlayerChunk.x,
      this.currentPlayerChunk.z,
      nextDistance,
      this.currentGeneration,
    )
  }

  public applyRuntimeMesherOptions() {
    this.workerPool.broadcast({
      type: 'setMesherOptions',
      mesherOptions: this.createMesherOptions(),
    })
  }

  public releasePayloadArenas(handles: readonly ChunkArtifactPayloadArenaReleaseHandle[]) {
    for (const handle of handles) {
      if (handle.workerId < 0) {
        continue
      }

      const worker = this.workerPool.getWorkerAt(handle.workerId)
      if (!worker) {
        continue
      }

      worker.postMessage({
        type: 'releasePayloadArena',
        arenaId: handle.arenaId,
        generation: handle.generation,
      })
    }
  }

  public reloadLoadedChunks() {
    const loadedChunks = Array.from(this.state.getLoadedChunksSet())

    for (const key of loadedChunks) {
      const [cxStr, czStr] = key.split(',')
      const cx = Number.parseInt(cxStr, 10)
      const cz = Number.parseInt(czStr, 10)
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) {
        continue
      }

      const pendingReqId = this.state.getRequestIdByKey(key)
      if (pendingReqId !== undefined) {
        this.cancelRequest(pendingReqId, key, false)
      }

      this.onChunkUnloaded?.(cx, cz)
      this.lightCache.delete(key)
      this.state.markUnloaded(key)
      this.releaseSlot(cx, cz)
    }

    this.scheduler.reset()
    this.currentGeneration++
    this.scheduler.setState(
      this.currentPlayerChunk.x,
      this.currentPlayerChunk.z,
      this.currentLoadDistance,
      this.currentGeneration,
    )
  }

  public remeshLoadedChunks() {
    const loadedChunks = Array.from(this.state.getLoadedChunksSet())

    for (const key of loadedChunks) {
      this.scheduler.removeMeshQueued(key)
    }

    this.currentGeneration++
    this.scheduler.setState(
      this.currentPlayerChunk.x,
      this.currentPlayerChunk.z,
      this.currentLoadDistance,
      this.currentGeneration,
    )

    for (const key of loadedChunks) {
      if (this.state.isFlight(key)) {
        continue
      }

      const [cxStr, czStr] = key.split(',')
      const cx = Number.parseInt(cxStr, 10)
      const cz = Number.parseInt(czStr, 10)
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) {
        continue
      }

      if (!this.isMeshable(cx, cz)) {
        continue
      }

      const slot = this.state.getSlot(key)
      if (!slot) {
        continue
      }

      const value = this.calculateMeshValue(
        cx,
        cz,
        this.currentPlayerChunk.x,
        this.currentPlayerChunk.z,
      )
      const dirtySectionYs = createFullChunkSectionYs()
      const ok = this.dispatchMeshTask({
        cx,
        cz,
        value,
        generation: this.currentGeneration,
        slotIndex: slot.slotIndex,
        slotVersion: slot.version,
        dirtySectionYs,
        remeshReason: 'debug',
      })

      if (!ok) {
        continue
      }

      this.scheduler.markMeshDispatched(key)
    }

    this.scheduler.requestQueueRefresh()
  }

  // ---

  private calculateMeshValue(cx: number, cz: number, px: number, pz: number): number {
    const dx = cx - px
    const dz = cz - pz
    const distSq = dx * dx + dz * dz

    // 超出切比雪夫视距时，网格优先级直接归零。
    // 这样边界外一圈区块仍可通过邻域关系保留调度分值。
    if (Math.max(Math.abs(dx), Math.abs(dz)) > this.currentLoadDistance) {
      return 0
    }

    // 基础分数：距离越近分数越高，按距离平方反比衰减。
    let score = 10000 / (distSq + 1)

    // 优先级 1：核心安全区（3x3）始终最高优先级，不受方向影响。
    // 避免玩家原地旋转或快速转身时，脚下和紧邻的区块加载/网格化延迟
    if (distSq <= 2.5) {
      return 50000 - distSq * 1000
    }

    // 优先级 2：预判性方向偏置。
    // 参考智能区块加载思路，优先加载视线前方和移动方向的区块。
    const dirX = this.cameraDirection.x
    const dirZ = this.cameraDirection.z

    // 仅当有明确方向输入时启用（避免初始状态误判）
    if (Math.abs(dirX) > 0.01 || Math.abs(dirZ) > 0.01) {
      const dist = Math.sqrt(distSq)
      // 归一化区块方向向量
      const ndx = dx / dist
      const ndz = dz / dist

      // 点积: 1.0 = 正前方, -1.0 = 正后方, 0 = 侧面
      const dot = ndx * dirX + ndz * dirZ

      // 权重函数：大幅提升前方权重，压低后方权重
      // 权重范围约为 [0.2, 1.8]。
      // 效果示例：同距离下，正前方优先级是正后方的 9 倍
      const bias = 1.0 + dot * 0.8
      score *= bias
    }

    return score
  }

  /**
   * 释放与区块绑定的 SAB 槽位 (容错型)
   */
  private releaseSlot(chunkX: number, chunkZ: number) {
    try {
      this.sabManager.freeSlot(chunkX, chunkZ)

      const key = this.getChunkKey(chunkX, chunkZ)
      this.artifactStatsByChunk.delete(key)
      this.dirtySectionsByChunk.delete(key)
      this.dirtyRemeshReasons.delete(key)
      if (this.state.hasSlot(key)) {
        this.state.removeSlot(key)
      }

      this.scheduler.removeMeshQueued(key)
      // [SAB 零拷贝优化] 无需清理 chunkDataCache，数据直接在 SAB 中管理
    } catch (e) {
      console.warn('[ChunkDirector] releaseSlot failed', chunkX, chunkZ, e)
    }
  }

  /**
   * 取消一个尚未完成的请求，负责清理状态与槽位
   */
  private cancelRequest(id: number, key: string, markFailed = false) {
    this.state.unregisterRequest(id)
    this.requestStartTimes.delete(id)
    // `unregisterRequest` 内部已经处理 `idToKey` 清理。

    const [cx, cz] = key.split(',').map(Number)
    this.releaseSlot(cx, cz)
    if (markFailed) this.failureTracker.markChunkFailure(key)
  }

  private onWorkerPaused: ((wIdx: number) => void) | null = null
  private maintenancePromise: Promise<number> | null = null

  /**
   * 执行全局碎片整理
   * 1. 暂停所有 Worker
   * 2. 执行 SharedVoxelStore.compact()
   * 3. 恢复 Worker
   */
  private async performDefragmentation(): Promise<number> {
    if (this.maintenancePromise) return this.maintenancePromise

    // 建立暂停跟踪状态。
    const workerCount = this.workerPool.getWorkerCount()
    const allPaused = new Promise<void>(resolve => {
      const pausedSet = new Set<number>()

      // 注册暂停回调。
      this.onWorkerPaused = idx => {
        pausedSet.add(idx)
        if (pausedSet.size === workerCount) {
          resolve()
        }
      }

      // 广播暂停信号。
      this.workerPool.broadcast({ type: 'PAUSE_WORK' })

      // 安全兜底：若 Worker 卡住，超时后强制继续。
      setTimeout(() => {
        if (pausedSet.size < workerCount) {
          console.error(
            `[ChunkDirector] Defrag safety timeout! Proceeding with ${pausedSet.size}/${workerCount} paused. (Risk!)`,
          )
          // 即使未全部暂停也继续，优先解除整机阻塞。
          resolve()
        }
      }, 500)
    })

    this.maintenancePromise = (async () => {
      console.warn('[ChunkDirector] --- PAUSING World for Defragmentation (Stop-the-World) ---')

      // 1. 等待全部 Worker 暂停。
      await allPaused
      this.onWorkerPaused = null

      // 2. 执行碎片整理。
      const result = this.sabManager.compact()

      // 3. 恢复 Worker。
      this.workerPool.broadcast({ type: 'RESUME_WORK' })

      const allocatedRatio = ((result.newEnd / this.sabManager.totalBlocks) * 100).toFixed(1)
      console.warn(
        `[ChunkDirector] --- RESUMED (Moved ${result.moved} chunks, Heap used: ${allocatedRatio}%) ---`,
      )
      return result.moved
    })()

    try {
      return await this.maintenancePromise
    } finally {
      this.maintenancePromise = null
    }
  }

  /**
   * 智能驱逐策略：优先驱逐最远区块；如果最远区块仍在视距内，则缩减视距
   */
  private evictOneChunk(excludeKey: string, neededBlocks: number): boolean {
    const px = this.currentPlayerChunk.x
    const pz = this.currentPlayerChunk.z
    let maxDist = -1
    let candidateKey: string | null = null

    // 1. 寻找最远的可驱逐区块，使用切比雪夫距离匹配正方形视距逻辑。
    for (const [key, _] of this.state.getAllocatedSlots()) {
      if (key === excludeKey) continue // 跳过请求来源
      if (this.state.isFlight(key)) continue // 跳过正在处理中的区块（避免破坏 Worker 任务）

      // 跳过正在 mesh 的区块，避免与 WASM 构建流程发生竞争。
      if (this.scheduler.isChunkMeshing(key)) continue

      const [cx, cz] = key.split(',').map(Number)
      const dist = Math.max(Math.abs(cx - px), Math.abs(cz - pz))

      if (dist > maxDist) {
        maxDist = dist
        candidateKey = key
      }
    }

    if (!candidateKey) {
      // 没有可驱逐候选时，直接返回失败，交给上层决定是否缩视距或终止。
      return false
    }

    // 2. 检查是否发生容量崩塌。
    // 如果最远的可牺牲区块仍在当前视距内，说明内存已经不足以支撑当前视距。
    if (maxDist <= this.currentLoadDistance && this.currentLoadDistance > 2) {
      // 缩减视距，缩得更狠以快速恢复
      const oldDist = this.currentLoadDistance
      const newDist = Math.max(2, Math.floor(oldDist * 0.7)) // 更激进地收缩到 70%

      // 仅当新距离确实更小时，且当前不在冷却期内时才报警。
      if (newDist < this.constrainedDistance || performance.now() > this.constrainedUntil) {
        console.error(
          `[ChunkDirector] 🧐 CAPACITY COLLAPSE DETECTED! Max eviction dist ${maxDist} <= Request Dist ${this.currentLoadDistance}. Shrinking to ${newDist}! (Blocking expansion for 10s)`,
        )
      }

      this.currentLoadDistance = newDist

      // 保护期内锁定此视距，避免下一帧被 update() 重置。
      this.constrainedDistance = newDist
      this.constrainedUntil = performance.now() + 10000 // 10秒冷静期

      // 更新调度器状态，防止后续继续请求远处区块
      this.scheduler.setState(px, pz, newDist, this.currentGeneration)
    }

    // 3. 执行驱逐
    const [cx, cz] = candidateKey.split(',').map(Number)
    try {
      console.warn(
        `[ChunkDirector] OOM Eviction: ${candidateKey} (d=${maxDist.toFixed(1)}) to free ${neededBlocks} blocks`,
      )

      // 立即通知渲染层卸载网格，防止视觉残留
      this.onChunkUnloaded?.(cx, cz)

      // 清理光照缓存
      this.lightCache.delete(candidateKey)

      // 释放资源与状态
      this.releaseSlot(cx, cz)
      this.state.markUnloaded(candidateKey) // 重要：确保从 loaded 集合移除

      return true
    } catch (e) {
      console.error(`[ChunkDirector] Failed to evict chunk ${candidateKey}`, e)
      return false
    }
  }

  /**
   * 初始加载突发模式，在加载初期提升并发度
   *
   * 优化：突发并发不超过 Worker 实际处理能力
   * 每个 Worker 有 MAX_IO_INFLIGHT=256、MAX_MESH_INFLIGHT=16
   * 有效并发 = workerCount × 128 (保守估计)
   */
  private get effectiveMaxConcurrent(): number {
    const loadedCount = this.state.getLoadedChunksSet().size
    const targetArea = (2 * this.currentLoadDistance + 1) ** 2

    // 限制突发模式的上限数量，避免大视距下长时间占用高并发。
    // 256 个区块约为 16x16 区域，足够覆盖初始视野
    const burstExitThreshold = Math.min(targetArea * 0.3, 256)
    const burstReEnterThreshold = Math.min(targetArea * 0.15, 128)

    // 引入迟滞控制，避免并发限制反复跳动。
    if (this.isInitialLoad && loadedCount > burstExitThreshold) {
      this.isInitialLoad = false
    } else if (!this.isInitialLoad && loadedCount < burstReEnterThreshold) {
      this.isInitialLoad = true
    }

    // Worker 实际处理能力：基于 IO=256、Mesh=16 的配置估算。
    // 取 128 作为单个 Worker 的合理吞吐量，给 Mesh 留出余量。
    const workerCapacity = this.workerPool.getWorkerCount() * 128

    if (this.isInitialLoad) {
      // 初始加载阶段：允许更高并发以快速填充视野
      // 上限开放到 MAX_CONCURRENT_REQUESTS * 4 或 workerCapacity。
      return Math.min(workerCapacity, this.MAX_CONCURRENT_REQUESTS * 4)
    }
    // 正常阶段：维持适中的并发度，避免持续高负载导致界面卡顿。
    return Math.min(this.MAX_CONCURRENT_REQUESTS, workerCapacity) // 移除 * 1.5 倍率，保持稳定
  }

  private dispatchMeshTask(task: {
    cx: number
    cz: number
    value: number
    generation: number
    slotIndex: number
    slotVersion: number
    dirtySectionYs?: number[]
    remeshReason?: ChunkRemeshReason
  }): boolean {
    // Worker 亲和性：优先使用解析该区块的同一 Worker。
    // 这样可以确保 BlockModelManager 的 properties_registry 在 Parse 和 Mesh 阶段保持一致。
    const key = this.getChunkKey(task.cx, task.cz)
    const slotInfo = this.state.getSlot(key)
    const affinityWorkerIndex = slotInfo?.workerIndex

    let worker: Worker | null = null
    if (affinityWorkerIndex !== undefined) {
      worker = this.workerPool.getWorkerAt(affinityWorkerIndex) ?? null
    }
    // 如果亲和 Worker 不可用，回退到轮询
    if (!worker) {
      worker = this.getWorker()
    }
    if (!worker) return false

    const reqId = this.nextRequestId++

    this.state.registerRequest(reqId, key)

    // 准备邻居槽位索引
    const neighborSlotIndices: number[] = []

    // 方位顺序：N、S、E、W、NE、NW、SE、SW
    const neighborOffsets2 = [
      [0, -1],
      [0, 1],
      [1, 0],
      [-1, 0],
      [1, -1],
      [-1, -1],
      [1, 1],
      [-1, 1],
    ]

    for (const [dx, dz] of neighborOffsets2) {
      const nKey = this.getChunkKey(task.cx + dx, task.cz + dz)
      const nInfo = this.state.getSlot(nKey)
      // 缺省邻居使用 0xffffffff（u32::MAX）占位
      neighborSlotIndices.push(nInfo ? nInfo.slotIndex : 0xffffffff)
    }

    const transfer: Transferable[] = []

    worker.postMessage(
      {
        type: 'MESH_TASK',
        task: {
          id: reqId,
          chunkX: task.cx,
          chunkZ: task.cz,
          generation: task.generation,
          slotIndex: task.slotIndex,
          slotVersion: task.slotVersion,
          dirtySectionYs: task.dirtySectionYs,
          remeshReason: task.remeshReason,
          // centerData: null, // 旧版遗留字段
          // neighborData: [], // 旧版遗留字段
          neighborSlotIndices, // 直接传递 SAB 网格索引
        },
      },
      transfer,
    )
    return true
  }

  private dispatchParseTask(task: {
    cx: number
    cz: number
    score: number
    generation: number
  }): boolean {
    // 获取 Worker 及其索引，用于维持 Worker 亲和性。
    const workerInfo = this.getWorkerWithIndex()
    if (!workerInfo) return false
    const { worker, workerIndex } = workerInfo

    const reqId = this.nextRequestId++
    const key = this.getChunkKey(task.cx, task.cz)
    this.state.registerRequest(reqId, key)

    // 生产者阶段不再预先申请 SAB 槽位，改为两阶段分配。
    // 仅当已有槽位（如重新解析）时复用。
    const slot = this.state.getSlot(key)
    if (slot) {
      slot.workerIndex = workerIndex
    }

    // SAB 零拷贝优化：无需检查 chunkDataCache，直接从 SAB 读取。
    // 推进边界策略所需的邻居槽位
    const neighbors: Record<number, number> = {}
    // 编码规则：0=N、1=S、2=E、3=W
    // 如邻居已分配槽位，则传递给 Worker。
    const nKey = this.getChunkKey(task.cx, task.cz - 1)
    if (this.state.hasSlot(nKey)) neighbors[0] = this.state.getSlot(nKey)!.slotIndex
    const sKey = this.getChunkKey(task.cx, task.cz + 1)
    if (this.state.hasSlot(sKey)) neighbors[1] = this.state.getSlot(sKey)!.slotIndex
    const eKey = this.getChunkKey(task.cx + 1, task.cz)
    if (this.state.hasSlot(eKey)) neighbors[2] = this.state.getSlot(eKey)!.slotIndex
    const wKey = this.getChunkKey(task.cx - 1, task.cz)
    if (this.state.hasSlot(wKey)) neighbors[3] = this.state.getSlot(wKey)!.slotIndex

    // 主线程通过 RegionManager 异步拉取区块数据
    this.regionManager.loadChunkData(task.cx, task.cz).then(chunkData => {
      // 二次确认任务是否仍处于激活状态
      if (!this.state.activeRequests.has(reqId)) {
        // 若等待过程中被取消，直接退出；cancelRequest 已处理清理
        return
      }

      const transfer: Transferable[] = []
      if (chunkData) {
        transfer.push(chunkData.buffer)
      }

      worker.postMessage(
        {
          type: 'PARSE_TASK',
          task: {
            id: reqId,
            chunkX: task.cx,
            chunkZ: task.cz,
            generation: task.generation,
            chunkData, // 直接传输的数据
            slotIndex: slot?.slotIndex ?? -1,
            slotVersion: slot?.version ?? 0,
            neighborSlots: neighbors,
          },
        },
        transfer,
      )
    })

    return true
  }

  private getWorker(): Worker | null {
    return this.workerPool.getReadyWorker()
  }

  /** 获取 Worker 及其索引（用于 Worker 亲和性跟踪） */
  private getWorkerWithIndex(): { worker: Worker; workerIndex: number } | null {
    return this.workerPool.getReadyWorkerWithIndex()
  }

  /**
   * 解析完成后的状态反馈，对应数学模型的“波纹更新”步骤
   *
   * 当一个区块解析结束时，检查它与四个邻居是否满足可网格化条件
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleParseComplete(data: any) {
    const { id, chunkX, chunkZ, generation, meshCandidates } = data

    if (generation !== undefined && generation !== this.currentGeneration) {
      this.state.unregisterRequest(id)
      return
    }

    const key = this.getChunkKey(chunkX, chunkZ)

    // [SAB 零拷贝优化] 数据已直接写入 SAB，无需在 JS 堆中缓存

    // 释放 IO 锁
    this.state.unregisterRequest(id)
    // 标记为已解析，SAB 数据已准备完成
    this.state.markLoaded(key)
    this.scheduler.requestQueueRefresh()

    // 优先信任 Worker 返回的候选结果（分布式状态机）
    if (meshCandidates && Array.isArray(meshCandidates) && meshCandidates.length > 0) {
      for (const c of meshCandidates) {
        const cKey = this.getChunkKey(c.cx, c.cz)

        // 跳过已在网格队列中的
        if (this.scheduler.isMeshQueued(cKey)) continue

        const val = this.calculateMeshValue(
          c.cx,
          c.cz,
          this.currentPlayerChunk.x,
          this.currentPlayerChunk.z,
        )
        this.scheduler.enqueueMeshable(c.cx, c.cz, val)
      }
      return
    }

    // 波纹式更新：检查自身及四邻是否满足可网格化条件
    // 解析完成后潜在可网格化的区块：
    // 1. (chunkX, chunkZ) 自身，只要四邻都已加载
    // 2. (chunkX±1, chunkZ) 与 (chunkX, chunkZ±1)，若其余邻居也已加载
    const candidates = [
      { cx: chunkX, cz: chunkZ },
      { cx: chunkX + 1, cz: chunkZ },
      { cx: chunkX - 1, cz: chunkZ },
      { cx: chunkX, cz: chunkZ + 1 },
      { cx: chunkX, cz: chunkZ - 1 },
    ]

    for (const c of candidates) {
      const cKey = this.getChunkKey(c.cx, c.cz)

      // 跳过已在网格队列中的
      if (this.scheduler.isMeshQueued(cKey)) continue

      // 使用数学模型的可网格化条件：M(x,z)=L(x,z)∧L(N)∧L(S)∧L(E)∧L(W)
      if (this.isMeshable(c.cx, c.cz)) {
        // 计算网格优先级
        const val = this.calculateMeshValue(
          c.cx,
          c.cz,
          this.currentPlayerChunk.x,
          this.currentPlayerChunk.z,
        )
        // 移除 val > 0 的限制，边界区块也需要入队。
        // 它们虽然自身不显示，但邻居需要这些数据完成跨区块剔除。
        this.scheduler.enqueueMeshable(c.cx, c.cz, val)
      }
    }
  }

  // --- 数学权重工具（卷积调度核心） ---

  /** 当前摄像机朝向（用于视锥权重） */
  private cameraDirection: { x: number; z: number } = { x: 0, z: -1 }

  /** 设置摄像机朝向（供 useEngine 调用） */
  public setCameraDirection(dirX: number, dirZ: number) {
    const len = Math.sqrt(dirX * dirX + dirZ * dirZ)
    if (len > 0.001) {
      this.cameraDirection = { x: dirX / len, z: dirZ / len }
    }
  }

  /**
   * 检查区块是否可生成网格（所有依赖已就绪）
   *
   * 条件：M(x,z) = L(x,z) ∧ L(x,z-1) ∧ L(x,z+1) ∧ L(x+1,z) ∧ L(x-1,z)
   */
  private isMeshable(cx: number, cz: number): boolean {
    // 自身必须已加载
    if (!this.state.isLoaded(this.getChunkKey(cx, cz))) return false
    // 四邻居必须已加载
    if (!this.state.isLoaded(this.getChunkKey(cx, cz - 1))) return false // 北
    if (!this.state.isLoaded(this.getChunkKey(cx, cz + 1))) return false // 南
    if (!this.state.isLoaded(this.getChunkKey(cx + 1, cz))) return false // 东
    if (!this.state.isLoaded(this.getChunkKey(cx - 1, cz))) return false // 西
    return true
  }

  private handleTaskAborted(data: WorkerMessage) {
    const { id } = data
    if (id !== undefined && this.state.activeRequests.has(id)) {
      this.state.unregisterRequest(id)
    }
  }

  private handleBackpressure(backlog: { ioBacklog?: number; meshBacklog?: number }) {
    const totalBacklog = (backlog.ioBacklog || 0) + (backlog.meshBacklog || 0)

    // 极速响应策略。
    // 只有当积压非常严重（>50）时才稍微暂停，否则仅作轻微节流。
    // 这样可以让 Worker 尽可能保持满负荷，而不是频繁等待。
    if (totalBacklog < 50) return // 忽略轻微积压

    const pauseMs = Math.min(10 + totalBacklog, 200) // 10-200ms (原为 50-500ms)
    this.scheduler.applyBackpressure(pauseMs)
  }

  private handleWorkerStats(payload: WorkerStatsPayload) {
    const { workerId, stats } = payload
    if (workerId >= 0) {
      this.workerPool.updateStats(workerId, {
        parseReceivedPerSec: stats.parseReceived || 0,
        parseCompletedPerSec: stats.parseCompleted || 0,
        meshReceivedPerSec: stats.meshReceived || 0,
        meshCompletedPerSec: stats.meshCompleted || 0,
        meshArenaDeliveredPerSec: stats.meshArenaDelivered || 0,
        meshTransferableDeliveredPerSec: stats.meshTransferableDelivered || 0,
        arenaPoolActiveCount: stats.arenaPoolActiveCount || 0,
        arenaPooledCount: stats.arenaPooledCount || 0,
        arenaPoolHitRate: stats.arenaPoolHitRate || 0,
        avgMeshTimeMs: stats.avgMeshTimeMs || 0,
        avgMeshWasmTimeMs: stats.avgMeshWasmTimeMs || 0,
        avgMeshNormalizeTimeMs: stats.avgMeshNormalizeTimeMs || 0,
        avgMeshBuildTimeMs: stats.avgMeshBuildTimeMs || 0,
        avgMeshWasmDecodeTimeMs: stats.avgMeshWasmDecodeTimeMs || 0,
        avgMeshWasmGenerateTimeMs: stats.avgMeshWasmGenerateTimeMs || 0,
        avgMeshWasmLegacyPackTimeMs: stats.avgMeshWasmLegacyPackTimeMs || 0,
        avgMeshWasmArtifactSerializeTimeMs: stats.avgMeshWasmArtifactSerializeTimeMs || 0,
        avgMeshWasmJsBridgeTimeMs: stats.avgMeshWasmJsBridgeTimeMs || 0,
      })
    }
  }

  private handleChunkRetry(data: { neededBlocks: number; chunkX: number; chunkZ: number }) {
    const { neededBlocks, chunkX, chunkZ } = data
    const chunkKey = this.getChunkKey(chunkX, chunkZ)
    const cx = chunkX
    const cz = chunkZ

    console.warn(
      `[ChunkManager] Handling retry for ${chunkKey} with ${neededBlocks} blocks (Dynamic Expansion).`,
    )

    // 1. 清理旧的请求/状态
    const reqId = this.state.getRequestIdByKey(chunkKey)

    if (reqId !== undefined) {
      // cancelRequest 内部会调用 releaseSlot。
      this.cancelRequest(reqId, chunkKey, false)
    } else {
      // 未找到具体请求时，直接按区块坐标释放槽位。
      this.releaseSlot(cx, cz)
    }

    // 2. 申请所需大小的新槽位。
    // 上面的 releaseSlot 已经释放了旧内存。
    const alloc = this.sabManager.allocSlot(cx, cz, neededBlocks, n =>
      this.evictOneChunk(chunkKey, n),
    )

    if (!alloc) {
      if (this.sabManager.getDiagnosis().fragmentationRatio > 0.2) {
        console.warn(
          `[ChunkDirector] High fragmentation for retry ${chunkKey}. Triggering Defrag...`,
        )
        this.performDefragmentation().then(moved => {
          if (moved > 0) {
            setTimeout(() => this.handleChunkRetry(data), 0)
          } else {
            const diag = this.sabManager.getDiagnosis()
            console.error('[ChunkManager] OOM: Defrag useless. ' + JSON.stringify(diag))
            this.failureTracker.markChunkFailure(chunkKey)
          }
        })
        return
      }

      const diag = this.sabManager.getDiagnosis()
      console.error(
        `[ChunkManager] OOM during retry expansion! Cannot allocate ${neededBlocks} blocks for ${chunkKey}.` +
          `\nDiagnostics: TotalFree=${diag.totalFree}, MaxContiguous=${diag.maxContiguous}, ` +
          `Fragments=${diag.fragmentCount}, FreeSlots=${diag.freeSlots}`,
      )
      this.failureTracker.markChunkFailure(chunkKey)
      return
    }

    // 3. 注册新槽位。
    // dispatchParseTask 将复用此槽位，而不是分配默认槽位。
    this.state.setSlot(chunkKey, {
      slotIndex: alloc.slotIndex,
      version: alloc.version,
    })

    // 4. 重新派发任务。
    // 这里尝试立即重新派发；如果失败（没有可用 Worker），
    // 调度器稍后会重新拾取它，因为 inflightChunks 已被清理，
    // 且 allocatedSlots 已填充新槽位。
    this.dispatchParseTask({
      cx,
      cz,
      score: 10000, // 高优先级
      generation: this.currentGeneration,
    })
  }

  /**
   * [Two-Phase Allocation] 主线程响应 Worker 的 "Alloc Request"
   * Worker 已在 buffer 中解析出精准大小，现在只需要我们分配
   */
  private handleAllocRequest(
    data: {
      reqId: number
      generation?: number
      chunkX: number
      chunkZ: number
      bufferId: number
      neededBlocks: number
    },
    workerIndex: number,
  ) {
    const { reqId, generation, chunkX, chunkZ, bufferId, neededBlocks } = data
    const key = this.getChunkKey(chunkX, chunkZ)

    // 1. 验证请求是否仍然有效（未被取消）
    if (!this.state.activeRequests.has(reqId)) {
      console.warn(`[ChunkDirector] Ignoring Alloc for cancelled request ${reqId} (${key})`)
      return
    }

    // 2. 尝试分配（精准大小）
    const alloc = this.sabManager.allocSlot(chunkX, chunkZ, neededBlocks, n =>
      this.evictOneChunk(key, n),
    )
    if (!alloc) {
      if (this.sabManager.getDiagnosis().fragmentationRatio > 0.2) {
        console.warn(`[ChunkDirector] High fragmentation detected for ${key}. Triggering Defrag...`)
        this.performDefragmentation().then(moved => {
          if (moved > 0) {
            // 整理完成后异步重试，避免在当前调用栈内递归重入。
            setTimeout(() => {
              // 重试前再次确认请求仍然有效。
              if (!this.state.activeRequests.has(reqId)) return
              this.handleAllocRequest(data, workerIndex)
            }, 0)
          } else {
            console.error('[ChunkDirector] Defrag failed to move chunks. Aborting alloc.')
            this.cancelRequest(reqId, key, true)
          }
        })
        return
      }

      console.warn(`[ChunkDirector] OOM in AllocRequest for ${key} (blocks=${neededBlocks})`)
      this.cancelRequest(reqId, key, true)
      return
    }

    // 3. 注册新槽位
    this.state.setSlot(key, { ...alloc, workerIndex })

    // 4. 获取邻居槽位 (用于后续处理/网格化)
    const neighbors: Record<number, number> = {}
    const nKey = this.getChunkKey(chunkX, chunkZ - 1)
    if (this.state.hasSlot(nKey)) neighbors[0] = this.state.getSlot(nKey)!.slotIndex
    const sKey = this.getChunkKey(chunkX, chunkZ + 1)
    if (this.state.hasSlot(sKey)) neighbors[1] = this.state.getSlot(sKey)!.slotIndex
    const eKey = this.getChunkKey(chunkX + 1, chunkZ)
    if (this.state.hasSlot(eKey)) neighbors[2] = this.state.getSlot(eKey)!.slotIndex
    const wKey = this.getChunkKey(chunkX - 1, chunkZ)
    if (this.state.hasSlot(wKey)) neighbors[3] = this.state.getSlot(wKey)!.slotIndex

    // 5. 回复 Worker
    const worker = this.workerPool.getWorkerAt(workerIndex)
    if (worker) {
      worker.postMessage({
        type: 'ALLOC_RESPONSE',
        id: reqId,
        generation,
        bufferId,
        chunkX,
        chunkZ,
        slotIndex: alloc.slotIndex,
        slotVersion: alloc.version,
        neighborSlots: neighbors,
      })
    } else {
      console.error(`[ChunkDirector] Worker ${workerIndex} not found for Alloc Reply`)
      this.releaseSlot(chunkX, chunkZ)
      this.cancelRequest(reqId, key)
    }
  }

  private handleInitComplete(workerIndex: number) {
    this.workerPool.markReady(workerIndex)
    console.log(`[ChunkManager] Worker ${workerIndex} initialized.`)

    // 至少有一个 Worker 就绪即可开始调度，其余 Worker 可延迟补齐
    // 只要派发逻辑检查就绪状态即可容忍部分 Worker 延迟初始化
    this.isWorkerReady = true

    this.onWorkerInit?.()
  }

  private handleChunkUpdate(data: WorkerMessage) {
    const { chunkX, chunkZ, generation, geometry, artifact, dirtySectionYs, remeshReason } = data

    if (generation !== undefined && generation !== this.currentGeneration) {
      return
    }

    if (chunkX !== undefined && chunkZ !== undefined) {
      if (remeshReason === 'debug') {
        debugLog(DEBUG_FLAGS.chunk, '[ChunkDirector] debug remesh chunkUpdate', {
          chunkX,
          chunkZ,
          generation,
          dirtySectionYs: dirtySectionYs?.length ?? 0,
          artifact: !!artifact,
          geometry: !!geometry,
        })
      }

      const key = this.getChunkKey(chunkX, chunkZ)
      this.dirtySectionsByChunk.delete(key)
      this.dirtyRemeshReasons.delete(key)
      if (artifact) {
        this.artifactStatsByChunk.set(key, this.summarizeArtifact(artifact))
      }
      this.reportDirtySectionChain(chunkX, chunkZ, dirtySectionYs, remeshReason, artifact, geometry)
      this.onChunkLoaded?.(chunkX, chunkZ, geometry ?? null, artifact, dirtySectionYs)
    }
  }

  private handleChunkLoaded(data: WorkerMessage) {
    const {
      id,
      generation,
      geometry,
      artifact,
      error,
      chunkX,
      chunkZ,
      lights,
      dirtySectionYs,
      remeshReason,
    } = data
    if (!id) return

    if (generation !== undefined && generation !== this.currentGeneration) {
      this.requestStartTimes.delete(id)
      this.state.unregisterRequest(id)
      return
    }

    const key = this.state.getRequestKey(id)

    // 立即解除请求注册，清理 active/inflight 状态
    this.state.unregisterRequest(id)

    // 1. 处理光源数据
    if (lights && chunkX !== undefined && chunkZ !== undefined) {
      const chunkKey = this.getChunkKey(chunkX, chunkZ)
      this.lightCache.setLights(chunkKey, lights)
    }

    // 2. 清理请求状态 (已通过 unregisterRequest 处理)
    this.requestStartTimes.delete(id)

    if (error) {
      this.handleChunkError(id, key, error)
    } else {
      // 成功加载
      // 触发邻居更新逻辑
      // 仅当这是一个新加载的区块时才触发邻居更新，避免递归更新
      // 保持原有逻辑：首次加载成功才尝试联动邻居
      if (key && chunkX !== undefined && chunkZ !== undefined) {
        // [拦截检查] 检查是否已经超出卸载范围（切比雪夫距离）
        const unloadDist = this.currentLoadDistance + GAME_CONFIG.CHUNK.UNLOAD_BUFFER
        const dx = chunkX - this.currentPlayerChunk.x
        const dz = chunkZ - this.currentPlayerChunk.z
        if (Math.max(Math.abs(dx), Math.abs(dz)) > unloadDist) {
          // 已超出卸载范围，立即释放槽位并丢弃
          this.lightCache.delete(key)
          this.releaseSlot(chunkX, chunkZ)
          return
        }

        // 标记该区块已完成 mesh，防止 Scheduler 重复入队。
        this.scheduler.markMeshed(key)
        this.dirtySectionsByChunk.delete(key)
        this.dirtyRemeshReasons.delete(key)
        if (artifact) {
          this.artifactStatsByChunk.set(key, this.summarizeArtifact(artifact))
        }
        this.reportDirtySectionChain(
          chunkX,
          chunkZ,
          dirtySectionYs,
          remeshReason,
          artifact,
          geometry,
        )

        // 只在首次加载时触发邻居更新。
        this.state.markLoaded(key)
        this.onChunkLoaded?.(chunkX, chunkZ, geometry ?? null, artifact, dirtySectionYs)
      }
    }
  }

  private handleChunkError(id: number, key: string | undefined, error: string) {
    console.warn(`[ChunkManager] Chunk load error (id=${id}):`, error)
    if (!key) return

    this.failureTracker.markChunkFailure(key)

    // 释放槽位，避免 SAB 泄漏。
    const [cx, cz] = key.split(',').map(Number)
    this.releaseSlot(cx, cz)

    // 区域级错误处理
    const rx = Math.floor(cx / 32)
    const rz = Math.floor(cz / 32)
    const regionKey = `${rx},${rz}`

    if (error.includes('404') || error.includes('status: 404')) {
      this.failureTracker.markRegionFailure(regionKey, 5)
    } else if (error.includes('Failed to fetch') || error.includes('NetworkError')) {
      this.failureTracker.markRegionFailure(regionKey, 3)
    }
  }

  private handleBlockStateSyncResult(data: WorkerMessage) {
    const workerId = data.workerId ?? INVALID_WORKER_ID
    const blockState = data.blockState ?? '<unknown>'
    const ok = data.ok === true
    const blockStateId = data.blockStateId ?? INVALID_WORKER_ID
    if (!blockState.trim()) {
      return
    }

    if (ok) {
      return
    }

    console.error(
      `[ChunkDirector] Worker ${workerId} failed to sync blockstate ${blockState} (id=${blockStateId}). ${data.error ?? ''}`.trim(),
    )
  }

  private handleDescribeBlockStateResult(data: WorkerMessage) {
    const requestId = data.requestId ?? 0
    const pending = this.resolvePendingDescribeBlockStateRequest(requestId)
    if (!pending) {
      return
    }

    const blockState = data.blockState?.trim() ?? ''
    if (data.ok === true && blockState.length > 0) {
      pending.resolve(blockState)
      return
    }

    console.error(
      `[ChunkDirector] Worker ${data.workerId ?? INVALID_WORKER_ID} failed to describe blockstate id ${data.blockStateId ?? INVALID_WORKER_ID}. ${data.error ?? ''}`.trim(),
    )
    pending.resolve(null)
  }

  /**
   * 初始化区块管理器
   * 加载方块定义、模型模板和剔除掩码，并广播给所有 Worker。
   * @param textureMap 纹理映射表
   * @param resource 资源定义配置
   */
  async init(
    textureMap: Map<string, number> | Record<string, number>,
    resource: ResourceDefinition,
  ) {
    const textureObj =
      textureMap instanceof Map ? Object.fromEntries(textureMap.entries()) : textureMap
    resolveResourceEndpoints(resource)

    console.log('[ChunkManager] Fetching resources for', resource.key)

    try {
      // 唯一源：加载二进制资源文件 (Zlib/JSON 格式)
      // 使用 .bin.deflate 明确表示它是压缩过的，与纹理的命名习惯一致
      const binary = await loadResourceBinary(resource)

      console.log('[ChunkManager] Using binary resource format')

      const msg = {
        type: 'init',
        textureMap: textureObj,
        resource,
        binary,
        mesherOptions: this.createMesherOptions(),
      }
      this.workerPool.broadcast(msg)
    } catch (error) {
      console.error('[ChunkManager] Failed to fetch resources:', error)
    }
  }

  /**
   * 设置基础路径
   * @param path 基础路径
   */
  setBasePath(path: string) {
    this.basePath = path
    this.regionManager.setBasePath(path)
    if (!this.regionUrlResolver) {
      this.regionUrlResolver = (rx, rz) => `${path}/r.${rx}.${rz}.mca`
      this.regionManager.setRegionUrlResolver(this.regionUrlResolver)
    }
  }

  /**
   * 设置区域 URL 解析器
   * @param resolver 解析函数
   */
  setRegionUrlResolver(resolver: (regionX: number, regionZ: number) => string) {
    this.regionUrlResolver = resolver
    this.regionManager.setRegionUrlResolver(resolver)
  }

  /**
   * 获取 Worker 统计信息（数组每项对应一个 Worker）
   */
  public getWorkerStats() {
    return this.workerPool.getStats()
  }

  public getStorageStats() {
    return this.sabManager.getStorageStats()
  }

  /**
   * 检查区块是否已加载
   * @param x 区块 X 坐标
   * @param z 区块 Z 坐标
   * @returns 是否已加载
   */
  isChunkLoaded(x: number, z: number): boolean {
    return this.state.isLoaded(this.getChunkKey(x, z))
  }

  /**
   * update：区块调度核心（原始版）
   * 仅保留“近到远 + 视锥优先”的切比雪夫排序，移除其他调度策略
   */
  async update(playerX: number, playerZ: number, distance: number): Promise<void> {
    const px = playerX
    const pz = playerZ
    const d = distance
    const distSq = (px - this.currentPlayerChunk.x) ** 2 + (pz - this.currentPlayerChunk.z) ** 2

    // 传送或剧烈移动检测。
    // 当玩家单帧瞬间移动超过 16 个区块 (256米) 时，判定为传送
    // 此时无需等待轮询，必须立即执行激进的垃圾回收和队列重置
    const isTeleport = distSq > 16 * 16

    this.currentPlayerChunk = { x: px, z: pz }

    let effectiveDistance = d

    // 如果处于容量限制恢复期，强制使用较小的视距。
    if (this.constrainedDistance > 0) {
      if (performance.now() < this.constrainedUntil) {
        effectiveDistance = Math.min(d, this.constrainedDistance)
      } else {
        // 逐步恢复视距，避免瞬间再次撑爆内存。
        if (this.constrainedDistance < d) {
          // 冷却结束后每次只恢复 1 格视距。
          this.constrainedDistance += 1
          // 2 秒后再尝试下一次恢复。
          this.constrainedUntil = performance.now() + 2000
          effectiveDistance = Math.min(d, this.constrainedDistance)
          console.log(`[ChunkDirector] Recovering Load Distance: ${effectiveDistance}/${d}`)
        } else {
          // 完全恢复
          this.constrainedDistance = -1
          console.log('[ChunkDirector] Capacity Constraint Lifted.')
        }
      }
    }

    this.currentLoadDistance = effectiveDistance
    this.scheduler.setState(px, pz, effectiveDistance, this.currentGeneration)

    const now = performance.now()
    const unloadDist = d + GAME_CONFIG.CHUNK.UNLOAD_BUFFER // 切比雪夫卸载距离

    if (isTeleport) {
      console.warn(
        `[ChunkDirector] Teleport detected! (${Math.sqrt(distSq).toFixed(1)} blocks). Executing aggressive GC.`,
      )
      // 1. 立即清除调度器中的无效任务。
      // 这会移除所有不在此刻视野范围内的新任务。
      this.scheduler.reset()

      // 2. 强制触发一次立即的满量卸载。
      // 将 lastUnloadCheckTime 重置为 0，确保下方逻辑能够立刻执行。
      this.lastUnloadCheckTime = 0

      // 3. 复位初始加载状态，以触发突发模式快速渲染新区域。
      this.isInitialLoad = true
    }

    // 1. 简单卸载检测（定期执行 或 传送时强制执行）
    if (now - this.lastUnloadCheckTime > this.UNLOAD_CHECK_INTERVAL) {
      this.lastUnloadCheckTime = now

      // 先收集待卸载区块，避免遍历时直接修改集合。
      const toUnload: Array<{ key: string; cx: number; cz: number }> = []

      for (const key of this.state.getLoadedChunksSet()) {
        const [cxStr, czStr] = key.split(',')
        const cx = parseInt(cxStr)
        const cz = parseInt(czStr)
        const dx = cx - px
        const dz = cz - pz

        if (Math.max(Math.abs(dx), Math.abs(dz)) > unloadDist) {
          toUnload.push({ key, cx, cz })
        }
      }

      // 执行卸载
      for (const { key, cx, cz } of toUnload) {
        // 卸载前必须取消 inflight 请求，避免 Worker 回调把区块重新激活。
        const pendingReqId = this.state.getRequestIdByKey(key)
        if (pendingReqId !== undefined) {
          // 卸载场景只做静默取消，不记为失败。
          this.cancelRequest(pendingReqId, key, false)
        }

        this.state.markUnloaded(key)
        // 注意：ChunkLights 卸载逻辑保持一致
        this.lightCache.delete(key)
        // 确保 Slot 和 Scheduler 状态被清理
        this.releaseSlot(cx, cz)
        this.onChunkUnloaded?.(cx, cz)
      }

      // 触发一次 GC
      this.scheduleRegionGC(px, pz, d + GAME_CONFIG.CHUNK.UNLOAD_BUFFER)
    }

    this.flushDirtySectionRemeshes()
  }

  /**
   * 判断区块是否应该加载
   * @param x 区块 X 坐标
   * @param z 区块 Z 坐标
   * @returns 是否应该加载
   */
  private shouldLoadChunk(x: number, z: number): boolean {
    const key = this.getChunkKey(x, z)

    // 已加载
    if (this.state.isLoaded(key)) return false

    // 初始加载阶段不过度受失败退避影响，优先铺满视野
    if (this.isInitialLoad) return true

    const regionKey = `${Math.floor(x / 32)},${Math.floor(z / 32)}`
    if (!this.failureTracker.canLoadRegion(regionKey)) return false
    if (!this.failureTracker.canLoadChunk(key, this.RETRY_DELAY)) return false

    return true
  }

  /**
   * 调度区域垃圾回收，通知 Worker 卸载不再需要的区域数据
   * @param px 玩家 X 坐标
   * @param pz 玩家 Z 坐标
   * @param unloadDist 卸载距离
   */
  private scheduleRegionGC(px: number, pz: number, unloadDist: number) {
    const minX = px - unloadDist
    const maxX = px + unloadDist
    const minZ = pz - unloadDist
    const maxZ = pz + unloadDist

    const minRX = Math.floor(minX / 32)
    const maxRX = Math.floor(maxX / 32)
    const minRZ = Math.floor(minZ / 32)
    const maxRZ = Math.floor(maxZ / 32)

    const keepRegions: string[] = []
    for (let rx = minRX; rx <= maxRX; rx++) {
      for (let rz = minRZ; rz <= maxRZ; rz++) {
        keepRegions.push(`${rx},${rz}`)
      }
    }

    // 向所有 Worker 广播 GC 消息，同时传递玩家坐标用于 WASM 缓存清理
    const msg = {
      type: 'gc',
      keepRegions,
      playerCX: px,
      playerCZ: pz,
      maxDistance: Math.ceil(unloadDist * 1.2), // 保留稍大范围的 WASM 缓存
    }
    this.workerPool.broadcast(msg)
  }

  /**
   * 检查请求是否超时
   */
  private checkTimeouts() {
    const now = performance.now()
    for (const [id, startTime] of this.requestStartTimes) {
      if (now - startTime > this.REQUEST_TIMEOUT) {
        console.warn(`[ChunkManager] Request ${id} timed out`)
        const key = this.state.getRequestKey(id)
        if (key) {
          this.state.unregisterRequest(id)
          this.failureTracker.markChunkFailure(key)

          const [cx, cz] = key.split(',').map(Number)
          const rx = Math.floor(cx / 32)
          const rz = Math.floor(cz / 32)
          const rKey = `${rx},${rz}`
          // 超时按区域请求失败处理，使用较短退避。
          this.failureTracker.markRegionFailure(rKey, 3)

          // 释放槽位。
          this.releaseSlot(cx, cz)
        } else {
          // 未找到 key 时至少先释放请求占用状态。
          this.state.unregisterRequest(id)
        }
        this.requestStartTimes.delete(id)
      }
    }
  }

  /**
   * 获取区块唯一键
   * @param x 区块 X 坐标
   * @param z 区块 Z 坐标
   * @returns 唯一键字符串 "x,z"
   */
  private getChunkKey(x: number, z: number) {
    return `${x},${z}`
  }

  public getActiveRequestCount() {
    return this.state.getPendingCount()
  }

  public getQueuedRequestCount() {
    return 0
  }

  public getCurrentQueueCount() {
    return 0
  }

  /**
   * 获取聚合后的光源数据 (带脏标记优化)
   * 只有当 chunkLights 变化时才重新聚合，避免每帧 O(n) 遍历
   */
  public getAggregatedLights(): Float32Array {
    return this.lightCache.getAggregatedLights(this.lightingConfig.enablePointLights)
  }

  public getAggregatedLightsForChunks(chunkKeys: readonly string[]): Float32Array {
    return this.lightCache.getAggregatedLights(this.lightingConfig.enablePointLights, chunkKeys)
  }

  public getChunkArtifact(chunkX: number, chunkZ: number): ChunkArtifactDescriptorInput | null {
    void chunkX
    void chunkZ
    return null
  }

  public getArtifactStats() {
    let sectionCount = 0
    let itemCount = 0

    for (const artifact of this.artifactStatsByChunk.values()) {
      sectionCount += artifact.sectionCount
      itemCount += artifact.itemCount
    }

    return {
      chunkCount: this.artifactStatsByChunk.size,
      sectionCount,
      itemCount,
    }
  }

  private summarizeArtifact(artifact: ChunkArtifactDescriptorInput) {
    return {
      sectionCount: getChunkArtifactSectionCount(artifact),
      itemCount: getChunkArtifactItemCount(artifact),
    }
  }

  public getDirtyRemeshStats() {
    let sectionCount = 0

    for (const sections of this.dirtySectionsByChunk.values()) {
      sectionCount += sections.size
    }

    return {
      chunkCount: this.dirtySectionsByChunk.size,
      sectionCount,
    }
  }

  public requestBlockUpdate(update: BlockUpdateRequest): void {
    const reason = update.reason ?? 'block-update'
    const chunkX = Math.floor(update.worldX / GAME_CONFIG.CHUNK.SIZE)
    const chunkZ = Math.floor(update.worldZ / GAME_CONFIG.CHUNK.SIZE)
    const sectionY = Math.floor(update.worldY / 16)

    this.markSectionDirty(chunkX, sectionY, chunkZ, reason)

    if (update.includeNeighborChunks) {
      const localX = ((update.worldX % 16) + 16) % 16
      const localZ = ((update.worldZ % 16) + 16) % 16

      if (localX === 0) this.markSectionDirty(chunkX - 1, sectionY, chunkZ, 'neighbor-update')
      if (localX === 15) this.markSectionDirty(chunkX + 1, sectionY, chunkZ, 'neighbor-update')
      if (localZ === 0) this.markSectionDirty(chunkX, sectionY, chunkZ - 1, 'neighbor-update')
      if (localZ === 15) this.markSectionDirty(chunkX, sectionY, chunkZ + 1, 'neighbor-update')
    }
  }

  public getBlockStateId(worldX: number, worldY: number, worldZ: number): number | null {
    return this.sabManager.getBlockStateId(worldX, worldY, worldZ)
  }

  public setBlockStateId(params: {
    worldX: number
    worldY: number
    worldZ: number
    blockStateId: number
    includeNeighborChunks?: boolean
    reason?: Extract<ChunkRemeshReason, 'block-update' | 'neighbor-update' | 'debug'>
  }): {
    changed: boolean
    previousBlockStateId: number | null
    overflowBytes: number
  } {
    let result = this.sabManager.setBlockStateId({
      worldX: params.worldX,
      worldY: params.worldY,
      worldZ: params.worldZ,
      blockStateId: params.blockStateId,
    })

    if (!result) {
      return { changed: false, previousBlockStateId: null, overflowBytes: 0 }
    }

    if (!result.changed && result.overflowBytes > 0) {
      const expanded = this.expandChunkSlotForEdit(
        result.chunkX,
        result.chunkZ,
        result.overflowBytes,
      )
      if (expanded) {
        result = this.sabManager.setBlockStateId({
          worldX: params.worldX,
          worldY: params.worldY,
          worldZ: params.worldZ,
          blockStateId: params.blockStateId,
        })
      }
    }

    if (!result) {
      return { changed: false, previousBlockStateId: null, overflowBytes: 0 }
    }

    if (!result.changed && result.overflowBytes > 0) {
      console.warn(
        `[ChunkDirector] Block edit overflow at ${result.chunkX},${result.chunkZ}; missing ${result.overflowBytes} bytes in current slot.`,
      )
    }

    if (result.changed) {
      const key = this.getChunkKey(result.chunkX, result.chunkZ)
      const slot = this.state.getSlot(key)
      if (slot) {
        this.state.setSlot(key, {
          ...slot,
          version: result.version,
        })
      }

      const traceId = this.recordPendingEditDiagnostic(
        result.chunkX,
        result.sectionY,
        result.chunkZ,
        params.worldX,
        params.worldY,
        params.worldZ,
        params.blockStateId,
      )
      console.log(
        `[ChunkDirector][EditTrace ${traceId}] wrote block edit chunk=${result.chunkX},${result.chunkZ} sectionY=${result.sectionY} world=${params.worldX},${params.worldY},${params.worldZ} prev=${result.previousBlockStateId} next=${params.blockStateId} version=${result.version}`,
      )

      this.requestBlockUpdate({
        worldX: params.worldX,
        worldY: params.worldY,
        worldZ: params.worldZ,
        includeNeighborChunks: params.includeNeighborChunks ?? true,
        reason: params.reason ?? 'block-update',
      })
    }

    return {
      changed: result.changed,
      previousBlockStateId: result.previousBlockStateId,
      overflowBytes: result.overflowBytes,
    }
  }

  public ensureBlockStateRegistered(blockState: string): boolean {
    const normalized = normalizeResolvableBlockState(blockState)
    if (!normalized) {
      return false
    }

    if (this.syncedBlockStates.has(normalized)) {
      return true
    }

    this.syncedBlockStates.add(normalized)
    this.workerPool.broadcast({
      type: 'ENSURE_BLOCKSTATE',
      blockState: normalized,
    })
    return true
  }

  public describeBlockStateAt(
    worldX: number,
    worldY: number,
    worldZ: number,
  ): Promise<string | null> {
    const blockStateId = this.getBlockStateId(worldX, worldY, worldZ)
    if (blockStateId === null || blockStateId < 0) {
      return Promise.resolve(null)
    }

    const chunkX = Math.floor(worldX / BLOCK_SIZE)
    const chunkZ = Math.floor(worldZ / BLOCK_SIZE)
    const worker = this.resolveWorkerForChunk(chunkX, chunkZ)
    if (!worker) {
      return Promise.resolve(null)
    }

    const requestId = this.nextRequestId++
    return new Promise(resolve => {
      const timeoutId = window.setTimeout(() => {
        const pending = this.resolvePendingDescribeBlockStateRequest(requestId)
        if (!pending) {
          return
        }

        console.error(
          `[ChunkDirector] Timed out describing blockstate id ${blockStateId} for chunk=${chunkX},${chunkZ}`,
        )
        pending.resolve(null)
      }, this.DESCRIBE_BLOCKSTATE_TIMEOUT)

      this.pendingDescribeBlockStateRequests.set(requestId, { timeoutId, resolve })

      worker.postMessage({
        type: 'DESCRIBE_BLOCKSTATE',
        requestId,
        blockStateId,
      })
    })
  }

  public requestSectionRemesh(request: DirtySectionRemeshRequest): void {
    for (const sectionY of request.dirtySectionYs) {
      this.markSectionDirty(request.chunkX, sectionY, request.chunkZ, request.reason)
    }
  }

  public flushDirtySectionRemeshes(): number {
    let dispatched = 0

    for (const [key, sections] of [...this.dirtySectionsByChunk]) {
      if (sections.size === 0) {
        this.dirtySectionsByChunk.delete(key)
        this.dirtyRemeshReasons.delete(key)
        continue
      }

      if (this.state.isFlight(key) || this.scheduler.isMeshQueued(key)) {
        continue
      }

      const [cx, cz] = key.split(',').map(Number)
      if (!this.isMeshable(cx, cz)) {
        continue
      }

      const slot = this.state.getSlot(key)
      if (!slot) {
        continue
      }

      const dirtySectionYs = [...sections].sort((a, b) => a - b)
      const value = this.calculateMeshValue(
        cx,
        cz,
        this.currentPlayerChunk.x,
        this.currentPlayerChunk.z,
      )
      const ok = this.dispatchMeshTask({
        cx,
        cz,
        value,
        generation: this.currentGeneration,
        slotIndex: slot.slotIndex,
        slotVersion: slot.version,
        dirtySectionYs,
        remeshReason: this.dirtyRemeshReasons.get(key) ?? 'block-update',
      })

      if (ok) {
        const pending = this.pendingEditDiagnostics.get(key)
        if (pending && pending.size > 0) {
          const traces = [...pending.entries()]
            .filter(([sectionY]) => sections.has(sectionY))
            .map(([sectionY, diagnostic]) => `${diagnostic.traceId}@${sectionY}`)
          if (traces.length > 0) {
            console.log(
              `[ChunkDirector][EditTrace dispatch] chunk=${cx},${cz} dirty=[${dirtySectionYs.join(',')}] reason=${this.dirtyRemeshReasons.get(key) ?? 'block-update'} traces=[${traces.join(',')}]`,
            )
          }
        }
        this.dirtySectionsByChunk.delete(key)
        this.dirtyRemeshReasons.delete(key)
        dispatched += 1
      }
    }

    return dispatched
  }

  /**
   * 清空所有状态，用于场景重建或材质切换 (稳定重置)
   */
  public clear() {
    const loadedChunks = Array.from(this.state.getLoadedChunksSet())

    for (const key of loadedChunks) {
      const [cxStr, czStr] = key.split(',')
      const cx = Number.parseInt(cxStr, 10)
      const cz = Number.parseInt(czStr, 10)
      if (!Number.isFinite(cx) || !Number.isFinite(cz)) {
        continue
      }

      this.onChunkUnloaded?.(cx, cz)
    }

    this.state.reset()
    this.requestStartTimes.clear()
    this.isInitialLoad = true // 重置为初始加载模式
    this.currentPlayerChunk = { x: 0, z: 0 }
    this.lastPlayerChunk = null
    this.lastUnloadCheckTime = 0
    this.constrainedDistance = -1
    this.constrainedUntil = 0

    this.scheduler.reset()
    this.sabManager.clear()
    this.lightCache.clear()
    this.artifactStatsByChunk.clear()
    this.dirtySectionsByChunk.clear()
    this.dirtyRemeshReasons.clear()
    this.syncedBlockStates.clear()
    this.pendingEditDiagnostics.clear()
    this.disposePendingDescribeBlockStateRequests()

    // 增加 generation，让残留的异步回调失效
    this.currentGeneration++

    console.log(`[ChunkManager] State cleared. Generation: ${this.currentGeneration}`)
  }

  /**
   * 销毁管理器，释放资源
   */
  terminate() {
    clearInterval(this.checkTimeoutInterval)
    this.disposePendingDescribeBlockStateRequests()
    this.workerPool.terminate()
  }

  private resolveWorkerForChunk(chunkX: number, chunkZ: number) {
    const key = this.getChunkKey(chunkX, chunkZ)
    const workerIndex = this.state.getSlot(key)?.workerIndex
    if (workerIndex !== undefined) {
      const worker = this.workerPool.getWorkerAt(workerIndex)
      if (worker) {
        return worker
      }
    }

    return this.getWorker()
  }

  private resolvePendingDescribeBlockStateRequest(requestId: number) {
    const pending = this.pendingDescribeBlockStateRequests.get(requestId)
    if (!pending) {
      return null
    }

    clearTimeout(pending.timeoutId)
    this.pendingDescribeBlockStateRequests.delete(requestId)
    return pending
  }

  private disposePendingDescribeBlockStateRequests() {
    for (const pending of this.pendingDescribeBlockStateRequests.values()) {
      clearTimeout(pending.timeoutId)
      pending.resolve(null)
    }
    this.pendingDescribeBlockStateRequests.clear()
  }

  private markSectionDirty(
    chunkX: number,
    sectionY: number,
    chunkZ: number,
    reason: ChunkRemeshReason,
  ) {
    const key = this.getChunkKey(chunkX, chunkZ)
    let sections = this.dirtySectionsByChunk.get(key)
    if (!sections) {
      sections = new Set<number>()
      this.dirtySectionsByChunk.set(key, sections)
    }

    sections.add(sectionY)

    const existingReason = this.dirtyRemeshReasons.get(key)
    if (existingReason !== 'debug') {
      this.dirtyRemeshReasons.set(key, reason)
    }
  }

  private recordPendingEditDiagnostic(
    chunkX: number,
    sectionY: number,
    chunkZ: number,
    worldX: number,
    worldY: number,
    worldZ: number,
    blockStateId: number,
  ) {
    const traceId = this.nextEditTraceId++
    const key = this.getChunkKey(chunkX, chunkZ)
    let sectionMap = this.pendingEditDiagnostics.get(key)
    if (!sectionMap) {
      sectionMap = new Map<number, PendingEditDiagnostic>()
      this.pendingEditDiagnostics.set(key, sectionMap)
    }

    sectionMap.set(sectionY, {
      traceId,
      worldX,
      worldY,
      worldZ,
      blockStateId,
      recordedAtMs: performance.now(),
    })

    return traceId
  }

  private reportDirtySectionChain(
    chunkX: number,
    chunkZ: number,
    dirtySectionYs: number[] | undefined,
    remeshReason: ChunkRemeshReason | undefined,
    artifact: ChunkArtifactDescriptorInput | undefined,
    geometry: ChunkGeometryData | null | undefined,
  ) {
    if (!dirtySectionYs || dirtySectionYs.length === 0) {
      return
    }

    const key = this.getChunkKey(chunkX, chunkZ)
    const pending = this.pendingEditDiagnostics.get(key)
    if (!pending || pending.size === 0) {
      return
    }

    const descriptor = resolveChunkArtifactDescriptor(artifact)
    const artifactSectionYs = new Set(descriptor?.sections.map(section => section.sectionY) ?? [])
    for (const sectionY of dirtySectionYs) {
      const diagnostic = pending.get(sectionY)
      if (!diagnostic) {
        continue
      }

      const ageMs = Math.round(performance.now() - diagnostic.recordedAtMs)
      console.log(
        `[ChunkDirector][EditTrace ${diagnostic.traceId}] remesh returned chunk=${chunkX},${chunkZ} dirtySectionY=${sectionY} reason=${remeshReason ?? 'unknown'} artifact=${artifact ? 'present' : 'null'} geometry=${geometry ? 'present' : 'null'} ageMs=${ageMs}`,
      )
      if (!artifact) {
        console.error(
          `[ChunkDirector][EditTrace ${diagnostic.traceId}] remesh returned no artifact for chunk=${chunkX},${chunkZ} sectionY=${sectionY} reason=${remeshReason ?? 'unknown'} world=${diagnostic.worldX},${diagnostic.worldY},${diagnostic.worldZ} block=${diagnostic.blockStateId} ageMs=${ageMs}`,
        )
      } else if (!artifactSectionYs.has(sectionY)) {
        console.error(
          `[ChunkDirector][EditTrace ${diagnostic.traceId}] remesh missing target section artifact for chunk=${chunkX},${chunkZ} sectionY=${sectionY} reason=${remeshReason ?? 'unknown'} world=${diagnostic.worldX},${diagnostic.worldY},${diagnostic.worldZ} block=${diagnostic.blockStateId} artifactSections=[${[...artifactSectionYs].sort((a, b) => a - b).join(',')}] items=${descriptor?.itemCount ?? 0} geometry=${geometry ? 'present' : 'null'} ageMs=${ageMs}`,
        )
      } else {
        console.log(
          `[ChunkDirector][EditTrace ${diagnostic.traceId}] remesh included target section ${sectionY}; artifactSections=[${[...artifactSectionYs].sort((a, b) => a - b).join(',')}] items=${descriptor?.itemCount ?? 0}`,
        )
      }

      pending.delete(sectionY)
    }

    if (pending.size === 0) {
      this.pendingEditDiagnostics.delete(key)
    }
  }

  private expandChunkSlotForEdit(chunkX: number, chunkZ: number, overflowBytes: number) {
    const key = this.getChunkKey(chunkX, chunkZ)
    const slot = this.state.getSlot(key)
    if (!slot) {
      return null
    }

    const currentBlocks = this.sabManager.getSlotBlockCount(slot.slotIndex)
    const extraBlocks = Math.max(1, Math.ceil(overflowBytes / BLOCK_SIZE))
    const requiredBlocks = currentBlocks + extraBlocks
    const resized = this.sabManager.resizeChunkSlot(chunkX, chunkZ, requiredBlocks, needed =>
      this.evictOneChunk(key, needed),
    )

    if (!resized) {
      return null
    }

    this.state.setSlot(key, {
      ...slot,
      slotIndex: resized.slotIndex,
      version: resized.version,
    })

    console.log(
      `[ChunkDirector] Expanded edit slot for ${key} from ${currentBlocks} to ${requiredBlocks} blocks.`,
    )

    return resized
  }
}
