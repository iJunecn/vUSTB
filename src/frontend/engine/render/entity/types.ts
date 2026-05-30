import type { RenderObject } from '@/engine/render/queue/RenderObject'

/**
 * 所有实体域共享的渲染状态契约。
 * 由 world 层实体类的 `getRenderState()` 组装，render 层 bridge/batch 消费。
 */
export interface EntityRenderState {
  id: number
  transform: Float32Array
  bounds: {
    min: Float32Array
    max: Float32Array
  }
  modelPosition: Float32Array
  mainViewVisible: boolean
  castShadow: boolean
  receiveShadow: boolean
  doubleSided: boolean
}

/**
 * 实体渲染组通用接口。
 * 每个子域（character / blockEntity …）需实现此接口来对接 EntityRenderBridge。
 */
export interface EntityRenderGroup<State, DebugInfo = unknown> {
  getRenderObjects(): readonly RenderObject[]
  sync(states: readonly State[]): void
  getCalibrationDebugInfo(index?: number): DebugInfo | null
  dispose(): void
}
