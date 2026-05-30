import type { GeometryHandle } from '../backend/GeometryHandle'
import type { ShaderFamily } from '../backend/PipelineKey'
import type { RenderDomain } from '../layout/VertexLayoutDescriptor'

export type ScreenEffectDomain = 'ui3d' | 'debug'
export const SCREEN_EFFECT_TYPES = ['liquid-glass-panel', 'hologram-panel', 'text-label'] as const
export type ScreenEffectType = (typeof SCREEN_EFFECT_TYPES)[number]

export interface RenderBounds {
  min: Float32Array
  max: Float32Array
  boundingSphere?: Float32Array
}

export interface MaterialFeatureFlags {
  alphaMask?: boolean
  translucent?: boolean
  receivesLighting?: boolean
}

export interface MaterialGpuResources {
  albedoTexture2D?: WebGLTexture | null
  albedoTextureArray2D?: WebGLTexture | null
}

export interface MaterialHandle {
  id: number
  domain: RenderDomain
  blendMode: 'opaque' | 'masked' | 'translucent' | 'additive'
  doubleSided: boolean
  shaderTag: string
  shaderFamily?: ShaderFamily
  textures?: Record<string, number>
  constants?: Record<string, number | Float32Array>
  resources?: MaterialGpuResources
  features?: MaterialFeatureFlags
}

export interface ScreenEffectRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ScreenEffectInstance<
  TType extends ScreenEffectType = ScreenEffectType,
  TPayload = unknown,
> {
  id: number
  kind: 'screen-effect'
  // ScreenEffect is the engine-level primitive. UI-facing code can map this to ui3d semantics.
  domain: ScreenEffectDomain
  effectType: TType
  rect: ScreenEffectRect
  payload: TPayload
  enabled?: boolean
  sortKey?: number
}

export interface RenderObject {
  id: number
  domain: RenderDomain
  transform: Float32Array
  bounds: RenderBounds
  geometry: GeometryHandle
  material: MaterialHandle
  mainViewVisible: boolean
  visibilityMask: number
  transparent: boolean
  castShadow: boolean
  receiveShadow: boolean
  sortKey?: number
}
