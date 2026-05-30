import { Entity, type EntityDefinition, type EntityOptions } from '../Entity'
import type { EntityRenderState } from '@/engine/render/entity/types'

export type BlockEntityType = 'chest' | 'barrel' | 'furnace' | 'shulker_box' | 'bed' | 'sign'

export type BlockEntityDefinition = EntityDefinition & {
  blockType: BlockEntityType
  /** 水平朝向索引 0-3，对应 south/west/north/east（与 MC 一致） */
  facing?: number
}

/** 方块实体的默认 AABB：一个完整方块 */
const DEFAULT_BLOCK_BOUNDS_MIN = [-0.5, 0, -0.5] as const
const DEFAULT_BLOCK_BOUNDS_MAX = [0.5, 1, 0.5] as const

/**
 * 方块实体世界层基类，对应箱子、熔炉、告示牌等。
 *
 * 继承 Entity 的变换/bounds 体系，增加方块网格对齐与朝向。
 * 与 Character 不同：没有骨骼动画、没有连续运动驱动。
 */
export class BlockEntity extends Entity {
  readonly blockType: BlockEntityType
  readonly facing: number

  protected readonly renderState: EntityRenderState

  constructor(definition: BlockEntityDefinition, options: EntityOptions = {}) {
    super(definition, {
      modelScale: options.modelScale ?? 1,
      localBoundsMin: options.localBoundsMin ?? DEFAULT_BLOCK_BOUNDS_MIN,
      localBoundsMax: options.localBoundsMax ?? DEFAULT_BLOCK_BOUNDS_MAX,
    })
    this.blockType = definition.blockType
    this.facing = definition.facing ?? 0
    this.renderState = {
      id: definition.id,
      transform: this.transform,
      bounds: {
        min: this.worldBoundsMin,
        max: this.worldBoundsMax,
      },
      modelPosition: this.modelPosition,
      mainViewVisible: true,
      castShadow: true,
      receiveShadow: true,
      doubleSided: false,
    }
  }

  /** 将方块实体放置到网格对齐的世界坐标 */
  setPosition(x: number, y: number, z: number) {
    this.modelPosition[0] = x
    this.modelPosition[1] = y
    this.modelPosition[2] = z
    this.transform[12] = x
    this.transform[13] = y
    this.transform[14] = z
    this.updateWorldBounds()
  }

  getRenderState(): EntityRenderState {
    return this.renderState
  }
}
