import type {
  ScreenEffectInstance,
  ScreenEffectRect,
  ScreenEffectType,
} from '@render/queue/RenderObject'
import type { TextLabelStyle } from '@render/ui3d/TextLabelSettings'

/**
 * @file TextLabel.ts
 * @brief 文本标签屏幕效果适配层
 *
 * 说明：
 *  - 将 `text-label` 组件语义转换为 `ScreenEffectInstance`
 *  - 负责过滤非法输入并生成稳定快照
 *  - 为后续 composer 与 technique 提供统一的效果契约
 */

export const TEXT_LABEL_EFFECT_TYPE = 'text-label' as const satisfies ScreenEffectType

export interface TextLabelEffectPayload {
  style: TextLabelStyle
}

export interface TextLabelEffectInstance
  extends ScreenEffectInstance<typeof TEXT_LABEL_EFFECT_TYPE, TextLabelEffectPayload> {
  effectType: typeof TEXT_LABEL_EFFECT_TYPE
  domain: 'ui3d'
}

export function createTextLabelEffectInstance(
  id: number,
  rect: ScreenEffectRect,
  style: TextLabelStyle,
  sortKey: number = 0,
): TextLabelEffectInstance {
  return {
    id,
    kind: 'screen-effect',
    domain: 'ui3d',
    effectType: TEXT_LABEL_EFFECT_TYPE,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    payload: {
      style: JSON.parse(JSON.stringify(style)) as TextLabelStyle,
    },
    enabled: true,
    sortKey,
  }
}

export function isTextLabelEffectInstance(
  object: ScreenEffectInstance,
): object is TextLabelEffectInstance {
  return object.effectType === TEXT_LABEL_EFFECT_TYPE
}

export function sanitizeTextLabelEffects(
  labels: readonly TextLabelEffectInstance[],
): TextLabelEffectInstance[] {
  return labels
    .filter(
      label => label.rect.width > 0 && label.rect.height > 0 && label.payload.style.text.length > 0,
    )
    .sort((left, right) => (left.sortKey ?? 0) - (right.sortKey ?? 0))
    .map(label => ({
      ...label,
      rect: {
        x: label.rect.x,
        y: label.rect.y,
        width: label.rect.width,
        height: label.rect.height,
      },
      payload: {
        style: JSON.parse(JSON.stringify(label.payload.style)) as TextLabelStyle,
      },
    }))
}
