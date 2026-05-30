import type { ScreenEffectInstance, ScreenEffectType } from '@render/queue/RenderObject'
import {
  createDefaultLiquidGlassInstanceSettings,
  type LiquidGlassInstanceSettings,
} from '@render/ui3d/LiquidGlassInstanceSettings'

/**
 * @file LiquidGlassPanel.ts
 * @brief Liquid Glass 屏幕效果适配层
 *
 * 说明：
 *  - 将 liquid-glass 面板语义转换为屏幕合成阶段可消费的效果实例
 *  - 负责过滤非法尺寸并补齐默认实例参数
 *  - 支持从通用 screen effect 列表中提取 glass panel 集合
 */

export const LIQUID_GLASS_EFFECT_TYPE = 'liquid-glass-panel' as const satisfies ScreenEffectType

export interface LiquidGlassPanel {
  x: number
  y: number
  width: number
  height: number
  layer?: string
  instanceSettings?: LiquidGlassInstanceSettings
}

export interface LiquidGlassEffectPayload {
  panel: LiquidGlassPanel
}

export const MAX_LIQUID_GLASS_PANELS = 1024

export function sanitizeLiquidGlassPanels(panels: readonly LiquidGlassPanel[]): LiquidGlassPanel[] {
  return panels
    .filter(panel => panel.width > 0 && panel.height > 0)
    .slice(0, MAX_LIQUID_GLASS_PANELS)
    .map(panel => ({
      x: panel.x,
      y: panel.y,
      width: panel.width,
      height: panel.height,
      layer: panel.layer ?? 'composite',
      instanceSettings: panel.instanceSettings
        ? (JSON.parse(JSON.stringify(panel.instanceSettings)) as LiquidGlassInstanceSettings)
        : createDefaultLiquidGlassInstanceSettings(),
    }))
}

export interface LiquidGlassEffectInstance
  extends ScreenEffectInstance<typeof LIQUID_GLASS_EFFECT_TYPE, LiquidGlassEffectPayload> {
  effectType: typeof LIQUID_GLASS_EFFECT_TYPE
  domain: 'ui3d'
}

export function createLiquidGlassEffectInstance(
  id: number,
  panel: LiquidGlassPanel,
  sortKey: number = 0,
): LiquidGlassEffectInstance {
  return {
    id,
    kind: 'screen-effect',
    domain: 'ui3d',
    effectType: LIQUID_GLASS_EFFECT_TYPE,
    rect: {
      x: panel.x,
      y: panel.y,
      width: panel.width,
      height: panel.height,
    },
    payload: {
      panel: {
        x: panel.x,
        y: panel.y,
        width: panel.width,
        height: panel.height,
        layer: panel.layer ?? 'composite',
        instanceSettings: panel.instanceSettings
          ? (JSON.parse(JSON.stringify(panel.instanceSettings)) as LiquidGlassInstanceSettings)
          : createDefaultLiquidGlassInstanceSettings(),
      },
    },
    enabled: true,
    sortKey,
  }
}

export function isLiquidGlassEffectInstance(
  object: ScreenEffectInstance,
): object is LiquidGlassEffectInstance {
  return object.effectType === LIQUID_GLASS_EFFECT_TYPE
}

export function collectLiquidGlassPanels(
  objects: Iterable<ScreenEffectInstance>,
): LiquidGlassPanel[] {
  const panels: LiquidGlassPanel[] = []

  for (const object of objects) {
    if (!isLiquidGlassEffectInstance(object)) {
      continue
    }

    if (object.enabled === false) {
      continue
    }

    panels.push({
      x: object.payload.panel.x,
      y: object.payload.panel.y,
      width: object.payload.panel.width,
      height: object.payload.panel.height,
      layer: object.payload.panel.layer,
      instanceSettings: object.payload.panel.instanceSettings,
    })
  }

  return sanitizeLiquidGlassPanels(panels)
}
