import { ref, readonly } from 'vue'
import {
  createLiquidGlassEffectInstance,
  type LiquidGlassEffectInstance,
} from '@/engine/render/ui3d/LiquidGlassPanel'
import { resolveTakeoverSurfaceLayer, type TakeoverSurfaceLayer } from '@/constants/takeoverSurface'
import type { TakeoverSurfaceConsumerInstance } from '@/engine/takeover/TakeoverSurfaceConsumer'

type TakeoverSurfaceRenderAdapterInput = {
  revision: number
  routeId: string | null
  sceneKey: string | null
  capturedAt: string
  trackedKeys: readonly string[]
  activeCount: number
  instances: readonly TakeoverSurfaceConsumerInstance[]
}

export type TakeoverSurfaceRenderAdapterInstance = {
  id: number
  surfaceKey: string
  kind: string
  layer: TakeoverSurfaceLayer
  borderRadius: number
  effect: LiquidGlassEffectInstance
}

export type TakeoverSurfaceRenderAdapterState = {
  revision: number
  routeId: string | null
  sceneKey: string | null
  capturedAt: string
  activeCount: number
  layerCounts: Record<TakeoverSurfaceLayer, number>
  instances: readonly TakeoverSurfaceRenderAdapterInstance[]
}

const EMPTY_LAYER_COUNTS: Record<TakeoverSurfaceLayer, number> = {
  section: 0,
  article: 0,
  headerbar: 0,
  indicator: 0,
}

function createAdapterInstance(
  id: number,
  source: TakeoverSurfaceConsumerInstance,
  sortKey: number,
): TakeoverSurfaceRenderAdapterInstance {
  const layer = resolveTakeoverSurfaceLayer(source.kind)

  return {
    id,
    surfaceKey: source.key,
    kind: source.kind,
    layer,
    borderRadius: source.borderRadius,
    effect: createLiquidGlassEffectInstance(
      id,
      {
        x: source.rect.x,
        y: source.rect.y,
        width: source.rect.width,
        height: source.rect.height,
      },
      sortKey,
    ),
  }
}

export function useTakeoverSurfaceRenderAdapter() {
  const idBySurfaceKey = new Map<string, number>()
  let nextId = 1

  const state = ref<TakeoverSurfaceRenderAdapterState>({
    revision: 0,
    routeId: null,
    sceneKey: null,
    capturedAt: '',
    activeCount: 0,
    layerCounts: { ...EMPTY_LAYER_COUNTS },
    instances: [],
  })

  function applyConsumerState(consumerState: TakeoverSurfaceRenderAdapterInput) {
    const nextInstances = consumerState.instances.map((instance, index) => {
      const id = idBySurfaceKey.get(instance.key) ?? nextId++
      idBySurfaceKey.set(instance.key, id)
      return createAdapterInstance(id, instance, index)
    })

    const activeKeys = new Set(nextInstances.map(instance => instance.surfaceKey))
    for (const key of Array.from(idBySurfaceKey.keys())) {
      if (!activeKeys.has(key)) {
        idBySurfaceKey.delete(key)
      }
    }

    const layerCounts = { ...EMPTY_LAYER_COUNTS }
    for (const instance of nextInstances) {
      layerCounts[instance.layer] += 1
    }

    state.value = {
      revision: consumerState.revision,
      routeId: consumerState.routeId,
      sceneKey: consumerState.sceneKey,
      capturedAt: consumerState.capturedAt,
      activeCount: nextInstances.length,
      layerCounts,
      instances: nextInstances,
    }
  }

  function clear() {
    idBySurfaceKey.clear()
    state.value = {
      revision: state.value.revision + 1,
      routeId: null,
      sceneKey: null,
      capturedAt: '',
      activeCount: 0,
      layerCounts: { ...EMPTY_LAYER_COUNTS },
      instances: [],
    }
  }

  return {
    state: readonly(state),
    applyConsumerState,
    clear,
  }
}
