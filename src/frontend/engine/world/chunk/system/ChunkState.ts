export interface ChunkSlot {
  slotIndex: number
  version: number
  workerIndex?: number
}

/**
 * @file ChunkState.ts
 * @brief 区块运行状态表
 *
 * 说明：
 *  - 维护 inflight、loaded 与 activeRequests 三组核心状态
 *  - 管理区块到 SAB 槽位的映射关系
 *  - 保证同一时刻一个区块只对应一个有效任务
 */
export class ChunkState {
  /** 活跃请求 ID 到区块 Key 的映射。 */
  private idToKey = new Map<number, string>()

  /** 当前正在处理中的区块 Key 集合。 */
  private inflightChunks = new Set<string>()

  /** 已分配 SAB 槽位的元数据映射 */
  private allocatedSlots = new Map<string, ChunkSlot>()

  /** 已完全加载并准备就绪的区块 Key 集合 */
  private loadedChunks = new Set<string>()

  /** 活跃请求 ID 集合，用于快速检查请求是否存在。 */
  public readonly activeRequests = new Set<number>()

  // --- 请求管理 ---

  public registerRequest(reqId: number, key: string) {
    this.activeRequests.add(reqId)
    this.idToKey.set(reqId, key)
    this.inflightChunks.add(key)
  }

  public unregisterRequest(reqId: number) {
    const key = this.idToKey.get(reqId)
    if (key) {
      this.inflightChunks.delete(key)
    }
    this.idToKey.delete(reqId)
    this.activeRequests.delete(reqId)
  }

  public getRequestKey(reqId: number): string | undefined {
    return this.idToKey.get(reqId)
  }

  public getRequestIdByKey(key: string): number | undefined {
    // 反向查找请求 ID，仅在必要时使用。
    for (const [id, k] of this.idToKey) {
      if (k === key) return id
    }
    return undefined
  }

  public isFlight(key: string): boolean {
    return this.inflightChunks.has(key)
  }

  // --- 槽位管理 ---

  public setSlot(key: string, slot: ChunkSlot) {
    this.allocatedSlots.set(key, slot)
  }

  public getSlot(key: string): ChunkSlot | undefined {
    return this.allocatedSlots.get(key)
  }

  public removeSlot(key: string) {
    this.allocatedSlots.delete(key)
  }

  public hasSlot(key: string): boolean {
    return this.allocatedSlots.has(key)
  }

  public getAllocatedSlots(): Map<string, ChunkSlot> {
    return this.allocatedSlots
  }

  // --- 加载状态 ---

  public markLoaded(key: string) {
    this.loadedChunks.add(key)
  }

  public markUnloaded(key: string) {
    this.loadedChunks.delete(key)
  }

  public isLoaded(key: string): boolean {
    return this.loadedChunks.has(key)
  }

  public getLoadedChunksSet(): Set<string> {
    return this.loadedChunks
  }

  public getInflightChunksSet(): Set<string> {
    return this.inflightChunks
  }

  public getPendingCount(): number {
    return this.activeRequests.size
  }

  /**
   * 重置全部状态集合与映射。
   */
  public reset() {
    this.idToKey.clear()
    this.inflightChunks.clear()
    this.allocatedSlots.clear()
    this.loadedChunks.clear()
    this.activeRequests.clear()
  }
}
