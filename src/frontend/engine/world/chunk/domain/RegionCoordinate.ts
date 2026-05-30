import type { RegionCoordinate as RegionCoord } from '../utils/ChunkKeyUtils'
import { regionFileName, toRegionCoord } from '../utils/ChunkKeyUtils'

export type RegionCoordinate = RegionCoord

export const fromChunk = (x: number, z: number): RegionCoordinate => toRegionCoord(x, z)

export const toFileName = (coord: RegionCoordinate): string => regionFileName(coord)
