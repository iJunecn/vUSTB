import { get_chunk_payload_from_region } from '@world-core'

/** 区域缓存，负责 `.mca` 文件的复用、LRU 逐出与并发请求合并。 */
interface RegionCacheEntry {
  data: Promise<ArrayBuffer> // 区域文件原始字节
  uint8View?: Uint8Array // 缓存视图，避免重复包装
  lastUsed: number // 最近使用时间戳
}

// 最大缓存区域数量，32 份区域约占 160-256MB
const MAX_REGION_CACHE_SIZE = 32

// 正在获取的区域文件，避免重复请求。
const inflightFetches = new Map<string, Promise<ArrayBuffer>>()

export class RegionCache {
  // LRU 缓存，键为 regionUrl。
  private cache = new Map<string, RegionCacheEntry>()

  // 读取指定区块的压缩字节；必要时触发网络获取并更新 LRU。
  async getPayload(
    cx: number,
    cz: number,
    regionUrl: string,
    allowFetch: boolean,
  ): Promise<Uint8Array | undefined> {
    let entry = this.cache.get(regionUrl)

    if (entry) {
      entry.lastUsed = Date.now()
    } else {
      if (!allowFetch) {
        // 检查是否有正在进行的请求可以复用
        const inflight = inflightFetches.get(regionUrl)
        if (inflight) {
          try {
            const buf = await inflight
            return get_chunk_payload_from_region(new Uint8Array(buf), cx, cz) as Uint8Array
          } catch {
            return undefined
          }
        }
        return undefined
      }

      // 执行 LRU 淘汰，优先移除最久未访问的区域。
      if (this.cache.size >= MAX_REGION_CACHE_SIZE) {
        let oldestUrl = ''
        let oldestTime = Infinity
        for (const [url, e] of this.cache.entries()) {
          if (e.lastUsed < oldestTime) {
            oldestTime = e.lastUsed
            oldestUrl = url
          }
        }
        if (oldestUrl) {
          this.cache.delete(oldestUrl)
        }
      }

      // 检查是否已有同 URL 请求在进行，以便直接复用。
      let promise = inflightFetches.get(regionUrl)
      if (!promise) {
        // 发起网络请求加载区域文件。
        promise = fetch(regionUrl)
          .then(r => {
            if (!r.ok) throw new Error(`Failed to fetch region: ${r.statusText}`)
            return r.arrayBuffer()
          })
          .finally(() => {
            inflightFetches.delete(regionUrl)
          })
        inflightFetches.set(regionUrl, promise)
      }

      entry = { data: promise, lastUsed: Date.now() }
      this.cache.set(regionUrl, entry)
    }

    try {
      const buf = await entry.data
      // 缓存 Uint8Array 视图，避免对同一个 ArrayBuffer 反复包装。
      if (!entry.uint8View) {
        entry.uint8View = new Uint8Array(buf)
      }
      // 通过 WASM 提取目标 chunk 的压缩数据片段。
      return get_chunk_payload_from_region(entry.uint8View, cx, cz) as Uint8Array
    } catch {
      return undefined
    }
  }

  // 主动清理长时间未使用的区域缓存。
  gc(maxAge: number = 30000) {
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.lastUsed > maxAge) {
        this.cache.delete(key)
      }
    }
  }
}
