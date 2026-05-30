/**
 * 缓冲池子区段句柄。
 * generation 用于检测 segment 被回收重用后的悬挂引用。
 */
export interface BufferSegmentHandle {
  arenaId: number
  segmentId: number
  offsetBytes: number
  sizeBytes: number
  generation: number
}

/**
 * 绘制绑定附加信息。
 * baseVertex / baseIndex 用于把逻辑子网格映射到共享缓冲的局部起点。
 */
export interface DrawBindingMetadata {
  baseVertex?: number
  baseIndex?: number
  layoutId: string
}
