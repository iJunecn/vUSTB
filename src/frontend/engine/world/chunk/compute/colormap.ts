import type { ResourceDefinition } from '@/engine/config'
import { resolveResourceEndpoints } from '@/resource/endpoints'

export interface RgbaImage {
  width: number
  height: number
  data: Uint8Array
}

function isPng(bytes: Uint8Array) {
  // PNG 文件签名：89 50 4E 47 0D 0A 1A 0A
  return (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
}

async function fetchColormap(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) {
      return null
    }

    // 校验返回内容，避免命中 SPA 的 `index.html` 回退页。
    const type = res.headers.get('content-type')
    if (type && type.includes('text/html')) {
      return null
    }

    return res
  } catch {
    return null
  }
}

async function decodePngToRgba(res: Response): Promise<RgbaImage | null> {
  // 防御式检查：有些开发服务器会以 200 返回 HTML 或错误的 content-type。
  const contentType = res.headers.get('content-type') ?? ''
  const buf = await res.arrayBuffer()
  const bytes = new Uint8Array(buf)

  if (!isPng(bytes)) {
    console.warn('[Worker] Colormap is not a PNG (signature mismatch)', { contentType })
    return null
  }

  // 显式指定 MIME，确保解码器按 PNG 处理。
  const blob = new Blob([bytes], { type: 'image/png' })

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch (e) {
    console.warn('[Worker] Failed to decode colormap PNG', e)
    return null
  }

  if (typeof OffscreenCanvas === 'undefined') {
    console.warn('[Worker] OffscreenCanvas not available; skipping colormap init')
    bitmap.close()
    return null
  }

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    console.warn('[Worker] OffscreenCanvas 2D context not available; skipping colormap init')
    bitmap.close()
    return null
  }

  ctx.drawImage(bitmap, 0, 0)
  const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height)

  bitmap.close()

  return {
    width: bitmap.width,
    height: bitmap.height,
    data: new Uint8Array(img.data),
  }
}

export async function loadMinecraftColormap(
  resource: ResourceDefinition,
  name: 'grass' | 'foliage',
) {
  const url = resolveResourceEndpoints(resource).getColormapUrl(name)

  console.log(`[Worker] Loading colormap ${name} from:`, url)

  const res = await fetchColormap(url)
  if (!res) {
    console.warn(`[Worker] Failed to load colormap ${name} from ${url}`)
    return null
  }
  return decodePngToRgba(res)
}
