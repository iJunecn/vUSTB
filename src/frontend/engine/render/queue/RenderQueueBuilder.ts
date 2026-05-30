import type { RenderQueue, RenderBucket } from '../backend/IRenderBackend'
import { isPipelineKeyAdmitted } from '../backend/PipelineContracts'
import { pipelineKeyToString, type PipelineKey, type ShaderFamily } from '../backend/PipelineKey'
import { TERRAIN_COMPACT_LAYOUT_ID } from '../layout/BuiltinLayouts'
import { type RenderObject } from './RenderObject'

function createDefaultPipelineKey(family: ShaderFamily): PipelineKey {
  return {
    stage: family === 'translucent' ? 'forward' : 'geometry',
    domain: family === 'cutout' ? 'decal' : 'terrain',
    layoutId: TERRAIN_COMPACT_LAYOUT_ID,
    shaderTag: family === 'translucent' ? 'terrain.forward' : 'terrain.deferred',
    shaderFamily: family,
    blendMode: family === 'translucent' ? 'translucent' : family === 'cutout' ? 'masked' : 'opaque',
    doubleSided: false,
    writeGBuffer: family !== 'translucent',
    gbufferSchemaId: family === 'translucent' ? undefined : 'default',
    receiveShadow: true,
    castShadow: true,
  }
}

function inferShaderFamily(object: RenderObject): ShaderFamily {
  const mat = object.material
  if (mat.shaderFamily) {
    return mat.shaderFamily
  }

  if (mat.blendMode === 'translucent' || mat.blendMode === 'additive' || object.transparent) {
    return 'translucent'
  }

  if (mat.blendMode === 'masked' || mat.features?.alphaMask) {
    return 'cutout'
  }

  const submeshPass = object.geometry.submeshes[0]?.pass
  if (submeshPass === 'decal' || object.domain === 'decal') {
    return 'cutout'
  }

  return 'opaque'
}

function inferPipelineKey(object: RenderObject): PipelineKey {
  const shaderFamily = inferShaderFamily(object)

  // If the object has a material with explicit pipeline properties, use them
  const mat = object.material
  if (mat && mat.domain !== 'terrain' && mat.domain !== 'decal') {
    return {
      stage: shaderFamily === 'translucent' ? 'forward' : 'geometry',
      domain: mat.domain,
      layoutId: object.geometry.layoutId,
      shaderTag: mat.shaderTag,
      shaderFamily,
      blendMode: mat.blendMode,
      doubleSided: mat.doubleSided,
      writeGBuffer: shaderFamily !== 'translucent',
      gbufferSchemaId: shaderFamily === 'translucent' ? undefined : 'default',
      receiveShadow: object.receiveShadow,
      castShadow: object.castShadow,
    }
  }

  return createDefaultPipelineKey(shaderFamily)
}

export class RenderQueueBuilder {
  private readonly _rejectedKeys = new Set<string>()

  public build(objects: Iterable<RenderObject>) {
    const bucketsByStage = new Map<PipelineKey['stage'], Map<string, RenderBucket>>()

    for (const object of objects) {
      const key = inferPipelineKey(object)

      // 准入校验：只有被至少一条 profile 承认的 key 才能进入队列。
      if (!isPipelineKeyAdmitted(key)) {
        const ks = pipelineKeyToString(key)
        if (!this._rejectedKeys.has(ks)) {
          this._rejectedKeys.add(ks)
          console.warn(`[RenderQueueBuilder] Rejected unadmitted PipelineKey: ${ks}`)
        }
        continue
      }

      let stageBuckets = bucketsByStage.get(key.stage)
      if (!stageBuckets) {
        stageBuckets = new Map<string, RenderBucket>()
        bucketsByStage.set(key.stage, stageBuckets)
      }

      const keyString = pipelineKeyToString(key)
      let bucket = stageBuckets.get(keyString)
      if (!bucket) {
        bucket = { key, objects: [] }
        stageBuckets.set(keyString, bucket)
      }

      bucket.objects.push(object)
    }

    const queues: RenderQueue[] = []
    for (const [stage, buckets] of bucketsByStage) {
      const bucketList = [...buckets.values()]
      if (stage === 'forward') {
        for (const bucket of bucketList) {
          if (bucket.key.blendMode === 'translucent') {
            bucket.objects.sort((a, b) => (b.sortKey ?? 0) - (a.sortKey ?? 0))
          }
        }
      }
      queues.push({
        stage,
        buckets: bucketList,
      })
    }

    return queues
  }
}
