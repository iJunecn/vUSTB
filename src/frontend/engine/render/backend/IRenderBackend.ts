import type { GeometryHandle } from './GeometryHandle'
import type { VertexLayoutDescriptor } from '../layout/VertexLayoutDescriptor'
import type { PipelineKey } from './PipelineKey'
import type { RenderObject } from '../queue/RenderObject'

/**
 * CPU 侧几何上传产物。
 * vertexBytes / indexBytes 仍是宿主可管理的原始字节流，适合一次性创建静态资源。
 */
export interface GeometryArtifact {
  layoutId: string
  topology: 'triangles' | 'triangle-strip' | 'lines'
  vertexBytes: Uint8Array
  indexBytes?: Uint8Array
}

/**
 * 外部几何资源包装。
 * 适用于 Mesh 等已经持有 GPU 资源或独立生命周期的对象。
 */
export interface ExternalGeometryArtifact {
  layoutId: string
  topology: 'triangles' | 'triangle-strip' | 'lines'
  resource: unknown
  kind?: GeometryHandle['kind']
}

/**
 * 常驻顶点缓冲绑定。
 * slot 必须与 VertexLayoutDescriptor 中的 attribute/buffer 布局保持一致。
 */
export interface ResidentVertexBufferBinding {
  slot: number
  buffer: unknown
  offsetBytes: number
  stride: number
  stepMode: 'vertex' | 'instance'
}

/**
 * 单个渲染桶。
 * key 决定 Program / Raster State / Blend State，objects 保持同态资源批次。
 */
export interface RenderBucket {
  key: PipelineKey
  objects: RenderObject[]
}

/**
 * 单帧某个 stage 的执行队列。
 * buckets 已按上层调度器分组完成，后端只负责逐桶提交。
 */
export interface RenderQueue {
  stage: PipelineKey['stage']
  buckets: RenderBucket[]
}

/**
 * 帧级调试与注入钩子。
 * beforeBucket / beforeObject 返回 false 时可跳过对应提交，用于统计或可视化调试。
 */
export interface FrameRenderContext {
  frameId: number
  beforeBucket?: (bucket: RenderBucket) => boolean | void
  beforeObject?: (object: RenderObject, bucket: RenderBucket) => boolean | void
  afterObject?: (object: RenderObject, bucket: RenderBucket) => void
}

/**
 * 常驻几何资源绑定描述。
 * 这类几何通常由外部流式系统维护，后端只消费 buffer 视图与绘制范围。
 */
export interface ResidentGeometryBinding {
  layoutId: string
  topology: 'triangles' | 'triangle-strip' | 'lines'
  vertexBuffers: ResidentVertexBufferBinding[]
  vertexCount: number
  instanceCount?: number
  indexBuffer?: unknown
  indexOffsetBytes?: number
  indexCount?: number
  indexType?: number
}

/**
 * 渲染后端统一接口。
 * 生命周期分为两段：资源注册 / 更新，以及 beginFrame-executeQueue-endFrame 的帧提交流。
 */
export interface IRenderBackend {
  readonly kind: 'webgl2' | 'wgpu'

  registerLayout(layout: VertexLayoutDescriptor): void
  createGeometry(artifact: GeometryArtifact): GeometryHandle
  createExternalGeometry(artifact: ExternalGeometryArtifact): GeometryHandle
  createResidentGeometry(binding: ResidentGeometryBinding): GeometryHandle
  updateGeometry(handle: GeometryHandle, artifact: GeometryArtifact): void
  updateResidentGeometry(handle: GeometryHandle, binding: ResidentGeometryBinding): void
  releaseGeometry(handle: GeometryHandle): void

  beginFrame(): void
  executeQueue(queue: RenderQueue, frame: FrameRenderContext): void
  endFrame(): void
}
