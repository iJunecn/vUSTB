import { mat4, quat, vec3 } from '@/engine/render/utils/math'
import type { CharacterModelType } from '@/engine/render/entity/character/CharacterModelSpec'
import { Character, type Vec3Like } from '../Character'

const FIRST_PERSON_HAND_ID = 910002
const WORLD_UP = vec3.fromValues(0, 1, 0)
const RIGHT_ARM_PIVOT_LOCAL = [-0.75, 3.75, 0] as const

export type FirstPersonHandCameraState = {
  dtSeconds: number
  cameraPosition: Vec3Like
  cameraLookTarget: Vec3Like
}

type FirstPersonHandOptions = {
  skinId: string
  skinUrl: string
  modelScale?: number
  modelType?: CharacterModelType
  cameraLocalOffset: { x: number; y: number; z: number }
  cameraLocalRotation: { pitch: number; yaw: number; roll: number }
}

/**
 * 第一人称手臂实体。
 *
 * 只用两组参数：
 * 1. 旋转原点（肩部 pivot）相对摄像机的位置
 * 2. 手臂相对摄像机的固定欧拉旋转
 */
export class FirstPersonHand extends Character {
  private readonly handPos = new Float32Array(3)
  private readonly handTarget = new Float32Array(3)
  private readonly fwd = vec3.create()
  private readonly rht = vec3.create()
  private readonly cup = vec3.create()
  private readonly baseOrientation = mat4.create() as Float32Array
  private readonly relativeRotationQuat = quat.create()
  private readonly relativeRotation = mat4.create() as Float32Array
  private readonly finalOrientation = mat4.create() as Float32Array
  private readonly scale: number
  private readonly baseOffset: { x: number; y: number; z: number }
  private readonly baseRotation: { pitch: number; yaw: number; roll: number }
  private readonly animationOffsetDelta = { x: 0, y: 0, z: 0 }
  private readonly animationRotationDelta = { pitch: 0, yaw: 0, roll: 0 }

  constructor(private readonly options: FirstPersonHandOptions) {
    super(
      {
        id: FIRST_PERSON_HAND_ID,
        skinId: options.skinId,
        skinUrl: options.skinUrl,
        modelType: options.modelType,
      },
      { modelScale: options.modelScale, rotateWithPitch: false },
    )
    const rs = this.getRenderState()
    rs.castShadow = false
    rs.receiveShadow = false
    rs.doubleSided = true
    this.scale = options.modelScale ?? 1
    this.baseOffset = { ...options.cameraLocalOffset }
    this.baseRotation = { ...options.cameraLocalRotation }
    this.rebuildRelativeRotation()
  }

  setCameraLocalOffset(offset: { x: number; y: number; z: number }) {
    this.baseOffset.x = offset.x
    this.baseOffset.y = offset.y
    this.baseOffset.z = offset.z
  }

  setCameraLocalRotation(rotation: { pitch: number; yaw: number; roll: number }) {
    this.baseRotation.pitch = rotation.pitch
    this.baseRotation.yaw = rotation.yaw
    this.baseRotation.roll = rotation.roll
    this.rebuildRelativeRotation()
  }

  setAnimationOffsetDelta(offset: { x: number; y: number; z: number }) {
    this.animationOffsetDelta.x = offset.x
    this.animationOffsetDelta.y = offset.y
    this.animationOffsetDelta.z = offset.z
  }

  setAnimationRotationDelta(rotation: { pitch: number; yaw: number; roll: number }) {
    this.animationRotationDelta.pitch = rotation.pitch
    this.animationRotationDelta.yaw = rotation.yaw
    this.animationRotationDelta.roll = rotation.roll
    this.rebuildRelativeRotation()
  }

  getCameraLocalOffset() {
    return { ...this.baseOffset }
  }

  getCameraLocalRotation() {
    return { ...this.baseRotation }
  }

  private rebuildRelativeRotation() {
    quat.fromEuler(
      this.relativeRotationQuat,
      this.baseRotation.pitch + this.animationRotationDelta.pitch,
      this.baseRotation.yaw + this.animationRotationDelta.yaw,
      this.baseRotation.roll + this.animationRotationDelta.roll,
    )
    mat4.fromQuat(this.relativeRotation, this.relativeRotationQuat)
  }

