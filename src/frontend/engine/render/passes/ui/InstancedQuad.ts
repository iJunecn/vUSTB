import { drawCallStats } from '@render/debug/DrawCallStats'

const FLOATS_PER_INSTANCE = 16
const BYTES_PER_FLOAT = 4
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * BYTES_PER_FLOAT

export class InstancedQuad {
  private readonly vao: WebGLVertexArrayObject
  private readonly vbo: WebGLBuffer
  private readonly instanceVbo: WebGLBuffer
  private maxInstances: number = 0

  constructor(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    attributeName: string = 'aPosition',
    instanceAttributeName: string = 'aPanelRect',
    initialMaxInstances: number = 1024,
  ) {
    // Quad from (0,0) to (1,1) using triangle strip
    const vertices = new Float32Array([0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0])

    const vbo = gl.createBuffer()
    if (!vbo) throw new Error('Failed')
    this.vbo = vbo
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)

    const instanceVbo = gl.createBuffer()
    if (!instanceVbo) throw new Error('Failed')
    this.instanceVbo = instanceVbo
    this.maxInstances = initialMaxInstances
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceVbo)
    gl.bufferData(gl.ARRAY_BUFFER, this.maxInstances * BYTES_PER_INSTANCE, gl.DYNAMIC_DRAW)

    const vao = gl.createVertexArray()
    if (!vao) throw new Error('Failed')
    this.vao = vao
    gl.bindVertexArray(vao)

    // Bind base geometry
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    const location = gl.getAttribLocation(program, attributeName)
    if (location >= 0) {
      gl.enableVertexAttribArray(location)
      gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0)
    }

    // Bind instance geometry
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceVbo)
    const instanceLocation = gl.getAttribLocation(program, instanceAttributeName)
    if (instanceLocation >= 0) {
      gl.enableVertexAttribArray(instanceLocation)
      gl.vertexAttribPointer(instanceLocation, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0)
      gl.vertexAttribDivisor(instanceLocation, 1)
    }

    const tuningALocation = gl.getAttribLocation(program, 'aInstanceTuningA')
    if (tuningALocation >= 0) {
      gl.enableVertexAttribArray(tuningALocation)
      gl.vertexAttribPointer(
        tuningALocation,
        4,
        gl.FLOAT,
        false,
        BYTES_PER_INSTANCE,
        4 * BYTES_PER_FLOAT,
      )
      gl.vertexAttribDivisor(tuningALocation, 1)
    }

    const tuningBLocation = gl.getAttribLocation(program, 'aInstanceTuningB')
    if (tuningBLocation >= 0) {
      gl.enableVertexAttribArray(tuningBLocation)
      gl.vertexAttribPointer(
        tuningBLocation,
        4,
        gl.FLOAT,
        false,
        BYTES_PER_INSTANCE,
        8 * BYTES_PER_FLOAT,
      )
      gl.vertexAttribDivisor(tuningBLocation, 1)
    }

    const overlayLocation = gl.getAttribLocation(program, 'aInstanceOverlayColor')
    if (overlayLocation >= 0) {
      gl.enableVertexAttribArray(overlayLocation)
      gl.vertexAttribPointer(
        overlayLocation,
        4,
        gl.FLOAT,
        false,
        BYTES_PER_INSTANCE,
        12 * BYTES_PER_FLOAT,
      )
      gl.vertexAttribDivisor(overlayLocation, 1)
    }

    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  updateInstances(gl: WebGL2RenderingContext, data: Float32Array) {
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo)
    const requiredInstances = Math.ceil(data.length / FLOATS_PER_INSTANCE)
    if (requiredInstances > this.maxInstances) {
      this.maxInstances = Math.max(this.maxInstances * 2, requiredInstances)
      gl.bufferData(gl.ARRAY_BUFFER, this.maxInstances * BYTES_PER_INSTANCE, gl.DYNAMIC_DRAW)
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  draw(gl: WebGL2RenderingContext, instanceCount: number) {
    if (instanceCount <= 0) return
    gl.bindVertexArray(this.vao)
    drawCallStats.recordDrawCall('arrays')
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceCount)
    gl.bindVertexArray(null)
  }

  dispose(gl: WebGL2RenderingContext) {
    gl.deleteVertexArray(this.vao)
    gl.deleteBuffer(this.vbo)
    gl.deleteBuffer(this.instanceVbo)
  }
}
