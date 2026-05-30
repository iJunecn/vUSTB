import type { HologramEffectSettings } from '@render/ui3d/HologramEffectSettings'
import type { HologramPanel } from '@render/ui3d/HologramPanel'
import type { Ui3dComponentInstance } from '@render/ui3d/Ui3dComponent'

/**
 * @file HologramComponent.ts
 * @brief 全息面板 UI3D 组件工厂
 *
 * 说明：
 *  - 将 hologram 面板语义包装成标准 UI3D 组件
 *  - 创建时深拷贝配置，避免外部状态直接污染渲染快照
 *  - 后续由 composer 转换为具体的屏幕效果实例
 */

export const HOLOGRAM_COMPONENT_TYPE = 'hologram' as const

export interface HologramComponentProps {
  settings: HologramEffectSettings
}

export interface HologramComponentInstance
  extends Ui3dComponentInstance<typeof HOLOGRAM_COMPONENT_TYPE, HologramComponentProps> {
  componentType: typeof HOLOGRAM_COMPONENT_TYPE
}

export function createHologramComponent(
  id: number,
  panel: HologramPanel,
  settings: HologramEffectSettings,
  sortKey: number = 0,
): HologramComponentInstance {
  return {
    id,
    componentType: HOLOGRAM_COMPONENT_TYPE,
    rect: {
      x: panel.x,
      y: panel.y,
      width: panel.width,
      height: panel.height,
    },
    props: {
      settings: JSON.parse(JSON.stringify(settings)) as HologramEffectSettings,
    },
    enabled: true,
    sortKey,
  }
}

export function isHologramComponent(
  component: Ui3dComponentInstance,
): component is HologramComponentInstance {
  return component.componentType === HOLOGRAM_COMPONENT_TYPE
}
