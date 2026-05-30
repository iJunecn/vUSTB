import type { IRenderBackend } from '@render/backend/IRenderBackend'
import type { Frustum } from '@render/core/scene/Frustum'
import type { RenderObject } from '@render/queue/RenderObject'
import { SectionVisibilityGraph } from '@render/terrain/SectionVisibilityGraph'
import { TerrainClusterArena } from '@render/terrain/TerrainClusterArena'
import { TerrainResidentUploadExecutor } from '@render/terrain/TerrainResidentUploadExecutor'
import type { ChunkArtifactItem } from './types'
import type { ClusterRenderEntry } from './internals'
import {
  createArtifactRenderObject,
  createChunkTransform,
  createSubmeshFromCounts,
  syncClusterEntryCollections,
} from './internals'

export function rebuildRenderObjectsCache(clusterEntries: Map<string, ClusterRenderEntry>) {
  const objects: RenderObject[] = []

  for (const entry of clusterEntries.values()) {
    objects.push(...entry.objects)
  }

  return objects
}

export function performCull(
  clusterEntries: Map<string, ClusterRenderEntry>,
  frustum: Frustum,
  viewProjection: Float32Array,
  cameraPosition?: Float32Array,
  reverseZ: boolean = false,
) {
  frustum.setFromProjectionMatrix(viewProjection, reverseZ)

  const visibleObjects: RenderObject[] = []
  const visibleChunkKeys: string[] = []
  const visibleRegionPriority: Array<readonly [string, number]> = []

  for (const entry of clusterEntries.values()) {
    if (
      !frustum.intersectsBox(
        { x: entry.boundsMin[0], y: entry.boundsMin[1], z: entry.boundsMin[2] },
        { x: entry.boundsMax[0], y: entry.boundsMax[1], z: entry.boundsMax[2] },
      )
    ) {
      continue
    }

    let distSq = 0
    if (cameraPosition) {
      const cx = (entry.boundsMin[0] + entry.boundsMax[0]) * 0.5
      const cy = (entry.boundsMin[1] + entry.boundsMax[1]) * 0.5
      const cz = (entry.boundsMin[2] + entry.boundsMax[2]) * 0.5
      const dx = cx - cameraPosition[0]
      const dy = cy - cameraPosition[1]
      const dz = cz - cameraPosition[2]
      distSq = dx * dx + dy * dy + dz * dz
    }
    visibleRegionPriority.push([entry.clusterKey, distSq])

    visibleChunkKeys.push(...entry.chunkKeys)
    for (const itemEntry of entry.itemEntries.values()) {
      if (itemEntry.object.transparent) {
        itemEntry.object.sortKey = distSq
      }
      visibleObjects.push(itemEntry.object)
    }
  }

  return {
    visibleObjects,
    visibleChunkKeys,
    visibleRegionPriority,
  }
}

export function collectVisibleChunkKeys(clusterEntries: Map<string, ClusterRenderEntry>) {
  const chunkKeys = new Set<string>()
  for (const entry of clusterEntries.values()) {
    for (const chunkKey of entry.chunkKeys) {
      chunkKeys.add(chunkKey)
    }
  }
  return [...chunkKeys]
}

export function releaseClusterEntryImpl(
  clusterEntries: Map<string, ClusterRenderEntry>,
  backend: IRenderBackend,
  clusterKey: string,
): void {
  const existing = clusterEntries.get(clusterKey)
  if (!existing) {
    return
  }

  for (const itemEntry of existing.itemEntries.values()) {
    backend.releaseGeometry(itemEntry.geometry)
  }

  clusterEntries.delete(clusterKey)
}

export interface RebuildClusterContext {
  clusterArena: TerrainClusterArena
  clusterEntries: Map<string, ClusterRenderEntry>
  visibilityGraph: SectionVisibilityGraph
  residentUploadExecutor: TerrainResidentUploadExecutor
  backend: IRenderBackend
  getChunkKey(chunkX: number, chunkZ: number): string
  releaseClusterEntry(clusterKey: string): void
}