  initializeFromCamera(camera: { cameraPosition: Vec3Like; cameraLookTarget: Vec3Like }) {
    this.computeMount(camera.cameraPosition, camera.cameraLookTarget)
    super.initialize({ position: this.handPos, lookTarget: this.handTarget })
    this.overrideTransform()
    this.updateWorldBounds()
  }

  updateFromCamera(state: FirstPersonHandCameraState) {
    this.computeMount(state.cameraPosition, state.cameraLookTarget)
    super.updateFromDriver({
      dtSeconds: state.dtSeconds,
      position: this.handPos,
      lookTarget: this.handTarget,
      animationOverride: new Float32Array([0, 0, 0, 0]),
    })
    this.overrideTransform()
    this.updateWorldBounds()
  }

  private computeMount(camPos: Vec3Like, camTarget: Vec3Like) {
    vec3.subtract(this.fwd, camTarget as vec3, camPos as vec3)
    if (vec3.squaredLength(this.fwd) <= 1e-8) vec3.set(this.fwd, 0, 0, -1)
    else vec3.normalize(this.fwd, this.fwd)

    vec3.cross(this.rht, this.fwd, WORLD_UP)
    if (vec3.squaredLength(this.rht) <= 1e-8) vec3.set(this.rht, 1, 0, 0)
    else vec3.normalize(this.rht, this.rht)

    vec3.cross(this.cup, this.rht, this.fwd)

    // 约定手部局部基向量相对于相机坐标系的方向：
    // X 指向相机右侧。
    // Y 指向相机前方的反方向，对应手臂沿局部 -Y 伸出。
    // Z 指向相机上方。
    this.baseOrientation[0] = this.rht[0]
    this.baseOrientation[1] = this.rht[1]
    this.baseOrientation[2] = this.rht[2]
    this.baseOrientation[3] = 0
    this.baseOrientation[4] = -this.fwd[0]
    this.baseOrientation[5] = -this.fwd[1]
    this.baseOrientation[6] = -this.fwd[2]
    this.baseOrientation[7] = 0
    this.baseOrientation[8] = this.cup[0]
    this.baseOrientation[9] = this.cup[1]
    this.baseOrientation[10] = this.cup[2]
    this.baseOrientation[11] = 0
    this.baseOrientation[12] = 0
    this.baseOrientation[13] = 0
    this.baseOrientation[14] = 0
    this.baseOrientation[15] = 1

    mat4.multiply(this.finalOrientation, this.baseOrientation, this.relativeRotation)

    const x = this.baseOffset.x + this.animationOffsetDelta.x
    const y = this.baseOffset.y + this.animationOffsetDelta.y
    const z = this.baseOffset.z + this.animationOffsetDelta.z
    const cx = camPos[0] ?? 0
    const cy = camPos[1] ?? 0
    const cz = camPos[2] ?? 0

    this.handPos[0] = cx + this.rht[0] * x + this.cup[0] * y + this.fwd[0] * z
    this.handPos[1] = cy + this.rht[1] * x + this.cup[1] * y + this.fwd[1] * z
    this.handPos[2] = cz + this.rht[2] * x + this.cup[2] * y + this.fwd[2] * z

    this.handTarget[0] = this.handPos[0] + this.fwd[0]
    this.handTarget[1] = this.handPos[1]
    this.handTarget[2] = this.handPos[2] + this.fwd[2]
  }

  /** Build transform directly from camera axes. */
  private overrideTransform() {
    const sc = this.scale
    const t = this.transform

    mat4.fromTranslation(t, [this.handPos[0], this.handPos[1], this.handPos[2]])
    mat4.multiply(t, t, this.finalOrientation)
    mat4.scale(t, t, [sc, sc, sc])
    mat4.translate(t, t, [
      -RIGHT_ARM_PIVOT_LOCAL[0],
      -RIGHT_ARM_PIVOT_LOCAL[1],
      -RIGHT_ARM_PIVOT_LOCAL[2],
    ])
  }
}
