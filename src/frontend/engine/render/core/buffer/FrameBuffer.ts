/**
 * @file FrameBuffer.ts
 * @brief WebGL 帧缓冲封装
 *
 * 说明：
 *  - 封装 FBO 的创建、绑定、挂接与销毁流程
 *  - 记录当前逻辑尺寸，供上层同步视口与附件大小
 *  - 支持二维纹理与纹理数组层级附件
 */
export class FrameBuffer {
  private gl: WebGL2RenderingContext
  public fbo: WebGLFramebuffer
  public width: number
  public height: number

  /**
   * 创建一个新的帧缓冲对象。
   * @param gl WebGL2 上下文
   * @param width 逻辑宽度
   * @param height 逻辑高度
   */
  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl
    this.width = width
    this.height = height
    const fbo = gl.createFramebuffer()
    if (!fbo) throw new Error('Failed to create framebuffer')
    this.fbo = fbo
  }

  /** 绑定当前帧缓冲。 */
  bind() {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fbo)
  }

  /** 解绑帧缓冲，恢复默认 framebuffer。 */
  unbind() {
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
  }

  /**
   * 将 2D 纹理挂接到指定附件点。
   * @param texture 目标纹理
   * @param attachment 附件点，例如 `gl.COLOR_ATTACHMENT0`
   * @param target 纹理目标，默认 `gl.TEXTURE_2D`
   * @param level mip 级别，默认 0
   */
  attachTexture(
    texture: WebGLTexture,
    attachment: number,
    target: number = this.gl.TEXTURE_2D,
    level: number = 0,
  ) {
    this.bind()
    this.gl.framebufferTexture2D(this.gl.FRAMEBUFFER, attachment, target, texture, level)
    this.unbind()
  }

  /**
   * 将纹理数组或 3D 纹理的某一层挂接到附件点。
   * @param texture 目标纹理
   * @param attachment 附件点
   * @param layer 目标层级
   * @param level mip 级别
   */
  attachTextureLayer(texture: WebGLTexture, attachment: number, layer: number, level: number = 0) {
    this.bind()
    this.gl.framebufferTextureLayer(this.gl.FRAMEBUFFER, attachment, texture, level, layer)
    this.unbind()
  }

  /**
   * 配置当前 FBO 的绘制附件列表，用于 MRT。
   * @param buffers 附件点列表
   */
  setDrawBuffers(buffers: number[]) {
    this.bind()
    this.gl.drawBuffers(buffers)
    this.unbind()
  }

  /**
   * 检查 FBO 是否完整可用。
   * @returns 是否通过完整性检查
   */
  checkStatus() {
    this.bind()
    const status = this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER)
    if (status !== this.gl.FRAMEBUFFER_COMPLETE) {
      console.error('Framebuffer incomplete:', status.toString(16))
      this.unbind()
      return false
    }
    this.unbind()
    return true
  }

  /**
   * 更新记录的尺寸信息。
   * 这里只修改逻辑宽高，附件纹理需要由调用方自行重建或缩放。
   */
  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  /** 释放底层 framebuffer 资源。 */
  dispose() {
    this.gl.deleteFramebuffer(this.fbo)
  }
}
