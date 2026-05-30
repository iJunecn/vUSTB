import { TerrainResidentUploadExecutor } from '@render/terrain/TerrainResidentUploadExecutor'
import type { ResidentFrameBudgetPolicy, ResidentWorkIntent } from './types'
import type {
  CommitWorkItem,
  PendingResidentCommitState,
  QueuedResidentUploadState,
  UploadWorkItem,
} from './internals'
import { sortCommitWorkItems, sortUploadWorkItems } from './internals'

export interface BridgeSchedulerState {
  uploadCount: number
  uploadVisibleCount: number
  uploadBackgroundCount: number
  rebuildHasWork: boolean
  rebuildCandidateItems: number
  rebuildOldestAgeMs: number
  rebuildDeferredFrames: number
  rebuildEstimatedCost: number
}

export function getSchedulerStateImpl(
  residentUploadExecutor: TerrainResidentUploadExecutor,
  pendingResidentUploads: Map<string, QueuedResidentUploadState>,
  getResidentWorkIntent: (clusterKey: string) => ResidentWorkIntent,
  estimateRebuildBacklogCost: (
    runtimeStats: ReturnType<TerrainResidentUploadExecutor['getRuntimeStats']>,
  ) => number,
  rebuildBacklogSinceMs: number | null,
  rebuildDeferredFrames: number,
  now: number,
) {
  const runtimeStats = residentUploadExecutor.getRuntimeStats()
  const rebuildHasWork = runtimeStats.rebuildCandidateItems > 0
  let nextRebuildBacklogSinceMs = rebuildBacklogSinceMs
  let nextRebuildDeferredFrames = rebuildDeferredFrames

  if (rebuildHasWork) {
    nextRebuildBacklogSinceMs ??= now
  } else {
    nextRebuildBacklogSinceMs = null
    nextRebuildDeferredFrames = 0
  }

  let uploadCount = 0
  let uploadVisibleCount = 0
  let uploadBackgroundCount = 0
  for (const upload of pendingResidentUploads.values()) {
    uploadCount += 1
    const intent = getResidentWorkIntent(upload.clusterKey)
    if (intent === 'background-consolidation') {
      uploadBackgroundCount += 1
    } else {
      uploadVisibleCount += 1
    }
  }

  const state: BridgeSchedulerState = {
    uploadCount,
    uploadVisibleCount,
    uploadBackgroundCount,
    rebuildHasWork,
    rebuildCandidateItems: runtimeStats.rebuildCandidateItems,
    rebuildOldestAgeMs: nextRebuildBacklogSinceMs === null ? 0 : now - nextRebuildBacklogSinceMs,
    rebuildDeferredFrames: nextRebuildDeferredFrames,
    rebuildEstimatedCost: rebuildHasWork ? estimateRebuildBacklogCost(runtimeStats) : 0,
  }

  return {
    state,
    rebuildBacklogSinceMs: nextRebuildBacklogSinceMs,
    rebuildDeferredFrames: nextRebuildDeferredFrames,
  }
}

export function buildUploadWorkItems(
  pendingResidentUploads: Map<string, QueuedResidentUploadState>,
  now: number,
  getResidentWorkIntent: (clusterKey: string) => ResidentWorkIntent,
  getQueuedTaskAgeMs: (enqueuedAtMs: number, now: number) => number,
): UploadWorkItem[] {
  const items: UploadWorkItem[] = []

  for (const upload of pendingResidentUploads.values()) {
    const intent = getResidentWorkIntent(upload.clusterKey)
    items.push({
      clusterKey: upload.clusterKey,
      visible: intent !== 'background-consolidation',
      intent,
      estimatedBytes: upload.estimatedBytes,
      estimatedCost: upload.estimatedCost,
      ageMs: getQueuedTaskAgeMs(upload.enqueuedAtMs, now),
    })
  }

  items.sort(sortUploadWorkItems)
  return items
}

