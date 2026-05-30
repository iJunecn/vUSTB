import { GAME_CONFIG, type ResourceDefinition } from '@/engine/config'
import { TextureLoader, type LoadedTexture } from '@render/texture/TextureLoader'
import { FrameBuffer } from '@render/core/buffer/FrameBuffer'

type WebGL2ColorSpaceExt = WebGL2RenderingContext & {
  UNPACK_COLORSPACE_CONVERSION_WEBGL?: number
}

/**
 * @file TextureManager.ts
 * @brief 纹理数组与动画纹理管理
 *
 * 说明：
 *  - 管理 Texture Array 与相关 GPU 纹理资源
 *  - 处理 .mcmeta 动画帧与运行时换帧上传
 *  - 统一维护颜色、法线和高光贴图数组
 *  - 负责 mipmap 生成和 CPU 临时资源释放
 */

/**
 * 描述纹理动画的单帧数据
 */
interface AnimationFrame {
  index: number // 帧索引
  time: number // 持续时间 (ms)
}

/**
 * 维护动画纹理的运行时状态与源数据
 */
interface AnimatedTexture {
  layerIndex: number // 在 Texture Array 中的层级索引
  sourceData: Uint8Array | HTMLImageElement
  normalSourceData?: Uint8Array | HTMLImageElement | null
  specularSourceData?: Uint8Array | HTMLImageElement | null

  // 预缩放后的帧数据，用于优化更新性能
  resampledFrames?: (Uint8Array | ImageBitmap)[]
  normalResampledFrames?: (Uint8Array | ImageBitmap)[]
  specularResampledFrames?: (Uint8Array | ImageBitmap)[]

  frames: AnimationFrame[] // 帧序列
  totalTime: number // 动画总时长
  elapsedTime: number // 当前累计播放时间
  currentFrameIndex: number // 当前显示的帧索引
  width: number
  height: number
}

interface _TextureMeta {
  animation?: {
    frametime?: number
    frames?: (number | { index: number; time?: number })[]
  }
}

/**
 * 纹理管理器。
 */
export class TextureManager {
  private gl: WebGL2RenderingContext
  private textureArray: WebGLTexture | null = null // 基础颜色纹理数组 (Albedo)
  private textureMap: Map<string, number> = new Map() // 纹理名称到层级索引的映射
  private layerCount: number = 0 // 总层数
  private TEXTURE_SIZE = 16 // 统一的纹理单元尺寸
  private animatedTextures: AnimatedTexture[] = [] // 活跃的动画列表
  private normalTextureArray: WebGLTexture | null = null // 法线纹理数组 (Normal)
  private specularTextureArray: WebGLTexture | null = null // PBR 属性纹理数组 (Specular/Roughness/Metallic)
  private readFrameBuffer: FrameBuffer | null = null // 用于 Mipmap 生成的读取 FBO
  private writeFrameBuffer: FrameBuffer | null = null // 用于 Mipmap 生成的写入 FBO
  private maxMipLevel: number = 0 // 最大 Mipmap 等级

  public variantLUT: WebGLTexture | null = null // 随机方块变体 LUT (R16UI)

