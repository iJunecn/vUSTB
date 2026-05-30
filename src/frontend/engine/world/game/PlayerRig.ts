import { reactive, readonly, onUnmounted } from 'vue'
import { vec3 } from '@/engine/render/utils/math'
import {
  PlayerMotionController,
  type PlayerMotionBehaviorConfig,
} from '@/engine/world/control/PlayerMotionController'
import { GAME_CONFIG } from '@/engine/config'

export type PlayerPerspectiveMode =
  | 'first-person'
  | 'spectator'
  | 'third-person-back'
  | 'third-person-front'

export type PlayerRigRenderSnapshot = {
  renderMotionAnchorPosition: vec3
  renderCameraEyePosition: vec3
  renderCameraViewPosition: vec3
  yaw: number
  pitch: number
  perspectiveMode: PlayerPerspectiveMode
}

export type PlayerRigPose = {
  position: ArrayLike<number>
  lookTarget: ArrayLike<number>
  perspectiveMode?: PlayerPerspectiveMode
}

export type PlayerRigMotionBehavior = PlayerMotionBehaviorConfig

/**
 * @file usePlayerRig.ts
 * @brief 玩家运动锚点 / 相机眼点派生 Hook
 * @description
 *  - 运动真源: motion anchor
 *  - 相机: 由 motion anchor + eye height 派生
 *  - player 模型: 由引擎装配层决定如何挂载到 motion anchor
 */
