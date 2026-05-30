import { extractChunkData } from './RegionParser'

type CachedRegionEntry = {
  buffer: ArrayBuffer
  fetchedAt: number
}

const REGION_CACHE_REVALIDATE_MS = 1000

async function readFetchErrorSummary(response: Response): Promise<string> {
  try {
    const raw = (await response.text()).trim()
    if (!raw) {
      return ''
    }

    return raw.length > 240 ? `${raw.slice(0, 240)}...` : raw
  } catch {
    return ''
  }
}

function withCacheBust(url: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://dev-app.example.test'
  const resolved = new URL(url, base)
  resolved.searchParams.set('mca_retry', Date.now().toString())
  return resolved.pathname + resolved.search
}

async function fetchRegionBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { cache: 'no-cache' })
  if (response.status === 404) {
    return new ArrayBuffer(0)
  }

  if (response.ok) {
    return response.arrayBuffer()
  }

  if (response.status === 400) {
    const retryUrl = withCacheBust(url)
    const retryResponse = await fetch(retryUrl, { cache: 'no-store' })
    if (retryResponse.status === 404) {
      return new ArrayBuffer(0)
    }
    if (retryResponse.ok) {
      console.warn(`[RegionManager] Retried ${url} as ${retryUrl} after 400 and recovered`)
      return retryResponse.arrayBuffer()
    }

    const retrySummary = await readFetchErrorSummary(retryResponse)
    const retryDetails = retrySummary ? ` - ${retrySummary}` : ''
    throw new Error(
      `Region fetch failed for ${url}: ${retryResponse.status} ${retryResponse.statusText} after retry ${retryUrl}${retryDetails}`,
    )
  }

  const errorSummary = await readFetchErrorSummary(response)
  const errorDetails = errorSummary ? ` - ${errorSummary}` : ''
  throw new Error(`Region fetch failed for ${url}: ${response.status} ${response.statusText}${errorDetails}`)
}

/**
 * @file RegionManager.ts
 * @brief 世界存档 Region 管理器
 *
 * 说明：
 *  - 从本地或远端加载标准 Minecraft `.mca` 文件
 *  - 通过 LRU 缓存与并发请求合并控制内存与重复加载
 *  - 负责区块坐标到 Region 文件的映射与提取
 */
export class RegionManager {
  // 区域缓存，键为最终请求 URL，避免跨世界/跨版本路径复用旧数据。
  private cache = new Map<string, CachedRegionEntry>()
  // 进行中的加载请求，避免同一文件重复获取。
  private inflight = new Map<string, Promise<ArrayBuffer>>()

  // LRU 顺序表，尾部表示最近访问。
  private lruOrder: string[] = []

  // 最大缓存 Region 数量。
  // F(x)=24 * 5 MB ≈ 120 MB
  private readonly MAX_CACHE_SIZE = 24

  private regionUrlResolver: ((regionX: number, regionZ: number) => string) | null = null

  constructor(private basePath: string | null = null) {}

  public setBasePath(basePath: string) {
    if (this.basePath === basePath) {
      return
    }

    this.basePath = basePath
    this.clear()
  }

  public setRegionUrlResolver(resolver: ((regionX: number, regionZ: number) => string) | null) {
    if (this.regionUrlResolver === resolver) {
      return
    }

    this.regionUrlResolver = resolver
    this.clear()
  }

  // 读取区块压缩数据；缓存缺失时触发 Region 文件加载。
  async loadChunkData(chunkX: number, chunkZ: number): Promise<Uint8Array | undefined> {
    const rx = Math.floor(chunkX / 32)
    const rz = Math.floor(chunkZ / 32)
    const fileName = `r.${rx}.${rz}.mca`
    const url = this.regionUrlResolver
      ? this.regionUrlResolver(rx, rz)
      : this.basePath
        ? `${this.basePath}/${fileName}`
        : null

    if (!url) {
      throw new Error('RegionManager requires an explicit world source before loading chunks')
    }

    let entry = this.cache.get(url)
    const shouldRefresh = !entry || Date.now() - entry.fetchedAt >= REGION_CACHE_REVALIDATE_MS

    if (shouldRefresh) {
      // 缓存未命中或进入重校验窗口时，优先复用同 URL 的在途请求。
      let promise = this.inflight.get(url)
      if (!promise) {
        promise = fetchRegionBuffer(url)
        this.inflight.set(url, promise)
      }

      try {
        const buffer = await promise
        // 404 会返回空 buffer，此时视为区域不存在而非损坏数据。
        if (buffer.byteLength > 0) {
          entry = {
            buffer,
            fetchedAt: Date.now(),
          }
          this.cache.set(url, entry)
          this.updateLru(url)
        } else {
          this.cache.delete(url)
          // 区域文件不存在时，当前区块直接视为缺失。
          return undefined
        }
      } catch (e) {
        console.warn(`[RegionManager] Failed to load ${fileName}:`, e)
        return undefined
      } finally {
        this.inflight.delete(url)
      }
    } else {
      // 缓存命中后刷新 LRU。
      this.updateLru(url)
    }

    const buffer = entry?.buffer
    if (!buffer) {
      return undefined
    }

    // 从 Region 二进制中提取目标 chunk 的压缩数据。
    return extractChunkData(buffer, chunkX, chunkZ)
  }

  /**
   * 刷新 LRU 状态。
   * 最近访问的 key 会移动到尾部；超出容量时逐出头部。
   */
  private updateLru(key: string) {
    const idx = this.lruOrder.indexOf(key)
    if (idx > -1) {
      this.lruOrder.splice(idx, 1)
    }
    this.lruOrder.push(key)

    if (this.lruOrder.length > this.MAX_CACHE_SIZE) {
      const evictionKey = this.lruOrder.shift()
      if (evictionKey) {
        this.cache.delete(evictionKey)
      }
    }
  }

  /**
   * 手动清空全部缓存与在途请求。
   */
  public clear() {
    this.cache.clear()
    this.lruOrder = []
    this.inflight.clear()
  }
}
