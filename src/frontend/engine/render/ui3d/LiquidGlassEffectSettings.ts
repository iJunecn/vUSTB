/**
 * @file LiquidGlassEffectSettings.ts
 * @brief Liquid Glass 效果参数模型
 *
 * 说明：
 *  - 集中定义 liquid-glass technique 消费的全部参数结构
 *  - 默认值与控制面板 schema 共存于同一模块
 *  - 属于 `ui3d` 语义层，具体 uniform 映射由渲染层负责
 */

export type Vec3 = readonly [number, number, number]

export interface LiquidGlassShapeSettings {
  width: number
  height: number
}

export interface LiquidGlassFlowSettings {
  enabled: boolean
  flowStrength: number
  flowWidth: number
  flowFalloff: number
}

export interface LiquidGlassChromaticSettings {
  enabled: boolean
  chromaticStrength: number
  chromaticWidth: number
  chromaticFalloff: number
  offsetR: number
  offsetG: number
  offsetB: number
}

export interface LiquidGlassHighlightSettings {
  enabled: boolean
  width: number
  angle: number
  strength: number
  range: number
  mode: number
  diagonal: boolean
}

export interface LiquidGlassBlurSettings {
  enabled: boolean
  radius: number
}

export interface LiquidGlassAntiAliasingSettings {
  enabled: boolean
  blurRadius: number
  edgeRange: number
  strength: number
}

export interface LiquidGlassColorGradingSettings {
  enabled: boolean
  brightness: number
  contrast: number
  saturation: number
  hueShift: number
  exposure: number
  gamma: number
  temperature: number
  highlights: number
  shadows: number
  vibrance: number
  fadeout: number
  vignetteStrength: number
  vignetteRadius: number
  vignetteSoftness: number
  shadowColor: Vec3
  midtoneColor: Vec3
  highlightColor: Vec3
}

export interface LiquidGlassColorOverlaySettings {
  enabled: boolean
  color: Vec3
  strength: number
}

export interface LiquidGlassEffectSettings {
  shape: LiquidGlassShapeSettings
  flow: LiquidGlassFlowSettings
  chromaticAberration: LiquidGlassChromaticSettings
  highlight: LiquidGlassHighlightSettings
  blur: LiquidGlassBlurSettings
  antiAliasing: LiquidGlassAntiAliasingSettings
  colorGrading: LiquidGlassColorGradingSettings
  colorOverlay: LiquidGlassColorOverlaySettings
}

export type LiquidGlassControlPath = readonly [string, ...string[]]

export type LiquidGlassControlDefinition =
  | {
      kind: 'boolean'
      path: LiquidGlassControlPath
      label: string
    }
  | {
      kind: 'float' | 'int'
      path: LiquidGlassControlPath
      label: string
      min: number
      max: number
      step: number
    }
  | {
      kind: 'vec3'
      path: LiquidGlassControlPath
      label: string
      min: number
      max: number
      step: number
      channels: readonly [string, string, string]
    }

export interface LiquidGlassControlSection {
  title: string
  controls: readonly LiquidGlassControlDefinition[]
}

export const DEFAULT_LIQUID_GLASS_EFFECT_SETTINGS: LiquidGlassEffectSettings = {
  shape: {
    width: 500,
    height: 500,
  },
  flow: {
    enabled: true,
    flowStrength: 5.0,
    flowWidth: 120,
    flowFalloff: 5.66,
  },
  chromaticAberration: {
    enabled: true,
    chromaticStrength: 5.0,
    chromaticWidth: 60,
    chromaticFalloff: 3.0,
    offsetR: 1.0,
    offsetG: 0.0,
    offsetB: -1.0,
  },
  highlight: {
    enabled: true,
    width: 5.0,
    angle: 225,
    strength: 1.0,
    range: 0.3,
    mode: 1,
    diagonal: true,
  },
  blur: {
    enabled: false,
    radius: 10,
  },
  antiAliasing: {
    enabled: true,
    blurRadius: 2.5,
    edgeRange: 1.0,
    strength: 1.0,
  },
  colorGrading: {
    enabled: false,
    brightness: 0.0,
    contrast: 1.0,
    saturation: 1.0,
    hueShift: 0.0,
    exposure: 0.0,
    gamma: 1.0,
    temperature: 0.0,
    highlights: 0.0,
    shadows: 0.0,
    vibrance: 0.0,
    fadeout: 0.0,
    vignetteStrength: 0.0,
    vignetteRadius: 0.5,
    vignetteSoftness: 0.5,
    shadowColor: [0.0, 0.0, 0.0],
    midtoneColor: [0.0, 0.0, 0.0],
    highlightColor: [0.0, 0.0, 0.0],
  },
  colorOverlay: {
    enabled: true,
    color: [1.0, 0.0, 1.0],
    strength: 0.1,
  },
}

