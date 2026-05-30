import type { TextLabelStyle } from '@render/ui3d/TextLabelSettings'
import type { Ui3dComponentInstance } from '@render/ui3d/Ui3dComponent'

/**
 * @file TextLabelComponent.ts
 * @brief 文本标签 UI3D 组件工厂
 *
 * 说明：
 *  - 将文本样式与屏幕矩形包装为标准 UI3D 组件
 *  - 创建时深拷贝文本样式，避免与业务态共享引用
 *  - 排序键决定同帧多个文本标签的绘制顺序
 */

export const TEXT_LABEL_COMPONENT_TYPE = 'text-label' as const

export interface TextLabelComponentProps {
  style: TextLabelStyle
}

export interface TextLabelComponentInstance
  extends Ui3dComponentInstance<typeof TEXT_LABEL_COMPONENT_TYPE, TextLabelComponentProps> {
  componentType: typeof TEXT_LABEL_COMPONENT_TYPE
}

export function createTextLabelComponent(
  id: number,
  rect: { x: number; y: number; width: number; height: number },
  style: TextLabelStyle,
  sortKey: number = 0,
): TextLabelComponentInstance {
  return {
    id,
    componentType: TEXT_LABEL_COMPONENT_TYPE,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    props: {
      style: JSON.parse(JSON.stringify(style)) as TextLabelStyle,
    },
    enabled: true,
    sortKey,
  }
}

export function isTextLabelComponent(
  component: Ui3dComponentInstance,
): component is TextLabelComponentInstance {
  return component.componentType === TEXT_LABEL_COMPONENT_TYPE
}
