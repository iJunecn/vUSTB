import { GL } from '../../utils/gl'

/**
 * @file UniformBuffer.ts
 * @brief Uniform Buffer 封装器
 *
 * 说明：
 *  - 管理符合 `std140` 约束的 Uniform Buffer 数据
 *  - 支持局部写入、延迟刷新与多 Program 共享绑定点
 *  - 统一封装创建、上传与销毁流程
 */
export class UniformBuffer {
  private gl: WebGL2RenderingContext
  private buffer: WebGLBuffer
  private bindingPoint: number
  private size: number
  private data: Float32Array
  private byteData: Uint8Array
  private dirtyStart: number = Number.POSITIVE_INFINITY
  private dirtyEnd: number = 0

  /**
   * 创建 Uniform Buffer。
   * @param gl WebGL2 上下文。
   * @param size 缓冲区大小，单位字节。
   * @param bindingPoint 绑定点索引。
   */
  constructor(gl: WebGL2RenderingContext, size: number, bindingPoint: number) {
    this.gl = gl
    this.size = size
    this.bindingPoint = bindingPoint
    this.data = new Float32Array(size / 4)
    this.byteData = new Uint8Array(this.data.buffer)

    const buffer = gl.createBuffer()
    if (!buffer) throw new Error('Failed to create Uniform Buffer')
    this.buffer = buffer

    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer)
    gl.bufferData(gl.UNIFORM_BUFFER, size, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.UNIFORM_BUFFER, null)

    gl.bindBufferBase(gl.UNIFORM_BUFFER, bindingPoint, this.buffer)
  }

  /**
   * 立即更新缓冲区数据。
   * @param offset 偏移量，单位字节。
   * @param data 数据。
   */
  public update(offset: number, data: Float32Array | number[]) {
    this.write(offset, data)
    this.flush()
  }

  public write(offset: number, data: Float32Array | number[]) {
    const floatData = Array.isArray(data) ? new Float32Array(data) : data
    this.data.set(floatData, offset / 4)
    this.dirtyStart = Math.min(this.dirtyStart, offset)
    this.dirtyEnd = Math.max(this.dirtyEnd, offset + floatData.byteLength)
  }

  public flush() {
    if (this.dirtyStart === Number.POSITIVE_INFINITY || this.dirtyEnd <= this.dirtyStart) {
      return
    }

    const gl = this.gl
    gl.bindBuffer(gl.UNIFORM_BUFFER, this.buffer)
    gl.bufferSubData(
      gl.UNIFORM_BUFFER,
      this.dirtyStart,
      this.byteData.subarray(this.dirtyStart, this.dirtyEnd),
    )
    gl.bindBuffer(gl.UNIFORM_BUFFER, null)

    this.dirtyStart = Number.POSITIVE_INFINITY
    this.dirtyEnd = 0
  }

  /**
   * 更新单个浮点数
   * @param offset 偏移量 (字节)
   * @param value 值
   */
  public updateFloat(offset: number, value: number) {
    this.update(offset, new Float32Array([value]))
  }

  public writeFloat(offset: number, value: number) {
    this.write(offset, new Float32Array([value]))
  }

  /**
   * 更新 Vec3 (会自动补齐到 Vec4 如果需要，但这里只写入 3 个 float)
   * 注意 std140 中 vec3 占用 12 字节，但通常作为 vec4 对齐 (16 字节)
   * @param offset 偏移量 (字节)
   * @param value 值
   */
  public updateVec3(offset: number, value: Float32Array | number[]) {
    // 确保只写入 3 个 float
    const v = Array.isArray(value) ? value : value
    this.update(offset, new Float32Array([v[0], v[1], v[2]]))
  }

  public writeVec3(offset: number, value: Float32Array | number[]) {
    const v = Array.isArray(value) ? value : value
    this.write(offset, new Float32Array([v[0], v[1], v[2]]))
  }

  /**
   * 更新 Vec4
   * @param offset 偏移量 (字节)
   * @param value 值
   */
  public updateVec4(offset: number, value: Float32Array | number[]) {
    this.update(offset, value)
  }

  public writeVec4(offset: number, value: Float32Array | number[]) {
    this.write(offset, value)
  }

  /**
   * 更新 Mat4
   * @param offset 偏移量 (字节)
   * @param value 值
   */
  public updateMat4(offset: number, value: Float32Array | number[]) {
    this.update(offset, value)
  }

  public writeMat4(offset: number, value: Float32Array | number[]) {
    this.write(offset, value)
  }

  /**
   * 绑定到 Shader Block
   * @param program WebGLProgram
   * @param blockName Block 名称
   */
  public bindToProgram(program: WebGLProgram, blockName: string) {
    GL.bindUniformBlock(this.gl, program, blockName, this.bindingPoint)
  }

  public dispose() {
    this.gl.deleteBuffer(this.buffer)
  }
}
