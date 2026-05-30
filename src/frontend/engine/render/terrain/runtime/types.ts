export type ChunkArtifactItem = 'opaque' | 'decal' | 'translucent'

export type ResidentWorkIntent = 'first-visible' | 'visible-refresh' | 'background-consolidation'

export interface ResidentFrameBudgetPolicy {
  commitBaseRegionsPerFrame: number
  commitMaxRegionsPerFrame: number
  commitBacklogStep: number
  uploadExecBytesBase: number
  uploadExecBytesMax: number
  uploadExecBytesBacklogStep: number
  uploadExecMaxRegionsPerFrame: number
  rebuildMinTargetMs: number
  rebuildTargetMs: number
  rebuildMaxPassesPerFrame: number
  commitQueueSoftRegionLimit: number
  commitQueueHardRegionLimit: number
}

export interface ResidentFrameBudgetDispatchOptions {
  frameBudgetMs: number
  hadIngressWork: boolean
  pendingChunkUploads: number
  policy: ResidentFrameBudgetPolicy
}