  private scratchCanvas: HTMLCanvasElement | null = null
  private scratchCtx: CanvasRenderingContext2D | null = null
  private resampleCanvas: HTMLCanvasElement | null = null
  private resampleCtx: CanvasRenderingContext2D | null = null

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
  }

  /**
   * 加载 Variant LUT 纹理
   */
  public async loadVariantLUT(url: string) {
    const gl = this.gl

    if (this.variantLUT) gl.deleteTexture(this.variantLUT)
    this.variantLUT = gl.createTexture()
    if (!this.variantLUT) {
      console.warn('[TextureManager] Failed to create variant LUT texture')
      return
    }

    gl.bindTexture(gl.TEXTURE_2D, this.variantLUT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    return new Promise<void>(resolve => {
      const image = new Image()
      image.onload = () => {
        gl.bindTexture(gl.TEXTURE_2D, this.variantLUT)
        // LUT 是按字节编码的数据而不是颜色，需关闭浏览器色彩空间转换。
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
        // 按标准 RGBA8 上传，由 Shader 解析高低字节。
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
        // 恢复默认像素上传行为。
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL)
        console.log('[TextureManager] Variant LUT loaded:', url)
        resolve()
      }
      image.onerror = e => {
        console.warn('[TextureManager] Failed to load variant LUT:', url, e)
        // 使用 1x1 回退纹理，默认映射到 0。
        const fallback = new Uint8Array([0, 0, 0, 255])
        gl.bindTexture(gl.TEXTURE_2D, this.variantLUT)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, fallback)
        resolve()
      }
      image.src = url
    })
  }

  /**
   * 针对指定层级手动更新 mipmap。
   * @param texture 目标纹理数组。
   * @param layer 目标层级索引。
   */
  private updateMipmapsGPU(texture: WebGLTexture, layer: number) {
    const gl = this.gl
    if (!this.readFrameBuffer) this.readFrameBuffer = new FrameBuffer(gl, 0, 0)
    if (!this.writeFrameBuffer) this.writeFrameBuffer = new FrameBuffer(gl, 0, 0)

    let width = this.TEXTURE_SIZE
    let height = this.TEXTURE_SIZE

    for (let i = 1; i < this.maxMipLevel; i++) {
      const srcLevel = i - 1
      const dstLevel = i

      this.readFrameBuffer.attachTextureLayer(texture, gl.COLOR_ATTACHMENT0, layer, srcLevel)
      this.writeFrameBuffer.attachTextureLayer(texture, gl.COLOR_ATTACHMENT0, layer, dstLevel)

      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.readFrameBuffer.fbo)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.writeFrameBuffer.fbo)

      const nextWidth = Math.max(1, width >> 1)
      const nextHeight = Math.max(1, height >> 1)

      // 使用线性过滤完成逐级缩放。
      gl.blitFramebuffer(
        0,
        0,
        width,
        height,
        0,
        0,
        nextWidth,
        nextHeight,
        gl.COLOR_BUFFER_BIT,
        gl.LINEAR,
      )

      width = nextWidth
      height = nextHeight
    }
    this.readFrameBuffer.unbind()
    this.writeFrameBuffer.unbind()
  }

  /**
   * 更新动画纹理帧状态。
   * @param deltaTime 时间增量，单位毫秒。
   */
  public update(deltaTime: number) {
    if (!this.textureArray) return

    for (const anim of this.animatedTextures) {
      anim.elapsedTime += deltaTime
      // 循环播放逻辑
      if (anim.elapsedTime >= anim.totalTime) {
        anim.elapsedTime %= anim.totalTime
      }

      // 查找当前时间点对应的帧索引
      let accumulatedTime = 0
      let newFrameIndex = 0
      for (let i = 0; i < anim.frames.length; i++) {
        accumulatedTime += anim.frames[i].time
        if (anim.elapsedTime < accumulatedTime) {
          newFrameIndex = i
          break
        }
      }

      // 仅在帧发生变化时执行 GPU 更新
      if (newFrameIndex !== anim.currentFrameIndex) {
        anim.currentFrameIndex = newFrameIndex
        const _frame = anim.frames[newFrameIndex]

        if (!this.scratchCtx || !this.scratchCanvas) return

        // 动态调整临时画布尺寸以匹配统一的纹理大小
        if (
          this.scratchCanvas.width !== this.TEXTURE_SIZE ||
          this.scratchCanvas.height !== this.TEXTURE_SIZE
        ) {
          this.scratchCanvas.width = this.TEXTURE_SIZE
          this.scratchCanvas.height = this.TEXTURE_SIZE
          if (this.scratchCtx) this.scratchCtx.imageSmoothingEnabled = false
        }

        // 重置解包参数，确保 texSubImage3D 操作正确
        this.resetPixelStoreParams()

        // 内部辅助：将单帧数据上传至指定的 Texture Array
        const uploadFrame = (
          source: Uint8Array | HTMLImageElement,
          targetTexture: WebGLTexture,
          resampled: (Uint8Array | ImageBitmap)[] | undefined,
        ) => {
          const frameIndex = anim.frames[anim.currentFrameIndex]?.index ?? 0

          // 优先复用预处理后的 ImageBitmap 或重采样结果。
          if (resampled && resampled.length > 0) {
            const idx = frameIndex % resampled.length
            const frameData = resampled[idx]
            this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, targetTexture)
            if (frameData instanceof ImageBitmap) {
              this.gl.texSubImage3D(
                this.gl.TEXTURE_2D_ARRAY,
                0,
                0,
                0,
                anim.layerIndex,
                this.TEXTURE_SIZE,
                this.TEXTURE_SIZE,
                1,
                this.gl.RGBA,
                this.gl.UNSIGNED_BYTE,
                frameData,
              )
            } else {
              this.gl.texSubImage3D(
                this.gl.TEXTURE_2D_ARRAY,
                0,
                0,
                0,
                anim.layerIndex,
                this.TEXTURE_SIZE,
                this.TEXTURE_SIZE,
                1,
                this.gl.RGBA,
                this.gl.UNSIGNED_BYTE,
                frameData,
              )
            }
          } else if (source instanceof HTMLImageElement) {
            // 回退路径：先绘制到画布，再上传到纹理数组。
            const frameSize = source.width
            const frameCount = Math.max(1, Math.floor(source.height / frameSize))
            const clampedIndex = frameIndex % frameCount
            const srcYSafe = clampedIndex * frameSize

            this.scratchCtx!.clearRect(0, 0, this.TEXTURE_SIZE, this.TEXTURE_SIZE)
            this.scratchCtx!.drawImage(
              source,
              0,
              srcYSafe,
              frameSize,
              frameSize,
              0,
              0,
              this.TEXTURE_SIZE,
              this.TEXTURE_SIZE,
            )
            this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, targetTexture)
            this.gl.texSubImage3D(
              this.gl.TEXTURE_2D_ARRAY,
              0,
              0,
              0,
              anim.layerIndex,
              this.TEXTURE_SIZE,
              this.TEXTURE_SIZE,
              1,
              this.gl.RGBA,
              this.gl.UNSIGNED_BYTE,
              this.scratchCanvas!,
            )
          } else {
            // 原始字节回退路径。
            const bytesPerFrame = this.TEXTURE_SIZE * this.TEXTURE_SIZE * 4
            const totalFrames = Math.max(1, Math.floor(source.length / bytesPerFrame))
            const clampedIndex = frameIndex % totalFrames
            const startOffset = clampedIndex * bytesPerFrame
            const endOffset = startOffset + bytesPerFrame
            const frameData = source.subarray(startOffset, endOffset)

            this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, targetTexture)
            this.gl.texSubImage3D(
              this.gl.TEXTURE_2D_ARRAY,
              0,
              0,
              0,
              anim.layerIndex,
              this.TEXTURE_SIZE,
              this.TEXTURE_SIZE,
              1,
              this.gl.RGBA,
              this.gl.UNSIGNED_BYTE,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              frameData as any,
            )
          }
          // 更新该层级的 mipmap，避免远距离采样继续使用旧帧。
          this.updateMipmapsGPU(targetTexture, anim.layerIndex)
        }

        // 同步更新 Albedo、Normal、Specular 三套纹理数组。
        uploadFrame(anim.sourceData, this.textureArray!, anim.resampledFrames)

        if (anim.normalSourceData && this.normalTextureArray) {
          uploadFrame(anim.normalSourceData, this.normalTextureArray, anim.normalResampledFrames)
        }

        if (anim.specularSourceData && this.specularTextureArray) {
          uploadFrame(
            anim.specularSourceData,
            this.specularTextureArray,
            anim.specularResampledFrames,
          )
        }

        this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, null)
      }
    }
  }

  /**
   * 重置 WebGL 像素存储参数，避免不同上传流程互相干扰。
   */
  private resetPixelStoreParams() {
    this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, false)
    this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)

    // 避免 DOM 源上传时发生隐式色彩空间转换。
    // 某些浏览器的 WebGL2 类型定义里可能没有该常量。
    const unpackColorSpaceConv = (this.gl as WebGL2ColorSpaceExt).UNPACK_COLORSPACE_CONVERSION_WEBGL
    if (typeof unpackColorSpaceConv === 'number') {
      // 0 对应 NONE。
      this.gl.pixelStorei(unpackColorSpaceConv, 0)
    }

    this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, 4)
    this.gl.pixelStorei(this.gl.UNPACK_ROW_LENGTH, 0)
    this.gl.pixelStorei(this.gl.UNPACK_SKIP_ROWS, 0)
    this.gl.pixelStorei(this.gl.UNPACK_SKIP_PIXELS, 0)
  }

  /**
   * 创建 Texture Array 的不可变存储。
   * 使用 texStorage3D 分配显存，并配置 NEAREST 过滤保持像素风格。
   */
  private createTextureStorage(mipLevels: number): WebGLTexture {
    const tex = this.gl.createTexture()!
    this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, tex)
    this.gl.texStorage3D(
      this.gl.TEXTURE_2D_ARRAY,
      mipLevels,
      this.gl.RGBA8,
      this.TEXTURE_SIZE,
      this.TEXTURE_SIZE,
      this.layerCount,
    )

    const error = this.gl.getError()
    if (error !== this.gl.NO_ERROR) {
      console.error('TextureManager: texStorage3D failed:', error.toString(16))
    }

    this.gl.texParameteri(
      this.gl.TEXTURE_2D_ARRAY,
      this.gl.TEXTURE_MIN_FILTER,
      this.gl.NEAREST_MIPMAP_NEAREST,
    )
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST)
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_WRAP_S, this.gl.REPEAT)
    this.gl.texParameteri(this.gl.TEXTURE_2D_ARRAY, this.gl.TEXTURE_WRAP_T, this.gl.REPEAT)
    return tex
  }

  /**
   * 确保重采样所需的 Canvas 资源已就绪。
   */
  private ensureResampleCanvases(size: number) {
    if (!this.resampleCanvas || !this.resampleCtx) {
      this.resampleCanvas = document.createElement('canvas')
      this.resampleCtx = this.resampleCanvas.getContext('2d', { willReadFrequently: true })
      if (this.resampleCtx) this.resampleCtx.imageSmoothingEnabled = false
    }
    if (!this.scratchCanvas || !this.scratchCtx) {
      this.scratchCanvas = document.createElement('canvas')
      this.scratchCtx = this.scratchCanvas.getContext('2d', { willReadFrequently: true })
      if (this.scratchCtx) this.scratchCtx.imageSmoothingEnabled = false
    }
    if (this.resampleCanvas!.width !== size || this.resampleCanvas!.height !== size) {
      this.resampleCanvas!.width = size
      this.resampleCanvas!.height = size
      if (this.resampleCtx) this.resampleCtx.imageSmoothingEnabled = false
    }
    if (this.scratchCanvas!.width !== size || this.scratchCanvas!.height !== size) {
      this.scratchCanvas!.width = size
      this.scratchCanvas!.height = size
      if (this.scratchCtx) this.scratchCtx.imageSmoothingEnabled = false
    }
  }

  /**
   * 对二进制纹理数据进行重采样。
   * 利用 Canvas 2D 将不同尺寸的源纹理缩放到统一尺寸。
   */
  private resampleTyped(data: Uint8Array, srcSize: number, targetSize: number): Uint8Array {
    if (srcSize === targetSize) return data
    if (srcSize <= 0 || targetSize <= 0) return data
    if (!data.length) return data

    this.ensureResampleCanvases(Math.max(srcSize, targetSize))

    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = srcSize
    tempCanvas.height = srcSize
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true })
    if (!tempCtx) return data

    const expected = srcSize * srcSize * 4
    if (data.length < expected) return data

    const imgData = new ImageData(new Uint8ClampedArray(data), srcSize, srcSize)
    tempCtx.putImageData(imgData, 0, 0)

    if (!this.resampleCtx) return data
    this.resampleCtx.clearRect(0, 0, targetSize, targetSize)
    this.resampleCtx.drawImage(tempCanvas, 0, 0, srcSize, srcSize, 0, 0, targetSize, targetSize)
    const out = this.resampleCtx.getImageData(0, 0, targetSize, targetSize)
    return new Uint8Array(out.data.buffer)
  }

  /**
   * 将二进制纹理上传到指定层级。
   */
  private uploadTyped(
    target: WebGLTexture,
    layer: number,
    data: Uint8Array,
    frameIndex = 0,
    srcSize: number,
  ) {
    const bytesPerFrame = srcSize * srcSize * 4
    const start = frameIndex * bytesPerFrame
    const sliceStart = data.byteOffset + start
    const sliceEnd = sliceStart + bytesPerFrame
    const slice = new Uint8Array(data.buffer.slice(sliceStart, sliceEnd))
    const resampled =
      srcSize === this.TEXTURE_SIZE ? slice : this.resampleTyped(slice, srcSize, this.TEXTURE_SIZE)
    this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, target)
    this.gl.texSubImage3D(
      this.gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layer,
      this.TEXTURE_SIZE,
      this.TEXTURE_SIZE,
      1,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      resampled,
    )
  }

  /**
   * 将 HTML 图像上传到指定层级。
   */
  private uploadImage(target: WebGLTexture, layer: number, img: HTMLImageElement) {
    const frameSize = img.width
    const srcH = Math.min(frameSize, img.height)

    this.ensureResampleCanvases(this.TEXTURE_SIZE)
    this.scratchCtx?.clearRect(0, 0, this.TEXTURE_SIZE, this.TEXTURE_SIZE)
    this.scratchCtx?.drawImage(
      img,
      0,
      0,
      frameSize,
      srcH,
      0,
      0,
      this.TEXTURE_SIZE,
      this.TEXTURE_SIZE,
    )
    this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, target)
    this.gl.texSubImage3D(
      this.gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      layer,
      this.TEXTURE_SIZE,
      this.TEXTURE_SIZE,
      1,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
      this.scratchCanvas!,
    )
  }

  /**
   * 解析并构建动画纹理。
   * 处理 .mcmeta 配置，并预处理所有动画帧。
   */
  private async buildAnimation(
    tex: {
      width: number
      height: number
      meta?: { animation?: { frametime?: number; frames?: unknown[] } }
      isAnimated: boolean
    },
    layerIndex: number,
    sources: {
      color: Uint8Array | HTMLImageElement
      normal?: Uint8Array | HTMLImageElement | null
      specular?: Uint8Array | HTMLImageElement | null
    },
  ): Promise<void> {
    const frames: AnimationFrame[] = []
    const metaAnim = tex.meta?.animation
    const baseFrameTime = metaAnim?.frametime ?? 1

    // 解析帧序列与持续时间
    if (metaAnim?.frames?.length) {
      for (const f of metaAnim.frames) {
        if (typeof f === 'number') {
          frames.push({ index: f, time: baseFrameTime * 50 })
        } else {
          const frame = f as { index: number; time?: number }
          frames.push({ index: frame.index, time: (frame.time ?? baseFrameTime) * 50 })
        }
      }
    } else if (tex.isAnimated && tex.height > tex.width) {
      // 默认按垂直方向切分动画帧
      const frameCount = tex.height / tex.width
      for (let i = 0; i < frameCount; i++) {
        frames.push({ index: i, time: baseFrameTime * 50 })
      }
    }

    if (frames.length <= 1) return

    const totalTime = frames.reduce((acc, f) => acc + f.time, 0)

    let resampledFrames: (Uint8Array | ImageBitmap)[] | undefined
    let normalResampledFrames: (Uint8Array | ImageBitmap)[] | undefined
    let specularResampledFrames: (Uint8Array | ImageBitmap)[] | undefined

    const bytesPerFrameSrc = tex.width * tex.width * 4
    const frameCount = Math.max(frames.length, tex.height > tex.width ? tex.height / tex.width : 1)

    /**
     * 异步重采样所有动画帧
     */
    const resampleTypedFrames = async (
      src: Uint8Array | null | undefined,
      targetArraySetter: (arr: (Uint8Array | ImageBitmap)[]) => void,
    ) => {
      if (!src) return
      const arr: (Uint8Array | ImageBitmap)[] = []
      let firstFrame: ImageBitmap | null = null
      let firstFrameData: Uint8Array | null = null
      let isStatic = true

      const createBitmap = async (imageData: ImageData): Promise<ImageBitmap> => {
        // 保持原始字节不被修改，避免透明像素被预乘或色彩空间转换污染。
        const commonOpts: ImageBitmapOptions = {
          premultiplyAlpha: 'none',
          colorSpaceConversion: 'none',
        }

        if (tex.width !== this.TEXTURE_SIZE) {
          const resizeOpts: ImageBitmapOptions = {
            ...commonOpts,
            resizeWidth: this.TEXTURE_SIZE,
            resizeHeight: this.TEXTURE_SIZE,
            resizeQuality: 'pixelated',
          }
          try {
            return await createImageBitmap(imageData, resizeOpts)
          } catch {
            // 旧浏览器或旧类型定义可能不支持这些选项，回退到仅缩放模式。
            return await createImageBitmap(imageData, {
              resizeWidth: this.TEXTURE_SIZE,
              resizeHeight: this.TEXTURE_SIZE,
              resizeQuality: 'pixelated',
            })
          }
        }

        try {
          return await createImageBitmap(imageData, commonOpts)
        } catch {
          return await createImageBitmap(imageData)
        }
      }

      const areEqual = (a: Uint8Array, b: Uint8Array) => {
        if (a.length !== b.length) return false
        for (let i = 0; i < a.length; i++) {
          if (a[i] !== b[i]) return false
        }
        return true
      }

      for (let i = 0; i < frameCount; i++) {
        const start = i * bytesPerFrameSrc
        const sliceStart = src.byteOffset + start
        const sliceEnd = sliceStart + bytesPerFrameSrc
        const slice = new Uint8Array(src.buffer.slice(sliceStart, sliceEnd))

        // 静态帧优化：如果后续帧与第一帧相同，则复用 ImageBitmap。
        if (i > 0 && isStatic && firstFrame && firstFrameData && areEqual(slice, firstFrameData)) {
          arr.push(firstFrame)
          continue
        }

        if (i > 0) isStatic = false

        const imageData = new ImageData(new Uint8ClampedArray(slice), tex.width, tex.width)
        const bitmap = await createBitmap(imageData)

        if (i === 0) {
          firstFrame = bitmap
          firstFrameData = slice
        }

        arr.push(bitmap)
      }
      targetArraySetter(arr)
    }

    /**
     * 对 HTMLImageElement 执行同样的预处理。
     * 关键点是禁用 premultiplyAlpha 与 colorSpaceConversion，避免亮色在半透明区域被压暗。
     */
    const resampleImageFrames = async (
      src: HTMLImageElement | null | undefined,
      targetArraySetter: (arr: (Uint8Array | ImageBitmap)[]) => void,
    ) => {
      if (!src) return

      const arr: (Uint8Array | ImageBitmap)[] = []
      const frameSize = src.width
      const totalFrames = Math.max(1, Math.floor(src.height / frameSize))

      const commonOpts: ImageBitmapOptions = {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      }

      for (let i = 0; i < totalFrames; i++) {
        const sx = 0
        const sy = i * frameSize
        const sw = frameSize
        const sh = frameSize

        // 优先一步完成裁剪与缩放。
        try {
          if (frameSize !== this.TEXTURE_SIZE) {
            arr.push(
              await createImageBitmap(src, sx, sy, sw, sh, {
                ...commonOpts,
                resizeWidth: this.TEXTURE_SIZE,
                resizeHeight: this.TEXTURE_SIZE,
                resizeQuality: 'pixelated',
              }),
            )
          } else {
            arr.push(await createImageBitmap(src, sx, sy, sw, sh, commonOpts))
          }
          continue
        } catch {
          // 继续尝试下一种回退路径。
        }

        // 回退到仅缩放模式。
        try {
          if (frameSize !== this.TEXTURE_SIZE) {
            arr.push(
              await createImageBitmap(src, sx, sy, sw, sh, {
                resizeWidth: this.TEXTURE_SIZE,
                resizeHeight: this.TEXTURE_SIZE,
                resizeQuality: 'pixelated',
              }),
            )
          } else {
            arr.push(await createImageBitmap(src, sx, sy, sw, sh))
          }
          continue
        } catch {
          // 继续尝试最终回退路径。
        }

        // 最终回退到 Canvas 绘制路径。
        this.ensureResampleCanvases(this.TEXTURE_SIZE)
        this.resampleCtx!.clearRect(0, 0, this.TEXTURE_SIZE, this.TEXTURE_SIZE)
        this.resampleCtx!.drawImage(src, sx, sy, sw, sh, 0, 0, this.TEXTURE_SIZE, this.TEXTURE_SIZE)
        arr.push(await createImageBitmap(this.resampleCanvas!))
      }

      targetArraySetter(arr)
    }

    // 并行处理颜色、法线和高光动画帧。
    await Promise.all([
      resampleTypedFrames(
        sources.color instanceof Uint8Array ? sources.color : null,
        arr => (resampledFrames = arr),
      ),
      resampleImageFrames(
        sources.color instanceof HTMLImageElement ? sources.color : null,
        arr => (resampledFrames = arr),
      ),
      resampleTypedFrames(
        sources.normal instanceof Uint8Array ? sources.normal : null,
        arr => (normalResampledFrames = arr),
      ),
      resampleImageFrames(
        sources.normal instanceof HTMLImageElement ? sources.normal : null,
        arr => (normalResampledFrames = arr),
      ),
      resampleTypedFrames(
        sources.specular instanceof Uint8Array ? sources.specular : null,
        arr => (specularResampledFrames = arr),
      ),
      resampleImageFrames(
        sources.specular instanceof HTMLImageElement ? sources.specular : null,
        arr => (specularResampledFrames = arr),
      ),
    ])

    this.animatedTextures.push({
      layerIndex,
      sourceData: sources.color instanceof Uint8Array ? new Uint8Array(0) : sources.color,
      normalSourceData:
        sources.normal instanceof Uint8Array ? new Uint8Array(0) : (sources.normal ?? null),
      specularSourceData:
        sources.specular instanceof Uint8Array ? new Uint8Array(0) : (sources.specular ?? null),
      resampledFrames,
      normalResampledFrames,
      specularResampledFrames,
      frames,
      totalTime,
      elapsedTime: 0,
      currentFrameIndex: -1,
      width: tex.width,
      height: tex.height,
    })
  }

  /**
   * 纹理加载主流程。
   * 1. 通过 TextureLoader 获取原始数据。
   * 2. 计算统一纹理尺寸并分配 GPU 存储。
   * 3. 并行上传各层纹理并构建动画状态。
   * 4. 生成 mipmap，并清理 CPU 侧临时缓冲。
   */
  public async loadTextures(resource: ResourceDefinition): Promise<void> {
    console.log('[TextureManager] loadTextures started')
    const startTime = performance.now()

    this.resetPixelStoreParams()

    const loader = TextureLoader.getInstance()
    let loaded: LoadedTexture[] = []
    try {
      console.log('[TextureManager] Loading raw texture data...')
      loaded = await loader.load(resource)

      if (!loaded.length) {
        console.warn('[TextureManager] No textures loaded')
        return
      }
      console.log(`[TextureManager] Loaded ${loaded.length} raw textures`)

      const renderMax = GAME_CONFIG.RENDER?.MAX_TEXTURE_SIZE ?? 128
      const resourceMax = resource?.MAX_TEXTURE_SIZE ?? renderMax
      const maxTextureSize = Math.min(renderMax, resourceMax)
      // 选择统一纹理尺寸，并受配置上限约束以避免 GPU 显存膨胀。
      this.TEXTURE_SIZE = Math.min(Math.max(...loaded.map(t => t.width), 16), maxTextureSize)
      this.layerCount = loaded.length
      console.log(
        `[TextureManager] Configured texture array: size=${this.TEXTURE_SIZE}px (cap=${maxTextureSize}), layers=${this.layerCount}`,
      )

      // Greedy Meshing 的方块纹理索引仅保留 11 位。
      if (this.layerCount > 2048) {
        alert(
          `[Severe Error] Texture count (${this.layerCount}) exceeds Greedy Meshing limit (2048)! Rendering will be corrupted.`,
        )
        console.error(
          `[Severe Error] Texture count (${this.layerCount}) exceeds Greedy Meshing limit (2048)!`,
        )
      }

      // 初始化共享画布资源。
      this.ensureResampleCanvases(this.TEXTURE_SIZE)

      // 准备 GPU 纹理对象。
      const mipLevels = Math.floor(Math.log2(this.TEXTURE_SIZE)) + 1
      this.maxMipLevel = mipLevels

      const maxLayers = this.gl.getParameter(this.gl.MAX_ARRAY_TEXTURE_LAYERS)
      if (this.layerCount > maxLayers) {
        console.error(
          `[TextureManager] Too many texture layers! Count=${this.layerCount}, Max=${maxLayers}`,
        )
      }

      console.log('[TextureManager] Allocating GPU memory...')
      this.textureArray = this.createTextureStorage(mipLevels)
      this.normalTextureArray = this.createTextureStorage(mipLevels)
      this.specularTextureArray = this.createTextureStorage(mipLevels)

      const createPlaceholderData = (color: [number, number, number, number]) => {
        const size = this.TEXTURE_SIZE * this.TEXTURE_SIZE * 4
        const buf = new Uint8Array(size)
        for (let i = 0; i < size; i += 4) {
          buf[i] = color[0]
          buf[i + 1] = color[1]
          buf[i + 2] = color[2]
          buf[i + 3] = color[3]
        }
        return buf
      }

      const placeholderNormal = createPlaceholderData([128, 128, 255, 255])
      const placeholderSpec = createPlaceholderData([0, 0, 0, 0])

      console.log('[TextureManager] Uploading textures and building animations...')
      let processedCount = 0
      const totalCount = loaded.length
      const logInterval = Math.max(1, Math.floor(totalCount / 10))

      // 上传每个纹理层，并并行构建动画数据。
      await Promise.all(
        loaded.map(async (tex, index) => {
          this.textureMap.set(tex.name, index)

          // 颜色贴图。
          if (tex.colorData instanceof Uint8Array) {
            this.uploadTyped(this.textureArray!, index, tex.colorData, 0, tex.width)
          } else {
            this.uploadImage(this.textureArray!, index, tex.colorData)
          }

          // 法线贴图。
          if (tex.normalData) {
            if (tex.normalData instanceof Uint8Array) {
              this.uploadTyped(this.normalTextureArray!, index, tex.normalData, 0, tex.width)
            } else {
              this.uploadImage(this.normalTextureArray!, index, tex.normalData)
            }
          } else {
            this.uploadTyped(
              this.normalTextureArray!,
              index,
              placeholderNormal,
              0,
              this.TEXTURE_SIZE,
            )
          }

          // 高光贴图。
          if (tex.specularData) {
            if (tex.specularData instanceof Uint8Array) {
              this.uploadTyped(this.specularTextureArray!, index, tex.specularData, 0, tex.width)
            } else {
              this.uploadImage(this.specularTextureArray!, index, tex.specularData)
            }
          } else {
            this.uploadTyped(
              this.specularTextureArray!,
              index,
              placeholderSpec,
              0,
              this.TEXTURE_SIZE,
            )
          }

          await this.buildAnimation(tex, index, {
            color: tex.colorData,
            normal: tex.normalData,
            specular: tex.specularData,
          })

          // 尽快释放单纹理 CPU 缓冲，避免通过子数组长期引用 textures.bin。
          if (tex.colorData instanceof Uint8Array) tex.colorData = new Uint8Array(0)
          if (tex.normalData instanceof Uint8Array) tex.normalData = new Uint8Array(0)
          if (tex.specularData instanceof Uint8Array) tex.specularData = new Uint8Array(0)

          processedCount++
          if (processedCount % logInterval === 0 || processedCount === totalCount) {
            console.log(
              `[TextureManager] Progress: ${Math.round((processedCount / totalCount) * 100)}% (${processedCount}/${totalCount})`,
            )
          }
        }),
      )

      console.log('[TextureManager] Generating mipmaps...')
      this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, this.textureArray)
      this.gl.generateMipmap(this.gl.TEXTURE_2D_ARRAY)
      this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, this.normalTextureArray)
      this.gl.generateMipmap(this.gl.TEXTURE_2D_ARRAY)
      this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, this.specularTextureArray)
      this.gl.generateMipmap(this.gl.TEXTURE_2D_ARRAY)

      this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, null)

      const duration = performance.now() - startTime
      console.log(`[TextureManager] loadTextures completed in ${duration.toFixed(2)}ms`)

      // Variant LUT 由 Renderer 在需要时显式触发加载。
    } finally {
      // GPU 上传完成后立即释放 CPU 侧副本，降低主线程内存压力。
      loader.clear()
      loaded.length = 0
    }
  }

  public getNormalArray(): WebGLTexture | null {
    return this.normalTextureArray
  }

  public getSpecularArray(): WebGLTexture | null {
    return this.specularTextureArray
  }

  public getTextureMap(): Map<string, number> {
    return this.textureMap
  }

  public getTextureArray(): WebGLTexture | null {
    return this.textureArray
  }

  public getTextureIndex(name: string): number {
    // 缺失纹理时回退到默认纹理索引。
    if (this.textureMap.has(name)) {
      return this.textureMap.get(name)!
    }
    console.warn(`Texture not found: ${name}`)
    return 0 // 回退到第一张纹理。
  }

  public getMap(): Map<string, number> {
    return this.textureMap
  }

  /**
   * 释放全部纹理与辅助资源。
   */
  public dispose(): void {
    console.log('[TextureManager] Disposing resources')

    // 删除 WebGL 纹理。
    if (this.textureArray) {
      this.gl.deleteTexture(this.textureArray)
      this.textureArray = null
    }
    if (this.normalTextureArray) {
      this.gl.deleteTexture(this.normalTextureArray)
      this.normalTextureArray = null
    }
    if (this.specularTextureArray) {
      this.gl.deleteTexture(this.specularTextureArray)
      this.specularTextureArray = null
    }

    // 清理帧缓冲。
    if (this.readFrameBuffer) {
      this.readFrameBuffer.dispose()
      this.readFrameBuffer = null
    }
    if (this.writeFrameBuffer) {
      this.writeFrameBuffer.dispose()
      this.writeFrameBuffer = null
    }

    // 清理画布资源。
    if (this.scratchCanvas) {
      this.scratchCanvas.width = 1
      this.scratchCanvas.height = 1
      this.scratchCanvas = null
      this.scratchCtx = null
    }
    if (this.resampleCanvas) {
      this.resampleCanvas.width = 1
      this.resampleCanvas.height = 1
      this.resampleCanvas = null
      this.resampleCtx = null
    }

    // 清理动画纹理缓存。
    this.animatedTextures.forEach(anim => {
      // 关闭 ImageBitmap。
      const closeBitmaps = (frames?: (Uint8Array | ImageBitmap)[]) => {
        if (!frames) return
        frames.forEach(f => {
          if (f instanceof ImageBitmap) f.close()
        })
      }
      closeBitmaps(anim.resampledFrames)
      closeBitmaps(anim.normalResampledFrames)
      closeBitmaps(anim.specularResampledFrames)

      // 清空大对象引用，帮助 GC 尽快回收。
      const animAny = anim as unknown as Record<string, unknown>
      if ('sourceData' in anim) delete animAny.sourceData
      if ('normalSourceData' in anim) delete animAny.normalSourceData
      if ('specularSourceData' in anim) delete animAny.specularSourceData
      if ('resampledFrames' in anim) delete animAny.resampledFrames
      if ('normalResampledFrames' in anim) delete animAny.normalResampledFrames
      if ('specularResampledFrames' in anim) delete animAny.specularResampledFrames
    })
    this.animatedTextures = []

    // 清空纹理索引映射。
    this.textureMap.clear()
    this.layerCount = 0

    console.log('[TextureManager] Resources disposed')
  }
}