export function rebuildClusterEntryResidentImpl(
  context: RebuildClusterContext,
  clusterKey: string,
  dirtyItems?: ReadonlySet<ChunkArtifactItem>,
): void {
  const sections = context.clusterArena.getClusterSections(clusterKey)
  const existingEntry = context.clusterEntries.get(clusterKey) ?? null
  if (sections.length === 0) {
    if (existingEntry) {
      context.releaseClusterEntry(clusterKey)
    }
    return
  }

  const clusterEntry: ClusterRenderEntry = existingEntry ?? {
    clusterKey,
    chunkKeys: [],
    itemEntries: new Map(),
    objects: [],
    geometries: [],
    boundsMin: new Float32Array(3),
    boundsMax: new Float32Array(3),
  }

  clusterEntry.clusterKey = clusterKey
  const chunkKeys = new Set<string>()
  const firstItemRecords = new Map<
    ChunkArtifactItem,
    ReturnType<(typeof sections)[number]['items']['get']>
  >()

  clusterEntry.boundsMin[0] = sections[0].boundsMin[0]
  clusterEntry.boundsMin[1] = sections[0].boundsMin[1]
  clusterEntry.boundsMin[2] = sections[0].boundsMin[2]
  clusterEntry.boundsMax[0] = sections[0].boundsMax[0]
  clusterEntry.boundsMax[1] = sections[0].boundsMax[1]
  clusterEntry.boundsMax[2] = sections[0].boundsMax[2]
  chunkKeys.add(context.getChunkKey(sections[0].key.chunkX, sections[0].key.chunkZ))

  for (const [itemName, itemRecord] of sections[0].items) {
    firstItemRecords.set(itemName, itemRecord)
  }

  for (let index = 1; index < sections.length; index += 1) {
    const section = sections[index]
    chunkKeys.add(context.getChunkKey(section.key.chunkX, section.key.chunkZ))
    clusterEntry.boundsMin[0] = Math.min(clusterEntry.boundsMin[0], section.boundsMin[0])
    clusterEntry.boundsMin[1] = Math.min(clusterEntry.boundsMin[1], section.boundsMin[1])
    clusterEntry.boundsMin[2] = Math.min(clusterEntry.boundsMin[2], section.boundsMin[2])
    clusterEntry.boundsMax[0] = Math.max(clusterEntry.boundsMax[0], section.boundsMax[0])
    clusterEntry.boundsMax[1] = Math.max(clusterEntry.boundsMax[1], section.boundsMax[1])
    clusterEntry.boundsMax[2] = Math.max(clusterEntry.boundsMax[2], section.boundsMax[2])

    for (const [itemName, itemRecord] of section.items) {
      if (firstItemRecords.has(itemName)) {
        continue
      }
      firstItemRecords.set(itemName, itemRecord)
    }
  }

  clusterEntry.chunkKeys = [...chunkKeys]

  for (const section of sections) {
    context.visibilityGraph.registerSection(
      section.key.chunkX,
      section.key.sectionY,
      section.key.chunkZ,
      section.boundsMin,
      section.boundsMax,
    )
  }

  const [clusterX, clusterZ] = clusterKey.split(',').map(Number)
  const clusterOrigin = context.clusterArena.getClusterOriginChunk({ clusterX, clusterZ })
  const transform = createChunkTransform(clusterOrigin.chunkX, clusterOrigin.chunkZ)
  for (const item of ['opaque', 'decal', 'translucent'] as const) {
    if (dirtyItems && !dirtyItems.has(item)) {
      const existingItemEntry = clusterEntry.itemEntries.get(item)
      if (existingItemEntry) {
        existingItemEntry.object.transform = transform
        existingItemEntry.object.bounds.min = clusterEntry.boundsMin
        existingItemEntry.object.bounds.max = clusterEntry.boundsMax
      }
      continue
    }

    const firstItemRecord = firstItemRecords.get(item)
    const residentBinding = firstItemRecord
      ? context.residentUploadExecutor.getResidentGeometryBinding(
          clusterKey,
          item,
          firstItemRecord.layoutId,
          firstItemRecord.vertexStride,
        )
      : null
    if (!residentBinding || !firstItemRecord) {
      const existingItemEntry = clusterEntry.itemEntries.get(item)
      if (existingItemEntry) {
        context.backend.releaseGeometry(existingItemEntry.geometry)
        clusterEntry.itemEntries.delete(item)
      }
      continue
    }

    const vertexCount = residentBinding.vertexCount
    const indexCount = residentBinding.indexCount ?? 0
    const existingItemEntry = clusterEntry.itemEntries.get(item)

    if (existingItemEntry) {
      context.backend.updateResidentGeometry(existingItemEntry.geometry, residentBinding)
      existingItemEntry.geometry.layoutId = firstItemRecord.layoutId
      existingItemEntry.geometry.topology = 'triangles'
      existingItemEntry.geometry.submeshes = [
        createSubmeshFromCounts(item, vertexCount, indexCount),
      ]
      existingItemEntry.object.transform = transform
      existingItemEntry.object.bounds.min = clusterEntry.boundsMin
      existingItemEntry.object.bounds.max = clusterEntry.boundsMax
    } else {
      const geometry = context.backend.createResidentGeometry(residentBinding)
      geometry.kind = 'section'
      geometry.submeshes = [createSubmeshFromCounts(item, vertexCount, indexCount)]

      const renderObject = createArtifactRenderObject(
        item,
        transform,
        clusterEntry.boundsMin,
        clusterEntry.boundsMax,
        geometry,
      )

      clusterEntry.itemEntries.set(item, {
        itemKind: item,
        object: renderObject,
        geometry,
      })
    }
  }

  syncClusterEntryCollections(clusterEntry)

  if (clusterEntry.objects.length > 0) {
    context.clusterEntries.set(clusterKey, clusterEntry)
  } else if (existingEntry) {
    context.releaseClusterEntry(clusterKey)
  }
}
