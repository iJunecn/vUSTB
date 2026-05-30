export const GEOMETRY_TEXTURE_UNITS = {
  albedoArray: 0,
  normalArray: 3,
  specularArray: 4,
  variantLut: 5,
  albedo2D: 6,
} as const

export const LIGHTING_TEXTURE_UNITS = {
  rt0: 0,
  rt1: 1,
  depth: 2,
  shadowMap: 3,
  shadowColorMap: 4,
  rt2: 5,
  lightBuffer: 6,
  linearDepth: 7,
  ssao: 8,
  clusterCounts: 9,
  clusterIndices: 10,
  pointShadowMap: 11,
} as const

export const FORWARD_TEXTURE_UNITS = {
  albedoArray: 0,
  shadowMap: 1,
  normalArray: 3,
  specularArray: 4,
  shadowColorMap: 5,
  lightBuffer: 6,
  wboitAccum: 0,
  wboitRevealage: 1,
} as const

export const SSAO_TEXTURE_UNITS = {
  normal: 0,
  depth: 1,
  noise: 2,
} as const

export const POSTPROCESS_TEXTURE_UNITS = {
  current: 0,
  history: 1,
  depth: 2,
} as const

export const UI_TEXTURE_UNITS = {
  input: 0,
  scene: 0,
  blur: 1,
  text: 2,
} as const

export const SHADOW_TEXTURE_UNITS = {
  albedoArray: 0,
  albedo2D: 1,
} as const

export const POINT_SHADOW_TEXTURE_UNITS = {
  albedoArray: 0,
  albedo2D: 1,
} as const
