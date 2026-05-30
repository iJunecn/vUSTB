import { GL } from '../utils/gl'
import type { UniformBuffer } from '../core/buffer/UniformBuffer'
import SELECTION_OUTLINE_VSH from '@shaders/screen/selection_outline.vsh'
import SELECTION_OUTLINE_FSH from '@shaders/screen/selection_outline.fsh'

const OUTLINE_VERTICES = new Float32Array([
  0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 1, 1, 0, 1,
  1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1,
  0, 1, 0, 0, 1, 1,
])

export type SelectionOutline = {
  x: number
  y: number
  z: number
}

/**
 * @file SelectionOutlinePass.ts
 * @brief 选中框渲染通道
 *
 * 说明：
 *  - 负责渲染方块或实体的高亮线框
 *  - 通过轻微外扩和深度策略减少 Z-Fighting
 *  - 与相机 UBO 配合输出最终选中框效果
 */
export class SelectionOutlinePass {
  private readonly program: WebGLProgram
  private readonly vao: WebGLVertexArrayObject
  private readonly vbo: WebGLBuffer
  private readonly uniforms: ReturnType<typeof GL.getUniformLocations>
  private readonly modelMatrix = new Float32Array(16)

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = GL.createProgram(gl, SELECTION_OUTLINE_VSH, SELECTION_OUTLINE_FSH)

    const vao = gl.createVertexArray()
    const vbo = gl.createBuffer()
    const uniforms = GL.getUniformLocations(gl, this.program, ['uModel', 'uColor'] as const)

    if (!vao || !vbo || !uniforms.uModel || !uniforms.uColor) {
      throw new Error('[SelectionOutlinePass] Failed to initialize WebGL resources')
    }

    this.vao = vao
    this.vbo = vbo
    this.uniforms = uniforms

    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo)
    gl.bufferData(gl.ARRAY_BUFFER, OUTLINE_VERTICES, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0)
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  public render(cameraUBO: UniformBuffer, outline: SelectionOutline, useReverseZ: boolean) {
    const gl = this.gl
    const scale = 1.002
    const offset = (scale - 1.0) * 0.5
    const previousDepthTestEnabled = gl.isEnabled(gl.DEPTH_TEST)
    const previousCullFaceEnabled = gl.isEnabled(gl.CULL_FACE)
    const previousDepthFunc = gl.getParameter(gl.DEPTH_FUNC) as number
    const previousDepthMask = gl.getParameter(gl.DEPTH_WRITEMASK) as boolean

    this.modelMatrix[0] = scale
    this.modelMatrix[1] = 0
    this.modelMatrix[2] = 0
    this.modelMatrix[3] = 0
    this.modelMatrix[4] = 0
    this.modelMatrix[5] = scale
    this.modelMatrix[6] = 0
    this.modelMatrix[7] = 0
    this.modelMatrix[8] = 0
    this.modelMatrix[9] = 0
    this.modelMatrix[10] = scale
    this.modelMatrix[11] = 0
    this.modelMatrix[12] = outline.x - offset
    this.modelMatrix[13] = outline.y - offset
    this.modelMatrix[14] = outline.z - offset
    this.modelMatrix[15] = 1

    gl.useProgram(this.program)
    cameraUBO.bindToProgram(this.program, 'CameraUniforms')
    gl.uniformMatrix4fv(this.uniforms.uModel!, false, this.modelMatrix)
    gl.uniform4f(this.uniforms.uColor!, 0.98, 0.96, 0.45, 1.0)

    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(useReverseZ ? gl.GEQUAL : gl.LEQUAL)
    gl.depthMask(false)
    gl.disable(gl.CULL_FACE)

    gl.bindVertexArray(this.vao)
    gl.drawArrays(gl.LINES, 0, OUTLINE_VERTICES.length / 3)
    gl.bindVertexArray(null)

    gl.depthMask(previousDepthMask)
    gl.depthFunc(previousDepthFunc)
    if (!previousDepthTestEnabled) {
      gl.disable(gl.DEPTH_TEST)
    }
    if (previousCullFaceEnabled) {
      gl.enable(gl.CULL_FACE)
    }
  }

  public dispose() {
    this.gl.deleteVertexArray(this.vao)
    this.gl.deleteBuffer(this.vbo)
    this.gl.deleteProgram(this.program)
  }
}
