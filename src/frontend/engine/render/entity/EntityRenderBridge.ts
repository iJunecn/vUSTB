import type { RenderObject } from '@/engine/render/queue/RenderObject'
import type { EntityRenderGroup } from './types'

type EntityRenderBridgeHooks<
  Descriptor extends { groupId: string },
  State,
  DebugInfo,
  Group extends EntityRenderGroup<State, DebugInfo>,
> = {
  createGroup: (descriptor: Descriptor, states: readonly State[]) => Group | Promise<Group>
  beforeCreate?: (descriptor: Descriptor, states: readonly State[]) => void | Promise<void>
  beforeSync?: (
    descriptor: Descriptor | undefined,
    states: readonly State[],
    group: Group,
  ) => void | Promise<void>
  disposeResources?: () => void
}

/**
 * render/entity 根层的通用组生命周期宿主。
 *
 * 管理 EntityRenderGroup 的创建 / 同步 / 销毁，汇总各组的 RenderObject 供
 * RenderQueueBuilder 统一调度，并透传 debug info。
 *
 * 本层不绑定任何领域语义——角色、方块实体等子域通过各自的 XxxRenderBridge
 * 组合此类，并在 hooks 中注入 create/preload/dispose 策略。
 *
 * 子域清单:
 * - `character/CharacterRenderBridge` — 角色皮肤 + 骨骼模型
 * - `blockEntity/` — 方块实体（箱子、熔炉…），走 entity 管线而非 terrain
 */
export class EntityRenderBridge<
  Descriptor extends { groupId: string },
  State,
  DebugInfo,
  Group extends EntityRenderGroup<State, DebugInfo>,
> {
  private readonly groups = new Map<string, Group>()

  constructor(
    private readonly hooks: EntityRenderBridgeHooks<Descriptor, State, DebugInfo, Group>,
  ) {}

  public async upsertGroup(descriptor: Descriptor, states: readonly State[]) {
    const existing = this.groups.get(descriptor.groupId)
    if (existing) {
      await this.hooks.beforeSync?.(descriptor, states, existing)
      existing.sync(states)
      return
    }

    await this.hooks.beforeCreate?.(descriptor, states)
    const group = await this.hooks.createGroup(descriptor, states)
    this.groups.set(descriptor.groupId, group)
  }

  public syncGroup(groupId: string, states: readonly State[]) {
    const group = this.groups.get(groupId)
    if (!group) {
      return
    }

    void this.hooks.beforeSync?.(undefined, states, group)
    group.sync(states)
  }

  public removeGroup(groupId: string) {
    const group = this.groups.get(groupId)
    if (!group) {
      return
    }

    group.dispose()
    this.groups.delete(groupId)
  }

  public getRenderObjects() {
    const objects: RenderObject[] = []
    for (const group of this.groups.values()) {
      const groupObjects = group.getRenderObjects()
      for (let i = 0; i < groupObjects.length; i++) {
        objects.push(groupObjects[i])
      }
    }
    return objects
  }

  public getCalibrationDebugInfo(groupId: string, index: number = 0): DebugInfo | null {
    return this.groups.get(groupId)?.getCalibrationDebugInfo(index) ?? null
  }

  public dispose() {
    for (const group of this.groups.values()) {
      group.dispose()
    }
    this.groups.clear()
    this.hooks.disposeResources?.()
  }
}
