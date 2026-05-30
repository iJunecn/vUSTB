import type { ChunkCoordinate } from './ChunkCoordinate'
import { toChunkKey, parseChunkKey } from '../utils/ChunkKeyUtils'

export type ChunkKey = string

export const toKey = (x: number, z: number): ChunkKey => toChunkKey(x, z)

export const toKeyFromCoord = (coord: ChunkCoordinate): ChunkKey => toChunkKey(coord.x, coord.z)

export const fromKey = (key: ChunkKey): ChunkCoordinate => parseChunkKey(key)
