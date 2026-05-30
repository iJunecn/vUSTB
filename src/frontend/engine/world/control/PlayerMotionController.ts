import { vec3, vec2, clamp, degToRad, radToDeg } from '@/engine/render/utils/math'
import { reactive } from 'vue'
import { getEngineRuntimeControlsConfig } from '@/config/runtime'

export type PlayerMotionBounds = {
  minX: number
  maxX: number
  minY?: number
  maxY?: number
  minZ: number
  maxZ: number
}

export type PlayerMotionBehaviorConfig = {
  lockPitch?: boolean
  fixedPitch?: number
  pitchRange?: [number, number]
  pitchRangeWhenAboveY?: {
    y: number
    pitchRange: [number, number]
  }
  movementBounds?: PlayerMotionBounds | null
  onPositionChange?: ((position: readonly [number, number, number]) => void) | null
}

/**
 * @file PlayerMotionController.ts
 * @brief 玩家移动与视角控制
 *
 * 说明：
 *  - 将键鼠和触摸输入转换为位置与视角变化
 *  - 维护 yaw、pitch 与平滑过渡目标值
 *  - 提供边界约束、触摸摇杆和位置变更回调
 */
export class PlayerMotionController {
  public position: vec3
  public target: vec3
  public up: vec3
  public state: { yaw: number; pitch: number }

  private targetYaw: number
  private targetPitch: number
  private readonly SMOOTHING_FACTOR = 15.0
  private readonly TOUCH_ROTATION_THRESHOLD = 1.0

  private keys: Record<string, boolean> = {}
  private touchState = {
    leftId: null as number | null,
    rightId: null as number | null,
    leftStart: vec2.create(),
    leftCurrent: vec2.create(),
    rightPrevious: vec2.create(),
  }
  private canvas: HTMLCanvasElement | null = null
  private motionBehavior: PlayerMotionBehaviorConfig = {}

  constructor(
    initialPos: vec3 = vec3.fromValues(200, 32, 600),
    initialTarget: vec3 = vec3.fromValues(initialPos[0] + 1, initialPos[1], initialPos[2]),
  ) {
    this.position = reactive(initialPos)
    this.target = reactive(vec3.clone(initialTarget))
    this.up = vec3.fromValues(0, 1, 0)
    const initialForward = vec3.create()
    vec3.subtract(initialForward, initialTarget, initialPos)
    if (vec3.squaredLength(initialForward) <= 1e-8) {
      vec3.set(initialForward, 1, 0, 0)
    } else {
      vec3.normalize(initialForward, initialForward)
    }
    const initialYaw = radToDeg(Math.atan2(initialForward[2], initialForward[0]))
    const initialPitch = radToDeg(Math.asin(clamp(initialForward[1], -1, 1)))
    this.state = reactive({
      yaw: initialYaw,
      pitch: initialPitch,
    })
    this.targetYaw = initialYaw
    this.targetPitch = initialPitch

    this.onMouseMove = this.onMouseMove.bind(this)
    this.onKeyDown = this.onKeyDown.bind(this)
    this.onKeyUp = this.onKeyUp.bind(this)
    this.onTouchStart = this.onTouchStart.bind(this)
    this.onTouchMove = this.onTouchMove.bind(this)
    this.onTouchEnd = this.onTouchEnd.bind(this)
    this.onCanvasClick = this.onCanvasClick.bind(this)
    this.onWindowBlur = this.onWindowBlur.bind(this)
    this.onVisibilityChange = this.onVisibilityChange.bind(this)
  }

