import type { ResidentFrameBudgetDispatchOptions } from './types'
import type { BridgeSchedulerState } from './scheduling'

type UploadPhaseResult = {
  processedClusters: number
  consumedBytes: number
}

export interface DispatchResidentFrameBudgetContext {
  getSchedulerState(now: number): BridgeSchedulerState
  getReadyResidentCommitCount(): number
  getPendingResidentCommitCount(): number
  computeReservedBackgroundBudgetMs(
    state: BridgeSchedulerState,
    policy: ResidentFrameBudgetDispatchOptions['policy'],
    remainingBudgetMs: number,
    commitBacklog: number,
    pendingChunkUploads: number,
  ): number
  scaleUploadByteBudget(
    uploadByteBudget: number,
    remainingBudgetMs: number,
    reservedBackgroundBudgetMs: number,
  ): number
  computeBgUploadByteBudget(
    totalUploadByteBudget: number,
    state: BridgeSchedulerState,
    reservedBackgroundBudgetMs: number,
    remainingBudgetMs: number,
  ): number
  processResidentUploadWork(
    maxBytes: number,
    maxClusters: number,
    mode: 'all' | 'foreground' | 'background' | 'first-visible' | 'visible-refresh',
  ): UploadPhaseResult
  sealResidentCommits(): void
  processResidentCommitWork(maxClusters: number): number
  computeRebuildStarvationScore(state: BridgeSchedulerState): number
  processRebuildWork(maxItems: number): number
  onRebuildProcessed(rebuiltItems: number): void
  onRebuildDeferred(): void
}

export function dispatchResidentFrameBudgetImpl(
  context: DispatchResidentFrameBudgetContext,
  options: ResidentFrameBudgetDispatchOptions,
): void {
  const start = performance.now()
  const { policy } = options

  const schedulerState = context.getSchedulerState(start)
  const commitBacklog =
    context.getReadyResidentCommitCount() + context.getPendingResidentCommitCount()

  let remainingBudgetMs = Math.max(0, options.frameBudgetMs)
  const reservedBackgroundBudgetMs = context.computeReservedBackgroundBudgetMs(
    schedulerState,
    policy,
    remainingBudgetMs,
    commitBacklog,
    options.pendingChunkUploads,
  )

  const residentUploadByteBudget = context.scaleUploadByteBudget(
    Math.min(
      policy.uploadExecBytesMax,
      policy.uploadExecBytesBase +
        Math.floor(schedulerState.uploadCount / policy.uploadExecBytesBacklogStep) *
          policy.uploadExecBytesBase,
    ),
    remainingBudgetMs,
    reservedBackgroundBudgetMs,
  )
  const backgroundUploadByteBudget = context.computeBgUploadByteBudget(
    residentUploadByteBudget,
    schedulerState,
    reservedBackgroundBudgetMs,
    remainingBudgetMs,
  )
  const foregroundUploadByteBudget = Math.max(
    0,
    residentUploadByteBudget - backgroundUploadByteBudget,
  )

  const firstVisible = context.processResidentUploadWork(
    foregroundUploadByteBudget,
    policy.uploadExecMaxRegionsPerFrame,
    'first-visible',
  )
  const refreshByteBudget = Math.max(0, foregroundUploadByteBudget - firstVisible.consumedBytes)
  const refreshClusterBudget = Math.max(
    0,
    policy.uploadExecMaxRegionsPerFrame - firstVisible.processedClusters,
  )
  const visibleRefresh = context.processResidentUploadWork(
    refreshByteBudget,
    refreshClusterBudget,
    'visible-refresh',
  )
  const fgClusters = firstVisible.processedClusters + visibleRefresh.processedClusters
  const bgClusterBudget = Math.max(0, policy.uploadExecMaxRegionsPerFrame - fgClusters)
  const background = context.processResidentUploadWork(
    backgroundUploadByteBudget,
    bgClusterBudget,
    'background',
  )

  const hadUploadWork =
    firstVisible.processedClusters +
      visibleRefresh.processedClusters +
      background.processedClusters >
    0

  context.sealResidentCommits()

  const commitBudget = Math.max(
    policy.commitBaseRegionsPerFrame,
    Math.min(
      policy.commitMaxRegionsPerFrame,
      policy.commitBaseRegionsPerFrame +
        Math.floor(context.getReadyResidentCommitCount() / policy.commitBacklogStep),
    ),
  )
  const committedClusters = context.processResidentCommitWork(commitBudget)

  const hadForegroundWork = options.hadIngressWork || committedClusters > 0 || hadUploadWork
  remainingBudgetMs = Math.max(0, options.frameBudgetMs - (performance.now() - start))

  const rebuildStarvationScore = context.computeRebuildStarvationScore(schedulerState)
  const rebuildStarved = rebuildStarvationScore >= 6
  const deferRebuildForChunkLoading = options.pendingChunkUploads > 0 && !rebuildStarved
  if (
    schedulerState.rebuildHasWork &&
    !deferRebuildForChunkLoading &&
    (remainingBudgetMs >= policy.rebuildMinTargetMs || (rebuildStarved && remainingBudgetMs > 0)) &&
    (!hadForegroundWork || rebuildStarved || rebuildStarvationScore >= 3)
  ) {
    const effectiveRebuildTargetMs = Math.max(
      policy.rebuildMinTargetMs,
      policy.rebuildTargetMs / Math.max(1, Math.min(3, 1 + rebuildStarvationScore)),
    )
    let rebuildItemBudget = Math.max(
      1,
      Math.min(
        policy.rebuildMaxPassesPerFrame,
        Math.floor(remainingBudgetMs / effectiveRebuildTargetMs),
      ),
    )

    const commitQueueHardLimit = Math.max(
      policy.commitQueueSoftRegionLimit,
      policy.commitQueueHardRegionLimit,
    )
    const postCommitBacklog =
      context.getReadyResidentCommitCount() + context.getPendingResidentCommitCount()
    if (postCommitBacklog >= commitQueueHardLimit && !rebuildStarved) {
      rebuildItemBudget = 0
    } else if (postCommitBacklog >= policy.commitQueueSoftRegionLimit && !rebuildStarved) {
      rebuildItemBudget = Math.min(
        rebuildItemBudget,
        Math.max(0, commitQueueHardLimit - postCommitBacklog),
      )
    }

    if (rebuildStarved) {
      rebuildItemBudget = Math.max(1, rebuildItemBudget)
    }

    const rebuiltItems = context.processRebuildWork(rebuildItemBudget)
    context.onRebuildProcessed(rebuiltItems)
  } else if (schedulerState.rebuildHasWork) {
    context.onRebuildDeferred()
  }
}
