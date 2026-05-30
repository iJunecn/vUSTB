import type { EngineRuntimeConfigPatch } from '@/config/runtime'
import type { EngineRuntimeConfigApplyResult } from '@/engine/runtime/EngineRuntimeConfigApplier'

/**
 * @file EngineRuntimeConfigHostBridge.ts
 * @brief 运行时配置宿主桥接层
 *
 * 说明：
 *  - 在运行时配置系统与宿主层之间建立可注册、可释放的应用入口
 *  - 由宿主层提供实际补丁应用函数，运行时侧只做转发
 *  - 当没有活跃宿主时返回 `null`，由上层决定回退策略
 */

type EngineRuntimeConfigApplyHandler = (
  patch: EngineRuntimeConfigPatch,
) => EngineRuntimeConfigApplyResult

let activeRuntimeConfigApplyHandler: EngineRuntimeConfigApplyHandler | null = null

export function registerEngineRuntimeConfigHost(handler: EngineRuntimeConfigApplyHandler) {
  activeRuntimeConfigApplyHandler = handler

  return () => {
    if (activeRuntimeConfigApplyHandler === handler) {
      activeRuntimeConfigApplyHandler = null
    }
  }
}

export function applyEngineRuntimeConfigThroughHost(patch: EngineRuntimeConfigPatch) {
  if (!activeRuntimeConfigApplyHandler) {
    return null
  }

  return activeRuntimeConfigApplyHandler(patch)
}

export function hasActiveEngineRuntimeConfigHost() {
  return activeRuntimeConfigApplyHandler !== null
}
