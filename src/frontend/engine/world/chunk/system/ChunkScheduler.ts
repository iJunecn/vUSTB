/**
 * @file ChunkScheduler.ts
 * @brief 区块任务调度器
 *
 * 说明：
 *  - 维护 parse 与 mesh 两条任务队列
 *  - 基于玩家位置、加载半径与背压状态决定派发节奏
 *  - 仅负责调度，不直接操作 Worker 或 SAB 细节
 */

export interface MeshTask {
  cx: number
  cz: number
  value: number
  generation: number
  slotIndex: number
  slotVersion: number
}

export interface ParseTask {
  cx: number
  cz: number
  score: number
  generation: number
}

export interface ChunkSchedulerDeps {
  loadedChunks: Set<string>
  inflightChunks: Set<string>
  allocatedSlots: Map<string, { slotIndex: number; version: number }>
  // `chunkDataCache` 已移除，任务数据通过 SAB 共享。
  getChunkKey: (x: number, z: number) => string
  shouldLoadChunk: (x: number, z: number) => boolean
  calculateMeshValue: (cx: number, cz: number, px: number, pz: number) => number
  dispatchMeshTask: (task: MeshTask) => boolean
  dispatchParseTask: (task: ParseTask) => boolean
  effectiveMaxConcurrent: () => number
  getActiveRequestCount: () => number
}

// 只负责排队与派发策略，不直接访问 SAB 或 Worker 实例。
export class ChunkScheduler {
  private readonly loadedChunks: Set<string>
  private readonly inflightChunks: Set<string>
  private readonly allocatedSlots: Map<string, { slotIndex: number; version: number }>
  // `chunkDataCache` 已移除，调度层只关心槽位元数据。
  private readonly getChunkKey: (x: number, z: number) => string
  private readonly shouldLoadChunk: (x: number, z: number) => boolean
  private readonly calculateMeshValue: (cx: number, cz: number, px: number, pz: number) => number
  private readonly dispatchMeshTask: (task: MeshTask) => boolean
  private readonly dispatchParseTask: (task: ParseTask) => boolean
  private readonly effectiveMaxConcurrent: () => number
  private readonly getActiveRequestCount: () => number

  private parseQueue: ParseTask[] = []
  private meshQueue: MeshTask[] = []
  private inParseQueue = new Set<string>() // 解析队列去重，避免重复排队
  private inMeshQueue = new Set<string>() // 网格队列去重
  private meshingChunks = new Set<string>() // 正在执行 mesh 的区块
  private meshedChunks = new Set<string>() // 本轮已 mesh 完成的区块

  private currentPlayerChunk = { x: 0, z: 0 }
  private lastPlayerChunk: { x: number; z: number } | null = null
  private currentLoadDistance = 0
  private currentGeneration = 0
  private queueRefreshRequested = true

  // 背压状态。
  private backpressureActive = false
  private backpressureUntil = 0

  private tickTimer: number | null = null

  constructor(deps: ChunkSchedulerDeps) {
    this.loadedChunks = deps.loadedChunks
    this.inflightChunks = deps.inflightChunks
    this.allocatedSlots = deps.allocatedSlots
    this.getChunkKey = deps.getChunkKey
    this.shouldLoadChunk = deps.shouldLoadChunk
    this.calculateMeshValue = deps.calculateMeshValue
    this.dispatchMeshTask = deps.dispatchMeshTask
    this.dispatchParseTask = deps.dispatchParseTask
    this.effectiveMaxConcurrent = deps.effectiveMaxConcurrent
    this.getActiveRequestCount = deps.getActiveRequestCount
  }

  // 更新玩家区块位置、加载半径与当前代次。
  public setState(px: number, pz: number, loadDistance: number, generation: number) {
    this.currentPlayerChunk = { x: px, z: pz }
    this.currentLoadDistance = loadDistance
    this.currentGeneration = generation
    this.queueRefreshRequested = true
  }

  /**
   * 清空当前调度状态。
   */
  public reset() {
    this.parseQueue = []
    this.meshQueue = []
    this.inParseQueue.clear()
    this.inMeshQueue.clear()
    this.meshingChunks.clear()
    this.meshedChunks.clear()
    this.lastPlayerChunk = null
    this.queueRefreshRequested = true
  }

