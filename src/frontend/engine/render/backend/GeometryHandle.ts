import type { BufferSegmentHandle, DrawBindingMetadata } from './BufferSegmentHandle'
import type { SubmeshRange } from './SubmeshRange'

/**
 * 常驻几何的 GPU 侧定位信息。
 * `draw` 保存与当前布局绑定直接相关的绘制偏移元数据。
 */
export interface GeometryResident {
  backendKind: 'webgl2' | 'wgpu'
  resourceId: number
  vertex: BufferSegmentHandle
  index?: BufferSegmentHandle
  draw: DrawBindingMetadata
}

/**
 * 上层持有的几何句柄。
 * `resident=null` 表示该几何尚未进入后端常驻路径，可能仍停留在 artifact 阶段。
 */
export interface GeometryHandle {
  id: number
  kind: 'section' | 'static-model' | 'dynamic-model' | 'debug' | 'procedural'
  topology: 'triangles' | 'triangle-strip' | 'lines'
  layoutId: string
  resident: GeometryResident | null
  artifactVersion: number
  residentVersion: number
  submeshes: SubmeshRange[]
}
