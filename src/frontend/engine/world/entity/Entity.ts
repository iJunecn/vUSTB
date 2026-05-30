export type { EntityRenderState } from '@/engine/render/entity/types'

export type Vec3Like = ArrayLike<number>

export type EntityDefinition = {
  id: number
}

export type EntityOptions = {
  modelScale?: number
  localBoundsMin?: readonly [number, number, number]
  localBoundsMax?: readonly [number, number, number]
}

const DEFAULT_LOCAL_BOUNDS_MIN = [-1.03125, -0.03125, -0.5625] as const
const DEFAULT_LOCAL_BOUNDS_MAX = [1.03125, 4.0625, 0.5625] as const

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function copyVec3(target: Float32Array, source: Vec3Like) {
  target[0] = source[0] ?? 0
  target[1] = source[1] ?? 0
  target[2] = source[2] ?? 0
}

export function transformPoint(matrix: Float32Array, x: number, y: number, z: number) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ] as const
}

export function computeYawRadians(position: Vec3Like, lookTarget: Vec3Like) {
  const dx = (lookTarget[0] ?? 0) - (position[0] ?? 0)
  const dz = (lookTarget[2] ?? 0) - (position[2] ?? 0)
  if (Math.abs(dx) < 1e-5 && Math.abs(dz) < 1e-5) {
    return 0
  }

  return Math.atan2(dx, dz)
}

export function computePitchRadians(position: Vec3Like, lookTarget: Vec3Like) {
  const dx = (lookTarget[0] ?? 0) - (position[0] ?? 0)
  const dy = (lookTarget[1] ?? 0) - (position[1] ?? 0)
  const dz = (lookTarget[2] ?? 0) - (position[2] ?? 0)
  const horizontal = Math.hypot(dx, dz)
  if (horizontal < 1e-5 && Math.abs(dy) < 1e-5) {
    return 0
  }

  return Math.atan2(dy, Math.max(horizontal, 1e-5))
}

/**
 * 世界实体公共基类。
 *
 * 位于 `world/entity/` 根层，作为 `character/` 与 `blockEntity/` 等子域的共享父类。
 * 只持有通用空间状态：变换矩阵、世界包围盒、局部 bounds、可见性与阴影标记。
 */
export class Entity {
  readonly id: number
  protected readonly transform = new Float32Array(16)
  protected readonly worldBoundsMin = new Float32Array(3)
  protected readonly worldBoundsMax = new Float32Array(3)
  protected readonly modelPosition = new Float32Array(3)
  protected readonly localBoundsMin: Float32Array
  protected readonly localBoundsMax: Float32Array
  protected readonly modelScale: number

  mainViewVisible = true
  castShadow = true
  receiveShadow = true
  doubleSided = false

  constructor(definition: EntityDefinition, options: EntityOptions = {}) {
    this.id = definition.id
    this.modelScale = options.modelScale ?? 1
    this.localBoundsMin = new Float32Array(options.localBoundsMin ?? DEFAULT_LOCAL_BOUNDS_MIN)
    this.localBoundsMax = new Float32Array(options.localBoundsMax ?? DEFAULT_LOCAL_BOUNDS_MAX)
    this.transform[0] = 1
    this.transform[5] = 1
    this.transform[10] = 1
    this.transform[15] = 1
  }

  getModelPosition(): readonly [number, number, number] {
    return [this.modelPosition[0], this.modelPosition[1], this.modelPosition[2]]
  }

  protected updateWorldBounds() {
    const x0 = this.localBoundsMin[0]
    const y0 = this.localBoundsMin[1]
    const z0 = this.localBoundsMin[2]
    const x1 = this.localBoundsMax[0]
    const y1 = this.localBoundsMax[1]
    const z1 = this.localBoundsMax[2]
    const m = this.transform

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity

    for (let i = 0; i < 8; i++) {
      const lx = i & 4 ? x1 : x0
      const ly = i & 2 ? y1 : y0
      const lz = i & 1 ? z1 : z0
      const wx = m[0] * lx + m[4] * ly + m[8] * lz + m[12]
      const wy = m[1] * lx + m[5] * ly + m[9] * lz + m[13]
      const wz = m[2] * lx + m[6] * ly + m[10] * lz + m[14]
      if (wx < minX) minX = wx
      if (wx > maxX) maxX = wx
      if (wy < minY) minY = wy
      if (wy > maxY) maxY = wy
      if (wz < minZ) minZ = wz
      if (wz > maxZ) maxZ = wz
    }

    this.worldBoundsMin[0] = minX
    this.worldBoundsMin[1] = minY
    this.worldBoundsMin[2] = minZ
    this.worldBoundsMax[0] = maxX
    this.worldBoundsMax[1] = maxY
    this.worldBoundsMax[2] = maxZ
  }

  dispose() {}
}
