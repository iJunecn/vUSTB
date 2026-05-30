export class HeapAllocator {
  private freeList: { start: number; count: number }[] = []

  constructor(totalBlocks: number) {
    this.freeList.push({ start: 0, count: totalBlocks })
  }

  alloc(count: number): number {
    // 最佳适配：优先选择满足要求的最小空闲块，给后续请求保留更大的连续空间。
    let bestIdx = -1
    let minDiff = Number.MAX_SAFE_INTEGER

    for (let i = 0; i < this.freeList.length; i++) {
      const range = this.freeList[i]
      if (range.count >= count) {
        const diff = range.count - count
        // 完全匹配时直接命中。
        if (diff === 0) {
          bestIdx = i
          break
        }
        // 记录当前更优候选。
        if (diff < minDiff) {
          minDiff = diff
          bestIdx = i
        }
      }
    }

    if (bestIdx !== -1) {
      const range = this.freeList[bestIdx]
      const start = range.start

      range.start += count
      range.count -= count

      if (range.count === 0) {
        this.freeList.splice(bestIdx, 1)
      }
      return start
    }

    return -1
  }

  // 诊断信息
  public getFragmentationInfo(): {
    totalFree: number
    maxContiguous: number
    fragmentCount: number
    freeRanges: { start: number; count: number }[]
  } {
    let totalFree = 0
    let maxContiguous = 0
    for (const range of this.freeList) {
      totalFree += range.count
      if (range.count > maxContiguous) {
        maxContiguous = range.count
      }
    }
    return {
      totalFree,
      maxContiguous,
      fragmentCount: this.freeList.length,
      freeRanges: this.freeList.slice(0, 10), // 仅返回前 10 个碎片，便于日志输出
    }
  }
  public getFragmentationRatio(): number {
    let totalFree = 0
    let maxContiguous = 0
    for (const range of this.freeList) {
      totalFree += range.count
      if (range.count > maxContiguous) {
        maxContiguous = range.count
      }
    }
    if (totalFree === 0) return 0
    return 1 - maxContiguous / totalFree
  }
  free(start: number, count: number) {
    let i = 0
    while (i < this.freeList.length && this.freeList[i].start < start) {
      i++
    }
    this.freeList.splice(i, 0, { start, count })

    // 与后继空闲块合并。
    if (i < this.freeList.length - 1) {
      const curr = this.freeList[i]
      const next = this.freeList[i + 1]
      if (curr.start + curr.count === next.start) {
        curr.count += next.count
        this.freeList.splice(i + 1, 1)
      }
    }
    // 与前驱空闲块合并。
    if (i > 0) {
      const prev = this.freeList[i - 1]
      const curr = this.freeList[i]
      if (prev.start + prev.count === curr.start) {
        prev.count += curr.count
        this.freeList.splice(i, 1)
      }
    }
  }

  public clear(totalBlocks: number) {
    this.freeList = [{ start: 0, count: totalBlocks }]
  }

  /**
   * 强制重置分配器状态（用于整理内存后）
   * @param totalBlocks 总容量
   * @param usedBlocks 已使用的连续块数量（从0开始）
   */
  public resetWithTotal(totalBlocks: number, usedBlocks: number) {
    if (usedBlocks >= totalBlocks) {
      this.freeList = []
    } else {
      this.freeList = [{ start: usedBlocks, count: totalBlocks - usedBlocks }]
    }
  }
}
