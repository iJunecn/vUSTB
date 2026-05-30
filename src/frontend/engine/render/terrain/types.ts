/**
 * @file terrain/types.ts
 * @brief 地形驻留运行时协议与兼容工具
 *
 * 说明：
 *  - 定义地形上传、提交和绘制主线共享的数据协议
 *  - 当前主线只消费 `ChunkSectionDescriptor + ChunkArtifactPayloadResolver`
 *  - 地形入口仅接受工作线程回传的 payload 封套
 */

import type {
  ChunkArtifactEnvelopeWithPayload,
  ChunkArtifactPayloadResolver,
  ChunkArtifactPayloadArenaReleaseHandle,
  ChunkSectionDescriptor,
} from '@/engine/world/chunk/domain'
import { resolveChunkArtifactDescriptor } from '@/engine/world/chunk/domain'
import { TERRAIN_COMPACT_LAYOUT_ID } from '@render/layout/BuiltinLayouts'

export type TerrainItem = 'opaque' | 'decal' | 'translucent'
export type TerrainIndexMode = 'shared-static' | 'local-dynamic'
export type TerrainResidentCommitSource = 'upload'

export interface TerrainSectionKey {
  chunkX: number
  sectionY: number
  chunkZ: number
}

export interface TerrainClusterCoord {
  clusterX: number
  clusterZ: number
}

export interface TerrainResidentSlot {
  layoutId: string
  indexMode: TerrainIndexMode
  residentVersion: number
  vertexStride: number
  vertexCount: number
  indexCount: number
  artifactVersion: number
}

export interface TerrainResidentItemRecord {
  item: TerrainItem
  layoutId: string
  indexMode: TerrainIndexMode
  residentVersion: number
  pendingResidentVersion: number | null
  lastCommitSource: TerrainResidentCommitSource | null
  vertexStride: number
  vertexCount: number
  indexCount: number
  artifactVersion: number
  current: TerrainResidentSlot | null
  pending: TerrainResidentSlot | null
}

export interface TerrainResidentSectionRecord {
  key: TerrainSectionKey
  cluster: TerrainClusterCoord
  buildVersion: number
  boundsMin: Float32Array
  boundsMax: Float32Array
  items: Map<TerrainItem, TerrainResidentItemRecord>
}

export interface TerrainClusterResident {
  key: TerrainClusterCoord
  clusterKey: string
  sectionKeys: Set<string>
  dirtyItems: Set<TerrainItem>
}

export interface TerrainSectionUpdate {
  key: TerrainSectionKey
  descriptor: ChunkSectionDescriptor
  resolver: ChunkArtifactPayloadResolver
  artifactVersion: number
}

export interface TerrainSectionRemoval {
  key: TerrainSectionKey
}

export interface TerrainItemRemoval {
  item: TerrainItem
  removal: TerrainSectionRemoval
}

export interface TerrainPendingClusterUpload {
  cluster: TerrainClusterCoord
  clusterKey: string
  dirtyItems: TerrainItem[]
  sectionUpdates: TerrainSectionUpdate[]
  sectionRemovals: TerrainSectionRemoval[]
  itemRemovals: TerrainItemRemoval[]
  payloadArenaReleaseHandles: ChunkArtifactPayloadArenaReleaseHandle[]
}

// 地形驻留运行时当前只接收工作线程回传的 payload 封套。
export type TerrainChunkBuildArtifactInput = ChunkArtifactEnvelopeWithPayload

const TERRAIN_COMPACT_VERTEX_STRIDE = 32
const EMPTY_UINT8_ARRAY = new Uint8Array(0)

export interface ResidentSectionSpan {
  vertexOffsetBytes: number
  vertexSizeBytes: number
  indexOffsetBytes: number
  indexSizeBytes: number
}

export interface ClusterItemBumpState {
  vertexCapacityBytes: number
  indexCapacityBytes: number
  vertexBumpBytes: number
  indexBumpBytes: number
  liveVertexBytes: number
  liveIndexBytes: number
  deadVertexBytes: number
  deadIndexBytes: number
  sectionCount: number
}

