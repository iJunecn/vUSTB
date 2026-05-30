import { drawCallStats } from '../debug/DrawCallStats'

export type SimpleMeshHandle = {
  vao: WebGLVertexArrayObject
  vbo: WebGLBuffer
  count: number
  mode: number
}

export class SimpleMesh {
  private gl: WebGL2RenderingContext
  private handle: SimpleMeshHandle

  constructor(gl: WebGL2RenderingContext, handle: SimpleMeshHandle) {
    this.gl = gl
    this.handle = handle
  }

  draw() {
    const { gl } = this
    gl.bindVertexArray(this.handle.vao)
    drawCallStats.recordDrawCall('arrays')
    gl.drawArrays(this.handle.mode, 0, this.handle.count)
    gl.bindVertexArray(null)
  }

  dispose() {
    const { gl } = this
    gl.deleteBuffer(this.handle.vbo)
    gl.deleteVertexArray(this.handle.vao)
  }
}

export const SimpleMeshFactory = {
  createFullscreenQuad(gl: WebGL2RenderingContext) {
    const vertices = new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1])
    return SimpleMeshFactory.create(gl, vertices, 4, gl.TRIANGLE_STRIP, 2)
  },

  create(
    gl: WebGL2RenderingContext,
    data: Float32Array,
    vertexCount: number,
    mode: number = gl.TRIANGLES,
    strideGroups: number = 3,
  ) {
    const vao = gl.createVertexArray()!
    const vbo = gl.createBuffer()!
    gl.bindVertexArray(vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)

    if (strideGroups === 3) {
      const stride = 6 * 4
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4)
      gl.enableVertexAttribArray(1)
    } else {
      const stride = 4 * 4
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0)
      gl.enableVertexAttribArray(0)
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 2 * 4)
      gl.enableVertexAttribArray(1)
    }

    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)

    return new SimpleMesh(gl, { vao, vbo, count: vertexCount, mode })
  },
}
