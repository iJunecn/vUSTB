import { Mesh } from '@render/core/Mesh'
import type { ResidentGeometryBinding } from '@render/backend/IRenderBackend'
import { TERRAIN_COMPACT_LAYOUT_ID } from '@render/layout/BuiltinLayouts'
import type { VertexLayoutDescriptor } from '@render/layout/VertexLayoutDescriptor'

export class WebGL2GeometryResource {
  public readonly id: number
  public readonly layoutId: string
  public readonly topology: 'triangles' | 'triangle-strip' | 'lines'
  private mesh: Mesh | null

  constructor(
    id: number,
    layoutId: string,
    topology: 'triangles' | 'triangle-strip' | 'lines',
    mesh: Mesh | null,
  ) {
    this.id = id
    this.layoutId = layoutId
    this.topology = topology
    this.mesh = mesh
  }

  public static createFromMesh(
    id: number,
    layoutId: string,
    topology: 'triangles' | 'triangle-strip' | 'lines',
    mesh: Mesh,
  ) {
    return new WebGL2GeometryResource(id, layoutId, topology, mesh)
  }

  /**
   * 从外部常驻 buffer binding 构造几何资源。
   * 常用于 arena/pool 已经管理好 GPU buffer，只需要重新声明 attribute 视图的场景。
   */
  public static createFromResidentBinding(
    gl: WebGL2RenderingContext,
    id: number,
    binding: ResidentGeometryBinding,
    layout: VertexLayoutDescriptor,
  ) {
    const mesh = new Mesh(gl)
    const resource = new WebGL2GeometryResource(id, binding.layoutId, binding.topology, mesh)
    resource.updateResidentBinding(gl, binding, layout)
    return resource
  }

  /**
   * 从 CPU artifact 创建几何资源。
   * 若传入 layout，则优先按描述符解释；否则 terrain compact 走兼容快捷路径。
   */
  public static create(
    gl: WebGL2RenderingContext,
    id: number,
    artifact: {
      layoutId: string
      topology: 'triangles' | 'triangle-strip' | 'lines'
      vertexBytes: Uint8Array
      indexBytes?: Uint8Array
    },
    layout?: VertexLayoutDescriptor | null,
  ) {
    const mesh = new Mesh(gl)
    let indices: Uint16Array | Uint32Array | undefined

    if (artifact.indexBytes && artifact.indexBytes.byteLength > 0) {
      const indexCount = artifact.indexBytes.byteLength / 4
      if (artifact.indexBytes.byteOffset % 4 === 0) {
        indices = new Uint32Array(
          artifact.indexBytes.buffer,
          artifact.indexBytes.byteOffset,
          indexCount,
        )
      } else {
        const alignedIndexBytes = artifact.indexBytes.slice()
        indices = new Uint32Array(
          alignedIndexBytes.buffer,
          alignedIndexBytes.byteOffset,
          indexCount,
        )
      }
    }

    if (layout) {
      mesh.setAttributesFromLayout(layout, artifact.vertexBytes, indices)
    } else if (artifact.layoutId === TERRAIN_COMPACT_LAYOUT_ID) {
      mesh.setAttributes(artifact.vertexBytes, indices)
    } else {
      return new WebGL2GeometryResource(id, artifact.layoutId, artifact.topology, null)
    }

    return new WebGL2GeometryResource(id, artifact.layoutId, artifact.topology, mesh)
  }

  public draw(gl: WebGL2RenderingContext) {
    this.mesh?.draw(gl)
  }

  /**
   * 刷新 resident geometry 的外部 buffer 绑定。
   * 这里不复制字节，只把 slot/buffer/offset/stride 转成 Mesh 可消费的 attribute 视图。
   */
  public updateResidentBinding(
    gl: WebGL2RenderingContext,
    binding: ResidentGeometryBinding,
    layout: VertexLayoutDescriptor,
  ) {
    if (!this.mesh) {
      this.mesh = new Mesh(gl)
    }

    this.mesh.setExternalAttributesFromLayout(layout, {
      vertexBuffers: binding.vertexBuffers.map(entry => ({
        slot: entry.slot,
        buffer: entry.buffer as WebGLBuffer,
        offsetBytes: entry.offsetBytes,
        stride: entry.stride,
        stepMode: entry.stepMode,
      })),
      vertexCount: binding.vertexCount,
      instanceCount: binding.instanceCount,
      indexBuffer: binding.indexBuffer as WebGLBuffer | undefined,
      indexOffsetBytes: binding.indexOffsetBytes,
      indexCount: binding.indexCount,
      indexType: binding.indexType,
    })
  }

  public dispose() {
    this.mesh?.dispose()
    this.mesh = null
  }

  public get isDrawable() {
    return this.mesh !== null
  }

  public get drawableMesh() {
    return this.mesh
  }
}
