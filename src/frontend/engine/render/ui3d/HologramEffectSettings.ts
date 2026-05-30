/**
 * @file HologramEffectSettings.ts
 * @brief 全息面板效果参数模型
 *
 * 说明：
 *  - 定义 hologram technique 所需的视觉控制参数
 *  - 提供默认配置与演示配置
 *  - 属于 `ui3d` 语义层，不直接绑定具体 uniform 实现
 */

export interface HologramEffectSettings {
  opacity: number
  tint: [number, number, number]
  scanlineDensity: number
  scanlineSpeed: number
  glowStrength: number
  distortionStrength: number
  edgeGlow: number
  gridScale: number
  noiseStrength: number
  cornerRadius: number
}

export function createDefaultHologramEffectSettings(): HologramEffectSettings {
  return {
    opacity: 0.72,
    tint: [0.18, 0.92, 1.0],
    scanlineDensity: 32,
    scanlineSpeed: 0.55,
    glowStrength: 0.42,
    distortionStrength: 4.5,
    edgeGlow: 7,
    gridScale: 11,
    noiseStrength: 0.14,
    cornerRadius: 22,
  }
}

export function createReferenceDemoHologramEffectSettings(): HologramEffectSettings {
  return {
    opacity: 0.8,
    tint: [0.2, 0.96, 1.0],
    scanlineDensity: 38,
    scanlineSpeed: 0.82,
    glowStrength: 0.58,
    distortionStrength: 6.25,
    edgeGlow: 10,
    gridScale: 14,
    noiseStrength: 0.2,
    cornerRadius: 26,
  }
}