export function buildCommitWorkItems(
  queue: ReadonlyMap<string, PendingResidentCommitState>,
  now: number,
  getResidentWorkIntent: (clusterKey: string) => ResidentWorkIntent,
  estimateCommitTaskCost: (clusterKey: string, state: PendingResidentCommitState) => number,
  getQueuedTaskAgeMs: (enqueuedAtMs: number, now: number) => number,
): CommitWorkItem[] {
  const items: CommitWorkItem[] = []

  for (const [clusterKey, state] of queue) {
    const intent = getResidentWorkIntent(clusterKey)
    items.push({
      clusterKey,
      visible: intent !== 'background-consolidation',
      intent,
      commitSource: state.commitSource,
      estimatedCost: estimateCommitTaskCost(clusterKey, state),
      ageMs: getQueuedTaskAgeMs(state.enqueuedAtMs, now),
    })
  }

  items.sort(sortCommitWorkItems)
  return items
}

export function computeRebuildStarvationScore(state: BridgeSchedulerState): number {
  let score = state.rebuildDeferredFrames * 2
  score += Math.floor(state.rebuildOldestAgeMs / 500)
  score += Math.min(4, Math.floor(state.rebuildEstimatedCost / 4))
  if (state.rebuildCandidateItems > 0) {
    score += 1
  }
  return score
}

export function computeReservedBackgroundBudgetMs(
  state: BridgeSchedulerState,
  policy: ResidentFrameBudgetPolicy,
  remainingBudgetMs: number,
  commitBacklog: number,
  pendingChunkUploads: number,
): number {
  if (remainingBudgetMs <= 0) {
    return 0
  }

  let reservedBudgetMs = 0
  const starvationScore = computeRebuildStarvationScore(state)
  if (state.rebuildHasWork && remainingBudgetMs - reservedBudgetMs >= policy.rebuildMinTargetMs) {
    const threshold =
      commitBacklog >= policy.commitQueueSoftRegionLimit || pendingChunkUploads > 0 ? 5 : 3
    if (starvationScore >= threshold) {
      reservedBudgetMs += policy.rebuildMinTargetMs
    }
  }

  return Math.min(remainingBudgetMs, reservedBudgetMs)
}

export function scaleUploadByteBudget(
  uploadByteBudget: number,
  remainingBudgetMs: number,
  reservedBackgroundBudgetMs: number,
): number {
  if (uploadByteBudget <= 0 || remainingBudgetMs <= 0) {
    return 0
  }
  const foregroundBudgetMs = Math.max(0, remainingBudgetMs - reservedBackgroundBudgetMs)
  if (foregroundBudgetMs <= 0) {
    return 0
  }
  const scale = Math.max(0.25, Math.min(1, foregroundBudgetMs / remainingBudgetMs))
  return Math.floor(uploadByteBudget * scale)
}

export function computeBgUploadByteBudget(
  totalUploadByteBudget: number,
  state: BridgeSchedulerState,
  reservedBackgroundBudgetMs: number,
  remainingBudgetMs: number,
): number {
  if (totalUploadByteBudget <= 0 || remainingBudgetMs <= 0 || state.uploadBackgroundCount <= 0) {
    return 0
  }
  if (state.uploadVisibleCount === 0) {
    return totalUploadByteBudget
  }
  if (reservedBackgroundBudgetMs <= 0) {
    return 0
  }
  const backgroundTimeShare = Math.max(
    0,
    Math.min(1, reservedBackgroundBudgetMs / Math.max(remainingBudgetMs, 0.0001)),
  )
  const backgroundBacklogShare =
    state.uploadCount > 0 ? state.uploadBackgroundCount / state.uploadCount : 0
  const allocationShare = Math.max(backgroundTimeShare, backgroundBacklogShare * 0.5)
  return Math.max(
    0,
    Math.min(totalUploadByteBudget, Math.floor(totalUploadByteBudget * allocationShare)),
  )
}
