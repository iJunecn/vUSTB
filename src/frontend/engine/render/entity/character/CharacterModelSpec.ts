/**
 * @file CharacterModelSpec.ts
 * @brief Minecraft 风格角色模型数据规格。
 *
 * 以数据驱动方式定义角色几何（部件尺寸、中心、UV）和骨骼（旋转支点）。
 * 支持 normal（Steve, 4px 手臂）与 slim（Alex, 3px 手臂）两种体型。
 *
 * 所有尺寸为局部模型单位，1 unit = 8 texture pixels。
 */

// ── 公开类型 ─────────────────────────────────────────────────

/** 角色体型：normal = Steve（4px 手臂）, slim = Alex（3px 手臂） */
export type CharacterModelType = 'normal' | 'slim'

/** UV 矩形，纹理像素坐标 [u1, v1, u2, v2] */
type UVRect = readonly [number, number, number, number]

/** 一个立方体六面的 UV 区域 */
export interface BoxUV {
  right: UVRect // +X face
  left: UVRect // -X face
  top: UVRect // +Y face
  bottom: UVRect // -Y face
  front: UVRect // +Z face
  back: UVRect // -Z face
}

/** 一个网格部件（box）的几何与 UV 规格 */
export interface PartSpec {
  partId: number
  name: string
  size: readonly [number, number, number]
  center: readonly [number, number, number]
  uv: BoxUV
}

/**
 * 骨骼节点 —— 将 inner/outer partId 对映射到动画旋转支点。
 *
 * GPU 着色器通过 `matchesPart(partId, innerPartId, outerPartId)` 判断
 * 当前顶点属于哪根骨骼，然后围绕 `pivot` 施加旋转。
 */
export interface SkeletonBone {
  name: string
  innerPartId: number
  outerPartId: number
  pivot: readonly [number, number, number]
}

// ── UV 生成 ──────────────────────────────────────────────────

/**
 * 根据 Minecraft 皮肤 UV 布局生成一个 box 的六面 UV 区域。
 *
 * MC 皮肤将 box 的 6 面展开为两行条带:
 * ```
 *   Row 0: [pad D] [TOP WxD]  [BOTTOM WxD]
 *   Row 1: [S1 DxH] [FRONT WxH] [S2 DxH] [BACK WxH]
 * ```
 *
 * Body/Limb 部件: S1 = right(+X), S2 = left(-X)。
 * Head 部件历史上使用相反的顺序: S1 = left(-X), S2 = right(+X)。
 *
 * @param u0 UV 起始 X（像素）
 * @param v0 UV 起始 Y（像素）
 * @param w  box 宽度（X 轴，像素）
 * @param h  box 高度（Y 轴，像素）
 * @param d  box 深度（Z 轴，像素）
 * @param headOrder 使用 Head UV 条带顺序（left/right 互换）
 */
function skinBoxUV(
  u0: number,
  v0: number,
  w: number,
  h: number,
  d: number,
  headOrder = false,
): BoxUV {
  const side1: UVRect = [u0, v0 + d, u0 + d, v0 + d + h]
  const side2: UVRect = [u0 + d + w, v0 + d, u0 + 2 * d + w, v0 + d + h]
  return {
    right: headOrder ? side2 : side1,
    front: [u0 + d, v0 + d, u0 + d + w, v0 + d + h],
    left: headOrder ? side1 : side2,
    back: [u0 + 2 * d + w, v0 + d, u0 + 2 * d + 2 * w, v0 + d + h],
    top: [u0 + d, v0, u0 + d + w, v0 + d],
    bottom: [u0 + d + w, v0, u0 + d + 2 * w, v0 + d],
  }
}

// ── 几何常量 ─────────────────────────────────────────────────

/** Head 外层膨胀量（每轴总增量） */
const HEAD_LAYER_INFLATION = 0.125 // 1px per side @ 8px = 1 unit
/** Body/Arm/Leg 外层膨胀量（每轴总增量） */
const LIMB_LAYER_INFLATION = 0.0625 // 0.5px per side

function inflated(
  size: readonly [number, number, number],
  amount: number,
): readonly [number, number, number] {
  return [size[0] + amount, size[1] + amount, size[2] + amount]
}

/** 手臂宽度（局部单位） */
function armWidth(type: CharacterModelType) {
  return type === 'slim' ? 0.375 : 0.5
}

/** 手臂中心 X 偏移（|body_half| + |arm_half|） */
function armCenterX(type: CharacterModelType) {
  return 0.5 + armWidth(type) / 2
}

/** 手臂宽度（纹理像素） */
function armPixelW(type: CharacterModelType) {
  return type === 'slim' ? 3 : 4
}

// ── 部件生成 ─────────────────────────────────────────────────

/**
 * 生成角色的完整部件列表。
 *
 * @param modelType 'normal'（Steve）或 'slim'（Alex）
 * @param isLegacySkin true = 64×32 旧格式皮肤（左侧肢体镜像右侧 UV，无 body/limb 外层）
 */
