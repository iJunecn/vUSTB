export type RuntimeDebugFlag =
  | 'showMeshBorders'
  | 'showLightNumbers'
  | 'showCutoutDebug'
  | 'showVariantIndices'

// 运行时调试状态快照。
export type RuntimeDebugState = Record<RuntimeDebugFlag, boolean>

export const runtimeDebug: RuntimeDebugState = {
  showMeshBorders: false,
  showLightNumbers: false,
  showCutoutDebug: false,
  showVariantIndices: false,
}

// 设置单个调试开关。
export function setRuntimeDebugFlag(flag: RuntimeDebugFlag, enabled: boolean) {
  runtimeDebug[flag] = enabled
}

// 翻转单个调试开关，并返回翻转后的状态。
export function toggleRuntimeDebugFlag(flag: RuntimeDebugFlag) {
  runtimeDebug[flag] = !runtimeDebug[flag]
  return runtimeDebug[flag]
}

// 重置全部调试开关。
export function resetRuntimeDebugFlags() {
  for (const flag of Object.keys(runtimeDebug) as RuntimeDebugFlag[]) {
    runtimeDebug[flag] = false
  }
}

export function toggleShowMeshBorders() {
  return toggleRuntimeDebugFlag('showMeshBorders')
}

export function toggleShowLightNumbers() {
  return toggleRuntimeDebugFlag('showLightNumbers')
}

export function toggleShowCutoutDebug() {
  return toggleRuntimeDebugFlag('showCutoutDebug')
}

export function toggleShowVariantIndices() {
  return toggleRuntimeDebugFlag('showVariantIndices')
}