export interface RebuildWorkItem {
  clusterKey: string
  item: TerrainItem
  deadVertexBytes: number
  deadIndexBytes: number
  liveVertexBytes: number
  liveIndexBytes: number
  reason: 'dead-exceeds-live' | 'capacity-exceeded'
}

export function createTerrainResidentSlot(params: TerrainResidentSlot): TerrainResidentSlot {
  return {
    layoutId: params.layoutId,
    indexMode: params.indexMode,
    residentVersion: params.residentVersion,
    vertexStride: params.vertexStride,
    vertexCount: params.vertexCount,
    indexCount: params.indexCount,
    artifactVersion: params.artifactVersion,
  }
}

export function getTerrainIndexModeForItem(item: TerrainItem): TerrainIndexMode {
  switch (item) {
    case 'opaque':
    case 'decal':
      return 'shared-static'
    case 'translucent':
      return 'local-dynamic'
    default:
      return 'local-dynamic'
  }
}

export function getTerrainIndexByteLength(
  indexMode: TerrainIndexMode,
  vertexCount: number,
  indexBytes?: Uint8Array | null,
) {
  switch (indexMode) {
    case 'shared-static': {
      const quadCount = Math.floor(vertexCount / 4)
      return quadCount > 0 ? quadCount * 6 * 4 : 0
    }
    case 'local-dynamic':
    default:
      return indexBytes?.byteLength ?? 0
  }
}

export function normalizeTerrainItem(item: string): TerrainItem | null {
  switch (item.toLowerCase()) {
    case 'opaque':
      return 'opaque'
    case 'decal':
      return 'decal'
    case 'translucent':
      return 'translucent'
    default:
      return null
  }
}

export function createTerrainSectionKey(
  chunkX: number,
  sectionY: number,
  chunkZ: number,
): TerrainSectionKey {
  return { chunkX, sectionY, chunkZ }
}

export function terrainSectionKeyToString(key: TerrainSectionKey): string {
  return `${key.chunkX},${key.sectionY},${key.chunkZ}`
}

export function terrainClusterKeyToString(coord: TerrainClusterCoord): string {
  return `${coord.clusterX},${coord.clusterZ}`
}

export function forEachTerrainDescriptorItemData(
  descriptor: ChunkSectionDescriptor,
  resolver: ChunkArtifactPayloadResolver,
  callback: (
    item: TerrainItem,
    indexMode: TerrainIndexMode,
    layoutId: string,
    vertexStride: number,
    vertexBytes: Uint8Array,
    indexBytes: Uint8Array | null | undefined,
    vertexCount: number,
    indexCount: number,
  ) => void,
) {
  for (const item of descriptor.items) {
    const normalized = normalizeTerrainItem(item.item)
    if (!normalized) {
      continue
    }

    const vertexBytes = resolver.resolve(item.vertexSpan) ?? EMPTY_UINT8_ARRAY
    const indexBytes = resolver.resolve(item.indexSpan)
    callback(
      normalized,
      getTerrainIndexModeForItem(normalized),
      item.layoutId ?? TERRAIN_COMPACT_LAYOUT_ID,
      item.vertexStride ?? TERRAIN_COMPACT_VERTEX_STRIDE,
      vertexBytes,
      indexBytes,
      item.vertexCount,
      item.indexCount,
    )
  }
}

export function getArtifactDescriptorSectionsByKey(artifactInput: TerrainChunkBuildArtifactInput) {
  // 主线入口：terrain runtime 应优先基于 descriptor 构造 section 映射。
  const descriptor = resolveChunkArtifactDescriptor(artifactInput)
  const result = new Map<string, ChunkSectionDescriptor>()

  if (!descriptor) {
    return result
  }

  for (const section of descriptor.sections) {
    const key = terrainSectionKeyToString(
      createTerrainSectionKey(section.chunkX, section.sectionY, section.chunkZ),
    )
    result.set(key, section)
  }

  return result
}
