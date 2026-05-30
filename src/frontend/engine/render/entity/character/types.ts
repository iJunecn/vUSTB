import type { EntityRenderGroup, EntityRenderState } from '../types'

export type { CharacterModelType } from './CharacterModelSpec'

export interface CharacterModelDefinition {
  id: number
  skinId: string
  skinUrl?: string
}

export type CharacterTemplateVariant = 'full-body' | 'right-arm'

/**
 * character 域的渲染状态，在通用 EntityRenderState 基础上叠加皮肤、朝向、动画。
 */
export interface CharacterRenderState extends EntityRenderState {
  skinId: string
  yawRadians: number
  animation: Float32Array
}

export type CharacterBatchMode = 'single' | 'instanced'

export interface CharacterRenderGroupDescriptor {
  groupId: string
  objectId: number
  definition: CharacterModelDefinition
  mode: CharacterBatchMode
  templateVariant?: CharacterTemplateVariant
  modelType?: import('./CharacterModelSpec').CharacterModelType
}

export interface CharacterCalibrationDebugInfo {
  skinId: string
  yawDegrees: number
  modelPosition: readonly [number, number, number]
  localBoundsSize: readonly [number, number, number]
  partCount: number
}

export type CharacterRenderGroup = EntityRenderGroup<
  CharacterRenderState,
  CharacterCalibrationDebugInfo
>
