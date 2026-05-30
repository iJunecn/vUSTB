import { ref, readonly } from 'vue'
import type { TakeoverSurfaceSnapshot } from '@/stores/takeoverSurfaces'

export type TakeoverSurfaceConsumerInput = {
  revision: number
  routeId: string | null
  sceneKey: string | null
  capturedAt: string
  trackedKeys: readonly string[]
  surfaces: readonly TakeoverSurfaceSnapshot[]
}

export type TakeoverSurfaceConsumerInstance = {
  key: string
  kind: string
  routeId: string | null
  sceneKey: string | null
  rect: {
    x: number
    y: number
    width: number
    height: number
  }
  borderRadius: number
  createdAt: string
  updatedAt: string
  sourceRevision: number
}

export type TakeoverSurfaceConsumerState = {
  revision: number
  routeId: string | null
  sceneKey: string | null
  capturedAt: string
  trackedKeys: readonly string[]
  activeCount: number
  instances: readonly TakeoverSurfaceConsumerInstance[]
}

function cloneSurface(surface: TakeoverSurfaceSnapshot): TakeoverSurfaceSnapshot {
  return {
    key: surface.key,
    kind: surface.kind,
    rect: { ...surface.rect },
    borderRadius: surface.borderRadius,
  }
}

export function useTakeoverSurfaceConsumer() {
  const instanceMap = new Map<string, TakeoverSurfaceConsumerInstance>()
  const state = ref<TakeoverSurfaceConsumerState>({
    revision: 0,
    routeId: null,
    sceneKey: null,
    capturedAt: '',
    trackedKeys: [],
    activeCount: 0,
    instances: [],
  })

  function applySnapshot(input: TakeoverSurfaceConsumerInput) {
    const nextKeys = new Set(input.surfaces.map(surface => surface.key))

    for (const key of Array.from(instanceMap.keys())) {
      if (!nextKeys.has(key)) {
        instanceMap.delete(key)
      }
    }

    for (const surface of input.surfaces) {
      const existing = instanceMap.get(surface.key)
      if (existing) {
        existing.kind = surface.kind
        existing.routeId = input.routeId
        existing.sceneKey = input.sceneKey
        existing.rect = { ...surface.rect }
        existing.borderRadius = surface.borderRadius
        existing.updatedAt = input.capturedAt
        existing.sourceRevision = input.revision
        continue
      }

      instanceMap.set(surface.key, {
        key: surface.key,
        kind: surface.kind,
        routeId: input.routeId,
        sceneKey: input.sceneKey,
        rect: { ...surface.rect },
        borderRadius: surface.borderRadius,
        createdAt: input.capturedAt,
        updatedAt: input.capturedAt,
        sourceRevision: input.revision,
      })
    }

    state.value = {
      revision: input.revision,
      routeId: input.routeId,
      sceneKey: input.sceneKey,
      capturedAt: input.capturedAt,
      trackedKeys: [...input.trackedKeys],
      activeCount: instanceMap.size,
      instances: Array.from(instanceMap.values()).map(instance => ({
        ...instance,
        rect: { ...instance.rect },
      })),
    }
  }

  function clear() {
    instanceMap.clear()
    state.value = {
      revision: state.value.revision + 1,
      routeId: null,
      sceneKey: null,
      capturedAt: '',
      trackedKeys: [],
      activeCount: 0,
      instances: [],
    }
  }

  return {
    state: readonly(state),
    applySnapshot,
    clear,
    cloneSurface,
  }
}
