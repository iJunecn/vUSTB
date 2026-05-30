import { drawCallStats } from '../debug/DrawCallStats'
import type { VertexLayoutDescriptor } from '../layout/VertexLayoutDescriptor'
import type { VertexAttributeFormat } from '../layout/VertexAttributeDescriptor'

const MAX_VERTEX_ATTRIBUTES = 16

function getGLAttribParams(
  gl: WebGL2RenderingContext,
  format: VertexAttributeFormat,
): { size: number; type: number; integer: boolean; normalized: boolean } {
  switch (format) {
    case 'f32':
      return { size: 1, type: gl.FLOAT, integer: false, normalized: false }
    case 'vec2<f32>':
      return { size: 2, type: gl.FLOAT, integer: false, normalized: false }
    case 'vec3<f32>':
      return { size: 3, type: gl.FLOAT, integer: false, normalized: false }
    case 'vec4<f32>':
      return { size: 4, type: gl.FLOAT, integer: false, normalized: false }
    case 'u32':
      return { size: 1, type: gl.UNSIGNED_INT, integer: true, normalized: false }
    case 'u32x4':
      return { size: 4, type: gl.UNSIGNED_INT, integer: true, normalized: false }
    case 'i32':
      return { size: 1, type: gl.INT, integer: true, normalized: false }
    case 'u8norm4':
      return { size: 4, type: gl.UNSIGNED_BYTE, integer: false, normalized: true }
    case 'u16norm2':
      return { size: 2, type: gl.UNSIGNED_SHORT, integer: false, normalized: true }
    case 'u16norm4':
      return { size: 4, type: gl.UNSIGNED_SHORT, integer: false, normalized: true }
  }
}

/**
 * @file Mesh.ts
 * @brief 网格缓冲与 VAO 封装
 *
 * 说明：
 *  - 管理顶点缓冲、索引缓冲和 VAO
 *  - 支持自有缓冲与外部共享缓冲两种绑定模式
 *  - 统一封装布局驱动的属性绑定与绘制入口
 */
