import type { ChunkGeometryData } from '../domain'

/** 主线程侧的区块运行时对象，记录槽位分配、几何引用、光照脏标记与最近更新时间。 */
export interface Chunk {
  key: string
  slotIndex: number
  slotVersion: number
  geometry?: ChunkGeometryData | null
  lightsDirty?: boolean // 是否需要重新聚合点光源数据
  updatedAt: number
}
