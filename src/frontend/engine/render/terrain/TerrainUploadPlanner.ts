import {
  forEachTerrainDescriptorItemData,
  getTerrainIndexByteLength,
  terrainSectionKeyToString,
  type TerrainIndexMode,
  type TerrainItem,
  type TerrainPendingClusterUpload,
  type TerrainClusterCoord,
  type TerrainSectionRemoval,
  type TerrainSectionUpdate,
} from './types'

export interface TerrainItemUploadItem {
  sectionKey: string
  update: TerrainSectionUpdate
  indexMode: TerrainIndexMode
  vertexStride: number
  vertexBytes: Uint8Array
  indexBytes: Uint8Array | null
  vertexCount: number
  indexCount: number
}

export interface TerrainItemUploadPlan {
  cluster: TerrainClusterCoord
  clusterKey: string
  item: TerrainItem
  updates: TerrainItemUploadItem[]
  removals: TerrainSectionRemoval[]
  totalVertexBytes: number
  totalIndexBytes: number
}

function buildBaseZeroQuadIndexBytes(vertexCount: number) {
  const quadCount = Math.floor(vertexCount / 4)
  if (quadCount <= 0) {
    return new Uint8Array(0)
  }

  const indices = new Uint32Array(quadCount * 6)
  for (let quadIndex = 0; quadIndex < quadCount; quadIndex++) {
    const vertexStart = quadIndex * 4
    const indexOffset = quadIndex * 6
    // Mirror QUAD_INDICES_CCW from terrain/TerrainMeshConventions.ts
    // Inlined in hot-path for performance; kept in sync via docs/CONVENTIONS.md.
    indices[indexOffset] = vertexStart
    indices[indexOffset + 1] = vertexStart + 2
    indices[indexOffset + 2] = vertexStart + 1
    indices[indexOffset + 3] = vertexStart
    indices[indexOffset + 4] = vertexStart + 3
    indices[indexOffset + 5] = vertexStart + 2
  }

  return new Uint8Array(indices.buffer, indices.byteOffset, indices.byteLength)
}

function prepareTerrainIndexBytes(
  indexMode: TerrainIndexMode,
  vertexCount: number,
  indexBytes?: Uint8Array | null,
) {
  switch (indexMode) {
    case 'shared-static':
      return buildBaseZeroQuadIndexBytes(vertexCount)
    case 'local-dynamic':
    default:
      // Must .slice() to create an owned copy — the source may be a subarray
      // view into a SharedArrayBuffer payload arena that gets released and
      // reused by the worker.  Without the copy, record.indexBytes in the
      // cluster buffer becomes stale when the arena is overwritten, causing
      // garbage indices on any future rebuildWholeItemIndex() call (tearing /
      // translucent geometry disappearing).
      return indexBytes?.byteLength ? indexBytes.slice() : null
  }
}

export interface TerrainClusterUploadPlan {
  cluster: TerrainClusterCoord
  clusterKey: string
  items: TerrainItemUploadPlan[]
}

export class TerrainUploadPlanner {
  public build(uploads: TerrainPendingClusterUpload[]): TerrainClusterUploadPlan[] {
    const plans: TerrainClusterUploadPlan[] = []

    for (const upload of uploads) {
      const itemPlans = new Map<TerrainItem, TerrainItemUploadPlan>()
      const dirtySet = new Set(upload.dirtyItems)

      for (const update of upload.sectionUpdates) {
        const sectionKey = terrainSectionKeyToString(update.key)
        forEachTerrainDescriptorItemData(
          update.descriptor,
          update.resolver,
          (
            item,
            indexMode,
            _layoutId,
            vertexStride,
            vertexBytes,
            rawIndexBytes,
            vertexCount,
            indexCount,
          ) => {
            if (!dirtySet.has(item)) return
            const indexBytes = prepareTerrainIndexBytes(indexMode, vertexCount, rawIndexBytes)
            let itemPlan = itemPlans.get(item)
            if (!itemPlan) {
              itemPlan = {
                cluster: upload.cluster,
                clusterKey: upload.clusterKey,
                item,
                updates: [],
                removals: [],
                totalVertexBytes: 0,
                totalIndexBytes: 0,
              }
              itemPlans.set(item, itemPlan)
            }

            itemPlan.updates.push({
              sectionKey,
              update,
              indexMode,
              vertexStride,
              vertexBytes,
              indexBytes,
              vertexCount,
              indexCount,
            })
            itemPlan.totalVertexBytes += vertexBytes.byteLength
            itemPlan.totalIndexBytes += getTerrainIndexByteLength(
              indexMode,
              vertexCount,
              indexBytes,
            )
          },
        )
      }

      if (upload.sectionRemovals.length > 0) {
        for (const item of upload.dirtyItems) {
          let itemPlan = itemPlans.get(item)
          if (!itemPlan) {
            itemPlan = {
              cluster: upload.cluster,
              clusterKey: upload.clusterKey,
              item,
              updates: [],
              removals: [],
              totalVertexBytes: 0,
              totalIndexBytes: 0,
            }
            itemPlans.set(item, itemPlan)
          }
          itemPlan.removals.push(...upload.sectionRemovals)
        }
      }

      for (const itemRemoval of upload.itemRemovals) {
        let itemPlan = itemPlans.get(itemRemoval.item)
        if (!itemPlan) {
          itemPlan = {
            cluster: upload.cluster,
            clusterKey: upload.clusterKey,
            item: itemRemoval.item,
            updates: [],
            removals: [],
            totalVertexBytes: 0,
            totalIndexBytes: 0,
          }
          itemPlans.set(itemRemoval.item, itemPlan)
        }

        itemPlan.removals.push(itemRemoval.removal)
      }

      plans.push({
        cluster: upload.cluster,
        clusterKey: upload.clusterKey,
        items: [...itemPlans.values()],
      })
    }

    return plans
  }
}
