import { mat4 } from '@/engine/render/utils/math'
import {
  Entity,
  clamp,
  copyVec3,
  computeYawRadians,
  computePitchRadians,
  type Vec3Like,
} from '../Entity'
import type { CharacterRenderState } from '@/engine/render/entity/character/types'

export type { CharacterRenderState } from '@/engine/render/entity/character/types'

export { clamp, copyVec3, transformPoint, computeYawRadians, computePitchRadians } from '../Entity'
export type { Vec3Like } from '../Entity'

export type CharacterDriverState = {
  dtSeconds: number
  position: Vec3Like
  lookTarget: Vec3Like
  animationOverride?: ArrayLike<number> | null
}

export type CharacterInitializationState = {
  position: Vec3Like
  lookTarget: Vec3Like
}

export type CharacterDefinition = {
  id: number
  skinId: string
  skinUrl: string
  modelType?: import('@/engine/render/entity/character/CharacterModelSpec').CharacterModelType
}

export type CharacterOptions = {
  modelScale?: number
  rotateWithPitch?: boolean
}

export type CharacterCalibrationDebugInfo = {
  skinUrl: string
  yawDegrees: number
  modelPosition: readonly [number, number, number]
  localBoundsSize: readonly [number, number, number]
  partCount: number
}

const CHARACTER_DEFAULT_PART_COUNT = 12
export const CHARACTER_LOCAL_HEIGHT = 4.0625 - -0.03125

/**
 * 场景角色基类，继承自 Entity。
 *
 * 在 Entity 的空间变换与包围盒基础上叠加角色专有能力：
 * 1. 朝向驱动 — 基于 LookTarget 计算 Yaw/Pitch。
 * 2. 皮肤与外观 — 管理 skinId/skinUrl。
 * 3. 骨骼动画 — 维护 4-float animation vector。
 */
export class Character extends Entity {
  protected readonly renderState: CharacterRenderState
  protected yawRadians = 0

  private readonly rotation = mat4.create() as Float32Array
  private readonly pitchRotation = mat4.create() as Float32Array
  private readonly previousPosition = new Float32Array(3)
  private readonly lookTarget = new Float32Array(3)
  private readonly animation = new Float32Array(4)
  private readonly definition: CharacterDefinition

  private animationPhase = 0
  private moveBlend = 0
  private hasPreviousPosition = false
  private readonly rotateWithPitch: boolean

  private readonly _tempTranslation = new Float32Array(3)
  private readonly _tempScale = new Float32Array(3)

  constructor(definition: CharacterDefinition, options: CharacterOptions = {}) {
    super(definition, { modelScale: options.modelScale })
    this.definition = definition
    this.rotateWithPitch = options.rotateWithPitch ?? false
    this.renderState = {
      id: definition.id,
      skinId: definition.skinId,
      transform: this.transform,
      bounds: {
        min: this.worldBoundsMin,
        max: this.worldBoundsMax,
      },
      modelPosition: this.modelPosition,
      yawRadians: 0,
      animation: this.animation,
      mainViewVisible: true,
      castShadow: true,
      receiveShadow: true,
      doubleSided: false,
    }
  }

  initialize(state: CharacterInitializationState) {
    copyVec3(this.previousPosition, state.position)
    this.hasPreviousPosition = false
    this.updatePose(state.position, state.lookTarget)
    this.updateAnimationVector(0, state.position, state.lookTarget)
  }

  updateFromDriver(state: CharacterDriverState) {
    this.updatePose(state.position, state.lookTarget)
    if (state.animationOverride && state.animationOverride.length >= 4) {
      this.applyAnimationOverride(state.animationOverride, state.position)
      return
    }

    this.updateAnimationVector(Math.max(0, state.dtSeconds), state.position, state.lookTarget)
  }

  getDefinition() {
    return this.definition
  }

  getRenderState(): CharacterRenderState {
    this.renderState.yawRadians = this.yawRadians
    return this.renderState
  }

  getCalibrationDebugInfo(): CharacterCalibrationDebugInfo | null {
    return {
      skinUrl: this.definition.skinUrl,
      yawDegrees: (this.yawRadians * 180) / Math.PI,
      modelPosition: [this.modelPosition[0], this.modelPosition[1], this.modelPosition[2]],
      localBoundsSize: [
        (this.localBoundsMax[0] - this.localBoundsMin[0]) * this.modelScale,
        (this.localBoundsMax[1] - this.localBoundsMin[1]) * this.modelScale,
        (this.localBoundsMax[2] - this.localBoundsMin[2]) * this.modelScale,
      ],
      partCount: CHARACTER_DEFAULT_PART_COUNT,
    }
  }

  override dispose() {
    this.animation.fill(0)
  }

  private updatePose(position: Vec3Like, lookTarget: Vec3Like) {
    copyVec3(this.modelPosition, position)
    copyVec3(this.lookTarget, lookTarget)
    this.yawRadians = computeYawRadians(position, lookTarget)
    const pitchRadians = this.rotateWithPitch ? computePitchRadians(position, lookTarget) : 0

    this._tempTranslation[0] = this.modelPosition[0]
    this._tempTranslation[1] = this.modelPosition[1]
    this._tempTranslation[2] = this.modelPosition[2]
    mat4.fromTranslation(this.transform, this._tempTranslation)
    mat4.fromYRotation(this.rotation, this.yawRadians)
    mat4.multiply(this.transform, this.transform, this.rotation)
    if (this.rotateWithPitch) {
      mat4.fromXRotation(this.pitchRotation, pitchRadians)
      mat4.multiply(this.transform, this.transform, this.pitchRotation)
    }
    if (Math.abs(this.modelScale - 1) > 1e-6) {
      this._tempScale[0] = this.modelScale
      this._tempScale[1] = this.modelScale
      this._tempScale[2] = this.modelScale
      mat4.scale(this.transform, this.transform, this._tempScale)
    }

    this.updateWorldBounds()
  }

  private applyAnimationOverride(override: ArrayLike<number>, position: Vec3Like) {
    this.animation[0] = override[0] ?? this.animation[0]
    this.animation[1] = override[1] ?? this.animation[1]
    this.animation[2] = override[2] ?? this.animation[2]
    this.animation[3] = override[3] ?? this.animation[3]
    copyVec3(this.previousPosition, position)
    this.hasPreviousPosition = true
  }

  private updateAnimationVector(dtSeconds: number, position: Vec3Like, lookTarget: Vec3Like) {
    let horizontalSpeed = 0
    if (this.hasPreviousPosition && dtSeconds > 1e-5) {
      const dx = (position[0] ?? 0) - this.previousPosition[0]
      const dz = (position[2] ?? 0) - this.previousPosition[2]
      horizontalSpeed = Math.hypot(dx, dz) / dtSeconds
    }

    copyVec3(this.previousPosition, position)
    this.hasPreviousPosition = true

    const targetMoveBlend = clamp(horizontalSpeed / 4.0, 0, 1)
    const smoothFactor = 1 - Math.exp(-dtSeconds * 12.0)
    this.moveBlend += (targetMoveBlend - this.moveBlend) * smoothFactor
    this.animationPhase += dtSeconds * (2.0 + this.moveBlend * 6.0)

    this.animation[0] = this.animationPhase
    this.animation[1] = this.moveBlend
    this.animation[2] = 0
    this.animation[3] = clamp(computePitchRadians(position, lookTarget), -0.7, 0.7)
  }
}
