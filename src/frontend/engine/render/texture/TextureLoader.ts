import type { ResourceDefinition } from '@/engine/config'
import { resolveResourceEndpoints } from '@/resource/endpoints'

/**
 * @file TextureLoader.ts
 * @brief 纹理资源加载器
 *
 * 说明：
 *  - 加载二进制纹理包与清单文件
 *  - 支持 IndexedDB 缓存与 Deflate 解压
 *  - 支持分块并发下载与显式内存清理
 */

export interface TextureManifestEntry {
  name: string
  width: number
  height: number
  hasNormal: boolean
  hasSpecular: boolean
  isAnimated: boolean
  frames?: number
  meta?: { animation?: { frametime?: number; frames?: unknown[] } }
  offset: number
  size: number
}

export interface TextureManifest {
  generatedAt: string
  textures: TextureManifestEntry[]
}

export interface LoadedTexture {
  name: string
  width: number
  height: number
  colorData: Uint8Array | HTMLImageElement
  normalData: Uint8Array | HTMLImageElement | null
  specularData: Uint8Array | HTMLImageElement | null
  meta?: { animation?: { frametime?: number; frames?: unknown[] } }
  isAnimated: boolean
}

/**
 * 纹理加载器。
 */
export class TextureLoader {
  private static instance: TextureLoader
  private loadedData: Uint8Array | null = null // 原始二进制数据缓冲区
  private loadedTextures: LoadedTexture[] = [] // 解析后的纹理对象列表

  public static getInstance(): TextureLoader {
    if (!TextureLoader.instance) {
      TextureLoader.instance = new TextureLoader()
    }
    return TextureLoader.instance
  }

  /**
   * 清理已加载的纹理数据，释放内存占用。
   */
  public clear(): void {
    // 断开对大型二进制缓冲区的引用
    this.loadedData = null

    // 遍历并置空所有纹理数据引用，辅助 GC
    this.loadedTextures.forEach(tex => {
      const texAny = tex as unknown as Record<string, unknown>
      if (tex.colorData instanceof Uint8Array) {
        texAny.colorData = null
      }
      if (tex.normalData instanceof Uint8Array) {
        texAny.normalData = null
      }
      if (tex.specularData instanceof Uint8Array) {
        texAny.specularData = null
      }
    })
    this.loadedTextures = []

    console.log('[TextureLoader] Memory cleared')
  }

  // --- IndexedDB 缓存管理 ---

