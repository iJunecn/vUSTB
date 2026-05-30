import type { CharacterModelType } from '@/engine/render/entity/character/CharacterModelSpec'
import {
  Character,
  type CharacterCalibrationDebugInfo,
  type CharacterDriverState,
  type CharacterInitializationState,
  type Vec3Like,
} from './Character'

const PLAYER_CHARACTER_ID = 910001

export type PlayerCalibrationDebugInfo = CharacterCalibrationDebugInfo

export type PlayerAnchorInitializationState = {
  anchorPosition: Vec3Like
  anchorLookTarget: Vec3Like
}

export type PlayerAnchorDriverState = {
  dtSeconds: number
  anchorPosition: Vec3Like
  anchorLookTarget: Vec3Like
}

type PlayerOptions = {
  skinId: string
  skinUrl: string
  modelMountOffsetY?: number
  modelScale?: number
  modelType?: CharacterModelType
}

/**
 * @file Player.ts
 * @brief 玩家角色封装
 *
 * 说明：
 *  - 继承自 `Character`，负责玩家模型与锚点状态的同步
 *  - 将相机或控制器提供的锚点位置映射到角色模型姿态
 *  - 支持基于锚点的初始化与逐帧驱动更新
 */
export class Player extends Character {
  private readonly modelPositionBuffer = new Float32Array(3)
  private readonly modelLookTargetBuffer = new Float32Array(3)

  constructor(private readonly options: PlayerOptions) {
    super(
      {
        id: PLAYER_CHARACTER_ID,
        skinId: options.skinId,
        skinUrl: options.skinUrl,
        modelType: options.modelType,
      },
      {
        modelScale: options.modelScale,
      },
    )
  }

  initializeFromAnchor(state: PlayerAnchorInitializationState) {
    super.initialize(
      this.buildModelInitializationState(state.anchorPosition, state.anchorLookTarget),
    )
  }

  updateFromAnchor(state: PlayerAnchorDriverState) {
    this.mountToAnchor(state.anchorPosition, state.anchorLookTarget)
    const driverState: CharacterDriverState = {
      dtSeconds: state.dtSeconds,
      position: this.modelPositionBuffer,
      lookTarget: this.modelLookTargetBuffer,
    }
    super.updateFromDriver(driverState)
  }

  getCalibrationDebugInfo(): PlayerCalibrationDebugInfo | null {
    return super.getCalibrationDebugInfo()
  }

  private buildModelInitializationState(
    anchorPosition: Vec3Like,
    anchorLookTarget: Vec3Like,
  ): CharacterInitializationState {
    this.mountToAnchor(anchorPosition, anchorLookTarget)
    return {
      position: this.modelPositionBuffer,
      lookTarget: this.modelLookTargetBuffer,
    }
  }

  private mountToAnchor(anchorPosition: Vec3Like, anchorLookTarget: Vec3Like) {
    const mountOffsetY = this.options.modelMountOffsetY ?? 0
    this.modelPositionBuffer[0] = anchorPosition[0] ?? 0
    this.modelPositionBuffer[1] = (anchorPosition[1] ?? 0) + mountOffsetY
    this.modelPositionBuffer[2] = anchorPosition[2] ?? 0

    this.modelLookTargetBuffer[0] = anchorLookTarget[0] ?? 0
    this.modelLookTargetBuffer[1] = (anchorLookTarget[1] ?? 0) + mountOffsetY
    this.modelLookTargetBuffer[2] = anchorLookTarget[2] ?? 0
  }
}
