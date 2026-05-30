// 区域失败状态，用于指数退避判断。
interface RegionFailureState {
  timestamp: number // 最近一次失败时间戳
  retryCount: number // 当前已重试次数
  maxRetries: number // 允许的最大重试次数
}

export class FailureTracker {
  // 区块失败时间表，用于固定延时重试。
  private failedChunks = new Map<string, number>()
  // 区域失败状态表，用于指数退避与熔断。
  private failedRegions = new Map<string, RegionFailureState>()

  // 固定延时退避：距离上次失败超过 retryDelayMs 才允许重试。
  canLoadChunk(key: string, retryDelayMs: number): boolean {
    const failedAt = this.failedChunks.get(key)
    if (failedAt === undefined) return true
    return Date.now() - failedAt >= retryDelayMs
  }

  // 指数退避：退避时间随 retryCount 按 2^(n-1) 增长，上限 5 分钟。
  canLoadRegion(regionKey: string): boolean {
    const state = this.failedRegions.get(regionKey)
    if (!state) return true
    if (state.retryCount >= state.maxRetries) return false

    const backoffMs = Math.min(5000 * Math.pow(2, state.retryCount - 1), 300000)
    return Date.now() - state.timestamp >= backoffMs
  }

  // 记录区块加载失败时间。
  markChunkFailure(key: string) {
    this.failedChunks.set(key, Date.now())
  }

  // 记录区域失败并刷新重试计数与时间戳。
  markRegionFailure(regionKey: string, maxRetries: number) {
    const existing = this.failedRegions.get(regionKey)
    const retryCount = existing ? existing.retryCount + 1 : 1
    this.failedRegions.set(regionKey, {
      timestamp: Date.now(),
      retryCount,
      maxRetries,
    })
  }
}
