import { reactive, readonly } from 'vue'
import { GAME_CONFIG } from '@/engine/config'

export type FirstPersonHandAnimationAction = 'break' | 'place'

type HandOffset = { x: number; y: number; z: number }
type HandRotation = { pitch: number; yaw: number; roll: number }

type AnimationSnapshot = {
  offsetDelta: HandOffset
  rotationDelta: HandRotation
}

type SwingState = {
  active: boolean
  kind: FirstPersonHandAnimationAction
  elapsedSeconds: number
}

const ZERO_OFFSET: HandOffset = { x: 0, y: 0, z: 0 }
const ZERO_ROTATION: HandRotation = { pitch: 0, yaw: 0, roll: 0 }

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

function easeOutCubic(value: number) {
  const t = 1 - clamp01(value)
  return 1 - t * t * t
}

function easeInOutSine(value: number) {
  const t = clamp01(value)
  return -(Math.cos(Math.PI * t) - 1) * 0.5
}

export function useFirstPersonHandAnimation() {
  const config = GAME_CONFIG.WORLD.PLAYER.FIRST_PERSON_HAND_ANIMATION
  const snapshot = reactive<AnimationSnapshot>({
    offsetDelta: { ...ZERO_OFFSET },
    rotationDelta: { ...ZERO_ROTATION },
  })

  const swingState: SwingState = {
    active: false,
    kind: 'break',
    elapsedSeconds: 0,
  }

  let equipElapsedSeconds = config.EQUIP_DURATION_SECONDS

  function resetPoseDeltas() {
    snapshot.offsetDelta.x = 0
    snapshot.offsetDelta.y = 0
    snapshot.offsetDelta.z = 0
    snapshot.rotationDelta.pitch = 0
    snapshot.rotationDelta.yaw = 0
    snapshot.rotationDelta.roll = 0
  }

  function triggerEquip() {
    equipElapsedSeconds = 0
  }

  function triggerAction(action: FirstPersonHandAnimationAction) {
    swingState.active = true
    swingState.kind = action
    swingState.elapsedSeconds = 0
  }

  function update(dtSeconds: number) {
    const deltaSeconds = Math.max(0, dtSeconds)
    equipElapsedSeconds = Math.min(
      config.EQUIP_DURATION_SECONDS,
      equipElapsedSeconds + deltaSeconds,
    )

    if (swingState.active) {
      const duration =
        swingState.kind === 'break'
          ? config.BREAK_SWING_DURATION_SECONDS
          : config.PLACE_SWING_DURATION_SECONDS
      swingState.elapsedSeconds += deltaSeconds
      if (swingState.elapsedSeconds >= duration) {
        swingState.active = false
        swingState.elapsedSeconds = duration
      }
    }

    resetPoseDeltas()

    const equipProgress = clamp01(equipElapsedSeconds / config.EQUIP_DURATION_SECONDS)
    const equipCurve = Math.sin(easeInOutSine(equipProgress) * Math.PI)
    snapshot.offsetDelta.y += config.EQUIP_OFFSET.y * equipCurve
    snapshot.offsetDelta.z += config.EQUIP_OFFSET.z * equipCurve
    snapshot.rotationDelta.roll += config.EQUIP_ROTATION.roll * equipCurve

    if (!swingState.active && swingState.elapsedSeconds <= 0) {
      return
    }

    const swingDuration =
      swingState.kind === 'break'
        ? config.BREAK_SWING_DURATION_SECONDS
        : config.PLACE_SWING_DURATION_SECONDS
    const swingProgress = clamp01(swingState.elapsedSeconds / swingDuration)
    const strikeCurve = Math.sin(easeOutCubic(swingProgress) * Math.PI)
    const recoilCurve = Math.sin(swingProgress * Math.PI)
    const swingConfig = swingState.kind === 'break' ? config.BREAK_SWING : config.PLACE_SWING

    snapshot.offsetDelta.x += swingConfig.OFFSET.x * strikeCurve
    snapshot.offsetDelta.y += swingConfig.OFFSET.y * recoilCurve
    snapshot.offsetDelta.z += swingConfig.OFFSET.z * strikeCurve
    snapshot.rotationDelta.pitch += swingConfig.ROTATION.pitch * strikeCurve
    snapshot.rotationDelta.yaw += swingConfig.ROTATION.yaw * strikeCurve
    snapshot.rotationDelta.roll += swingConfig.ROTATION.roll * recoilCurve
  }

  return {
    animationPose: readonly(snapshot),
    triggerEquip,
    triggerAction,
    update,
  }
}