  public attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    document.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onWindowBlur)
    document.addEventListener('visibilitychange', this.onVisibilityChange)
    canvas.addEventListener('click', this.onCanvasClick)
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false })
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false })
    canvas.addEventListener('touchend', this.onTouchEnd, { passive: false })
    canvas.addEventListener('touchcancel', this.onTouchEnd, { passive: false })
  }

  public detach() {
    document.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onWindowBlur)
    document.removeEventListener('visibilitychange', this.onVisibilityChange)
    this.resetTransientInputState()
    if (this.canvas) {
      this.canvas.removeEventListener('click', this.onCanvasClick)
      this.canvas.removeEventListener('touchstart', this.onTouchStart)
      this.canvas.removeEventListener('touchmove', this.onTouchMove)
      this.canvas.removeEventListener('touchend', this.onTouchEnd)
      this.canvas.removeEventListener('touchcancel', this.onTouchEnd)
      this.canvas = null
    }
  }

  public syncPose(position: ArrayLike<number>, lookTarget: ArrayLike<number>) {
    this.position[0] = position[0] ?? 0
    this.position[1] = position[1] ?? 0
    this.position[2] = position[2] ?? 0
    this.target[0] = lookTarget[0] ?? 0
    this.target[1] = lookTarget[1] ?? 0
    this.target[2] = lookTarget[2] ?? 0

    const forward = vec3.create()
    vec3.subtract(forward, this.target, this.position)
    if (vec3.squaredLength(forward) <= 1e-8) {
      vec3.set(forward, 1, 0, 0)
      vec3.add(this.target, this.position, forward)
    } else {
      vec3.normalize(forward, forward)
    }

    const yaw = radToDeg(Math.atan2(forward[2], forward[0]))
    const pitch = radToDeg(Math.asin(clamp(forward[1], -1, 1)))
    this.state.yaw = yaw
    this.state.pitch = this.clampPitch(pitch)
    this.targetYaw = yaw
    this.targetPitch = this.clampPitch(pitch)
    this.applyMovementBounds()
    this.syncForwardTarget()
  }

  public setMotionBehavior(config: PlayerMotionBehaviorConfig | null | undefined) {
    this.motionBehavior = config ?? {}
    this.targetPitch = this.clampPitch(this.targetPitch)
    this.state.pitch = this.clampPitch(this.state.pitch)
    this.applyMovementBounds()
    this.syncForwardTarget()
  }

  public update(dt: number = 0.016) {
    const controls = getEngineRuntimeControlsConfig()
    const t = 1.0 - Math.pow(0.001, dt * this.SMOOTHING_FACTOR)
    this.state.yaw += (this.targetYaw - this.state.yaw) * t
    this.targetPitch = this.clampPitch(this.targetPitch)
    this.state.pitch += (this.targetPitch - this.state.pitch) * t
    this.state.pitch = this.clampPitch(this.state.pitch)

    const front = vec3.create()
    front[0] = Math.cos(degToRad(this.state.yaw)) * Math.cos(degToRad(this.state.pitch))
    front[1] = Math.sin(degToRad(this.state.pitch))
    front[2] = Math.sin(degToRad(this.state.yaw)) * Math.cos(degToRad(this.state.pitch))
    vec3.normalize(front, front)
    const forward = front

    const speed = controls.moveSpeed * dt
    const right = vec3.create()
    vec3.cross(right, forward, this.up)
    vec3.normalize(right, right)

    const temp = vec3.create()

    if (this.keys['KeyW']) {
      vec3.scale(temp, forward, speed)
      vec3.add(this.position, this.position, temp)
    }
    if (this.keys['KeyS']) {
      vec3.scale(temp, forward, speed)
      vec3.subtract(this.position, this.position, temp)
    }
    if (this.keys['KeyA']) {
      vec3.scale(temp, right, speed)
      vec3.subtract(this.position, this.position, temp)
    }
    if (this.keys['KeyD']) {
      vec3.scale(temp, right, speed)
      vec3.add(this.position, this.position, temp)
    }
    if (this.keys['Space']) this.position[1] += speed
    if (this.keys['ShiftLeft']) this.position[1] -= speed

    if (this.touchState.leftId !== null) {
      const deltaX = this.touchState.leftCurrent[0] - this.touchState.leftStart[0]
      const deltaY = this.touchState.leftCurrent[1] - this.touchState.leftStart[1]

      const maxRadius = controls.touchJoystickRadius
      let moveX = deltaX / maxRadius
      let moveY = deltaY / maxRadius

      const len = Math.sqrt(moveX * moveX + moveY * moveY)
      if (len > 1) {
        moveX /= len
        moveY /= len
      }

      if (Math.abs(moveY) > 0.1) {
        vec3.scale(temp, forward, -moveY * speed)
        vec3.add(this.position, this.position, temp)
      }
      if (Math.abs(moveX) > 0.1) {
        vec3.scale(temp, right, moveX * speed)
        vec3.add(this.position, this.position, temp)
      }
    }

    this.applyMovementBounds()
    this.syncForwardTarget(forward)
    this.emitPositionChange()
  }

  private clampPitch(pitch: number) {
    const fixedPitch = this.motionBehavior.fixedPitch
    if (typeof fixedPitch === 'number') {
      return clamp(fixedPitch, -89, 89)
    }

    if (this.motionBehavior.lockPitch) {
      return 0
    }

    const conditionalPitchRange = this.motionBehavior.pitchRangeWhenAboveY
    const pitchRange =
      conditionalPitchRange && this.position[1] > conditionalPitchRange.y
        ? conditionalPitchRange.pitchRange
        : this.motionBehavior.pitchRange
    if (pitchRange) {
      const minPitch = clamp(Math.min(pitchRange[0], pitchRange[1]), -89, 89)
      const maxPitch = clamp(Math.max(pitchRange[0], pitchRange[1]), -89, 89)
      return clamp(pitch, minPitch, maxPitch)
    }

    return clamp(pitch, -89, 89)
  }

  private applyMovementBounds() {
    const bounds = this.motionBehavior.movementBounds
    if (!bounds) {
      return
    }

    this.position[0] = clamp(this.position[0], bounds.minX, bounds.maxX)

    if (typeof bounds.minY === 'number' && typeof bounds.maxY === 'number') {
      this.position[1] = clamp(this.position[1], bounds.minY, bounds.maxY)
    } else if (typeof bounds.minY === 'number') {
      this.position[1] = Math.max(this.position[1], bounds.minY)
    } else if (typeof bounds.maxY === 'number') {
      this.position[1] = Math.min(this.position[1], bounds.maxY)
    }

    this.position[2] = clamp(this.position[2], bounds.minZ, bounds.maxZ)
  }

  private syncForwardTarget(forwardVector?: vec3) {
    const forward = forwardVector ?? vec3.create()
    if (!forwardVector) {
      forward[0] = Math.cos(degToRad(this.state.yaw)) * Math.cos(degToRad(this.state.pitch))
      forward[1] = Math.sin(degToRad(this.state.pitch))
      forward[2] = Math.sin(degToRad(this.state.yaw)) * Math.cos(degToRad(this.state.pitch))
      vec3.normalize(forward, forward)
    }

    vec3.add(this.target, this.position, forward)
  }

  private emitPositionChange() {
    this.motionBehavior.onPositionChange?.([this.position[0], this.position[1], this.position[2]])
  }

  private resetTransientInputState() {
    this.keys = {}
    this.touchState.leftId = null
    this.touchState.rightId = null
    vec2.set(this.touchState.leftStart, 0, 0)
    vec2.set(this.touchState.leftCurrent, 0, 0)
    vec2.set(this.touchState.rightPrevious, 0, 0)
  }

  private onWindowBlur() {
    this.resetTransientInputState()
  }

  private onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      this.resetTransientInputState()
    }
  }

  private onMouseMove(e: MouseEvent) {
    if (this.canvas && document.pointerLockElement !== this.canvas) return
    if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return

    const sensitivity = getEngineRuntimeControlsConfig().mouseSensitivity
    this.targetYaw += e.movementX * sensitivity
    this.targetPitch -= e.movementY * sensitivity
    this.targetPitch = this.clampPitch(this.targetPitch)
  }

  private onCanvasClick() {
    this.canvas?.requestPointerLock()
  }

  private onKeyDown(e: KeyboardEvent) {
    if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ShiftLeft'].includes(e.code)) {
      this.keys[e.code] = true
    }
  }

  private onKeyUp(e: KeyboardEvent) {
    if (['KeyW', 'KeyS', 'KeyA', 'KeyD', 'Space', 'ShiftLeft'].includes(e.code)) {
      this.keys[e.code] = false
    }
  }

  private onTouchStart(e: TouchEvent) {
    e.preventDefault()
    for (let index = 0; index < e.changedTouches.length; index++) {
      const touch = e.changedTouches[index]
      const halfWidth = window.innerWidth / 2

      if (touch.clientX < halfWidth && this.touchState.leftId === null) {
        this.touchState.leftId = touch.identifier
        vec2.set(this.touchState.leftStart, touch.clientX, touch.clientY)
        vec2.set(this.touchState.leftCurrent, touch.clientX, touch.clientY)
      } else if (touch.clientX >= halfWidth && this.touchState.rightId === null) {
        this.touchState.rightId = touch.identifier
        vec2.set(this.touchState.rightPrevious, touch.clientX, touch.clientY)
      }
    }
  }

  private onTouchMove(e: TouchEvent) {
    e.preventDefault()
    for (let index = 0; index < e.changedTouches.length; index++) {
      const touch = e.changedTouches[index]
      if (touch.identifier === this.touchState.leftId) {
        vec2.set(this.touchState.leftCurrent, touch.clientX, touch.clientY)
      } else if (touch.identifier === this.touchState.rightId) {
        const deltaX = touch.clientX - this.touchState.rightPrevious[0]
        const deltaY = touch.clientY - this.touchState.rightPrevious[1]

        if (
          Math.abs(deltaX) < this.TOUCH_ROTATION_THRESHOLD &&
          Math.abs(deltaY) < this.TOUCH_ROTATION_THRESHOLD
        ) {
          continue
        }

        const sensitivity = getEngineRuntimeControlsConfig().touchSensitivity
        this.targetYaw += deltaX * sensitivity
        this.targetPitch -= deltaY * sensitivity
        this.targetPitch = this.clampPitch(this.targetPitch)

        vec2.set(this.touchState.rightPrevious, touch.clientX, touch.clientY)
      }
    }
  }

  private onTouchEnd(e: TouchEvent) {
    e.preventDefault()
    for (let index = 0; index < e.changedTouches.length; index++) {
      const touch = e.changedTouches[index]
      if (touch.identifier === this.touchState.leftId) {
        this.touchState.leftId = null
        vec2.set(this.touchState.leftStart, 0, 0)
        vec2.set(this.touchState.leftCurrent, 0, 0)
      } else if (touch.identifier === this.touchState.rightId) {
        this.touchState.rightId = null
      }
    }
  }
}
