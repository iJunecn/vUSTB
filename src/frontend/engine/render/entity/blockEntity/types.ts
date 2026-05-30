import type { EntityRenderGroup, EntityRenderState } from '../types'

/**
 * blockEntity 域的渲染状态，在通用 EntityRenderState 基础上叠加方块类型与朝向。
 */
export interface BlockEntityRenderState extends EntityRenderState {
  blockType: string
  facing: number
}

export type BlockEntityRenderGroupDescriptor = {
  groupId: string
  objectId: number
  blockType: string
}

export type BlockEntityCalibrationDebugInfo = {
  blockType: string
  facing: number
  modelPosition: readonly [number, number, number]
}

export type BlockEntityRenderGroup = EntityRenderGroup<
  BlockEntityRenderState,
  BlockEntityCalibrationDebugInfo
>
