import { MODEL_STANDARD_LAYOUT_ID, TERRAIN_COMPACT_LAYOUT_ID } from '@render/layout/BuiltinLayouts'
import type { VertexLayoutDescriptor } from '@render/layout/VertexLayoutDescriptor'
import type { RenderDomain } from '@render/layout/VertexLayoutDescriptor'
import type { PipelineKey, PipelineStage, ShaderFamily } from './PipelineKey'

// ---------------------------------------------------------------------------
// 1. 管线契约最小描述
// ---------------------------------------------------------------------------

/**
 * 管线契约最小描述。
 * 这里不关心具体 Program，只关心 shader 语义族、stage 与写入能力是否匹配。
 */
export interface PipelineContract {
  stage: PipelineStage
  shaderTag: string
  shaderFamily: ShaderFamily
  blendMode?: PipelineKey['blendMode']
  writeGBuffer?: boolean
}

export const TERRAIN_PIPELINE_CONTRACTS = {
  deferredOpaque: {
    stage: 'geometry',
    shaderTag: 'terrain.deferred',
    shaderFamily: 'opaque',
    blendMode: 'opaque',
    writeGBuffer: true,
  },
  deferredCutout: {
    stage: 'geometry',
    shaderTag: 'terrain.deferred',
    shaderFamily: 'cutout',
    blendMode: 'masked',
    writeGBuffer: true,
  },
  forwardTranslucent: {
    stage: 'forward',
    shaderTag: 'terrain.forward',
    shaderFamily: 'translucent',
    blendMode: 'translucent',
    writeGBuffer: false,
  },
} as const satisfies Record<string, PipelineContract>

export const ENTITY_PIPELINE_CONTRACTS = {
  deferredCutout: {
    stage: 'geometry',
    shaderTag: 'entity.deferred',
    shaderFamily: 'cutout',
    blendMode: 'masked',
    writeGBuffer: true,
  },
} as const satisfies Record<string, PipelineContract>

export type TerrainPipelineContractName = keyof typeof TERRAIN_PIPELINE_CONTRACTS
export type EntityPipelineContractName = keyof typeof ENTITY_PIPELINE_CONTRACTS

// ---------------------------------------------------------------------------
// 2. 管线准入概况（Pipeline Profile）
//    每个 profile 把契约、域、布局与参与阶段集中描述。
//    pass决定渲染行为，但"我需要为哪些 profile 注册 variant"由这里决定。
// ---------------------------------------------------------------------------

/**
 * 单个管线准入概况。
 * 描述一条渲染路径在哪些渲染阶段参与出图，以及它要求的域和布局约束。
 * pass 侧只需查询"当前 stage 有哪些 profile"，然后为每个 profile 注册 variant。
 */
export interface PipelineProfile {
  /** 人类可读的唯一 profile 名。 */
  name: string
  /** 对应的管线契约。 */
  contract: PipelineContract
  /** 渲染域。 */
  domain: RenderDomain
  /** 要求的顶点布局 ID。 */
  layoutId: string
  /**
   * 该 profile 参与的全部渲染阶段。
   * 与 contract.stage（队列分组用的阶段）独立；
   * 这里描述的是 pass 侧的实际出图阶段。
   */
  renderStages: readonly PipelineStage[]
}

/**
 * 统一管线概况注册表。
 * 新增一条渲染链路时只需要在这里添加一条 profile。
 * pass 侧通过 `getProfilesForRenderStage()` 查询需要注册的 variant 集。
 */
export const PIPELINE_PROFILES: readonly PipelineProfile[] = [
  {
    name: 'terrain.deferred.opaque',
    contract: TERRAIN_PIPELINE_CONTRACTS.deferredOpaque,
    domain: 'terrain',
    layoutId: TERRAIN_COMPACT_LAYOUT_ID,
    renderStages: ['depth-prepass', 'geometry', 'shadow'],
  },
  {
    name: 'terrain.deferred.cutout',
    contract: TERRAIN_PIPELINE_CONTRACTS.deferredCutout,
    domain: 'decal',
    layoutId: TERRAIN_COMPACT_LAYOUT_ID,
    renderStages: ['depth-prepass', 'geometry', 'shadow'],
  },
  {
    name: 'terrain.forward.translucent',
    contract: TERRAIN_PIPELINE_CONTRACTS.forwardTranslucent,
    domain: 'terrain',
    layoutId: TERRAIN_COMPACT_LAYOUT_ID,
    renderStages: ['forward', 'shadow'],
  },
  {
    name: 'entity.deferred.cutout',
    contract: ENTITY_PIPELINE_CONTRACTS.deferredCutout,
    domain: 'entity',
    layoutId: MODEL_STANDARD_LAYOUT_ID,
    renderStages: ['depth-prepass', 'geometry', 'shadow'],
  },
  {
    name: 'entity.deferred.cutout.instanced',
    contract: ENTITY_PIPELINE_CONTRACTS.deferredCutout,
    domain: 'entity',
    layoutId: 'model.standard.instanced.v1',
    renderStages: ['depth-prepass', 'geometry', 'shadow'],
  },
] as const

