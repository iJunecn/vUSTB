import type { DrawCallPassName } from '@/engine/render/debug/DrawCallStats'

// 单帧性能快照。
export type PerformanceSnapshot = {
  avgCpuMs: number
  cpuFps: number
  avgGpuMs: number | null
  gpuFps: number | null
  hasGpuTiming: boolean
}

export type RuntimeDebugSnapshot = {
  scene: {
    renderMotionAnchorPosition: readonly [number, number, number]
    renderCameraEyePosition: readonly [number, number, number]
    renderCameraViewPosition: readonly [number, number, number]
    timeHours: number
  }
  streaming: {
    chunkLoadedRate: number
    chunkUpdatedRate: number
    chunkGrowthRate: number
    activeRequests: number
    queuedRequests: number
    currentQueue: number
    pendingChunkUploads: number
    artifactChunkCount: number
    artifactSectionCount: number
    artifactItemCount: number
    dirtyChunkCount: number
    dirtySectionCount: number
  }
  worker: {
    meshCompletedPerSec: number
    meshArenaDeliveredPerSec: number
    meshTransferableDeliveredPerSec: number
    arenaPoolActiveCount: number
    arenaPooledCount: number
    arenaPoolHitRate: number
    avgMeshTimeMs: number
    avgMeshWasmTimeMs: number
    avgMeshNormalizeTimeMs: number
    avgMeshBuildTimeMs: number
  }
  render: {
    visibleOpaqueCount: number
    visibleDecalCount: number
    visibleTransparentCount: number
    drawStats: {
      total: number
      drawArrays: number
      drawElements: number
      byPass: Record<DrawCallPassName, number>
    }
    totalLightCount: number
    selectedLightCount: number
    csmMs: number
    lightsMs: number
    meshUploadMs: number
    cullMs: number
    renderMs: number
    shadow: {
      resolution: number
      texelSize: number
      near: number
      far: number
      range: number
    } | null
  }
  player: {
    skinId: string
    yawDegrees: number
    localBoundsSize: readonly [number, number, number]
    modelPosition: readonly [number, number, number]
    partCount: number
  } | null
}

export type RuntimeDebugEntry = {
  label: string
  value: string
}

