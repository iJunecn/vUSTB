import { GL } from '@render/utils/gl'
import { FrameBuffer } from '@render/core/buffer/FrameBuffer'

/**
 * @file GBuffer.ts
 * @brief 延迟渲染几何缓冲
 *
 * 说明：
 *  - 管理延迟渲染阶段的多个颜色附件与深度附件
 *  - 统一承载反照率、法线、PBR 参数和深度数据
 *  - 按设备能力选择深度格式与线性深度附件
 */
export class GBuffer {
  public frameBuffer: FrameBuffer
  public RT0: WebGLTexture
  public RT1: WebGLTexture
  public RT2: WebGLTexture
  /** 可选线性深度附件，使用 RG8 打包 16 位 UNORM。 */
  public linearDepth: WebGLTexture | null = null
  public depth: WebGLTexture
  private depthInternalFormat: number
  private depthType: number
  private linearDepthEnabled: boolean
  public width: number
  public height: number

  /**
   * 创建 G-Buffer。
   * @param gl WebGL2 上下文。
   * @param width 宽度。
   * @param height 高度。
   * @param enableLinearDepth 是否额外分配存储线性视深度的 RG8 附件。
   */
  constructor(
    gl: WebGL2RenderingContext,
    width: number,
    height: number,
    enableLinearDepth: boolean = false,
  ) {
    this.width = width
    this.height = height
    this.frameBuffer = new FrameBuffer(gl, width, height)
    this.linearDepthEnabled = enableLinearDepth

    // RT0：反照率与自发光。
    this.RT0 = GL.createTexture(gl, width, height, {
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.NEAREST,
      magFilter: gl.NEAREST,
    })
    this.frameBuffer.attachTexture(this.RT0, gl.COLOR_ATTACHMENT0)

    // RT1：法线。
    // 这里使用 RGBA8，以兼顾兼容性与显存占用。
    this.RT1 = GL.createTexture(gl, width, height, {
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.NEAREST,
      magFilter: gl.NEAREST,
    })
    this.frameBuffer.attachTexture(this.RT1, gl.COLOR_ATTACHMENT1)

    // RT2：粗糙度、金属度、天空光和方块光。
    this.RT2 = GL.createTexture(gl, width, height, {
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.NEAREST,
      magFilter: gl.NEAREST,
    })
    this.frameBuffer.attachTexture(this.RT2, gl.COLOR_ATTACHMENT2)

    if (this.linearDepthEnabled) {
      // 使用 RG8 存储线性深度，降低移动端深度量化带来的条带问题。
      this.linearDepth = GL.createTexture(gl, width, height, {
        internalFormat: gl.RG8,
        format: gl.RG,
        type: gl.UNSIGNED_BYTE,
        minFilter: gl.NEAREST,
        magFilter: gl.NEAREST,
        wrapS: gl.CLAMP_TO_EDGE,
        wrapT: gl.CLAMP_TO_EDGE,
      })
      this.frameBuffer.attachTexture(this.linearDepth, gl.COLOR_ATTACHMENT3)
    }

    // 通道打包约定：自发光存储在 RT0.a。

    // 深度缓冲。
    // 关键：阴影/位置重建高度依赖深度精度。
    // 移动端有些设备会在你“以为”是 24bit 时实际降级，导致屏幕空间量化带在阴影里被放大。
    // 这里优先尝试 32F，并用 FBO 完整性检测保证不是“flag only”。失败则回退 24bit。
    const createDepth = (internalFormat: number, type: number) =>
      GL.createTexture(gl, width, height, {
        internalFormat,
        format: gl.DEPTH_COMPONENT,
        type,
        minFilter: gl.NEAREST,
        magFilter: gl.NEAREST,
      })

    const configureDepthSampling = (tex: WebGLTexture) => {
      gl.bindTexture(gl.TEXTURE_2D, tex)
      // 确保深度以普通纹理值采样，而不是比较采样。
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE)
      // 禁止错误使用 mip 级别。
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 0)
      // 使用稳定的采样参数，减少驱动差异造成的边缘伪影。
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }

    this.depthInternalFormat = gl.DEPTH_COMPONENT32F
    this.depthType = gl.FLOAT
    this.depth = createDepth(this.depthInternalFormat, this.depthType)
    configureDepthSampling(this.depth)
    this.frameBuffer.attachTexture(this.depth, gl.DEPTH_ATTACHMENT)

    // 配置绘制附件列表，确保所有颜色附件都能正确写入。
    this.frameBuffer.setDrawBuffers([
      gl.COLOR_ATTACHMENT0,
      gl.COLOR_ATTACHMENT1,
      gl.COLOR_ATTACHMENT2,
      ...(this.linearDepthEnabled ? [gl.COLOR_ATTACHMENT3] : []),
    ])

    if (!this.frameBuffer.checkStatus()) {
      console.warn(
        '[GBuffer] DEPTH_COMPONENT32F not supported for this FBO, fallback to DEPTH_COMPONENT24',
      )
      gl.deleteTexture(this.depth)
      this.depthInternalFormat = gl.DEPTH_COMPONENT24
      this.depthType = gl.UNSIGNED_INT
      this.depth = createDepth(this.depthInternalFormat, this.depthType)
      configureDepthSampling(this.depth)
      this.frameBuffer.attachTexture(this.depth, gl.DEPTH_ATTACHMENT)
      // 如果仍然不完整，可能是线性深度附件不受支持，则直接关闭该附件。
      if (!this.frameBuffer.checkStatus() && this.linearDepthEnabled && this.linearDepth) {
        console.warn('[GBuffer] LinearDepth attachment may be unsupported, disabling it')
        gl.deleteTexture(this.linearDepth)
        this.linearDepth = null
        this.linearDepthEnabled = false
        // 解绑附件 3。
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.frameBuffer.fbo)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT3, gl.TEXTURE_2D, null, 0)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        this.frameBuffer.setDrawBuffers([
          gl.COLOR_ATTACHMENT0,
          gl.COLOR_ATTACHMENT1,
          gl.COLOR_ATTACHMENT2,
        ])
        this.frameBuffer.checkStatus()
      }
    }
    this.frameBuffer.unbind()
  }

  /**
   * 获取底层 WebGLFramebuffer 对象。
   */
  get fbo() {
    return this.frameBuffer.fbo
  }

  /**
   * 调整 G-Buffer 尺寸。
   * @param gl WebGL2 上下文。
   * @param width 新宽度。
   * @param height 新高度。
   */
  resize(gl: WebGL2RenderingContext, width: number, height: number) {
    if (this.width === width && this.height === height) return

    this.width = width
    this.height = height
    this.frameBuffer.resize(width, height)

    GL.resizeTexture(gl, this.RT0, width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE)
    GL.resizeTexture(gl, this.RT1, width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE)
    GL.resizeTexture(gl, this.RT2, width, height, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE)
    if (this.linearDepth) {
      GL.resizeTexture(gl, this.linearDepth, width, height, gl.RG8, gl.RG, gl.UNSIGNED_BYTE)
    }
    GL.resizeTexture(
      gl,
      this.depth,
      width,
      height,
      this.depthInternalFormat,
      gl.DEPTH_COMPONENT,
      this.depthType,
    )
  }

  /**
   * 释放 G-Buffer 资源。
   * @param gl WebGL2 上下文。
   */
  dispose(gl: WebGL2RenderingContext) {
    this.frameBuffer.dispose()
    gl.deleteTexture(this.RT0)
    gl.deleteTexture(this.RT1)
    gl.deleteTexture(this.RT2)
    if (this.linearDepth) gl.deleteTexture(this.linearDepth)
    gl.deleteTexture(this.depth)
  }
}
