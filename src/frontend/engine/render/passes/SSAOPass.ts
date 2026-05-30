import { GL } from '@render/utils/gl'
import vsh from '@shaders/screen/ssao.vsh'
import fsh from '@shaders/screen/ssao.fsh'
import { FrameBuffer } from '@render/core/buffer/FrameBuffer'
import { drawCallStats } from '@render/debug/DrawCallStats'
import { SSAO_TEXTURE_UNITS } from '@render/bindings/TextureUnits'

/**
 * @file SSAOPass.ts
 * @brief 屏幕空间环境光遮蔽通道
 *
 * 说明：
 *  - 通过深度与法线重建局部遮蔽信息
 *  - 使用采样核与噪声纹理降低带状伪影
 *  - 输出后续可继续模糊的 SSAO 结果
 */
export class SSAOPass {
  private gl: WebGL2RenderingContext
  public program: WebGLProgram
  private quadVBO: WebGLBuffer
  private quadVAO: WebGLVertexArrayObject

  public ssaoFrameBuffer!: FrameBuffer
  public ssaoTexture!: WebGLTexture
  private noiseTexture!: WebGLTexture
  private kernel!: Float32Array
  private readonly uniformLocations: ReturnType<typeof GL.getUniformLocations>

  private width: number
  private height: number

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl
    this.width = width
    this.height = height
    this.program = GL.createProgram(gl, vsh, fsh)
    this.uniformLocations = GL.getUniformLocations(gl, this.program, [
      'uProjection',
      'uInverseProjection',
      'uView',
      'uScreenSize',
      'uSamples',
      'uNoiseScale',
      'uRT1',
      'uGDepth',
      'uNoiseTexture',
      'uRadius',
      'uBias',
    ] as const)

    // Fullscreen Quad
    const quadVertices = new Float32Array([
      // pos        // uv
      -1.0, 1.0, 0.0, 1.0, -1.0, -1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, -1.0, 1.0, 0.0,
    ])
    this.quadVAO = gl.createVertexArray()!
    this.quadVBO = gl.createBuffer()!
    gl.bindVertexArray(this.quadVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO)
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW)
    // aPosition (Location 0)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 4 * 4, 0)
    // aTexCoord (Location 1) - manually set stride offset
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 4 * 4, 2 * 4)

    this.initKernel()
    this.initNoise()
    this.initFramebuffer()
  }

  private initKernel() {
    const kernelSize = 64
    const kernel = new Float32Array(kernelSize * 3)
    for (let i = 0; i < kernelSize; i++) {
      const sample = [Math.random() * 2.0 - 1.0, Math.random() * 2.0 - 1.0, Math.random()]
      // Normalize
      const len = Math.sqrt(sample[0] * sample[0] + sample[1] * sample[1] + sample[2] * sample[2])
      sample[0] /= len
      sample[1] /= len
      sample[2] /= len

      // Scale samples to be distributed within hemisphere
      let scale = i / kernelSize
      scale = 0.1 + scale * scale * (1.0 - 0.1) // Lerp

      sample[0] *= scale
      sample[1] *= scale
      sample[2] *= scale

      kernel[i * 3 + 0] = sample[0]
      kernel[i * 3 + 1] = sample[1]
      kernel[i * 3 + 2] = sample[2]
    }
    this.kernel = kernel
  }

  private initNoise() {
    const gl = this.gl
    const noiseData = new Float32Array(16 * 3)
    for (let i = 0; i < 16; i++) {
      noiseData[i * 3 + 0] = Math.random() * 2.0 - 1.0
      noiseData[i * 3 + 1] = Math.random() * 2.0 - 1.0
      noiseData[i * 3 + 2] = 0.0 // Rotate around Z
    }
    this.noiseTexture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTexture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, 4, 4, 0, gl.RGB, gl.FLOAT, noiseData)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
  }

  private initFramebuffer() {
    const gl = this.gl
    this.ssaoFrameBuffer = new FrameBuffer(gl, this.width, this.height)
    this.ssaoTexture = GL.createTexture(gl, this.width, this.height, {
      internalFormat: gl.R8,
      format: gl.RED,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.NEAREST,
      magFilter: gl.NEAREST,
    })
    this.ssaoFrameBuffer.attachTexture(this.ssaoTexture, gl.COLOR_ATTACHMENT0)
  }

  public resize(width: number, height: number) {
    this.width = width
    this.height = height
    // Recreate framebuffer
    // Dispose old if needed (FrameBuffer class might handle simple resizing or we reinit)
    // Assuming we just re-init for simplicity or use FrameBuffer's resize if available.
    // Let's just create new texture and re-attach.
    const gl = this.gl
    gl.deleteTexture(this.ssaoTexture)
    this.ssaoTexture = GL.createTexture(gl, width, height, {
      internalFormat: gl.R8,
      format: gl.RED,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.NEAREST,
      magFilter: gl.NEAREST,
    })
    this.ssaoFrameBuffer.resize(width, height)
    this.ssaoFrameBuffer.attachTexture(this.ssaoTexture, gl.COLOR_ATTACHMENT0)
  }

  public render(
    gBufferNormal: WebGLTexture,
    gBufferDepth: WebGLTexture,
    projection: Float32Array,
    cameraNear: number,
    cameraFar: number,
    inverseProjection: Float32Array,
    viewMatrix: Float32Array,
  ) {
    const gl = this.gl
    this.ssaoFrameBuffer.bind()
    gl.clearColor(0.0, 0.0, 0.0, 1.0)
    gl.clear(gl.COLOR_BUFFER_BIT) // Clear SSAO to 0

    gl.useProgram(this.program)
    const uniforms = this.uniformLocations

    // Bind inputs
    GL.bindTextureSampler(
      gl,
      uniforms.uRT1,
      SSAO_TEXTURE_UNITS.normal,
      gl.TEXTURE_2D,
      gBufferNormal,
    )
    GL.bindTextureSampler(
      gl,
      uniforms.uGDepth,
      SSAO_TEXTURE_UNITS.depth,
      gl.TEXTURE_2D,
      gBufferDepth,
    )
    GL.bindTextureSampler(
      gl,
      uniforms.uNoiseTexture,
      SSAO_TEXTURE_UNITS.noise,
      gl.TEXTURE_2D,
      this.noiseTexture,
    )

    if (uniforms.uProjection) gl.uniformMatrix4fv(uniforms.uProjection, false, projection)
    if (uniforms.uInverseProjection) {
      gl.uniformMatrix4fv(uniforms.uInverseProjection, false, inverseProjection)
    }
    if (uniforms.uView) gl.uniformMatrix4fv(uniforms.uView, false, viewMatrix)
    if (uniforms.uScreenSize) gl.uniform2f(uniforms.uScreenSize, this.width, this.height)
    if (uniforms.uSamples) gl.uniform3fv(uniforms.uSamples, this.kernel)
    if (uniforms.uNoiseScale)
      gl.uniform2f(uniforms.uNoiseScale, this.width / 4.0, this.height / 4.0)
    if (uniforms.uRadius) gl.uniform1f(uniforms.uRadius, 1.0)
    if (uniforms.uBias) gl.uniform1f(uniforms.uBias, 0.005)

    // Draw
    gl.bindVertexArray(this.quadVAO)
    drawCallStats.recordDrawCall('arrays')
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

    // Cleanup
    gl.bindVertexArray(null)
    this.ssaoFrameBuffer.unbind()
  }
}