// 把 draw pass 分布压成简短字符串，便于 HUD 单行显示。
function buildDrawPassBreakdown(snapshot: RuntimeDebugSnapshot) {
  const byPass = snapshot.render.drawStats.byPass
  return [
    byPass.shadow > 0 ? `sh:${byPass.shadow}` : '',
    byPass['depth-prepass'] > 0 ? `dp:${byPass['depth-prepass']}` : '',
    byPass.geometry > 0 ? `gb:${byPass.geometry}` : '',
    byPass.ssao > 0 ? `ao:${byPass.ssao}` : '',
    byPass['point-shadow'] > 0 ? `ps:${byPass['point-shadow']}` : '',
    byPass.lighting > 0 ? `li:${byPass.lighting}` : '',
    byPass.forward > 0 ? `fw:${byPass.forward}` : '',
    byPass['forward-composite'] > 0 ? `fc:${byPass['forward-composite']}` : '',
    byPass.postprocess > 0 ? `pp:${byPass.postprocess}` : '',
    byPass.ui > 0 ? `ui:${byPass.ui}` : '',
    byPass.unknown > 0 ? `uk:${byPass.unknown}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * 把运行时快照格式化为 HUD 条目数组。
 * 若 runtime 为空，返回空数组，调用方可直接判定为无可显示调试信息。
 */
export function buildRuntimeDebugEntries(
  runtime: RuntimeDebugSnapshot | null,
  performance: PerformanceSnapshot | null,
): RuntimeDebugEntry[] {
  if (!runtime) {
    return []
  }

  const entries: RuntimeDebugEntry[] = []

  if (performance) {
    entries.push({
      label: 'CPU',
      value: `${performance.avgCpuMs.toFixed(2)} ms (~${performance.cpuFps.toFixed(1)} fps)`,
    })
    entries.push({
      label: 'GPU',
      value:
        performance.hasGpuTiming && performance.avgGpuMs != null && performance.gpuFps != null
          ? `${performance.avgGpuMs.toFixed(2)} ms (~${performance.gpuFps.toFixed(1)} fps)`
          : 'N/A',
    })
  }

  entries.push({
    label: 'Anchor/Eye/View',
    value: `a=${runtime.scene.renderMotionAnchorPosition[0]},${runtime.scene.renderMotionAnchorPosition[1]},${runtime.scene.renderMotionAnchorPosition[2]}  e=${runtime.scene.renderCameraEyePosition[0]},${runtime.scene.renderCameraEyePosition[1]},${runtime.scene.renderCameraEyePosition[2]}  v=${runtime.scene.renderCameraViewPosition[0]},${runtime.scene.renderCameraViewPosition[1]},${runtime.scene.renderCameraViewPosition[2]}  Time: ${runtime.scene.timeHours.toFixed(1)}h`,
  })
  entries.push({
    label: 'Chunks',
    value: `Load/Upd/Grow: ${runtime.streaming.chunkLoadedRate.toFixed(1)}/${runtime.streaming.chunkUpdatedRate.toFixed(1)}/${runtime.streaming.chunkGrowthRate.toFixed(1)} chunk/s  Req: ${runtime.streaming.activeRequests}/${runtime.streaming.queuedRequests}/${runtime.streaming.currentQueue}`,
  })
  entries.push({
    label: 'Artifacts C/S/I',
    value: `${runtime.streaming.artifactChunkCount}/${runtime.streaming.artifactSectionCount}/${runtime.streaming.artifactItemCount}  Dirty: ${runtime.streaming.dirtyChunkCount}/${runtime.streaming.dirtySectionCount}  Pending: ${runtime.streaming.pendingChunkUploads}`,
  })
  entries.push({
    label: 'Worker Mesh/s',
    value: `${runtime.worker.meshCompletedPerSec.toFixed(1)} (A:${runtime.worker.meshArenaDeliveredPerSec.toFixed(1)}/T:${runtime.worker.meshTransferableDeliveredPerSec.toFixed(1)})  Pool:${runtime.worker.arenaPoolActiveCount}a/${runtime.worker.arenaPooledCount}p/${(runtime.worker.arenaPoolHitRate * 100).toFixed(0)}%  Avg: ${runtime.worker.avgMeshTimeMs.toFixed(1)}ms  W/N/B: ${runtime.worker.avgMeshWasmTimeMs.toFixed(1)}/${runtime.worker.avgMeshNormalizeTimeMs.toFixed(1)}/${runtime.worker.avgMeshBuildTimeMs.toFixed(1)}ms`,
  })
  entries.push({
    label: 'Visible O/D/T',
    value: `${runtime.render.visibleOpaqueCount}/${runtime.render.visibleDecalCount}/${runtime.render.visibleTransparentCount}  DrawCalls T/A/E: ${runtime.render.drawStats.total}/${runtime.render.drawStats.drawArrays}/${runtime.render.drawStats.drawElements}  ByPass: ${buildDrawPassBreakdown(runtime) || 'none'}`,
  })
  entries.push({
    label: 'Lights Agg/Sel',
    value: `${runtime.render.totalLightCount}/${runtime.render.selectedLightCount}`,
  })
  entries.push({
    label: '[Frame] csm',
    value: `${runtime.render.csmMs.toFixed(1)} lights:${runtime.render.lightsMs.toFixed(1)} mesh:${runtime.render.meshUploadMs.toFixed(1)} cull:${runtime.render.cullMs.toFixed(1)} render:${runtime.render.renderMs.toFixed(1)}`,
  })

  if (runtime.render.shadow) {
    entries.push({
      label: 'Shadow',
      value: `res=${runtime.render.shadow.resolution} texel=${runtime.render.shadow.texelSize.toFixed(4)} near=${runtime.render.shadow.near.toFixed(2)} far=${runtime.render.shadow.far.toFixed(2)} range=${runtime.render.shadow.range.toFixed(2)}`,
    })
  }

  if (runtime.player) {
    entries.push({
      label: 'Player',
      value: `skin=${runtime.player.skinId} yaw=${runtime.player.yawDegrees.toFixed(1)}deg bounds=${runtime.player.localBoundsSize[0].toFixed(2)}/${runtime.player.localBoundsSize[1].toFixed(2)}/${runtime.player.localBoundsSize[2].toFixed(2)} model=${runtime.player.modelPosition[0]},${runtime.player.modelPosition[1]},${runtime.player.modelPosition[2]} parts=${runtime.player.partCount}`,
    })
  }

  return entries
}

// 把条目列表拍平成多行文本输出。
export function formatRuntimeDebugOutput(
  runtime: RuntimeDebugSnapshot | null,
  performance: PerformanceSnapshot | null,
) {
  const entries = buildRuntimeDebugEntries(runtime, performance)
  if (entries.length === 0) {
    return 'null'
  }

  return entries.map(entry => `${entry.label}: ${entry.value}`).join('\n')
}
