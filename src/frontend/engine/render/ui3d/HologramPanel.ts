import type { ScreenEffectInstance, ScreenEffectType } from '@render/queue/RenderObject'
import type { HologramEffectSettings } from '@render/ui3d/HologramEffectSettings'

/**
 * @file HologramPanel.ts
 * @brief 全息面板屏幕效果适配层
 *
 * 说明：
 *  - 将 hologram 面板语义转换为 `ScreenEffectInstance`
 *  - 负责过滤无效输入并限制每帧最大面板数量
 *  - 让 UI3D 调用方无需感知底层 effect handler 细节
 */

export const HOLOGRAM_EFFECT_TYPE = 'hologram-panel' as const satisfies ScreenEffectType

export interface HologramPanel {
  x: number
  y: number
  width: number
  height: number
}

export interface HologramEffectPayload {
  panel: HologramPanel
  settings: HologramEffectSettings
}

export const MAX_HOLOGRAM_PANELS = 4

export function sanitizeHologramPanels(
  panels: readonly HologramEffectInstance[],
): HologramEffectInstance[] {
  return panels
    .filter(panel => panel.payload.panel.width > 0 && panel.payload.panel.height > 0)
    .slice(0, MAX_HOLOGRAM_PANELS)
    .map(panel => ({
      ...panel,
      rect: {
        x: panel.rect.x,
        y: panel.rect.y,
        width: panel.rect.width,
        height: panel.rect.height,
      },
      payload: {
        panel: {
          x: panel.payload.panel.x,
          y: panel.payload.panel.y,
          width: panel.payload.panel.width,
          height: panel.payload.panel.height,
        },
        settings: JSON.parse(JSON.stringify(panel.payload.settings)) as HologramEffectSettings,
      },
    }))
}

export interface HologramEffectInstance
  extends ScreenEffectInstance<typeof HOLOGRAM_EFFECT_TYPE, HologramEffectPayload> {
  effectType: typeof HOLOGRAM_EFFECT_TYPE
  domain: 'ui3d'
}

export function createHologramEffectInstance(
  id: number,
  panel: HologramPanel,
  settings: HologramEffectSettings,
  sortKey: number = 0,
): HologramEffectInstance {
  return {
    id,
    kind: 'screen-effect',
    domain: 'ui3d',
    effectType: HOLOGRAM_EFFECT_TYPE,
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
      },
      settings: JSON.parse(JSON.stringify(settings)) as HologramEffectSettings,
    },
    enabled: true,
    sortKey,
  }
}

export function isHologramEffectInstance(
  object: ScreenEffectInstance,
): object is HologramEffectInstance {
  return object.effectType === HOLOGRAM_EFFECT_TYPE
}