export class Mesh {
  private gl: WebGL2RenderingContext
  private vao: WebGLVertexArrayObject | null = null
  private ownedBuffers: WebGLBuffer[] = []
  private vertexCount: number = 0
  private instanceCount: number = 1
  private indicesCount: number = 0
  private hasIndices: boolean = false
  private indexType: number = 0
  private indexOffsetBytes: number = 0
  private externalVertexBuffers: Array<{
    slot: number
    buffer: WebGLBuffer
    offsetBytes: number
    stride: number
    stepMode: 'vertex' | 'instance'
  }> = []
  private externalIndexBuffer: WebGLBuffer | null = null

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.indexType = gl.UNSIGNED_SHORT
  }

  /**
   * 释放 GPU 资源
   */
  dispose() {
    const gl = this.gl
    if (this.vao) {
      gl.deleteVertexArray(this.vao)
      this.vao = null
    }
    for (const buffer of this.ownedBuffers) {
      gl.deleteBuffer(buffer)
    }
    this.ownedBuffers = []
    this.vertexCount = 0
    this.indicesCount = 0
    this.hasIndices = false
    this.indexOffsetBytes = 0
    this.instanceCount = 1
    this.externalVertexBuffers = []
    this.externalIndexBuffer = null
  }

  /**
   * 设置地形交错顶点数据与索引。
   * @param interleavedData 交错顶点数据。
   * @param indices 可选索引数据。
   */
  setAttributes(interleavedData: Uint8Array, indices?: Uint16Array | Uint32Array) {
    const gl = this.gl

    this.dispose() // 清理旧资源。
    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)

    const vbo = gl.createBuffer()!
    this.ownedBuffers.push(vbo)
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, interleavedData, gl.STATIC_DRAW)

    this.vertexCount = interleavedData.length / 32
    this.instanceCount = 1

    const stride = 32

    // 属性 0：地形顶点字组 0。
    gl.enableVertexAttribArray(0)
    gl.vertexAttribIPointer(0, 4, gl.UNSIGNED_INT, stride, 0)

    // 属性 1：地形顶点字组 1。
    gl.enableVertexAttribArray(1)
    gl.vertexAttribIPointer(1, 4, gl.UNSIGNED_INT, stride, 16)

    for (let location = 2; location < MAX_VERTEX_ATTRIBUTES; location += 1) {
      gl.disableVertexAttribArray(location)
      gl.vertexAttribDivisor(location, 0)
    }

    if (indices) {
      // 创建索引缓冲。
      const indexBuffer = gl.createBuffer()!
      this.ownedBuffers.push(indexBuffer)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)

      this.indicesCount = indices.length
      this.hasIndices = true
      this.indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
      this.indexOffsetBytes = 0
    } else {
      this.hasIndices = false
      this.indexOffsetBytes = 0
    }

    gl.bindVertexArray(null)
  }

  public setExternalTerrainAttributes(params: {
    vertexBuffer: WebGLBuffer
    vertexOffsetBytes: number
    vertexStride: number
    vertexCount: number
    instanceCount?: number
    indexBuffer?: WebGLBuffer
    indexOffsetBytes?: number
    indexCount?: number
    indexType?: number
  }) {
    const gl = this.gl
    const nextIndexBuffer = params.indexBuffer ?? null
    const nextVertexBindings = [
      {
        slot: 0,
        buffer: params.vertexBuffer,
        offsetBytes: params.vertexOffsetBytes,
        stride: params.vertexStride,
        stepMode: 'vertex' as const,
      },
    ]

    // 快速路径：缓冲句柄未变时跳过 VAO 重建，只更新绘制计数。
    if (
      this.vao &&
      this.hasMatchingExternalVertexBindings(nextVertexBindings) &&
      this.externalIndexBuffer === nextIndexBuffer
    ) {
      this.vertexCount = params.vertexCount
      this.instanceCount = Math.max(params.instanceCount ?? 1, 1)
      this.indexOffsetBytes = params.indexOffsetBytes ?? 0
      if (nextIndexBuffer && (params.indexCount ?? 0) > 0) {
        this.indicesCount = params.indexCount ?? 0
        this.hasIndices = true
        this.indexType = params.indexType ?? gl.UNSIGNED_INT
      } else {
        this.indicesCount = 0
        this.hasIndices = false
        this.indexType = gl.UNSIGNED_SHORT
        this.indexOffsetBytes = 0
      }
      return
    }

    this.dispose()
    this.externalVertexBuffers = nextVertexBindings
    this.externalIndexBuffer = nextIndexBuffer

    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, params.vertexBuffer)

    const stride = params.vertexStride
    const baseOffset = params.vertexOffsetBytes

    gl.enableVertexAttribArray(0)
    gl.vertexAttribIPointer(0, 4, gl.UNSIGNED_INT, stride, baseOffset)

    gl.enableVertexAttribArray(1)
    gl.vertexAttribIPointer(1, 4, gl.UNSIGNED_INT, stride, baseOffset + 16)

    for (let location = 2; location < MAX_VERTEX_ATTRIBUTES; location += 1) {
      gl.disableVertexAttribArray(location)
      gl.vertexAttribDivisor(location, 0)
    }

    this.vertexCount = params.vertexCount
    this.instanceCount = Math.max(params.instanceCount ?? 1, 1)
    this.indexOffsetBytes = params.indexOffsetBytes ?? 0

    if (params.indexBuffer && (params.indexCount ?? 0) > 0) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, params.indexBuffer)
      this.indicesCount = params.indexCount ?? 0
      this.hasIndices = true
      this.indexType = params.indexType ?? gl.UNSIGNED_INT
    } else {
      this.indicesCount = 0
      this.hasIndices = false
      this.indexType = gl.UNSIGNED_SHORT
      this.indexOffsetBytes = 0
    }

    gl.bindVertexArray(null)
  }

  public setExternalAttributesFromLayout(
    layout: VertexLayoutDescriptor,
    params: {
      vertexBuffers: Array<{
        slot: number
        buffer: WebGLBuffer
        offsetBytes: number
        stride: number
        stepMode: 'vertex' | 'instance'
      }>
      vertexCount: number
      instanceCount?: number
      indexBuffer?: WebGLBuffer
      indexOffsetBytes?: number
      indexCount?: number
      indexType?: number
    },
  ) {
    const gl = this.gl
    const nextIndexBuffer = params.indexBuffer ?? null
    const layoutBindings = this.validateExternalLayoutBindings(layout, params.vertexBuffers)

    if (
      this.vao &&
      this.hasMatchingExternalVertexBindings(layoutBindings) &&
      this.externalIndexBuffer === nextIndexBuffer
    ) {
      this.vertexCount = params.vertexCount
      this.instanceCount = Math.max(params.instanceCount ?? 1, 1)
      this.indexOffsetBytes = params.indexOffsetBytes ?? 0
      if (nextIndexBuffer && (params.indexCount ?? 0) > 0) {
        this.indicesCount = params.indexCount ?? 0
        this.hasIndices = true
        this.indexType = params.indexType ?? gl.UNSIGNED_INT
      } else {
        this.indicesCount = 0
        this.hasIndices = false
        this.indexType = gl.UNSIGNED_SHORT
        this.indexOffsetBytes = 0
      }
      return
    }

    this.dispose()
    this.externalVertexBuffers = layoutBindings
    this.externalIndexBuffer = nextIndexBuffer

    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)

    for (let i = 0; i < MAX_VERTEX_ATTRIBUTES; i++) {
      gl.disableVertexAttribArray(i)
      gl.vertexAttribDivisor(i, 0)
    }

    for (const attr of layout.attributes) {
      const binding = layoutBindings.find(entry => entry.slot === attr.bufferSlot)
      if (!binding) {
        throw new Error(
          `Missing external vertex buffer binding for slot ${attr.bufferSlot} (layout: ${layout.id})`,
        )
      }

      const p = getGLAttribParams(gl, attr.format)
      const isInt = attr.integer ?? p.integer
      const isNorm = attr.normalized ?? p.normalized
      const offset = binding.offsetBytes + attr.offset
      const stepMode = attr.stepMode ?? binding.stepMode

      gl.bindBuffer(gl.ARRAY_BUFFER, binding.buffer)
      gl.enableVertexAttribArray(attr.location)
      if (isInt) {
        gl.vertexAttribIPointer(attr.location, p.size, p.type, binding.stride, offset)
      } else {
        gl.vertexAttribPointer(attr.location, p.size, p.type, isNorm, binding.stride, offset)
      }
      gl.vertexAttribDivisor(attr.location, stepMode === 'instance' ? 1 : 0)
    }

    this.vertexCount = params.vertexCount
    this.instanceCount = Math.max(params.instanceCount ?? 1, 1)
    this.indexOffsetBytes = params.indexOffsetBytes ?? 0

    if (params.indexBuffer && (params.indexCount ?? 0) > 0) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, params.indexBuffer)
      this.indicesCount = params.indexCount ?? 0
      this.hasIndices = true
      this.indexType = params.indexType ?? gl.UNSIGNED_INT
    } else {
      this.indicesCount = 0
      this.hasIndices = false
      this.indexType = gl.UNSIGNED_SHORT
      this.indexOffsetBytes = 0
    }

    gl.bindVertexArray(null)
  }

  /**
   * 执行绘制。
   * @param gl WebGL2 上下文。
   */
  draw(gl: WebGL2RenderingContext) {
    if (!this.vao || this.vertexCount <= 0 || this.instanceCount <= 0) return

    gl.bindVertexArray(this.vao)
    if (this.hasIndices) {
      drawCallStats.recordDrawCall('elements')
      if (this.instanceCount > 1) {
        gl.drawElementsInstanced(
          gl.TRIANGLES,
          this.indicesCount,
          this.indexType,
          this.indexOffsetBytes,
          this.instanceCount,
        )
      } else {
        gl.drawElements(gl.TRIANGLES, this.indicesCount, this.indexType, this.indexOffsetBytes)
      }
    } else {
      drawCallStats.recordDrawCall('arrays')
      if (this.instanceCount > 1) {
        gl.drawArraysInstanced(gl.TRIANGLES, 0, this.vertexCount, this.instanceCount)
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount)
      }
    }
    gl.bindVertexArray(null)
  }

  /**
   * 使用布局描述设置属性和索引。
   */
  setAttributesFromLayout(
    layout: VertexLayoutDescriptor,
    vertexData: Uint8Array,
    indices?: Uint16Array | Uint32Array,
  ) {
    const gl = this.gl
    this.dispose()

    this.vao = gl.createVertexArray()
    gl.bindVertexArray(this.vao)

    const vbo = gl.createBuffer()!
    this.ownedBuffers.push(vbo)
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
    gl.bufferData(gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW)

    this.vertexCount = vertexData.byteLength / layout.stride
    this.instanceCount = 1

    for (const attr of layout.attributes) {
      if (attr.bufferSlot !== 0) {
        throw new Error(
          `Owned WebGL2 geometry currently supports only bufferSlot 0 (layout: ${layout.id})`,
        )
      }
      if (attr.stepMode === 'instance') {
        throw new Error(
          `Owned WebGL2 geometry does not support instance step mode (layout: ${layout.id})`,
        )
      }
    }

    // 先关闭所有属性槽位，避免旧状态泄漏。
    for (let i = 0; i < MAX_VERTEX_ATTRIBUTES; i++) {
      gl.disableVertexAttribArray(i)
      gl.vertexAttribDivisor(i, 0)
    }

    // 按布局描述启用并配置各属性槽位。
    for (const attr of layout.attributes) {
      const loc = attr.location
      gl.enableVertexAttribArray(loc)

      const p = getGLAttribParams(gl, attr.format)
      const isInt = attr.integer ?? p.integer
      const isNorm = attr.normalized ?? p.normalized

      if (isInt) {
        gl.vertexAttribIPointer(loc, p.size, p.type, layout.stride, attr.offset)
      } else {
        gl.vertexAttribPointer(loc, p.size, p.type, isNorm, layout.stride, attr.offset)
      }
    }

    if (indices) {
      const ebo = gl.createBuffer()!
      this.ownedBuffers.push(ebo)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW)
      this.indicesCount = indices.length
      this.hasIndices = true
      this.indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT
      this.indexOffsetBytes = 0
    } else {
      this.hasIndices = false
      this.indexOffsetBytes = 0
    }

    gl.bindVertexArray(null)
  }

  private hasMatchingExternalVertexBindings(
    bindings: Array<{
      slot: number
      buffer: WebGLBuffer
      offsetBytes: number
      stride: number
      stepMode: 'vertex' | 'instance'
    }>,
  ) {
    if (this.externalVertexBuffers.length !== bindings.length) {
      return false
    }

    return bindings.every((binding, index) => {
      const current = this.externalVertexBuffers[index]
      return (
        !!current &&
        current.slot === binding.slot &&
        current.buffer === binding.buffer &&
        current.offsetBytes === binding.offsetBytes &&
        current.stride === binding.stride &&
        current.stepMode === binding.stepMode
      )
    })
  }

  private validateExternalLayoutBindings(
    layout: VertexLayoutDescriptor,
    bindings: Array<{
      slot: number
      buffer: WebGLBuffer
      offsetBytes: number
      stride: number
      stepMode: 'vertex' | 'instance'
    }>,
  ) {
    const sortedBindings = [...bindings].sort((left, right) => left.slot - right.slot)

    for (let index = 1; index < sortedBindings.length; index += 1) {
      if (sortedBindings[index - 1].slot === sortedBindings[index].slot) {
        throw new Error(
          `Duplicate external vertex buffer binding for slot ${sortedBindings[index].slot} (layout: ${layout.id})`,
        )
      }
    }

    for (const attr of layout.attributes) {
      const binding = sortedBindings.find(entry => entry.slot === attr.bufferSlot)
      if (!binding) {
        throw new Error(
          `Layout '${layout.id}' requires external binding for slot ${attr.bufferSlot}`,
        )
      }

      if (binding.stride <= 0) {
        throw new Error(
          `External binding stride must be positive for slot ${binding.slot} (layout: ${layout.id})`,
        )
      }

      const attrStepMode = attr.stepMode ?? 'vertex'
      if (binding.stepMode !== attrStepMode) {
        throw new Error(
          `External binding step mode mismatch for slot ${binding.slot} (layout: ${layout.id})`,
        )
      }

      if (attr.offset >= binding.stride) {
        throw new Error(
          `Attribute '${attr.semantic}' offset exceeds stride for slot ${binding.slot} (layout: ${layout.id})`,
        )
      }
    }

    return sortedBindings
  }
}
