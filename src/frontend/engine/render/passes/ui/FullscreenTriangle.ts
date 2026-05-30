import { drawCallStats } from '@render/debug/DrawCallStats'

export class FullscreenTriangle {
  private readonly vao: WebGLVertexArrayObject
  private readonly vbo: WebGLBuffer

  constructor(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    attributeName: string = 'aPosition',
  ) {
    const vertices = new Float32Array([-1.0, -1.0, 3.0, -1.0, -1.0, 3.0])

    const vbo = gl.createBuffer()
    if (!vbo) {
      throw new Error('Failed to create fullscreen triangle buffer')
    }
    this.vbo = vbo
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)

    const vao = gl.createVertexArray()
    if (!vao) {
      throw new Error('Failed to create fullscreen triangle VAO')
    }
    this.vao = vao
    gl.bindVertexArray(vao)

    const location = gl.getAttribLocation(program, attributeName)
    if (location >= 0) {
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
    }

    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  draw(gl: WebGL2RenderingContext) {
    gl.bindVertexArray(this.vao)
    drawCallStats.recordDrawCall('arrays')
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
  }

  dispose(gl: WebGL2RenderingContext) {
    gl.deleteVertexArray(this.vao)
    gl.deleteBuffer(this.vbo)
  }
}
