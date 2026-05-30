import type { WorkerMessage, WorkerStatsSnapshot } from '../../domain'

export type WorkerFactory = () => Worker
export type WorkerMessageHandler = (event: MessageEvent<WorkerMessage>, workerIndex: number) => void
export type WorkerInitHook = (worker: Worker, workerIndex: number) => void

export interface WorkerPoolOptions {
  workerCount: number
  workerFactory: WorkerFactory
  onMessage: WorkerMessageHandler
  onWorkerCreate?: WorkerInitHook
}

// Worker 池，维护实例列表、就绪状态与统计快照。
export class WorkerPool {
  private workers: Worker[] = [] // Worker 实例列表
  private workerReady: boolean[] = [] // 对应 Worker 是否已经完成初始化
  private perWorkerStats: WorkerStatsSnapshot[] = [] // 每个 Worker 的统计快照
  private nextWorkerIndex = 0 // 轮询指针
  private onMessage: WorkerMessageHandler

  constructor(options: WorkerPoolOptions) {
    const { workerCount, workerFactory, onMessage, onWorkerCreate } = options
    this.onMessage = onMessage

    for (let i = 0; i < workerCount; i++) {
      const worker = workerFactory()
      worker.onmessage = e => this.onMessage(e as MessageEvent<WorkerMessage>, i)
      this.workers.push(worker)
      this.workerReady.push(false)
      this.perWorkerStats.push({
        parseReceivedPerSec: 0,
        parseCompletedPerSec: 0,
        meshReceivedPerSec: 0,
        meshCompletedPerSec: 0,
        meshArenaDeliveredPerSec: 0,
        meshTransferableDeliveredPerSec: 0,
        arenaPoolActiveCount: 0,
        arenaPooledCount: 0,
        arenaPoolHitRate: 0,
        avgMeshTimeMs: 0,
        avgMeshWasmTimeMs: 0,
        avgMeshNormalizeTimeMs: 0,
        avgMeshBuildTimeMs: 0,
        avgMeshWasmDecodeTimeMs: 0,
        avgMeshWasmGenerateTimeMs: 0,
        avgMeshWasmLegacyPackTimeMs: 0,
        avgMeshWasmArtifactSerializeTimeMs: 0,
        avgMeshWasmJsBridgeTimeMs: 0,
      })
      onWorkerCreate?.(worker, i)
    }
  }

  // 标记指定 Worker 已经就绪。
  markReady(workerIndex: number) {
    this.workerReady[workerIndex] = true
  }

  // 按轮询顺序获取一个就绪 Worker；若都不可用则返回 null。
  getReadyWorker(): Worker | null {
    const result = this.getReadyWorkerWithIndex()
    return result ? result.worker : null
  }

  // 获取就绪 Worker 及其索引，便于调用方做亲和性统计。
  getReadyWorkerWithIndex(): { worker: Worker; workerIndex: number } | null {
    if (this.workers.length === 0) return null

    let attempts = 0
    while (attempts < this.workers.length) {
      const idx = this.nextWorkerIndex
      this.nextWorkerIndex = (this.nextWorkerIndex + 1) % this.workers.length
      if (this.workerReady[idx]) {
        return { worker: this.workers[idx], workerIndex: idx }
      }
      attempts++
    }
    return null
  }

  // 向全部 Worker 广播消息。
  broadcast(message: unknown, transfer?: Transferable[]) {
    this.workers.forEach(w => w.postMessage(message, transfer || []))
  }

  getWorkerCount(): number {
    return this.workers.length
  }

  getWorkerAt(index: number): Worker | undefined {
    return this.workers[index]
  }

  // 返回每个 Worker 的统计快照，供 UI 展示。
  getStats(): WorkerStatsSnapshot[] {
    return this.perWorkerStats
  }

  // 更新指定 Worker 的统计数据。
  updateStats(workerId: number, stats: Partial<WorkerStatsSnapshot>) {
    const target = this.perWorkerStats[workerId]
    if (!target) return
    Object.assign(target, stats)
  }

  // 终止全部 Worker，并清空池状态。
  terminate() {
    this.workers.forEach(w => w.terminate())
    this.workers = []
    this.workerReady = []
    this.perWorkerStats = []
  }
}
