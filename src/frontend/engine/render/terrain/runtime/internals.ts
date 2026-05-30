import type { GeometryHandle } from '@render/backend/GeometryHandle'
import type { SubmeshRange } from '@render/backend/SubmeshRange'
import type { MaterialHandle, RenderObject } from '@render/queue/RenderObject'
import type { ChunkArtifactPayloadArenaReleaseHandle } from '@/engine/world/chunk/domain'
import type {
  TerrainChunkBuildArtifactInput,
  TerrainClusterCoord,
  TerrainResidentCommitSource,
  TerrainSectionRemoval,
  TerrainSectionUpdate,
} from '@render/terrain/types'
import type { ChunkArtifactItem, ResidentWorkIntent } from './types'

export interface PendingChunkArtifactUploadEntry {
  chunkX: number
  chunkZ: number
  artifact: TerrainChunkBuildArtifactInput
  dirtySectionYs?: number[]
}

export interface ClusterItemEntry {
  itemKind: ChunkArtifactItem
  object: RenderObject
  geometry: GeometryHandle
}

export interface ClusterRenderEntry {
  clusterKey: string
  chunkKeys: string[]
  itemEntries: Map<ChunkArtifactItem, ClusterItemEntry>
  objects: RenderObject[]
  geometries: GeometryHandle[]
  boundsMin: Float32Array
  boundsMax: Float32Array
}

export interface PendingResidentCommitState {
  dirtyItems: Set<ChunkArtifactItem> | null
  commitSource: TerrainResidentCommitSource
  estimatedCost: number
  enqueuedAtMs: number
}

export interface QueuedResidentUploadState {
  cluster: TerrainClusterCoord
  clusterKey: string
  dirtyItems: Set<ChunkArtifactItem>
  sectionUpdates: Map<string, TerrainSectionUpdate>
  sectionRemovals: Map<string, TerrainSectionRemoval>
  itemRemovals: Map<ChunkArtifactItem, Map<string, TerrainSectionRemoval>>
  payloadArenaReleaseHandles: Map<string, ChunkArtifactPayloadArenaReleaseHandle>
  updatedSectionCount: number
  removedSectionCount: number
  itemRemovalCount: number
  estimatedBytes: number
  estimatedCost: number
  enqueuedAtMs: number
}

export interface UploadWorkItem {
  clusterKey: string
  visible: boolean
  intent: ResidentWorkIntent
  estimatedBytes: number
  estimatedCost: number
  ageMs: number
}

export interface CommitWorkItem {
  clusterKey: string
  visible: boolean
  intent: ResidentWorkIntent
  commitSource: TerrainResidentCommitSource
  estimatedCost: number
  ageMs: number
}

let nextArtifactRenderObjectId = 1
let nextArtifactMaterialId = 1

export function sortCommitWorkItems(left: CommitWorkItem, right: CommitWorkItem) {
  const intentDelta = compareResidentWorkIntent(left.intent, right.intent)
  if (intentDelta !== 0) {
    return intentDelta
  }

  if (left.ageMs !== right.ageMs) {
    return right.ageMs - left.ageMs
  }

  if (left.commitSource !== right.commitSource) {
    return left.commitSource === 'upload' ? -1 : 1
  }

  if (left.estimatedCost !== right.estimatedCost) {
    return left.estimatedCost - right.estimatedCost
  }

  return left.clusterKey.localeCompare(right.clusterKey)
}

export function sortUploadWorkItems(left: UploadWorkItem, right: UploadWorkItem) {
  const intentDelta = compareResidentWorkIntent(left.intent, right.intent)
  if (intentDelta !== 0) {
    return intentDelta
  }

  if (left.ageMs !== right.ageMs) {
    return right.ageMs - left.ageMs
  }

  if (left.estimatedCost !== right.estimatedCost) {
    return left.estimatedCost - right.estimatedCost
  }

  return left.clusterKey.localeCompare(right.clusterKey)
}

export function getResidentWorkIntentPriority(intent: ResidentWorkIntent) {
  switch (intent) {
    case 'first-visible':
      return 0
    case 'visible-refresh':
      return 1
    case 'background-consolidation':
    default:
      return 2
  }
}

export function compareResidentWorkIntent(left: ResidentWorkIntent, right: ResidentWorkIntent) {
  return getResidentWorkIntentPriority(left) - getResidentWorkIntentPriority(right)
}

export function createChunkTransform(chunkX: number, chunkZ: number) {
  const tx = chunkX * 16
  const tz = chunkZ * 16

  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, 0, tz, 1])
}

export function createSubmeshFromCounts(
  item: ChunkArtifactItem,
  vertexCount: number,
  indexCount: number,
): SubmeshRange {
  return {
    pass: item,
    pipelineTag: `artifact-terrain-${item}`,
    vertexCount,
    firstVertex: 0,
    indexCount,
    firstIndex: 0,
    baseVertex: 0,
  }
}

export function createMaterial(item: ChunkArtifactItem): MaterialHandle {
  return {
    id: nextArtifactMaterialId++,
    domain: item === 'decal' ? 'decal' : 'terrain',
    blendMode: item === 'translucent' ? 'translucent' : item === 'decal' ? 'masked' : 'opaque',
    doubleSided: false,
    shaderTag: item === 'translucent' ? 'terrain.forward' : 'terrain.deferred',
    shaderFamily: item === 'translucent' ? 'translucent' : item === 'decal' ? 'cutout' : 'opaque',
    constants: {
      color: new Float32Array([1, 1, 1, item === 'translucent' ? 0.5 : 1]),
      roughness: item === 'translucent' ? 0.1 : 0.8,
      metallic: 0,
    },
    features: {
      alphaMask: item === 'decal',
      translucent: item === 'translucent',
      receivesLighting: true,
    },
  }
}

export function createArtifactRenderObject(
  item: ChunkArtifactItem,
  transform: Float32Array,
  boundsMin: Float32Array,
  boundsMax: Float32Array,
  geometry: GeometryHandle,
): RenderObject {
  return {
    id: nextArtifactRenderObjectId++,
    domain: item === 'decal' ? 'decal' : 'terrain',
    transform,
    bounds: {
      min: boundsMin,
      max: boundsMax,
    },
    geometry,
    material: createMaterial(item),
    mainViewVisible: true,
    visibilityMask: 0xffffffff,
    transparent: item === 'translucent',
    castShadow: true,
    receiveShadow: true,
  }
}

export function syncClusterEntryCollections(entry: ClusterRenderEntry) {
  entry.objects = []
  entry.geometries = []

  for (const item of ['opaque', 'decal', 'translucent'] as const) {
    const itemEntry = entry.itemEntries.get(item)
    if (!itemEntry) {
      continue
    }
    entry.objects.push(itemEntry.object)
    entry.geometries.push(itemEntry.geometry)
  }
}
