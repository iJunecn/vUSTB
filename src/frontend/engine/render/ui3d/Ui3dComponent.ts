import type { ScreenEffectRect } from '@render/queue/RenderObject'

/**
 * @file Ui3dComponent.ts
 * @brief UI3D 组件协议定义
 *
 * 说明：
 *  - 定义业务层向渲染器提交 UI3D 组件时的统一结构
 *  - 每个组件都携带屏幕矩形、组件类型、属性和排序键
 *  - 后续由 `ScreenEffectComposer` 转换为具体的渲染输入
 */

export const UI3D_COMPONENT_TYPES = ['liquid-glass', 'hologram', 'text-label'] as const
export type Ui3dComponentType = (typeof UI3D_COMPONENT_TYPES)[number]

export interface Ui3dComponentInstance<
  TType extends Ui3dComponentType = Ui3dComponentType,
  TProps = unknown,
> {
  id: number
  componentType: TType
  rect: ScreenEffectRect
  props: TProps
  enabled?: boolean
  sortKey?: number
}
