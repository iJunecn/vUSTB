import { FrameBuffer } from '@render/core/buffer/FrameBuffer'

/**
 * @file ShadowManager.ts
 * @brief 阴影贴图资源管理
 *
 * 说明：
 *  - 管理级联阴影深度贴图与彩色阴影贴图
 *  - 封装阴影 FBO 与多层纹理附件切换
 *  - 在高精度与兼容格式之间做能力回退
 */
export class ShadowManager {
  private gl: WebGL2RenderingContext
  public shadowMap: WebGLTexture // 阴影深度贴图数组。
  public shadowColorMap: WebGLTexture // 彩色阴影贴图数组。
  public frameBuffer: FrameBuffer // 阴影渲染使用的 FBO。
  public resolution: number // 阴影贴图分辨率。
  public cascadeCount: number // 级联层级数量。
  public useHighPrecision: boolean = false // 是否使用高精度深度格式。

  /**
   * 创建阴影资源管理器。
   * @param gl WebGL2 上下文。
   * @param resolution 阴影贴图分辨率。
   * @param cascadeCount 级联层级数量。
   */
  constructor(gl: WebGL2RenderingContext, resolution: number = 2048, cascadeCount: number = 3) {
    this.gl = gl
    this.resolution = resolution
    this.cascadeCount = cascadeCount

    // 创建级联深度纹理数组，并在必要时回退到 24 位深度格式。
    this.shadowMap = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shadowMap)

    const allocateDepth = (internalFormat: number, type: number) => {
      gl.texImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        internalFormat,
        resolution,
        resolution,
        this.cascadeCount,
        0,
        gl.DEPTH_COMPONENT,
        type,
        null,
      )
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }

    allocateDepth(gl.DEPTH_COMPONENT32F, gl.FLOAT)
    this.useHighPrecision = true

    // 创建彩色阴影纹理数组。
    // 优先使用浮点格式，以支持大于 1.0 的透射累积值。
    this.shadowColorMap = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shadowColorMap)

    const extColorFloat = gl.getExtension('EXT_color_buffer_float')
    const useFloatColor = !!extColorFloat

    if (useFloatColor) {
      // 使用 RGBA16F 存储彩色阴影数据。
      gl.texImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        gl.RGBA16F,
        resolution,
        resolution,
        this.cascadeCount,
        0,
        gl.RGBA,
        gl.HALF_FLOAT,
        null,
      )
    } else {
      // 回退到 RGBA8，并由 Shader 负责压缩编码。
      console.warn(
        'EXT_color_buffer_float not supported, using RGBA8 for shadow color. Precision constraints apply.',
      )
      gl.texImage3D(
        gl.TEXTURE_2D_ARRAY,
        0,
        gl.RGBA8,
        resolution,
        resolution,
        this.cascadeCount,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      )
    }

    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    this.frameBuffer = new FrameBuffer(gl, resolution, resolution)
    // 初始绑定第一层级。
    this.frameBuffer.attachTextureLayer(this.shadowMap, gl.DEPTH_ATTACHMENT, 0)
    this.frameBuffer.attachTextureLayer(this.shadowColorMap, gl.COLOR_ATTACHMENT0, 0)

    this.frameBuffer.setDrawBuffers([gl.COLOR_ATTACHMENT0])

    // 如果 32F 深度纹理不可用，则回退到 24 位深度格式。
    if (!this.frameBuffer.checkStatus()) {
      console.warn('[ShadowManager] Depth32F FBO incomplete, fallback to DEPTH_COMPONENT24')
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shadowMap)
      allocateDepth(gl.DEPTH_COMPONENT24, gl.UNSIGNED_INT)
      this.useHighPrecision = false
      this.frameBuffer.attachTextureLayer(this.shadowMap, gl.DEPTH_ATTACHMENT, 0)
      if (!this.frameBuffer.checkStatus()) {
        console.error('[ShadowManager] Depth24 fallback also incomplete; shadows may be disabled')
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
   * 释放 GPU 资源
   */
  dispose() {
    this.gl.deleteTexture(this.shadowMap)
    this.gl.deleteTexture(this.shadowColorMap)
    // this.gl.deleteTexture(this.shadowFluxMap)
    // this.gl.deleteTexture(this.shadowNormalMap)
    this.frameBuffer.dispose()
  }
}