export function getCharacterParts(
  modelType: CharacterModelType,
  isLegacySkin: boolean,
): PartSpec[] {
  const aw = armWidth(modelType)
  const ax = armCenterX(modelType)
  const ap = armPixelW(modelType)

  const parts: PartSpec[] = []

  // ── Head ─────────────────────────────
  const headSize: readonly [number, number, number] = [1, 1, 1]
  parts.push(
    {
      partId: 0,
      name: 'head',
      size: headSize,
      center: [0, 3.5, 0],
      uv: skinBoxUV(0, 0, 8, 8, 8, true),
    },
    {
      partId: 1,
      name: 'headLayer',
      size: inflated(headSize, HEAD_LAYER_INFLATION),
      center: [0, 3.5, 0],
      uv: skinBoxUV(32, 0, 8, 8, 8, true),
    },
  )

  // ── Body ─────────────────────────────
  const bodySize: readonly [number, number, number] = [1, 1.5, 0.5]
  parts.push({
    partId: 2,
    name: 'body',
    size: bodySize,
    center: [0, 2.25, 0],
    uv: skinBoxUV(16, 16, 8, 12, 4),
  })
  if (!isLegacySkin) {
    parts.push({
      partId: 3,
      name: 'bodyLayer',
      size: inflated(bodySize, LIMB_LAYER_INFLATION),
      center: [0, 2.25, 0],
      uv: skinBoxUV(16, 32, 8, 12, 4),
    })
  }

  // ── Right Arm ────────────────────────
  const armSize: readonly [number, number, number] = [aw, 1.5, 0.5]
  parts.push({
    partId: 4,
    name: 'rightArm',
    size: armSize,
    center: [-ax, 2.25, 0],
    uv: skinBoxUV(40, 16, ap, 12, 4),
  })
  if (!isLegacySkin) {
    parts.push({
      partId: 5,
      name: 'rightArmLayer',
      size: inflated(armSize, LIMB_LAYER_INFLATION),
      center: [-ax, 2.25, 0],
      uv: skinBoxUV(40, 32, ap, 12, 4),
    })
  }

  // ── Left Arm ─────────────────────────
  parts.push({
    partId: 6,
    name: 'leftArm',
    size: armSize,
    center: [ax, 2.25, 0],
    uv: isLegacySkin ? skinBoxUV(40, 16, ap, 12, 4) : skinBoxUV(32, 48, ap, 12, 4),
  })
  if (!isLegacySkin) {
    parts.push({
      partId: 7,
      name: 'leftArmLayer',
      size: inflated(armSize, LIMB_LAYER_INFLATION),
      center: [ax, 2.25, 0],
      uv: skinBoxUV(48, 48, ap, 12, 4),
    })
  }

  // ── Right Leg ────────────────────────
  const legSize: readonly [number, number, number] = [0.5, 1.5, 0.5]
  parts.push({
    partId: 8,
    name: 'rightLeg',
    size: legSize,
    center: [-0.25, 0.75, 0],
    uv: skinBoxUV(0, 16, 4, 12, 4),
  })
  if (!isLegacySkin) {
    parts.push({
      partId: 9,
      name: 'rightLegLayer',
      size: inflated(legSize, LIMB_LAYER_INFLATION),
      center: [-0.25, 0.75, 0],
      uv: skinBoxUV(0, 32, 4, 12, 4),
    })
  }

  // ── Left Leg ─────────────────────────
  parts.push({
    partId: 10,
    name: 'leftLeg',
    size: legSize,
    center: [0.25, 0.75, 0],
    uv: isLegacySkin ? skinBoxUV(0, 16, 4, 12, 4) : skinBoxUV(16, 48, 4, 12, 4),
  })
  if (!isLegacySkin) {
    parts.push({
      partId: 11,
      name: 'leftLegLayer',
      size: inflated(legSize, LIMB_LAYER_INFLATION),
      center: [0.25, 0.75, 0],
      uv: skinBoxUV(0, 48, 4, 12, 4),
    })
  }

  return parts
}

// ── 骨骼 ─────────────────────────────────────────────────────

/**
 * 角色骨骼定义，包含每根骨骼的动画旋转支点 (pivot)。
 *
 * Body 骨骼目前在着色器中无动画，但为完整性保留。
 * 支点的 X 分量随 modelType 变化（slim 手臂更窄 → 支点更靠近身体中心）。
 */
export function getCharacterSkeleton(modelType: CharacterModelType): SkeletonBone[] {
  const ax = armCenterX(modelType)
  return [
    { name: 'head', innerPartId: 0, outerPartId: 1, pivot: [0, 3.0, 0] },
    { name: 'body', innerPartId: 2, outerPartId: 3, pivot: [0, 2.25, 0] },
    { name: 'rightArm', innerPartId: 4, outerPartId: 5, pivot: [-ax, 3.0, 0] },
    { name: 'leftArm', innerPartId: 6, outerPartId: 7, pivot: [ax, 3.0, 0] },
    { name: 'rightLeg', innerPartId: 8, outerPartId: 9, pivot: [-0.25, 1.5, 0] },
    { name: 'leftLeg', innerPartId: 10, outerPartId: 11, pivot: [0.25, 1.5, 0] },
  ]
}
