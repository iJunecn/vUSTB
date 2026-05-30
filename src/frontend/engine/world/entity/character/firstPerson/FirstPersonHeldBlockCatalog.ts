import type { ResourceDefinition } from '@/engine/config'

/**
 * @file FirstPersonHeldBlockCatalog.ts
 * @brief 第一人称手持方块贴图目录
 *
 * 说明：
 *  - 为手持方块渲染提供六面贴图名称映射
 *  - 当前版本仅保留查询接口与资源切换时的缓存清理
 *  - 若未命中显式目录项则返回 `null` 交由上层回退
 */

export type HeldBlockFaceTextures = {
  up: string
  down: string
  north: string
  south: string
  west: string
  east: string
}

function normalizeBlockName(blockState: string) {
  const trimmed = blockState.trim()
  const withoutNamespace = trimmed.startsWith('minecraft:')
    ? trimmed.slice('minecraft:'.length)
    : trimmed
  const propertyIndex = withoutNamespace.indexOf('[')
  return propertyIndex >= 0 ? withoutNamespace.slice(0, propertyIndex) : withoutNamespace
}

export class FirstPersonHeldBlockCatalog {
  private resourceKey: string | null = null
  private entries = new Map<string, HeldBlockFaceTextures | null>()

  async load(resource: ResourceDefinition) {
    const nextResourceKey = resource.key
    if (this.resourceKey === nextResourceKey) {
      return
    }

    // 资源切换时直接丢弃旧缓存；当前版本尚未从资源包重建显式目录。
    this.entries = new Map()
    this.resourceKey = nextResourceKey
  }

  resolve(blockState: string): HeldBlockFaceTextures | null {
    if (!blockState || blockState === 'minecraft:air') {
      return null
    }

    return this.entries.get(normalizeBlockName(blockState)) ?? null
  }
}
