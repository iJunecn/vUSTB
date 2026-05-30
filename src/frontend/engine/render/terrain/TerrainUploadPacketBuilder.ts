import type { TerrainClusterUploadPlan } from './TerrainUploadPlanner'
import type {
  TerrainClusterCoord,
  TerrainIndexMode,
  TerrainItem,
  TerrainSectionRemoval,
} from './types'

export type TerrainUploadPacketIntent =
  | 'first-visible'
  | 'visible-refresh'
  | 'background-consolidation'

export interface TerrainUploadPacketSectionUpdate {
  sectionKey: string
  chunkX: number
  chunkZ: number
  indexMode: TerrainIndexMode
  vertexStride: number
  vertexBytes: Uint8Array
  indexBytes: Uint8Array | null
  vertexCount: number
  indexCount: number
}

export interface TerrainUploadPacket {
  intent: TerrainUploadPacketIntent
  cluster: TerrainClusterCoord
  clusterKey: string
  item: TerrainItem
  updates: TerrainUploadPacketSectionUpdate[]
  removals: TerrainSectionRemoval[]
  estimatedBytes: number
  estimatedWrites: number
  estimatedCost: number
}

export class TerrainUploadPacketBuilder {
  public build(
    plans: TerrainClusterUploadPlan[],
    resolveIntent: (clusterKey: string, item: TerrainItem) => TerrainUploadPacketIntent = () =>
      'background-consolidation',
  ): TerrainUploadPacket[] {
    const packets = new Map<string, TerrainUploadPacket>()

    for (const clusterPlan of plans) {
      for (const itemPlan of clusterPlan.items) {
        const intent = resolveIntent(clusterPlan.clusterKey, itemPlan.item)
        const packetKey = `${intent}:${clusterPlan.clusterKey}:${itemPlan.item}`
        let packet = packets.get(packetKey)
        if (!packet) {
          packet = {
            intent,
            cluster: clusterPlan.cluster,
            clusterKey: clusterPlan.clusterKey,
            item: itemPlan.item,
            updates: [],
            removals: [],
            estimatedBytes: 0,
            estimatedWrites: 0,
            estimatedCost: 0,
          }
          packets.set(packetKey, packet)
        }

        for (const update of itemPlan.updates) {
          packet.updates.push({
            sectionKey: update.sectionKey,
            chunkX: update.update.key.chunkX,
            chunkZ: update.update.key.chunkZ,
            indexMode: update.indexMode,
            vertexStride: update.vertexStride,
            vertexBytes: update.vertexBytes,
            indexBytes: update.indexBytes,
            vertexCount: update.vertexCount,
            indexCount: update.indexCount,
          })
        }

        packet.removals.push(...itemPlan.removals)
        packet.estimatedBytes += itemPlan.totalVertexBytes + itemPlan.totalIndexBytes
        packet.estimatedWrites += itemPlan.updates.length + (itemPlan.removals.length > 0 ? 1 : 0)
        packet.estimatedCost +=
          Math.max(1, Math.ceil((itemPlan.totalVertexBytes + itemPlan.totalIndexBytes) / 131072)) +
          itemPlan.updates.length * 2 +
          itemPlan.removals.length
      }
    }

    return [...packets.values()].sort((left, right) => {
      if (left.intent !== right.intent) {
        return left.intent.localeCompare(right.intent)
      }

      if (left.estimatedCost !== right.estimatedCost) {
        return left.estimatedCost - right.estimatedCost
      }

      return left.clusterKey.localeCompare(right.clusterKey) || left.item.localeCompare(right.item)
    })
  }
}