export function usePlayerRig() {
  const eyeHeight = GAME_CONFIG.WORLD.PLAYER.CAMERA_EYE_HEIGHT
  const thirdPersonBackDistance = GAME_CONFIG.WORLD.PLAYER.THIRD_PERSON_BACK_DISTANCE
  const thirdPersonFrontDistance = GAME_CONFIG.WORLD.PLAYER.THIRD_PERSON_FRONT_DISTANCE
  const thirdPersonHeightOffset = GAME_CONFIG.WORLD.PLAYER.THIRD_PERSON_HEIGHT_OFFSET
  const defaultPerspective = GAME_CONFIG.WORLD.PLAYER.DEFAULT_PERSPECTIVE as PlayerPerspectiveMode

  // If no initialPose is provided to setup(), rig defaults to origin.
  // In practice, PersistentEngineHost always resolves a scene preset or persisted pose.
  const initialMotionAnchorPosition = vec3.fromValues(0, 0, 0)
  const initialMotionAnchorLookTarget = vec3.fromValues(1, 0, 0)

  // 低层输入控制器负责驱动运动锚点与观察方向；上层再派生 camera/player。
  const controller = new PlayerMotionController(
    initialMotionAnchorPosition,
    initialMotionAnchorLookTarget,
  )

  let perspectiveMode: PlayerPerspectiveMode = defaultPerspective

  const snapshot = reactive<PlayerRigRenderSnapshot>({
    renderMotionAnchorPosition: vec3.fromValues(
      controller.position[0],
      controller.position[1],
      controller.position[2],
    ),
    renderCameraEyePosition: vec3.fromValues(
      controller.position[0],
      controller.position[1] + eyeHeight,
      controller.position[2],
    ),
    renderCameraViewPosition: vec3.fromValues(
      controller.position[0],
      controller.position[1] + eyeHeight,
      controller.position[2],
    ),
    yaw: 0,
    pitch: 0,
    perspectiveMode,
  })

  const previousMotionAnchorPosition = vec3.clone(controller.position)
  const currentMotionAnchorPosition = vec3.clone(controller.position)
  const renderMotionAnchorPosition = vec3.clone(controller.position)
  const previousMotionAnchorLookTarget = vec3.clone(controller.target)
  const currentMotionAnchorLookTarget = vec3.clone(controller.target)
  const renderMotionAnchorLookTarget = vec3.clone(controller.target)
  const renderCameraEyePosition = vec3.fromValues(
    controller.position[0],
    controller.position[1] + eyeHeight,
    controller.position[2],
  )
  const renderCameraEyeLookTarget = vec3.fromValues(
    controller.target[0],
    controller.target[1] + eyeHeight,
    controller.target[2],
  )
  const renderCameraViewPosition = vec3.clone(renderCameraEyePosition)
  const renderCameraViewLookTarget = vec3.clone(renderCameraEyeLookTarget)
  const previousCameraUp = vec3.clone(controller.up)
  const currentCameraUp = vec3.clone(controller.up)
  const renderCameraUp = vec3.clone(controller.up)
  const cameraForward = vec3.create()
  const cameraRight = vec3.create()
  const cameraOffset = vec3.create()

  function normalizeDirection(from: ArrayLike<number>, to: ArrayLike<number>, out: vec3) {
    out[0] = (to[0] ?? 0) - (from[0] ?? 0)
    out[1] = (to[1] ?? 0) - (from[1] ?? 0)
    out[2] = (to[2] ?? 0) - (from[2] ?? 0)

    if (vec3.squaredLength(out) <= 1e-8) {
      vec3.set(out, 0, 0, -1)
      return
    }

    vec3.normalize(out, out)
  }

  function updateRenderCameraEyePose(position: ArrayLike<number>, lookTarget: ArrayLike<number>) {
    renderCameraEyePosition[0] = position[0] ?? 0
    renderCameraEyePosition[1] = (position[1] ?? 0) + eyeHeight
    renderCameraEyePosition[2] = position[2] ?? 0

    renderCameraEyeLookTarget[0] = lookTarget[0] ?? 0
    renderCameraEyeLookTarget[1] = (lookTarget[1] ?? 0) + eyeHeight
    renderCameraEyeLookTarget[2] = lookTarget[2] ?? 0

    snapshot.renderMotionAnchorPosition[0] = renderMotionAnchorPosition[0]
    snapshot.renderMotionAnchorPosition[1] = renderMotionAnchorPosition[1]
    snapshot.renderMotionAnchorPosition[2] = renderMotionAnchorPosition[2]
    snapshot.renderCameraEyePosition[0] = renderCameraEyePosition[0]
    snapshot.renderCameraEyePosition[1] = renderCameraEyePosition[1]
    snapshot.renderCameraEyePosition[2] = renderCameraEyePosition[2]
  }

  function updateRenderCameraViewPose() {
    normalizeDirection(renderCameraEyePosition, renderCameraEyeLookTarget, cameraForward)
    vec3.cross(cameraRight, cameraForward, renderCameraUp)
    if (vec3.squaredLength(cameraRight) <= 1e-8) {
      vec3.set(cameraRight, 1, 0, 0)
    } else {
      vec3.normalize(cameraRight, cameraRight)
    }

    if (perspectiveMode === 'first-person' || perspectiveMode === 'spectator') {
      vec3.copy(renderCameraViewPosition, renderCameraEyePosition)
      vec3.copy(renderCameraViewLookTarget, renderCameraEyeLookTarget)
    } else {
      let distance = thirdPersonFrontDistance
      if (perspectiveMode === 'third-person-back') {
        distance = thirdPersonBackDistance
      }
      const directionSign = perspectiveMode === 'third-person-back' ? -1 : 1

      vec3.scale(cameraOffset, cameraForward, distance * directionSign)
      renderCameraViewPosition[0] = renderCameraEyePosition[0] + cameraOffset[0]
      renderCameraViewPosition[1] =
        renderCameraEyePosition[1] + thirdPersonHeightOffset + cameraOffset[1]
      renderCameraViewPosition[2] = renderCameraEyePosition[2] + cameraOffset[2]
      vec3.copy(renderCameraViewLookTarget, renderCameraEyePosition)
    }

    snapshot.renderCameraViewPosition[0] = renderCameraViewPosition[0]
    snapshot.renderCameraViewPosition[1] = renderCameraViewPosition[1]
    snapshot.renderCameraViewPosition[2] = renderCameraViewPosition[2]
    snapshot.perspectiveMode = perspectiveMode
  }

  function syncSnapshotsToController() {
    vec3.copy(previousMotionAnchorPosition, controller.position)
    vec3.copy(currentMotionAnchorPosition, controller.position)
    vec3.copy(renderMotionAnchorPosition, controller.position)
    vec3.copy(previousMotionAnchorLookTarget, controller.target)
    vec3.copy(currentMotionAnchorLookTarget, controller.target)
    vec3.copy(renderMotionAnchorLookTarget, controller.target)
    vec3.copy(previousCameraUp, controller.up)
    vec3.copy(currentCameraUp, controller.up)
    vec3.copy(renderCameraUp, controller.up)
    updateRenderCameraEyePose(controller.position, controller.target)
    updateRenderCameraViewPose()
  }

  function attachInput(canvas: HTMLCanvasElement) {
    controller.attach(canvas)
  }

  function detachInput() {
    controller.detach()
  }

  function fixedUpdate(dt: number) {
    vec3.copy(previousMotionAnchorPosition, currentMotionAnchorPosition)
    vec3.copy(previousMotionAnchorLookTarget, currentMotionAnchorLookTarget)
    vec3.copy(previousCameraUp, currentCameraUp)

    controller.update(dt)

    vec3.copy(currentMotionAnchorPosition, controller.position)
    vec3.copy(currentMotionAnchorLookTarget, controller.target)
    vec3.copy(currentCameraUp, controller.up)

    snapshot.yaw = controller.state.yaw
    snapshot.pitch = controller.state.pitch
  }

  function syncRenderPose(alpha: number) {
    const t = Math.min(1, Math.max(0, alpha))
    vec3.lerp(
      renderMotionAnchorPosition,
      previousMotionAnchorPosition,
      currentMotionAnchorPosition,
      t,
    )
    vec3.lerp(
      renderMotionAnchorLookTarget,
      previousMotionAnchorLookTarget,
      currentMotionAnchorLookTarget,
      t,
    )
    vec3.lerp(renderCameraUp, previousCameraUp, currentCameraUp, t)
    updateRenderCameraEyePose(renderMotionAnchorPosition, renderMotionAnchorLookTarget)
    updateRenderCameraViewPose()
  }

  function teleportMotionAnchor(position: ArrayLike<number>) {
    const nextX = position[0] ?? 0
    const nextY = position[1] ?? 0
    const nextZ = position[2] ?? 0
    const dx = nextX - controller.position[0]
    const dy = nextY - controller.position[1]
    const dz = nextZ - controller.position[2]

    controller.position[0] = nextX
    controller.position[1] = nextY
    controller.position[2] = nextZ
    controller.target[0] += dx
    controller.target[1] += dy
    controller.target[2] += dz
    syncSnapshotsToController()
  }

  function setPose(pose: PlayerRigPose) {
    controller.syncPose(pose.position, pose.lookTarget)

    if (pose.perspectiveMode) {
      perspectiveMode = pose.perspectiveMode
    }

    syncSnapshotsToController()
  }

  function setPerspectiveMode(mode: PlayerPerspectiveMode) {
    perspectiveMode = mode
    updateRenderCameraViewPose()
  }

  function setMotionBehavior(config: PlayerRigMotionBehavior | null | undefined) {
    controller.setMotionBehavior(config)
    syncSnapshotsToController()
  }

  function cyclePerspectiveMode() {
    if (perspectiveMode === 'first-person') {
      setPerspectiveMode('spectator')
      return perspectiveMode
    }

    if (perspectiveMode === 'spectator') {
      setPerspectiveMode('third-person-back')
      return perspectiveMode
    }

    if (perspectiveMode === 'third-person-back') {
      setPerspectiveMode('third-person-front')
      return perspectiveMode
    }

    setPerspectiveMode('first-person')
    return perspectiveMode
  }

  syncSnapshotsToController()

  onUnmounted(() => {
    detachInput()
  })

  return {
    playerRigRenderState: readonly(snapshot),
    attachInput,
    detachInput,
    fixedUpdate,
    syncRenderPose,
    motionAnchorPosition: controller.position,
    motionAnchorLookTarget: controller.target,
    renderMotionAnchorPosition,
    renderMotionAnchorLookTarget,
    renderCameraEyePosition,
    renderCameraEyeLookTarget,
    renderCameraViewPosition,
    renderCameraViewLookTarget,
    cameraUp: renderCameraUp,
    perspectiveMode: () => perspectiveMode,
    isFirstPersonView: () => perspectiveMode === 'first-person',
    isEyeView: () => perspectiveMode === 'first-person' || perspectiveMode === 'spectator',
    isThirdPersonView: () =>
      perspectiveMode === 'third-person-back' || perspectiveMode === 'third-person-front',
    setPerspectiveMode,
    cyclePerspectiveMode,
    setMotionBehavior,
    teleportMotionAnchor,
    setPose,
  }
}
