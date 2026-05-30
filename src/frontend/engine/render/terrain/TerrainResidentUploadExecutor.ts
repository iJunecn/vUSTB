import type { ResidentGeometryBinding } from '@render/backend/IRenderBackend'
import type { TerrainUploadPacket } from './TerrainUploadPacketBuilder'
import type { TerrainClusterUploadPlan } from './TerrainUploadPlanner'
import type { TerrainItem } from './types'

export interface TerrainResidentUploadStats {
  uploadedClusters: number
  uploadedItems: number
  vertexBytes: number
  indexBytes: number
  partialVertexUploadCalls: number
  vertexReallocations: number
  indexBuildMs: number
  rebuildSuggestedItems: number
  committedResidentSlots: number
}

export interface TerrainResidentRebuildStats {
  rebuiltClusters: string[]
  rebuiltItems: number
  vertexBytes: number
  indexBytes: number
  committedResidentSlots: number
}

export interface TerrainResidentRuntimeStats {
  deadVertexBytes: number
  deadIndexBytes: number
  liveVertexBytes: number
  liveIndexBytes: number
  rebuildCandidateItems: number
  topDeadVertexBytes: number
  topDeadClusterKey: string | null
  topDeadItem: TerrainItem | null
}

export interface TerrainResidentUploadExecutionBackend {
  setVisibleClusterPriority(priorities: Iterable<readonly [string, number]> | null): void
  applyPlans(plans: TerrainClusterUploadPlan[]): TerrainResidentUploadStats
  applyPackets(packets: TerrainUploadPacket[]): TerrainResidentUploadStats
  rebuildClusters(maxItems: number): TerrainResidentRebuildStats
  clear(): void
  getResidentGeometryBinding(
    clusterKey: string,
    item: TerrainItem,
    layoutId: string,
    vertexStride: number,
  ): ResidentGeometryBinding | null
  getRuntimeStats(): TerrainResidentRuntimeStats
}

export class TerrainResidentUploadExecutor {
  constructor(private readonly executionBackend: TerrainResidentUploadExecutionBackend) {}

  public setVisibleClusterPriority(priorities: Iterable<readonly [string, number]> | null): void {
    this.executionBackend.setVisibleClusterPriority(priorities)
  }

  public applyPlans(plans: TerrainClusterUploadPlan[]): TerrainResidentUploadStats {
    return this.executionBackend.applyPlans(plans)
  }

  public applyPackets(packets: TerrainUploadPacket[]): TerrainResidentUploadStats {
    return this.executionBackend.applyPackets(packets)
  }

  public rebuildClusters(maxItems: number): TerrainResidentRebuildStats {
    return this.executionBackend.rebuildClusters(maxItems)
  }

  public clear() {
    this.executionBackend.clear()
  }

  public getResidentGeometryBinding(
    clusterKey: string,
    item: TerrainItem,
    layoutId: string,
    vertexStride: number,
  ): ResidentGeometryBinding | null {
    return this.executionBackend.getResidentGeometryBinding(
      clusterKey,
      item,
      layoutId,
      vertexStride,
    )
  }

  public getRuntimeStats(): TerrainResidentRuntimeStats {
    return this.executionBackend.getRuntimeStats()
  }
}