  /**
   * 初始化并打开 IndexedDB 数据库。
   */
  private async openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('TextureCacheDB', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains('textures')) {
          db.createObjectStore('textures')
        }
      }
    })
  }

  /**
   * 从缓存中检索二进制数据
   */
  private async getCachedData(key: string): Promise<ArrayBuffer | null> {
    try {
      const db = await this.openDB()
      return new Promise((resolve, reject) => {
        const tx = db.transaction('textures', 'readonly')
        const store = tx.objectStore('textures')
        const request = store.get(key)
        request.onsuccess = () => resolve(request.result as ArrayBuffer | null)
        request.onerror = () => reject(request.error)
      })
    } catch (e) {
      console.warn('[TextureLoader] Cache read failed', e)
      return null
    }
  }

  /**
   * 将二进制数据写入持久化缓存。
   */
  private async setCachedData(key: string, data: ArrayBuffer): Promise<void> {
    try {
      const db = await this.openDB()
      return new Promise((resolve, reject) => {
        const tx = db.transaction('textures', 'readwrite')
        const store = tx.objectStore('textures')
        const request = store.put(data, key)
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    } catch (e) {
      console.warn('[TextureLoader] Cache write failed', e)
    }
  }

  // --- 网络下载辅助 ---

  /**
   * 使用 HTTP Range 执行分块并发下载。
   * @param url 资源 URL。
   * @param totalSize 文件总大小。
   * @param concurrency 并发数量。
   * @returns 完整 ArrayBuffer。
   */
  private async downloadChunked(
    url: string,
    totalSize: number,
    concurrency = 4,
  ): Promise<ArrayBuffer> {
    console.log(
      `[TextureLoader] Starting chunked download for ${url} (Size: ${(totalSize / 1024 / 1024).toFixed(2)}MB, Chunks: ${concurrency})`,
    )
    const chunkSize = Math.ceil(totalSize / concurrency)

    const downloadRange = async (index: number) => {
      const start = index * chunkSize
      const end = Math.min(start + chunkSize - 1, totalSize - 1)
      if (start >= totalSize) return null

      const headers = { Range: `bytes=${start}-${end}` }
      const res = await fetch(url, { headers })
      if (!res.ok) throw new Error(`Chunk ${index} failed: ${res.status}`)

      const buf = await res.arrayBuffer()
      console.log(
        `[TextureLoader] Chunk ${index + 1}/${concurrency} downloaded (${(buf.byteLength / 1024 / 1024).toFixed(2)} MB)`,
      )
      return { index, buf }
    }

    const promises = []
    for (let i = 0; i < concurrency; i++) {
      promises.push(downloadRange(i))
    }

    const results = await Promise.all(promises)

    const finalBuffer = new Uint8Array(totalSize)
    for (const res of results) {
      if (res) {
        finalBuffer.set(new Uint8Array(res.buf), res.index * chunkSize)
      }
    }
    console.log(`[TextureLoader] Chunked download complete.`)
    return finalBuffer.buffer
  }

  private async downloadTextureBinaryWithFallback(url: string): Promise<ArrayBuffer> {
    let contentLength = 0
    let acceptRanges = false

    try {
      const headRes = await fetch(url, { method: 'HEAD' })
      if (headRes.ok) {
        contentLength = parseInt(headRes.headers.get('Content-Length') || '0', 10)
        acceptRanges = headRes.headers.get('Accept-Ranges') === 'bytes'
      } else {
        console.warn(
          `[TextureLoader] HEAD probe failed for ${url}: ${headRes.status} ${headRes.statusText}. Falling back to direct download.`,
        )
      }
    } catch (error) {
      console.warn('[TextureLoader] HEAD probe failed; falling back to direct download.', error)
    }

    if (acceptRanges && contentLength > 2 * 1024 * 1024) {
      try {
        return await this.downloadChunked(url, contentLength, 4)
      } catch (error) {
        console.warn(
          '[TextureLoader] Chunked download failed; retrying with a single direct request.',
          error,
        )
      }
    }

    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`textures.bin.deflate not found (${res.status})`)
    }

    return this.downloadWithProgress(res, 'textures.bin.deflate')
  }

  /**
   * 流式下载并实时输出进度。
   * @param response Fetch 响应对象。
   * @param name 资源名称。
   * @returns 下载完成后的 ArrayBuffer。
   */
  private async downloadWithProgress(response: Response, name: string): Promise<ArrayBuffer> {
    const reader = response.body?.getReader()
    if (!reader) {
      console.warn(
        `[TextureLoader] Cannot read body stream for ${name}, falling back to arrayBuffer()`,
      )
      return await response.arrayBuffer()
    }

    const contentLengthHeader = response.headers.get('Content-Length')
    const totalLength = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0

    console.log(
      `[TextureLoader] Starting download of ${name}. Total size: ${totalLength ? (totalLength / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown'}`,
    )

    let receivedLength = 0
    const chunks: Uint8Array[] = []
    let lastLogTime = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      if (value) {
        chunks.push(value)
        receivedLength += value.length

        const now = performance.now()
        if (now - lastLogTime > 500) {
          // 每 0.5 秒记录一次下载进度。
          const progress = totalLength
            ? `(${((receivedLength / totalLength) * 100).toFixed(1)}%)`
            : ''
          console.log(
            `[TextureLoader] Downloading ${name}: ${(receivedLength / 1024 / 1024).toFixed(2)} MB ${progress}`,
          )
          lastLogTime = now
        }
      }
    }

    console.log(
      `[TextureLoader] Finished downloading ${name}. Total: ${(receivedLength / 1024 / 1024).toFixed(2)} MB`,
    )

    const result = new Uint8Array(receivedLength)
    let position = 0
    for (const chunk of chunks) {
      result.set(chunk, position)
      position += chunk.length
    }

    return result.buffer
  }

  /**
   * 解析清单并获取完整的纹理数据集。
   * 流程：解析 manifest -> 检查缓存 -> 下载并解压 -> 按偏移切分数据。
   */
  public async load(resource: ResourceDefinition): Promise<LoadedTexture[]> {
    // 加载新纹理前先清理旧数据。
    this.clear()
    console.log('[TextureLoader] Mode: Deflate Only')

    // 解析资源端点，保持与旧版路径逻辑一致。
    const endpoints = resolveResourceEndpoints(resource)

    console.log(`[TextureLoader] Fetching manifest from ${endpoints.textureManifestUrl}...`)

    let manifestData: TextureManifest
    try {
      // 必须使用 .json.deflate 以匹配构建脚本输出。
      // 当前依赖 DecompressionStream('deflate') 处理 zlib 包装的 deflate 数据。
      const manifestRes = await fetch(endpoints.textureManifestUrl)
      if (!manifestRes.ok) throw new Error(`${manifestRes.status} ${manifestRes.statusText}`)

      const blob = await manifestRes.blob()
      const ds = new DecompressionStream('deflate')
      const stream = blob.stream().pipeThrough(ds)
      const decompressed = await new Response(stream).json()
      manifestData = decompressed as TextureManifest
    } catch (e) {
      console.error(`[TextureLoader] Critical Error: Failed to load compressed manifest.`, e)
      throw new Error(
        `[TextureLoader] Manifest loading failed. Deflate resource is required at ${endpoints.textureManifestUrl}`,
      )
    }

    const manifest = manifestData
    console.log(`[TextureLoader] Manifest loaded. Contains ${manifest.textures.length} entries.`)

    let dataView: Uint8Array | null = null

    // 1. 尝试从 IndexedDB 缓存读取。
    const cacheKey = ['texture_data_v4', manifest.generatedAt].join('|')
    const cachedBuffer = await this.getCachedData(cacheKey)
    if (cachedBuffer) {
      console.log('[TextureLoader] Loaded texture data from IndexedDB cache')
      dataView = new Uint8Array(cachedBuffer)
    }

    // 2. 若缓存未命中，则走网络下载。
    if (!dataView) {
      const url = endpoints.textureBinaryUrl
      console.log(`[TextureLoader] Downloading ${url}...`)

      try {
        const downloadedBuffer = await this.downloadTextureBinaryWithFallback(url)

        console.log(`[TextureLoader] Decompressing...`)
        const decompressStart = performance.now()

        try {
          const ds = new DecompressionStream('deflate')
          const stream = new Response(downloadedBuffer).body
          if (!stream) throw new Error('Failed to create stream')
          const decompressed = stream.pipeThrough(ds)
          const resultBuffer = await new Response(decompressed).arrayBuffer()
          dataView = new Uint8Array(resultBuffer)

          console.log(
            `[TextureLoader] Decompressed to ${dataView.byteLength} bytes in ${(performance.now() - decompressStart).toFixed(2)}ms`,
          )
        } catch (decompError) {
          console.error('[TextureLoader] Decompression failed', decompError)
          throw decompError
        }
      } catch (err) {
        console.error('[TextureLoader] Failed to download or decompress textures.bin.deflate', err)
        throw new Error('[TextureLoader] Fatal: Failed to invoke deflate texture loading pipeline.')
      }
    }

    // 3. 将解压后的数据写入缓存。
    if (!cachedBuffer) {
      const cacheData = new Uint8Array(dataView.byteLength)
      cacheData.set(dataView)
      this.setCachedData(cacheKey, cacheData.buffer)
    }

    // 4. 按 manifest 描述切分二进制缓冲。
    this.loadedData = dataView

    const textures: LoadedTexture[] = []

    for (const entry of manifest.textures) {
      const entrySize = entry.width * entry.height * 4

      const safeSlice = (start: number, length: number, label: string): Uint8Array => {
        const end = start + length
        if (start < 0 || end > dataView.length) {
          console.warn(
            `[TextureLoader] Out-of-range ${label} slice for ${entry.name}: ` +
              `start=${start}, end=${end}, dataLen=${dataView.length}. Using zero fallback.`,
          )
          return new Uint8Array(length)
        }

        const sub = dataView.subarray(start, end)
        if (sub.length !== length) {
          console.warn(
            `[TextureLoader] Short ${label} slice for ${entry.name}: ` +
              `expected=${length}, got=${sub.length}. Using zero fallback.`,
          )
          return new Uint8Array(length)
        }
        return sub
      }

      // 计算各通道在二进制缓冲中的偏移。
      let localOffset = 0

      const colorStart = entry.offset + localOffset
      const colorData = safeSlice(colorStart, entrySize, 'color')
      localOffset += entrySize

      let normalData: Uint8Array | null = null
      // 构建脚本始终会生成法线贴图占位数据。
      {
        const normalStart = entry.offset + localOffset
        normalData = safeSlice(normalStart, entrySize, 'normal')
        localOffset += entrySize
      }

      let specularData: Uint8Array | null = null
      // 构建脚本始终会生成高光贴图占位数据。
      {
        const specStart = entry.offset + localOffset
        specularData = safeSlice(specStart, entrySize, 'specular')
        localOffset += entrySize
      }

      textures.push({
        name: entry.name,
        width: entry.width,
        height: entry.height,
        colorData: colorData,
        normalData: normalData,
        specularData: specularData,
        meta: entry.meta,
        isAnimated: entry.isAnimated,
      })
    }

    this.loadedTextures = textures
    return textures
  }
}
