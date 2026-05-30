import type { EngineRuntimeConfigPatch } from '@/config/runtime'

/**
 * @file EngineRuntimeConfigApplier.ts
 * @brief 运行时配置补丁分类工具
 *
 * 说明：
 *  - 将运行时配置补丁归类为具体动作结果
 *  - 让上层只消费动作类型，而不直接耦合 patch 结构
 *  - 作为 `useEngine` 与宿主桥之间的纯函数判断层
 */

export type EngineRuntimeConfigApplyResult = {
  controlsUpdated: boolean
  chunkReloadRequested: boolean
  engineRefreshRequested: boolean
}

export function createEmptyRuntimeConfigApplyResult(): EngineRuntimeConfigApplyResult {
  return {
    controlsUpdated: false,
    chunkReloadRequested: false,
    engineRefreshRequested: false,
  }
}

export function mergeRuntimeConfigApplyResult(
  target: EngineRuntimeConfigApplyResult,
  partial: Partial<EngineRuntimeConfigApplyResult>,
) {
  target.controlsUpdated = target.controlsUpdated || partial.controlsUpdated === true
  target.chunkReloadRequested = target.chunkReloadRequested || partial.chunkReloadRequested === true
  target.engineRefreshRequested =
    target.engineRefreshRequested || partial.engineRefreshRequested === true
  return target
}

export function classifyRuntimeConfigPatch(
  patch: EngineRuntimeConfigPatch,
): EngineRuntimeConfigApplyResult {
  const result = createEmptyRuntimeConfigApplyResult()

  if (patch.controls) {
    result.controlsUpdated = true
  }

  if (
    patch.lighting?.enableVertexLighting !== undefined ||
    patch.lighting?.enableSmoothLighting !== undefined
  ) {
    result.engineRefreshRequested = true
  }

  return result
}
