import type { CharacterModelType } from '@/engine/render/entity/character/CharacterModelSpec'
import { Character, type Vec3Like } from './Character'

export type NpcUpdateContext = {
  dtSeconds: number
  centerPosition: Vec3Like
  centerLookTarget: Vec3Like
}

const NPC_CHARACTER_BASE_ID = 920100
const DEFAULT_HEAD_HEIGHT = 1.5

function mix(current: number, target: number, factor: number) {
  return current + (target - current) * factor
}

/**
 * @file Npc.ts
 * @brief 非玩家角色封装
 *
 * 说明：
 *  - 基于 `Character` 实现编队跟随和头部朝向控制
 *  - 通过触发状态和混合参数驱动动作过渡
 *  - 适合大规模集群角色的轻量更新流程
 */
export class Npc extends Character {
  private readonly position = new Float32Array(3)
  private readonly targetBuffer = new Float32Array(3)
  private readonly animationOverride = new Float32Array(4)

  private triggerCooldownSeconds = 0
  private triggerRemainingSeconds = 0
  private triggerMoveBlend = 0
  private headYawAmplitude = 0
  private headPitchAmplitude = 0
  private triggerPhase = 0

  constructor(
    private readonly index: number,
    private readonly formationOffsetX: number,
    private readonly formationOffsetZ: number,
    skinId: string,
    skinUrl: string,
    modelType?: CharacterModelType,
  ) {
    super({
      id: NPC_CHARACTER_BASE_ID + index,
      skinId,
      skinUrl,
      modelType,
    })
    this.resetTriggerCooldown()
    this.triggerPhase = index * 0.37
  }

  public initializeFromCenter(centerPosition: Vec3Like) {
    this.position[0] = (centerPosition[0] ?? 0) + this.formationOffsetX
    this.position[1] = centerPosition[1] ?? 0
    this.position[2] = (centerPosition[2] ?? 0) + this.formationOffsetZ
    this.targetBuffer[0] = centerPosition[0] ?? 0
    this.targetBuffer[1] = (centerPosition[1] ?? 0) + DEFAULT_HEAD_HEIGHT
    this.targetBuffer[2] = centerPosition[2] ?? 0

    super.initialize({
      position: this.position,
      lookTarget: this.targetBuffer,
    })
  }

  public update(context: NpcUpdateContext) {
    const targetX = (context.centerPosition[0] ?? 0) + this.formationOffsetX
    const targetY = context.centerPosition[1] ?? 0
    const targetZ = (context.centerPosition[2] ?? 0) + this.formationOffsetZ
    const followFactor = 1 - Math.exp(-Math.max(0, context.dtSeconds) * 8.0)

    this.position[0] = mix(this.position[0], targetX, followFactor)
    this.position[1] = mix(this.position[1], targetY, followFactor)
    this.position[2] = mix(this.position[2], targetZ, followFactor)

    this.targetBuffer[0] = context.centerPosition[0] ?? 0
    this.targetBuffer[1] = (context.centerPosition[1] ?? 0) + DEFAULT_HEAD_HEIGHT
    this.targetBuffer[2] = context.centerPosition[2] ?? 0

    this.updateTrigger(context.dtSeconds)

    super.updateFromDriver({
      dtSeconds: context.dtSeconds,
      position: this.position,
      lookTarget: this.targetBuffer,
      animationOverride: this.animationOverride,
    })
  }

  private updateTrigger(dtSeconds: number) {
    const clampedDt = Math.max(0, dtSeconds)
    if (this.triggerRemainingSeconds > 0) {
      this.triggerRemainingSeconds = Math.max(0, this.triggerRemainingSeconds - clampedDt)
    } else {
      this.triggerCooldownSeconds = Math.max(0, this.triggerCooldownSeconds - clampedDt)
      if (this.triggerCooldownSeconds <= 0) {
        this.startTrigger()
      }
    }

    const targetBlend = this.triggerRemainingSeconds > 0 ? this.triggerMoveBlend : 0
    const smoothing = 1 - Math.exp(-clampedDt * 9.0)
    this.animationOverride[1] = mix(this.animationOverride[1], targetBlend, smoothing)
    this.triggerPhase += clampedDt * (1.4 + this.animationOverride[1] * 6.0)
    this.animationOverride[0] = this.triggerPhase

    const yawWave = Math.sin(this.triggerPhase * 0.37 + this.index * 0.41)
    const pitchWave = Math.sin(this.triggerPhase * 0.29 + this.index * 0.73)
    this.animationOverride[2] = yawWave * this.headYawAmplitude * this.animationOverride[1]
    this.animationOverride[3] = pitchWave * this.headPitchAmplitude * this.animationOverride[1]

    if (this.triggerRemainingSeconds <= 0 && this.animationOverride[1] < 0.02) {
      this.headYawAmplitude = 0
      this.headPitchAmplitude = 0
      this.animationOverride[1] = 0
      this.animationOverride[2] = 0
      this.animationOverride[3] = 0
    }
  }

  private startTrigger() {
    this.triggerRemainingSeconds = 0.9 + Math.random() * 1.8
    this.triggerMoveBlend = 0.45 + Math.random() * 0.55
    this.headYawAmplitude = 0.2 + Math.random() * 0.35
    this.headPitchAmplitude = 0.05 + Math.random() * 0.2
    this.resetTriggerCooldown()
  }

  private resetTriggerCooldown() {
    this.triggerCooldownSeconds = 0.4 + Math.random() * 2.8
  }
}