  public requestQueueRefresh() {
    this.queueRefreshRequested = true
  }

  // 接收外部背压信号，在指定时间内暂停继续派发。
  public applyBackpressure(pauseMs: number) {
    this.backpressureActive = true
    this.backpressureUntil = performance.now() + pauseMs
  }

  // 启动内部 tick 循环。
  public start(intervalMs = 4) {
    if (this.tickTimer !== null) return
    this.tickTimer = window.setInterval(() => this.tick(), intervalMs)
  }

  // 停止内部 tick 循环。
  public stop() {
    if (this.tickTimer !== null) {
      window.clearInterval(this.tickTimer)
      this.tickTimer = null
    }
  }

  // 单次调度 tick：必要时刷新队列，然后尝试派发任务。
  public tick() {
    const px = this.currentPlayerChunk.x
    const pz = this.currentPlayerChunk.z
    const moved = this.lastPlayerChunk
      ? this.lastPlayerChunk.x !== px || this.lastPlayerChunk.z !== pz
      : true

    if (moved || this.queueRefreshRequested || this.currentGeneration % 10 === 0) {
      this.updateQueues(px, pz)
      this.lastPlayerChunk = { x: px, z: pz }
      this.queueRefreshRequested = false
    }

    this.driveScheduler()
  }

  // 将已满足条件的区块加入 mesh 队列。
  // 即使 value <= 0 也允许排队，因为边界区块仍可能需要邻域修补。
  public enqueueMeshable(cx: number, cz: number, value: number) {
    const key = this.getChunkKey(cx, cz)
    // 避免重复进入 mesh 队列或重复 mesh。
    if (this.meshedChunks.has(key)) return
    if (this.meshingChunks.has(key)) return
    if (this.inMeshQueue.has(key)) return

    const slot = this.allocatedSlots.get(key)
    if (!slot) return

    this.meshQueue.push({
      cx,
      cz,
      value,
      generation: this.currentGeneration,
      slotIndex: slot.slotIndex,
      slotVersion: slot.version,
    })
    this.inMeshQueue.add(key)
  }

  public isMeshQueued(key: string) {
    return this.inMeshQueue.has(key)
  }

  /**
   * 检查区块是否已进入 mesh 阶段，包括排队中与执行中。
   */
  public isChunkMeshing(key: string): boolean {
    return this.inMeshQueue.has(key) || this.meshingChunks.has(key)
  }

  public removeMeshQueued(key: string) {
    this.inMeshQueue.delete(key)
    this.meshingChunks.delete(key)
    this.meshedChunks.delete(key)
  }

  public markMeshDispatched(key: string) {
    this.inMeshQueue.delete(key)
    this.meshedChunks.delete(key)
    this.meshingChunks.add(key)
  }

  // 标记区块已完成 mesh。
  public markMeshed(key: string) {
    this.meshingChunks.delete(key)
    this.meshedChunks.add(key)
  }

  // 内部 mesh 条件检查：中心区块与四邻域都必须已加载。
  private isMeshableInternal(cx: number, cz: number): boolean {
    if (!this.loadedChunks.has(this.getChunkKey(cx, cz))) return false
    if (!this.loadedChunks.has(this.getChunkKey(cx, cz - 1))) return false // 北
    if (!this.loadedChunks.has(this.getChunkKey(cx, cz + 1))) return false // 南
    if (!this.loadedChunks.has(this.getChunkKey(cx + 1, cz))) return false // 东
    if (!this.loadedChunks.has(this.getChunkKey(cx - 1, cz))) return false // 西
    return true
  }

