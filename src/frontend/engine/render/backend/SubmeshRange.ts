/**
 * 子网格绘制片段。
 * firstVertex / firstIndex 定义该片段在共享缓冲中的起始偏移。
 */
export interface SubmeshRange {
  pass: 'opaque' | 'decal' | 'translucent' | 'shadow' | 'velocity'
  pipelineTag: string
  vertexCount: number
  firstVertex: number
  indexCount?: number
  firstIndex?: number
  baseVertex?: number
  materialSlot?: number
}
