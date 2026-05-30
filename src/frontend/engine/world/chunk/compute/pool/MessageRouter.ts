import type { WorkerMessage } from '../../domain'

export interface WorkerStatsPayload {
  workerId: number
  stats: {
    parseReceived?: number // 每秒收到的解析任务数
    parseCompleted?: number // 每秒完成的解析任务数
    meshReceived?: number // 每秒收到的网格任务数
    meshCompleted?: number // 每秒完成的网格任务数
    meshArenaDelivered?: number
    meshTransferableDelivered?: number
    arenaPoolActiveCount?: number
    arenaPooledCount?: number
    arenaPoolHitRate?: number
    avgMeshTimeMs?: number // 平均网格构建耗时，单位 ms
    avgMeshWasmTimeMs?: number
    avgMeshNormalizeTimeMs?: number
    avgMeshBuildTimeMs?: number
    avgMeshWasmDecodeTimeMs?: number
    avgMeshWasmGenerateTimeMs?: number
    avgMeshWasmLegacyPackTimeMs?: number
    avgMeshWasmArtifactSerializeTimeMs?: number
    avgMeshWasmJsBridgeTimeMs?: number
  }
}

export interface MessageRouterHandlers {
  onChunkLoaded: (data: WorkerMessage) => void
  onParseComplete: (data: WorkerMessage) => void
  onTaskAborted: (data: WorkerMessage) => void
  onInitComplete: (workerIndex: number) => void
  onChunkUpdate: (data: WorkerMessage) => void
  onBlockStateSyncResult?: (data: WorkerMessage) => void
  onDescribeBlockStateResult?: (data: WorkerMessage) => void
  onBackpressure: (backlog: { ioBacklog?: number; meshBacklog?: number }) => void
  onWorkerStats: (payload: WorkerStatsPayload) => void
  onChunkRetry?: (data: { neededBlocks: number; chunkX: number; chunkZ: number }) => void
  onAllocRequest?: (
    data: { reqId: number; chunkX: number; chunkZ: number; bufferId: number; neededBlocks: number },
    workerIndex: number,
  ) => void
  onError?: (message: string) => void
}

// 统一分发 Worker onmessage 事件，避免 ChunkDirector 直接耦合消息细节。
export class MessageRouter {
  constructor(private readonly handlers: MessageRouterHandlers) {}

  public handle(
    event: MessageEvent<
      WorkerMessage | { type: 'chunkRetry'; neededBlocks: number; chunkX: number; chunkZ: number }
    >,
    workerIndex: number,
  ) {
    const { type } = event.data
    switch (type) {
      case 'chunkLoaded':
        this.handlers.onChunkLoaded(event.data as WorkerMessage)
        break
      case 'parseComplete':
        this.handlers.onParseComplete(event.data as WorkerMessage)
        break
      case 'taskAborted':
        this.handlers.onTaskAborted(event.data as WorkerMessage)
        break
      case 'init_complete':
        this.handlers.onInitComplete(workerIndex)
        break
      case 'chunkUpdate':
        this.handlers.onChunkUpdate(event.data as WorkerMessage)
        break
      case 'blockStateSyncResult':
        this.handlers.onBlockStateSyncResult?.(event.data as WorkerMessage)
        break
      case 'describeBlockStateResult':
        this.handlers.onDescribeBlockStateResult?.(event.data as WorkerMessage)
        break
      case 'backpressure':
        this.handlers.onBackpressure(
          event.data as unknown as { ioBacklog?: number; meshBacklog?: number },
        )
        break
      case 'workerStats':
        this.handlers.onWorkerStats(event.data as unknown as WorkerStatsPayload)
        break
      case 'chunkAllocRequest': {
        const d = event.data as unknown as {
          id: number
          chunkX: number
          chunkZ: number
          bufferId: number
          neededBlocks: number
        }
        this.handlers.onAllocRequest?.(
          {
            reqId: d.id,
            chunkX: d.chunkX,
            chunkZ: d.chunkZ,
            bufferId: d.bufferId,
            neededBlocks: d.neededBlocks,
          },
          workerIndex,
        )
        break
      }
      case 'chunkRetry':
        this.handlers.onChunkRetry?.(
          event.data as { neededBlocks: number; chunkX: number; chunkZ: number },
        )
        break
      case 'error':
        this.handlers.onError?.((event.data as { error?: string }).error || 'Unknown worker error')
        break
    }
  }
}
