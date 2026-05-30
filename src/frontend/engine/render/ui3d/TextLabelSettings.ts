/**
 * @file TextLabelSettings.ts
 * @brief 文本标签样式参数模型
 *
 * 说明：
 *  - 集中定义 text-label 的排版与视觉样式参数
 *  - 默认配置与演示配置共用同一套结构定义
 *  - 仅描述语义样式，不承担文本栅格化逻辑
 */

export type TextLabelAlign = 'left' | 'center' | 'right'

export interface TextLabelStyle {
  text: string
  fontSize: number
  fontFamily: string
  fontWeight: string
  lineHeight: number
  align: TextLabelAlign
  padding: number
  color: string
  backgroundColor: string
  outlineColor: string
  outlineWidth: number
  shadowColor: string
  shadowBlur: number
  opacity: number
}

export function createDefaultTextLabelStyle(): TextLabelStyle {
  return {
    text: 'UI3D Text',
    fontSize: 18,
    fontFamily: 'Segoe UI, Arial, sans-serif',
    fontWeight: '700',
    lineHeight: 1.2,
    align: 'left',
    padding: 14,
    color: '#f4fbff',
    backgroundColor: 'rgba(10, 16, 24, 0.38)',
    outlineColor: 'rgba(0, 0, 0, 0.72)',
    outlineWidth: 3,
    shadowColor: 'rgba(0, 214, 255, 0.45)',
    shadowBlur: 12,
    opacity: 1,
  }
}

export function createReferenceDemoTextLabelStyle(): TextLabelStyle {
  return {
    text: 'UI3D TEXT\nScreen Composition Lane',
    fontSize: 20,
    fontFamily: 'Segoe UI, Arial, sans-serif',
    fontWeight: '800',
    lineHeight: 1.18,
    align: 'left',
    padding: 16,
    color: '#ecffff',
    backgroundColor: 'rgba(6, 16, 24, 0.24)',
    outlineColor: 'rgba(0, 0, 0, 0.78)',
    outlineWidth: 3,
    shadowColor: 'rgba(30, 220, 255, 0.55)',
    shadowBlur: 16,
    opacity: 0.96,
  }
}
