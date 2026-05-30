import { GL } from '../utils/gl'
import { drawCallStats } from '../debug/DrawCallStats'
import { POSTPROCESS_TEXTURE_UNITS } from '@render/bindings/TextureUnits'
import VERTEX_SHADER from '@shaders/screen/postprocess.vsh'
import FRAGMENT_SHADER from '@shaders/screen/postprocess.fsh'

/**
 * @file PostProcessPass.ts
 * @brief 后处理通道
 *
 * 说明：
 *  - 使用全屏三角形执行后处理链
 *  - 负责 TAA 历史融合与色调映射
 *  - 与 `ScreenEffectComposer` 配合完成最终出画
 */
export class PostProcessPass {
  public program: WebGLProgram
  private screenVAO: WebGLVertexArrayObject
  private readonly uniformLocations: {
    currentTexture: WebGLUniformLocation | null
    historyTexture: WebGLUniformLocation | null
    depthTexture: WebGLUniformLocation | null
    inverseViewProj: WebGLUniformLocation | null
    prevViewProj: WebGLUniformLocation | null
  }

  constructor(gl: WebGL2RenderingContext) {
    this.program = GL.createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER)
    this.uniformLocations = {
      currentTexture: GL.getUniformLocation(gl, this.program, 'uCurrentTexture'),
      historyTexture: GL.getUniformLocation(gl, this.program, 'uHistoryTexture'),
      depthTexture: GL.getUniformLocation(gl, this.program, 'uDepthTexture'),
      inverseViewProj: GL.getUniformLocation(gl, this.program, 'uInverseViewProj'),
      prevViewProj: GL.getUniformLocation(gl, this.program, 'uPrevViewProj'),
    }

    // 使用单个全屏三角形，避免对角线导数接缝。
    const screenVertices = new Float32Array([-1.0, -1.0, 3.0, -1.0, -1.0, 3.0])

    const vbo = gl.createBuffer()
    if (!vbo) throw new Error('Failed to create buffer')
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, screenVertices, gl.STATIC_DRAW)

    const vao = gl.createVertexArray()
    if (!vao) throw new Error('Failed to create VAO')
    this.screenVAO = vao
    gl.bindVertexArray(vao)

    const loc = gl.getAttribLocation(this.program, 'aPosition')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)

    gl.bindVertexArray(null)
  }

  /**
   * 执行后处理渲染 - TAA (Temporal Anti-Aliasing) + Tone Mapping
   *
   * 核心算法流程:
   * 1. 锐化当前帧 (补偿 TAA 模糊)
   * 2. ACES 色调映射 (HDR -> LDR)
   * 3. 3x3 邻域采样获取颜色范围 (防止 Ghosting)
   * 4. 深度重投影计算像素速度
   * 5. 历史帧采样与 Luma 保护
   * 6. 动态混合因子 (基于速度)
   * 7. 时间域混合输出
   *
   * @param gl WebGL2 上下文
   * @param currentTexture 当前帧纹理 (HDR Linear)
   * @param historyTexture 历史帧纹理 (LDR)
   * @param depthTexture 深度纹理
   * @param invViewProj 逆视图投影矩阵 (用于重建世界坐标)
   * @param prevViewProj 上一帧视图投影矩阵 (用于重投影)
   */
  render(
    gl: WebGL2RenderingContext,
    currentTexture: WebGLTexture,
    historyTexture: WebGLTexture,
    depthTexture: WebGLTexture,
    invViewProj: Float32Array,
    prevViewProj: Float32Array,
  ) {
    gl.useProgram(this.program)
    const uniforms = this.uniformLocations

    GL.bindTextureSampler(
      gl,
      uniforms.currentTexture,
      POSTPROCESS_TEXTURE_UNITS.current,
      gl.TEXTURE_2D,
      currentTexture,
    )

    GL.bindTextureSampler(
      gl,
      uniforms.historyTexture,
      POSTPROCESS_TEXTURE_UNITS.history,
      gl.TEXTURE_2D,
      historyTexture,
    )

    GL.bindTextureSampler(
      gl,
      uniforms.depthTexture,
      POSTPROCESS_TEXTURE_UNITS.depth,
      gl.TEXTURE_2D,
      depthTexture,
    )

    if (uniforms.inverseViewProj) {
      gl.uniformMatrix4fv(uniforms.inverseViewProj, false, invViewProj)
    }
    if (uniforms.prevViewProj) {
      gl.uniformMatrix4fv(uniforms.prevViewProj, false, prevViewProj)
    }

    gl.bindVertexArray(this.screenVAO)
    drawCallStats.recordDrawCall('arrays')
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  dispose(gl: WebGL2RenderingContext) {
    if (this.program) gl.deleteProgram(this.program)
    if (this.screenVAO) gl.deleteVertexArray(this.screenVAO)
  }
}
