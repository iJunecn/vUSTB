import { TerrainResidentUploadExecutor } from '@render/terrain/TerrainResidentUploadExecutor'
import type { TerrainResidentCommitSource } from '@render/terrain/types'
import type { ChunkArtifactItem } from './types'
import type { CommitWorkItem, PendingResidentCommitState } from './internals'

export function processRebuildWorkImpl(
  residentUploadExecutor: TerrainResidentUploadExecutor,
  queueResidentCommit: (
    clusterKey: string,
    dirtyItems: ReadonlySet<ChunkArtifactItem> | null,
    commitSource: TerrainResidentCommitSource,
    estimatedCost: number,
  ) => void,
  estimateRebuildCommitCost: (clusterKey: string) => number,
  maxItems: number,
): number {
  if (maxItems <= 0) {
    return 0
  }

  const rebuildStats = residentUploadExecutor.rebuildClusters(maxItems)

  for (const clusterKey of rebuildStats.rebuiltClusters) {
    queueResidentCommit(clusterKey, null, 'upload', estimateRebuildCommitCost(clusterKey))
  }

  return rebuildStats.rebuiltItems
}

export function processResidentCommitWorkImpl(
  readyResidentCommits: Map<string, PendingResidentCommitState>,
  getCommitWorkItems: (
    queue: ReadonlyMap<string, PendingResidentCommitState>,
    now: number,
  ) => CommitWorkItem[],
  commitCluster: (clusterKey: string, state: PendingResidentCommitState) => void,
  invalidateCaches: () => void,
  maxClusters: number = Number.POSITIVE_INFINITY,
): number {
  if (maxClusters <= 0 || readyResidentCommits.size === 0) {
    return 0
  }

  let committedClusters = 0
  const orderedReadyCommits = getCommitWorkItems(readyResidentCommits, performance.now())

  for (const item of orderedReadyCommits) {
    const state = readyResidentCommits.get(item.clusterKey)
    if (!state) {
      continue
    }

    if (committedClusters >= maxClusters) {
      break
    }

    commitCluster(item.clusterKey, state)
    readyResidentCommits.delete(item.clusterKey)
    committedClusters += 1
  }

  if (committedClusters > 0) {
    invalidateCaches()
  }

  return committedClusters
}

export function sealResidentCommitsImpl(
  pendingResidentCommits: Map<string, PendingResidentCommitState>,
  readyResidentCommits: Map<string, PendingResidentCommitState>,
  mergeResidentCommitState: (
    target: PendingResidentCommitState,
    dirtyItems: ReadonlySet<ChunkArtifactItem> | null,
    commitSource: TerrainResidentCommitSource,
    estimatedCost: number,
  ) => void,
): void {
  if (pendingResidentCommits.size === 0) {
    return
  }

  for (const [clusterKey, state] of pendingResidentCommits) {
    const existingReady = readyResidentCommits.get(clusterKey)
    if (!existingReady) {
      readyResidentCommits.set(clusterKey, {
        dirtyItems: state.dirtyItems ? new Set(state.dirtyItems) : null,
        commitSource: state.commitSource,
        estimatedCost: state.estimatedCost,
        enqueuedAtMs: state.enqueuedAtMs,
      })
      continue
    }

    mergeResidentCommitState(
      existingReady,
      state.dirtyItems,
      state.commitSource,
      state.estimatedCost,
    )
  }

  pendingResidentCommits.clear()
}

export function queueResidentCommitImpl(
  readyResidentCommits: Map<string, PendingResidentCommitState>,
  pendingResidentCommits: Map<string, PendingResidentCommitState>,
  mergeResidentCommitState: (
    target: PendingResidentCommitState,
    dirtyItems: ReadonlySet<ChunkArtifactItem> | null,
    commitSource: TerrainResidentCommitSource,
    estimatedCost: number,
  ) => void,
  clusterKey: string,
  dirtyItems: ReadonlySet<ChunkArtifactItem> | null,
  commitSource: TerrainResidentCommitSource,
  estimatedCost: number,
) {
  const existingReady = readyResidentCommits.get(clusterKey)
  if (existingReady) {
    mergeResidentCommitState(existingReady, dirtyItems, commitSource, estimatedCost)
    return
  }

  const existing = pendingResidentCommits.get(clusterKey)
  if (!existing) {
    pendingResidentCommits.set(clusterKey, {
      dirtyItems: dirtyItems ? new Set(dirtyItems) : null,
      commitSource,
      estimatedCost,
      enqueuedAtMs: performance.now(),
    })
    return
  }

  mergeResidentCommitState(existing, dirtyItems, commitSource, estimatedCost)
}

export function mergeResidentCommitStateImpl(
  target: PendingResidentCommitState,
  dirtyItems: ReadonlySet<ChunkArtifactItem> | null,
  _commitSource: TerrainResidentCommitSource,
  estimatedCost: number,
) {
  target.commitSource = 'upload'
  target.estimatedCost = Math.max(target.estimatedCost, estimatedCost)

  if (target.dirtyItems === null || dirtyItems === null) {
    target.dirtyItems = null
    return
  }

  for (const item of dirtyItems) {
    target.dirtyItems.add(item)
  }
}
