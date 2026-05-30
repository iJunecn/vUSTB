import type { ChunkKey } from '../utils/ChunkKeyUtils'
import { parseChunkKey, toChunkKeyFromCoord } from '../utils/ChunkKeyUtils'

export interface ChunkCoordinate {
  x: number
  z: number
}

export const fromKey = (key: ChunkKey): ChunkCoordinate => parseChunkKey(key)

export const toKey = (coord: ChunkCoordinate): ChunkKey => toChunkKeyFromCoord(coord)
