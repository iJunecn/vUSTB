import type { LiquidGlassControlSection, Vec3 } from '@render/ui3d/LiquidGlassEffectSettings'

/**
 * @file LiquidGlassInstanceSettings.ts
 * @brief Liquid Glass 实例级参数模型
 *
 * 说明：
 *  - 定义单个 glass panel 相对于全局参数的局部覆盖项
 *  - 与全局效果参数共同构成双层配置结构
 *  - 同时导出控制面板 schema，便于调试界面复用
 */

export interface LiquidGlassInstanceSettings {
  cornerRadius: number
  blurMix: number
  flowStrengthScale: number
  chromaticStrengthScale: number
  highlightStrengthScale: number
  overlayStrengthScale: number
  opacity: number
  overlayColor: Vec3
}

export const DEFAULT_LIQUID_GLASS_INSTANCE_SETTINGS: LiquidGlassInstanceSettings = {
  cornerRadius: 0,
  blurMix: 0.82,
  flowStrengthScale: 1.0,
  chromaticStrengthScale: 1.0,
  highlightStrengthScale: 1.0,
  overlayStrengthScale: 1.0,
  opacity: 1.0,
  overlayColor: [0.0, 0.0, 0.0],
}

export const LIQUID_GLASS_INSTANCE_CONTROL_SECTIONS: readonly LiquidGlassControlSection[] = [
  {
    title: 'Shape',
    controls: [
      {
        kind: 'int',
        path: ['cornerRadius'],
        label: 'Corner Radius',
        min: 0,
        max: 96,
        step: 1,
      },
      {
        kind: 'float',
        path: ['blurMix'],
        label: 'Blur Mix',
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['opacity'],
        label: 'Opacity',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },
  {
    title: 'Multipliers',
    controls: [
      {
        kind: 'float',
        path: ['flowStrengthScale'],
        label: 'Flow Scale',
        min: 0,
        max: 2,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['chromaticStrengthScale'],
        label: 'Chromatic Scale',
        min: 0,
        max: 2,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['highlightStrengthScale'],
        label: 'Highlight Scale',
        min: 0,
        max: 2,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['overlayStrengthScale'],
        label: 'Overlay Scale',
        min: 0,
        max: 2,
        step: 0.01,
      },
    ],
  },
  {
    title: 'Overlay',
    controls: [
      {
        kind: 'vec3',
        path: ['overlayColor'],
        label: 'Overlay Color',
        min: 0,
        max: 1,
        step: 0.01,
        channels: ['R', 'G', 'B'],
      },
    ],
  },
] as const

export function createDefaultLiquidGlassInstanceSettings(
  cornerRadius: number = 0,
): LiquidGlassInstanceSettings {
  const settings = JSON.parse(
    JSON.stringify(DEFAULT_LIQUID_GLASS_INSTANCE_SETTINGS),
  ) as LiquidGlassInstanceSettings
  settings.cornerRadius = Math.max(0, cornerRadius)
  return settings
}