  // 使用 BFS 在正方形加载区域内扩散任务，优先保证近处区块先进入队列。
  private updateQueues(px: number, pz: number) {
    this.parseQueue = []
    this.meshQueue = []
    this.inParseQueue.clear()
    this.inMeshQueue.clear()

    const loadDist = this.currentLoadDistance
    // 扫描上限使用更大的正方形边界，给 BFS 预留足够的扩散余量。
    const scanLimit = loadDist * 2 + 2

    const isWithinSquare = (cx: number, cz: number) =>
      Math.max(Math.abs(cx - px), Math.abs(cz - pz)) <= loadDist

    // BFS 初始化。
    const queue: { x: number; z: number; dist: number }[] = []
    const visited = new Set<string>()
    let head = 0

    // 从玩家当前区块开始。
    const startKey = this.getChunkKey(px, pz)
    queue.push({ x: px, z: pz, dist: 0 })
    visited.add(startKey)

    // 四邻域偏移。
    const neighbors = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ]

    while (head < queue.length) {
      const { x, z, dist } = queue[head++]

      const key = this.getChunkKey(x, z)

      // 1. 已加载区块优先尝试进入 mesh 队列。
      if (this.loadedChunks.has(key)) {
        if (
          !this.inflightChunks.has(key) &&
          !this.meshedChunks.has(key) &&
          !this.meshingChunks.has(key) &&
          !this.inMeshQueue.has(key)
        ) {
          const slot = this.allocatedSlots.get(key)
          if (slot && this.isMeshableInternal(x, z)) {
            this.meshQueue.push({
              cx: x,
              cz: z,
              value: 0,
              generation: this.currentGeneration,
              slotIndex: slot.slotIndex,
              slotVersion: slot.version,
            })
            this.inMeshQueue.add(key)
          }
        }
      }
      // 2. 未加载区块在满足范围条件时进入 parse 队列。
      else if (!this.inflightChunks.has(key)) {
        // 再次交给外部策略判定，避免与更高层过滤规则冲突。
        if (this.shouldLoadChunk(x, z)) {
          if (!this.inParseQueue.has(key)) {
            this.parseQueue.push({
              cx: x,
              cz: z,
              score: 0,
              generation: this.currentGeneration,
            })
            this.inParseQueue.add(key)
          }
        }
      }

      // 3. 继续向四邻域扩散。
      if (dist < scanLimit) {
        for (const [dx, dz] of neighbors) {
          const nx = x + dx
          const nz = z + dz

          // 仅在仍处于加载正方形内时才继续扩散。
          if (isWithinSquare(nx, nz)) {
            const nKey = this.getChunkKey(nx, nz)
            if (!visited.has(nKey)) {
              visited.add(nKey)
              queue.push({ x: nx, z: nz, dist: dist + 1 })
            }
          }
        }
      }
    }
  }

  private driveScheduler() {
    if (this.backpressureActive) {
      if (performance.now() < this.backpressureUntil) return
      this.backpressureActive = false
    }

    const maxConcurrent = this.effectiveMaxConcurrent()
    const active = this.getActiveRequestCount()
    if (active >= maxConcurrent) return

    let dispatchedThisTick = 0
    // 单帧派发上限，兼顾高吞吐与主线程响应性。
    const maxPerTick = 256

    // 当前 tick 内优先派发 mesh，其次派发 parse。
    while (this.getActiveRequestCount() < maxConcurrent && dispatchedThisTick < maxPerTick) {
      // 1. 先派发 mesh 任务。
      if (this.meshQueue.length > 0) {
        const task = this.meshQueue.shift()!
        const key = this.getChunkKey(task.cx, task.cz)
        const ok = this.dispatchMeshTask(task)
        if (!ok) {
          this.meshQueue.unshift(task)
          break
        }
        this.inMeshQueue.delete(key)
        this.meshingChunks.add(key) // 标记为正在 mesh
        dispatchedThisTick++
        continue
      }

      // 2. 再派发 parse 任务。
      if (this.parseQueue.length > 0) {
        const task = this.parseQueue.shift()!
        const key = this.getChunkKey(task.cx, task.cz)

        if (this.loadedChunks.has(key) || this.inflightChunks.has(key)) {
          this.inParseQueue.delete(key)
          continue
        }
        if (!this.shouldLoadChunk(task.cx, task.cz)) {
          this.inParseQueue.delete(key)
          continue
        }

        const ok = this.dispatchParseTask(task)
        if (!ok) {
          this.parseQueue.unshift(task)
          break
        }

        this.inParseQueue.delete(key)
        dispatchedThisTick++
        continue
      }

      break
    }
  }
}
