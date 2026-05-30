import type { RenderDomain } from '../layout/VertexLayoutDescriptor'

// 着色族决定 alpha test / blend 路径，不直接等同于材质类型。
export type ShaderFamily = 'opaque' | 'cutout' | 'translucent'

// stage 反映 DrawCall 所属的渲染阶段。
export type PipelineStage =
  | 'depth-prepass'
  | 'geometry'
  | 'shadow'
  | 'forward'
  | 'velocity'
  | 'debug'

/**
 * 单个渲染桶的状态键。
 * 若两个对象的 PipelineKey 不一致，则至少有一项 GPU 状态不能安全复用。
 */
export interface PipelineKey {
  stage: PipelineStage
  domain: RenderDomain
  layoutId: string
  shaderTag: string
  shaderFamily: ShaderFamily
  blendMode: 'opaque' | 'masked' | 'translucent' | 'additive'
  doubleSided: boolean
  writeGBuffer?: boolean
  gbufferSchemaId?: string
  receiveShadow?: boolean
  castShadow?: boolean
}

/**
 * 把 PipelineKey 压平成稳定字符串。
 * 字段顺序固定，便于 Map key 与调试日志直接比较。
 */
export function pipelineKeyToString(key: PipelineKey) {
  return [
    key.stage,
    key.domain,
    key.layoutId,
    key.shaderTag,
    key.shaderFamily,
    key.blendMode,
    key.doubleSided ? 'double' : 'single',
    key.writeGBuffer ? 'gbuffer' : 'no-gbuffer',
    key.gbufferSchemaId || 'default',
    key.receiveShadow ? 'recv-shadow' : 'no-recv-shadow',
    key.castShadow ? 'cast-shadow' : 'no-cast-shadow',
  ].join('|')
}
