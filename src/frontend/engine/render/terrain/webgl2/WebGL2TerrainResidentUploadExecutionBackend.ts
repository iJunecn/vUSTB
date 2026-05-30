import type { ResidentGeometryBinding } from '@render/backend/IRenderBackend'
import { TerrainClusterArena } from '../TerrainClusterArena'
import { type TerrainUploadPacket } from '../TerrainUploadPacketBuilder'
import type {
  TerrainResidentRebuildStats,
  TerrainResidentRuntimeStats,
  TerrainResidentUploadExecutionBackend,
  TerrainResidentUploadStats,
} from '../TerrainResidentUploadExecutor'
import type { TerrainClusterUploadPlan, TerrainItemUploadPlan } from '../TerrainUploadPlanner'
import { terrainSectionKeyToString, type TerrainItem } from '../types'
import { WebGL2TerrainClusterBuffer } from './WebGL2TerrainClusterBuffer'

interface TerrainRebuildCandidate {
  clusterKey: string
  item: TerrainItem
  deadVertexBytes: number
  liveVertexBytes: number
}

export class WebGL2TerrainResidentUploadExecutionBackend
  implements TerrainResidentUploadExecutionBackend
{
  private readonly clusterBuffers = new Map<string, WebGL2TerrainClusterBuffer>()
  private visibleClusterPriority = new Map<string, number>()

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly arena: TerrainClusterArena,
  ) {}

  public setVisibleClusterPriority(priorities: Iterable<readonly [string, number]> | null): void {
    this.visibleClusterPriority = priorities ? new Map(priorities) : new Map()
  }

  public applyPlans(plans: TerrainClusterUploadPlan[]): TerrainResidentUploadStats {
    let uploadedItems = 0
    const uploadedClusters = new Set<string>()
    let vertexBytes = 0
    let indexBytes = 0
    let partialVertexUploadCalls = 0
    let vertexReallocations = 0
    let indexBuildMs = 0
    let rebuildSuggestedItems = 0

    for (const clusterPlan of plans) {
      uploadedClusters.add(clusterPlan.clusterKey)

      for (const itemPlan of clusterPlan.items) {
        const buffer = this.getOrCreateClusterItemBuffer(clusterPlan.clusterKey, itemPlan.item)
        const result = buffer.uploadDelta({
          updates: this.buildSectionUpdates(clusterPlan, itemPlan),
          removals: itemPlan.removals.map(removal => terrainSectionKeyToString(removal.key)),
        })

        if (buffer.getVertexByteLength() === 0) {
          this.releaseClusterItemBuffer(clusterPlan.clusterKey, itemPlan.item)
          continue
        }

        for (const sectionKey of result.uploadedSectionKeys) {
          this.arena.markSectionItemUploaded(sectionKey, itemPlan.item)
        }

        uploadedItems += 1
        vertexBytes += result.vertexBytes
        indexBytes += result.indexBytes
        partialVertexUploadCalls += result.partialVertexUploadCalls
        vertexReallocations += result.vertexReallocated ? 1 : 0
        indexBuildMs += result.indexBuildMs
        rebuildSuggestedItems += result.rebuildSuggested ? 1 : 0
      }
    }

    return {
      uploadedClusters: uploadedClusters.size,
      uploadedItems,
      vertexBytes,
      indexBytes,
      partialVertexUploadCalls,
      vertexReallocations,
      indexBuildMs,
      rebuildSuggestedItems,
      committedResidentSlots: 0,
    }
  }

  public applyPackets(packets: TerrainUploadPacket[]): TerrainResidentUploadStats {
    let uploadedItems = 0
    const uploadedClusters = new Set<string>()
    let vertexBytes = 0
    let indexBytes = 0
    let partialVertexUploadCalls = 0
    let vertexReallocations = 0
    let indexBuildMs = 0
    let rebuildSuggestedItems = 0

    for (const packet of packets) {
      uploadedClusters.add(packet.clusterKey)
      const buffer = this.getOrCreateClusterItemBuffer(packet.clusterKey, packet.item)
      const result = buffer.uploadDelta({
        updates: this.buildPacketSectionUpdates(packet),
        removals: packet.removals.map(removal => terrainSectionKeyToString(removal.key)),
      })

      if (buffer.getVertexByteLength() === 0) {
        this.releaseClusterItemBuffer(packet.clusterKey, packet.item)
        continue
      }

      for (const sectionKey of result.uploadedSectionKeys) {
        this.arena.markSectionItemUploaded(sectionKey, packet.item)
      }

      uploadedItems += 1
      vertexBytes += result.vertexBytes
      indexBytes += result.indexBytes
      partialVertexUploadCalls += result.partialVertexUploadCalls
      vertexReallocations += result.vertexReallocated ? 1 : 0
      indexBuildMs += result.indexBuildMs
      rebuildSuggestedItems += result.rebuildSuggested ? 1 : 0
    }

    return {
      uploadedClusters: uploadedClusters.size,
      uploadedItems,
      vertexBytes,
      indexBytes,
      partialVertexUploadCalls,
      vertexReallocations,
      indexBuildMs,
      rebuildSuggestedItems,
      committedResidentSlots: 0,
    }
  }

  public rebuildClusters(maxItems: number): TerrainResidentRebuildStats {
    if (maxItems <= 0) {
      return {
        rebuiltClusters: [],
        rebuiltItems: 0,
        vertexBytes: 0,
        indexBytes: 0,
        committedResidentSlots: 0,
      }
    }

    const rebuiltClusters = new Set<string>()
    let rebuiltItems = 0
    let vertexBytes = 0
    let indexBytes = 0
    const candidates = this.collectRebuildCandidates()

    for (const candidate of candidates) {
      if (rebuiltItems >= maxItems) {
        break
      }

      const buffer = this.getClusterBuffer(candidate.clusterKey, candidate.item)
      if (!buffer?.needsRebuild()) {
        continue
      }

      const result = buffer.rebuild()

      // Mark all sections in this cluster-item as re-uploaded after rebuild
      for (const sectionKey of this.getBufferSectionKeys(candidate.clusterKey, candidate.item)) {
        this.arena.markSectionItemUploaded(sectionKey, candidate.item)
      }

      rebuiltClusters.add(candidate.clusterKey)
      rebuiltItems += 1
      vertexBytes += result.vertexBytes
      indexBytes += result.indexBytes
    }

    return {
      rebuiltClusters: [...rebuiltClusters],
      rebuiltItems,
      vertexBytes,
      indexBytes,
      committedResidentSlots: 0,
    }
  }

  public clear() {
    for (const buffer of this.clusterBuffers.values()) {
      buffer.dispose()
    }
    this.clusterBuffers.clear()
  }

  public getClusterBuffer(clusterKey: string, item: TerrainItem) {
    return this.clusterBuffers.get(`${clusterKey}:${item}`) ?? null
  }

  public getResidentGeometryBinding(
    clusterKey: string,
    item: TerrainItem,
    layoutId: string,
    vertexStride: number,
  ): ResidentGeometryBinding | null {
    const buffer = this.getClusterBuffer(clusterKey, item)
    if (!buffer || buffer.getVertexByteLength() === 0) {
      return null
    }

    const indexByteLength = buffer.getIndexByteLength()

    return {
      layoutId,
      topology: 'triangles',
      vertexBuffers: [
        {
          slot: 0,
          buffer: buffer.getVertexBuffer(),
          offsetBytes: 0,
          stride: vertexStride,
          stepMode: 'vertex',
        },
      ],
      vertexCount: Math.floor(buffer.getVertexByteLength() / Math.max(vertexStride, 1)),
      instanceCount: 1,
      indexBuffer: indexByteLength > 0 ? buffer.getIndexBuffer() : undefined,
      indexOffsetBytes: 0,
      indexCount: indexByteLength / 4,
      indexType: indexByteLength > 0 ? this.gl.UNSIGNED_INT : undefined,
    }
  }

  public getRuntimeStats(): TerrainResidentRuntimeStats {
    let deadVertexBytes = 0
    let deadIndexBytes = 0
    let liveVertexBytes = 0
    let liveIndexBytes = 0
    let rebuildCandidateItems = 0
    let topDeadVertexBytes = 0
    let topDeadClusterKey: string | null = null
    let topDeadItem: TerrainItem | null = null

    for (const [bufferKey, buffer] of this.clusterBuffers) {
      const state = buffer.getBumpState()
      deadVertexBytes += state.deadVertexBytes
      deadIndexBytes += state.deadIndexBytes
      liveVertexBytes += state.liveVertexBytes
      liveIndexBytes += state.liveIndexBytes

      if (buffer.needsRebuild()) {
        rebuildCandidateItems += 1
        if (state.deadVertexBytes > topDeadVertexBytes) {
          topDeadVertexBytes = state.deadVertexBytes
          const [clusterKey] = bufferKey.split(':')
          topDeadClusterKey = clusterKey
          topDeadItem = buffer.item
        }
      }
    }

    return {
      deadVertexBytes,
      deadIndexBytes,
      liveVertexBytes,
      liveIndexBytes,
      rebuildCandidateItems,
      topDeadVertexBytes,
      topDeadClusterKey,
      topDeadItem,
    }
  }

  private getOrCreateClusterItemBuffer(clusterKey: string, item: TerrainItem) {
    const bufferKey = `${clusterKey}:${item}`
    let buffer = this.clusterBuffers.get(bufferKey)
    if (!buffer) {
      buffer = new WebGL2TerrainClusterBuffer(this.gl, clusterKey, item)
      this.clusterBuffers.set(bufferKey, buffer)
    }
    return buffer
  }

  private releaseClusterItemBuffer(clusterKey: string, item: TerrainItem) {
    const bufferKey = `${clusterKey}:${item}`
    const buffer = this.clusterBuffers.get(bufferKey)
    if (!buffer) {
      return
    }

    buffer.dispose()
    this.clusterBuffers.delete(bufferKey)
  }

  private getBufferSectionKeys(clusterKey: string, item: TerrainItem): string[] {
    const sections = this.arena.getClusterSections(clusterKey)
    const sectionKeys: string[] = []
    for (const section of sections) {
      if (section.items.has(item)) {
        sectionKeys.push(terrainSectionKeyToString(section.key))
      }
    }
    return sectionKeys
  }

  private collectRebuildCandidates(): TerrainRebuildCandidate[] {
    const candidates: TerrainRebuildCandidate[] = []

    for (const [bufferKey, buffer] of this.clusterBuffers) {
      if (!buffer.needsRebuild()) {
        continue
      }

      const [clusterKey] = bufferKey.split(':')
      candidates.push({
        clusterKey,
        item: buffer.item,
        deadVertexBytes: buffer.getDeadVertexBytes(),
        liveVertexBytes: buffer.getLiveVertexBytes(),
      })
    }

    candidates.sort((left, right) => {
      const visibleDelta = this.compareVisibleClusterPriority(left.clusterKey, right.clusterKey)
      if (visibleDelta !== 0) {
        return visibleDelta
      }

      const wasteDelta = right.deadVertexBytes - left.deadVertexBytes
      if (wasteDelta !== 0) {
        return wasteDelta
      }

      return left.clusterKey.localeCompare(right.clusterKey) || left.item.localeCompare(right.item)
    })

    return candidates
  }

  private compareVisibleClusterPriority(leftClusterKey: string, rightClusterKey: string) {
    if (this.visibleClusterPriority.size === 0) {
      return 0
    }

    const leftPriority = this.visibleClusterPriority.get(leftClusterKey)
    const rightPriority = this.visibleClusterPriority.get(rightClusterKey)
    const leftVisible = leftPriority !== undefined
    const rightVisible = rightPriority !== undefined
    if (leftVisible === rightVisible) {
      if (!leftVisible || !rightVisible || leftPriority === rightPriority) {
        return 0
      }

      return leftPriority < rightPriority ? -1 : 1
    }

    return leftVisible ? -1 : 1
  }

  private buildSectionUpdates(
    clusterPlan: TerrainClusterUploadPlan,
    itemPlan: TerrainItemUploadPlan,
  ) {
    return itemPlan.updates.map(update => ({
      sectionKey: update.sectionKey,
      vertexBytes: this.rebaseVertexBytesForCluster(
        update.update.key.chunkX,
        update.update.key.chunkZ,
        clusterPlan,
        update.vertexStride,
        update.vertexBytes,
      ),
      indexBytes: update.indexBytes,
      indexMode: update.indexMode,
      vertexStride: update.vertexStride,
      vertexCount: update.vertexCount,
      indexCount: update.indexCount,
    }))
  }

  private buildPacketSectionUpdates(packet: TerrainUploadPacket) {
    return packet.updates.map(update => ({
      sectionKey: update.sectionKey,
      vertexBytes: this.rebaseVertexBytesForPacket(
        update.chunkX,
        update.chunkZ,
        packet,
        update.vertexStride,
        update.vertexBytes,
      ),
      indexBytes: update.indexBytes,
      indexMode: update.indexMode,
      vertexStride: update.vertexStride,
      vertexCount: update.vertexCount,
      indexCount: update.indexCount,
    }))
  }

  private rebaseVertexBytesForCluster(
    chunkX: number,
    chunkZ: number,
    clusterPlan: TerrainClusterUploadPlan,
    vertexStride: number,
    vertexBytes: Uint8Array,
  ) {
    if (vertexBytes.byteLength === 0 || vertexStride !== 32) {
      return vertexBytes
    }

    const clusterOrigin = this.arena.getClusterOriginChunk(clusterPlan.cluster)
    const chunkOffsetX = (chunkX - clusterOrigin.chunkX) * 16
    const chunkOffsetZ = (chunkZ - clusterOrigin.chunkZ) * 16
    if (chunkOffsetX === 0 && chunkOffsetZ === 0) {
      return vertexBytes
    }

    const rebasedBytes = vertexBytes.slice()
    const words = new Uint32Array(
      rebasedBytes.buffer,
      rebasedBytes.byteOffset,
      Math.floor(rebasedBytes.byteLength / 4),
    )

    for (let vertexIndex = 0; vertexIndex < words.length; vertexIndex += 8) {
      words[vertexIndex] = (words[vertexIndex] + chunkOffsetX * 32) >>> 0
      words[vertexIndex + 2] = (words[vertexIndex + 2] + chunkOffsetZ * 32) >>> 0
    }

    return rebasedBytes
  }

  private rebaseVertexBytesForPacket(
    chunkX: number,
    chunkZ: number,
    packet: TerrainUploadPacket,
    vertexStride: number,
    vertexBytes: Uint8Array,
  ) {
    if (vertexBytes.byteLength === 0 || vertexStride !== 32) {
      return vertexBytes
    }

    const clusterOrigin = this.arena.getClusterOriginChunk(packet.cluster)
    const chunkOffsetX = (chunkX - clusterOrigin.chunkX) * 16
    const chunkOffsetZ = (chunkZ - clusterOrigin.chunkZ) * 16
    if (chunkOffsetX === 0 && chunkOffsetZ === 0) {
      return vertexBytes
    }

    const rebasedBytes = vertexBytes.slice()
    const words = new Uint32Array(
      rebasedBytes.buffer,
      rebasedBytes.byteOffset,
      Math.floor(rebasedBytes.byteLength / 4),
    )

    for (let vertexIndex = 0; vertexIndex < words.length; vertexIndex += 8) {
      words[vertexIndex] = (words[vertexIndex] + chunkOffsetX * 32) >>> 0
      words[vertexIndex + 2] = (words[vertexIndex + 2] + chunkOffsetZ * 32) >>> 0
    }

    return rebasedBytes
  }
}
