// 顶点属性的底层存储格式。
export type VertexAttributeFormat =
  | 'u32'
  | 'u32x4'
  | 'i32'
  | 'f32'
  | 'vec2<f32>'
  | 'vec3<f32>'
  | 'vec4<f32>'
  | 'u8norm4'
  | 'u16norm2'
  | 'u16norm4'

// 顶点语义名，表示属性在渲染管线中的逻辑含义。
export type VertexSemanticName =
  | 'position'
  | 'normal'
  | 'uv0'
  | 'uv1'
  | 'color0'
  | 'light0'
  | 'material0'
  | 'joint0'
  | 'weight0'
  | 'custom0'
  | 'custom1'
  | 'custom2'
  | 'custom3'
  | 'custom4'
  | 'custom5'

/**
 * 单个顶点属性描述。
 * `bufferSlot` 支持多缓冲布局，`stepMode` 决定按顶点还是按实例步进。
 */
export interface VertexAttributeDescriptor {
  location: number
  semantic: VertexSemanticName
  format: VertexAttributeFormat
  offset: number
  bufferSlot: number
  normalized?: boolean
  integer?: boolean
  stepMode?: 'vertex' | 'instance'
}