export const LIQUID_GLASS_CONTROL_SECTIONS: readonly LiquidGlassControlSection[] = [
  {
    title: 'Shape',
    controls: [
      { kind: 'int', path: ['shape', 'width'], label: 'Width', min: 100, max: 1000, step: 1 },
      { kind: 'int', path: ['shape', 'height'], label: 'Height', min: 100, max: 1000, step: 1 },
    ],
  },
  {
    title: 'Flow',
    controls: [
      { kind: 'boolean', path: ['flow', 'enabled'], label: 'Enable' },
      {
        kind: 'float',
        path: ['flow', 'flowStrength'],
        label: 'Strength',
        min: 1,
        max: 5,
        step: 0.01,
      },
      { kind: 'int', path: ['flow', 'flowWidth'], label: 'Width', min: 0, max: 200, step: 1 },
      {
        kind: 'float',
        path: ['flow', 'flowFalloff'],
        label: 'Falloff',
        min: 0.5,
        max: 10,
        step: 0.01,
      },
    ],
  },
  {
    title: 'Chromatic Aberration',
    controls: [
      { kind: 'boolean', path: ['chromaticAberration', 'enabled'], label: 'Enable' },
      {
        kind: 'float',
        path: ['chromaticAberration', 'chromaticStrength'],
        label: 'Strength',
        min: 0,
        max: 20,
        step: 0.01,
      },
      {
        kind: 'int',
        path: ['chromaticAberration', 'chromaticWidth'],
        label: 'Width',
        min: 0,
        max: 200,
        step: 1,
      },
      {
        kind: 'float',
        path: ['chromaticAberration', 'chromaticFalloff'],
        label: 'Falloff',
        min: 0.5,
        max: 5,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['chromaticAberration', 'offsetR'],
        label: 'Offset R',
        min: -1,
        max: 1,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['chromaticAberration', 'offsetG'],
        label: 'Offset G',
        min: -1,
        max: 1,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['chromaticAberration', 'offsetB'],
        label: 'Offset B',
        min: -1,
        max: 1,
        step: 0.01,
      },
    ],
  },
  {
    title: 'Highlight',
    controls: [
      { kind: 'boolean', path: ['highlight', 'enabled'], label: 'Enable' },
      { kind: 'float', path: ['highlight', 'width'], label: 'Width', min: 0, max: 50, step: 0.01 },
      { kind: 'int', path: ['highlight', 'angle'], label: 'Angle', min: 0, max: 360, step: 1 },
      {
        kind: 'float',
        path: ['highlight', 'strength'],
        label: 'Strength',
        min: 0,
        max: 1,
        step: 0.01,
      },
      { kind: 'float', path: ['highlight', 'range'], label: 'Range', min: 0, max: 1, step: 0.01 },
      { kind: 'int', path: ['highlight', 'mode'], label: 'Mode', min: 0, max: 1, step: 1 },
      { kind: 'boolean', path: ['highlight', 'diagonal'], label: 'Diagonal' },
    ],
  },
  {
    title: 'Blur',
    controls: [
      { kind: 'boolean', path: ['blur', 'enabled'], label: 'Enable' },
      { kind: 'int', path: ['blur', 'radius'], label: 'Radius', min: 0, max: 50, step: 1 },
    ],
  },
  {
    title: 'Anti-Aliasing',
    controls: [
      { kind: 'boolean', path: ['antiAliasing', 'enabled'], label: 'Enable' },
      {
        kind: 'float',
        path: ['antiAliasing', 'blurRadius'],
        label: 'Blur Radius',
        min: 0,
        max: 10,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['antiAliasing', 'edgeRange'],
        label: 'Edge Range',
        min: 0,
        max: 5,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['antiAliasing', 'strength'],
        label: 'Strength',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },
  {
    title: 'Color Grading',
    controls: [
      { kind: 'boolean', path: ['colorGrading', 'enabled'], label: 'Enable' },
      {
        kind: 'float',
        path: ['colorGrading', 'brightness'],
        label: 'Brightness',
        min: -1,
        max: 1,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['colorGrading', 'contrast'],
        label: 'Contrast',
        min: 0,
        max: 3,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['colorGrading', 'saturation'],
        label: 'Saturation',
        min: 0,
        max: 3,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['colorGrading', 'hueShift'],
        label: 'Hue Shift',
        min: -0.5,
        max: 0.5,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['colorGrading', 'exposure'],
        label: 'Exposure',
        min: -3,
        max: 3,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['colorGrading', 'gamma'],
        label: 'Gamma',
        min: 0.1,
        max: 5,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['colorGrading', 'temperature'],
        label: 'Temperature',
        min: -1,
        max: 1,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['colorGrading', 'highlights'],
        label: 'Highlights',
        min: -1,
        max: 1,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['colorGrading', 'shadows'],
        label: 'Shadows',
        min: -1,
        max: 1,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['colorGrading', 'vibrance'],
        label: 'Vibrance',
        min: -1,
        max: 2,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['colorGrading', 'fadeout'],
        label: 'Fadeout',
        min: 0,
        max: 0.5,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['colorGrading', 'vignetteStrength'],
        label: 'Vignette Strength',
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['colorGrading', 'vignetteRadius'],
        label: 'Vignette Radius',
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: 'float',
        path: ['colorGrading', 'vignetteSoftness'],
        label: 'Vignette Softness',
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: 'vec3',
        path: ['colorGrading', 'shadowColor'],
        label: 'Shadow Color',
        min: -1,
        max: 1,
        step: 0.01,
        channels: ['R', 'G', 'B'],
      },
      {
        kind: 'vec3',
        path: ['colorGrading', 'midtoneColor'],
        label: 'Midtone Color',
        min: -1,
        max: 1,
        step: 0.01,
        channels: ['R', 'G', 'B'],
      },
      {
        kind: 'vec3',
        path: ['colorGrading', 'highlightColor'],
        label: 'Highlight Color',
        min: -1,
        max: 1,
        step: 0.01,
        channels: ['R', 'G', 'B'],
      },
    ],
  },
  {
    title: 'Color Overlay',
    controls: [
      { kind: 'boolean', path: ['colorOverlay', 'enabled'], label: 'Enable' },
      {
        kind: 'vec3',
        path: ['colorOverlay', 'color'],
        label: 'Color',
        min: 0,
        max: 1,
        step: 0.01,
        channels: ['R', 'G', 'B'],
      },
      {
        kind: 'float',
        path: ['colorOverlay', 'strength'],
        label: 'Strength',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },
] as const

export function createDefaultLiquidGlassEffectSettings(): LiquidGlassEffectSettings {
  return JSON.parse(
    JSON.stringify(DEFAULT_LIQUID_GLASS_EFFECT_SETTINGS),
  ) as LiquidGlassEffectSettings
}

export function createReferenceDemoLiquidGlassEffectSettings(): LiquidGlassEffectSettings {
  const settings = createDefaultLiquidGlassEffectSettings()
  settings.highlight.angle = 120
  settings.highlight.range = 0.5
  settings.colorGrading.enabled = true
  settings.colorGrading.saturation = 1.5
  settings.colorOverlay.enabled = true
  settings.colorOverlay.color = [1.0, 0.0, 1.0]
  settings.colorOverlay.strength = 0.1
  return settings
}
