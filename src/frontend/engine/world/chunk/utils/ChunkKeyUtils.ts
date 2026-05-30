/**
 * @file ChunkKeyUtils.ts
 * @brief 区块与区域坐标转换工具
 *
 * 说明：
 *  - 统一生成区块 Key，固定格式为 `"x,z"`
 *  - 提供区块坐标、区域坐标与区域文件名之间的转换
 */
export type ChunkKey = string

export interface ChunkCoordinate {
  x: number // 区块 X 坐标
  z: number // 区块 Z 坐标
}

export interface RegionCoordinate {
  rx: number // 区域 X 坐标，每 32 个 chunk 为一组
  rz: number // 区域 Z 坐标
}

// 将区块坐标编码为字符串 Key，格式固定为 "x,z"
export const toChunkKey = (x: number, z: number): ChunkKey => `${x},${z}`
export const toChunkKeyFromCoord = ({ x, z }: ChunkCoordinate): ChunkKey => `${x},${z}`

export const parseChunkKey = (key: ChunkKey): ChunkCoordinate => {
  const [xStr, zStr] = key.split(',')
  return { x: Number(xStr), z: Number(zStr) }
}

export const toRegionCoord = (x: number, z: number): RegionCoordinate => ({
  rx: Math.floor(x / 32),
  rz: Math.floor(z / 32),
})

// 将区域坐标转换为标准 `.mca` 文件名。
export const regionFileName = ({ rx, rz }: RegionCoordinate): string => `r.${rx}.${rz}.mca`
