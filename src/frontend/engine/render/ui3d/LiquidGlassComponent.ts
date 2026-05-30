import type { LiquidGlassEffectSettings } from '@render/ui3d/LiquidGlassEffectSettings'
import type { LiquidGlassInstanceSettings } from '@render/ui3d/LiquidGlassInstanceSettings'
import type { LiquidGlassPanel } from '@render/ui3d/LiquidGlassPanel'
import type { Ui3dComponentInstance } from '@render/ui3d/Ui3dComponent'

/**
 * @file LiquidGlassComponent.ts
 * @brief Liquid Glass UI3D 组件工厂
 *
 * 说明：
 *  - 将 glass panel 语义包装成标准 `Ui3dComponentInstance`
 *  - 组件携带面板矩形、效果设置与实例级参数
 *  - 创建时深拷贝配置，避免业务层修改污染渲染快照
 */

export const LIQUID_GLASS_COMPONENT_TYPE = 'liquid-glass' as const

export interface LiquidGlassComponentProps {
  settings: LiquidGlassEffectSettings
  layer?: string
  instanceSettings?: LiquidGlassInstanceSettings
}

export interface LiquidGlassComponentInstance
  extends Ui3dComponentInstance<typeof LIQUID_GLASS_COMPONENT_TYPE, LiquidGlassComponentProps> {
  componentType: typeof LIQUID_GLASS_COMPONENT_TYPE
}

export function createLiquidGlassComponent(
  id: number,
  panel: LiquidGlassPanel,
  settings: LiquidGlassEffectSettings,
  layer: string = 'composite',
  sortKey: number = 0,
): LiquidGlassComponentInstance {
  return {
    id,
    componentType: LIQUID_GLASS_COMPONENT_TYPE,
    rect: {
      x: panel.x,
      y: panel.y,
      width: panel.width,
      height: panel.height,
    },
    props: {
      settings: JSON.parse(JSON.stringify(settings)) as LiquidGlassEffectSettings,
      layer,
      instanceSettings: panel.instanceSettings
        ? (JSON.parse(JSON.stringify(panel.instanceSettings)) as LiquidGlassInstanceSettings)
        : undefined,
    },
    enabled: true,
    sortKey,
  }
}

export function isLiquidGlassComponent(
  component: Ui3dComponentInstance,
): component is LiquidGlassComponentInstance {
  return component.componentType === LIQUID_GLASS_COMPONENT_TYPE
}
