import { TerrainClusterArena } from './TerrainClusterArena'
import { TerrainUploadPlanner, type TerrainClusterUploadPlan } from './TerrainUploadPlanner'
import {
  createChunkArtifactEnvelopePayloadResolver,
  getChunkArtifactPayloadArenaReleaseHandles,
  resolveChunkArtifactDescriptor,
} from '@/engine/world/chunk/domain'
import {
  createTerrainSectionKey,
  getArtifactDescriptorSectionsByKey,
  terrainSectionKeyToString,
  type TerrainChunkBuildArtifactInput,
  type TerrainSectionKey,
  type TerrainPendingClusterUpload,
} from './types'

/**
 * @file TerrainUploadCoordinator.ts
 * @brief 地形上传协调器
 *
 * 说明：
 *  - 将区块构建产物转换为显存上传计划
 *  - 负责在 `TerrainClusterArena` 中登记更新与移除
 *  - 产出描述性的 `TerrainClusterUploadPlan` 供执行层消费
 */
export class TerrainUploadCoordinator {
  private readonly planner = new TerrainUploadPlanner()

  constructor(private readonly arena: TerrainClusterArena) {}

  /**
   * 提交区块构建产物到暂存区。
   */
  public stageArtifact(
    artifact: TerrainChunkBuildArtifactInput,
    dirtySectionYs?: number[],
  ): TerrainPendingClusterUpload[] {
    const descriptor = resolveChunkArtifactDescriptor(artifact)
    if (!descriptor) {
      return []
    }

    const resolver = createChunkArtifactEnvelopePayloadResolver(artifact)
    const artifactSections = getArtifactDescriptorSectionsByKey(artifact)

    if (dirtySectionYs && dirtySectionYs.length > 0) {
      for (const sectionY of dirtySectionYs) {
        const key = createTerrainSectionKey(descriptor.chunkX, sectionY, descriptor.chunkZ)
        const sectionKey = terrainSectionKeyToString(key)
        const sectionDescriptor = artifactSections.get(sectionKey)
        if (sectionDescriptor) {
          this.arena.stageSectionUpdate({
            key,
            descriptor: sectionDescriptor,
            resolver,
            artifactVersion: sectionDescriptor.buildVersion,
          })
        } else {
          this.arena.stageSectionRemoval(key)
        }
      }
    } else {
      for (const sectionDescriptor of descriptor.sections) {
        const key = createTerrainSectionKey(
          sectionDescriptor.chunkX,
          sectionDescriptor.sectionY,
          sectionDescriptor.chunkZ,
        )
        this.arena.stageSectionUpdate({
          key,
          descriptor: sectionDescriptor,
          resolver,
          artifactVersion: sectionDescriptor.buildVersion,
        })
      }
    }

    const uploads = this.arena.drainPendingUploads()
    if (uploads.length > 0) {
      const payloadArenaReleaseHandles = getChunkArtifactPayloadArenaReleaseHandles(artifact)
      // Attach release handles only to the first upload to avoid duplicate release messages
      // when a single chunk artifact spans multiple clusters.
      uploads[0].payloadArenaReleaseHandles.push(...payloadArenaReleaseHandles)
    }
    return uploads
  }

  public removeChunk(chunkX: number, chunkZ: number): TerrainPendingClusterUpload[] {
    this.arena.removeChunk(chunkX, chunkZ)
    return this.arena.drainPendingUploads()
  }

  public stageSectionRemoval(key: TerrainSectionKey): TerrainPendingClusterUpload[] {
    this.arena.stageSectionRemoval(key)
    return this.arena.drainPendingUploads()
  }

  public clear(): void {
    this.arena.clear()
  }

  public buildUploadPlan(uploads: TerrainPendingClusterUpload[]): TerrainClusterUploadPlan[] {
    return this.planner.build(uploads)
  }
}