/**
 * 查询某个渲染阶段需要出图的全部 profile。
 * pass 构造时可以用来决定需要注册哪些 variant。
 */
export function getProfilesForRenderStage(stage: PipelineStage): readonly PipelineProfile[] {
  return PIPELINE_PROFILES.filter(p => p.renderStages.includes(stage))
}

/**
 * 查找与 PipelineKey 匹配的 profile。
 * 匹配条件：contract 字段级一致 + domain 一致 + layoutId 一致。
 */
export function resolveProfile(key: PipelineKey): PipelineProfile | null {
  for (const profile of PIPELINE_PROFILES) {
    if (
      matchesPipelineContract(key, profile.contract) &&
      key.domain === profile.domain &&
      key.layoutId === profile.layoutId
    ) {
      return profile
    }
  }
  return null
}

/**
 * 校验 PipelineKey 是否被至少一条 profile 承认。
 * 返回 true 表示合法，false 表示无任何 profile 承认该组合。
 */
export function isPipelineKeyAdmitted(key: PipelineKey): boolean {
  return resolveProfile(key) !== null
}

// ---------------------------------------------------------------------------
// 3. 单契约匹配函数（向后兼容，pass 内部仍可用）
// ---------------------------------------------------------------------------

/**
 * 判断 PipelineKey 是否满足某一组静态契约。
 * 这一步只做字段级比对，不访问 GPU 资源。
 */
export function matchesPipelineContract(key: PipelineKey, contract: PipelineContract) {
  if (key.stage !== contract.stage) {
    return false
  }
  if (key.shaderTag !== contract.shaderTag) {
    return false
  }
  if (key.shaderFamily !== contract.shaderFamily) {
    return false
  }
  if (contract.blendMode !== undefined && key.blendMode !== contract.blendMode) {
    return false
  }
  if (contract.writeGBuffer !== undefined && !!key.writeGBuffer !== contract.writeGBuffer) {
    return false
  }

  return true
}

export function matchesTerrainPipelineContract(
  key: PipelineKey,
  contractName: TerrainPipelineContractName,
) {
  return matchesPipelineContract(key, TERRAIN_PIPELINE_CONTRACTS[contractName])
}

export function matchesEntityPipelineContract(
  key: PipelineKey,
  contractName: EntityPipelineContractName,
) {
  return matchesPipelineContract(key, ENTITY_PIPELINE_CONTRACTS[contractName])
}

// ---------------------------------------------------------------------------
// 4. 布局×管线兼容性校验
// ---------------------------------------------------------------------------

/**
 * 校验 pipeline 与顶点布局的组合是否合法。
 * 几何阶段必须写 GBuffer，forward 阶段只接受 translucent 族。
 */
export function assertPipelineCompatibility(
  key: PipelineKey,
  layout: VertexLayoutDescriptor,
): void {
  if (!layout.compatibleDomains.includes(key.domain)) {
    throw new Error(`Pipeline domain '${key.domain}' is not compatible with layout '${layout.id}'`)
  }

  if (key.stage === 'geometry') {
    if (key.shaderFamily === 'translucent') {
      throw new Error('Translucent shader family is not compatible with geometry stage buckets')
    }
    if (key.writeGBuffer === false) {
      throw new Error('Geometry stage buckets must write GBuffer data')
    }
  }

  if (key.stage === 'forward') {
    if (key.shaderFamily !== 'translucent') {
      throw new Error('Forward stage currently only supports translucent shader family')
    }
    if (key.writeGBuffer === true) {
      throw new Error('Forward stage buckets must not declare GBuffer writes')
    }
  }

  if (key.shaderTag === 'terrain.deferred' || key.shaderTag === 'terrain.forward') {
    if (layout.id !== TERRAIN_COMPACT_LAYOUT_ID && layout.id !== 'terrain-compact') {
      throw new Error(
        `Terrain shader tag '${key.shaderTag}' requires layout '${TERRAIN_COMPACT_LAYOUT_ID}'`,
      )
    }
  }

  if (layout.id === MODEL_STANDARD_LAYOUT_ID && key.domain === 'terrain') {
    throw new Error(`Layout '${MODEL_STANDARD_LAYOUT_ID}' is not compatible with terrain domain`)
  }
}
