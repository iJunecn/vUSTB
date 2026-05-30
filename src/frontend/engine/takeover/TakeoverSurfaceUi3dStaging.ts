import { ref, readonly } from 'vue'
import type { TakeoverSurfaceLayer } from '@/constants/takeoverSurface'
import { createLiquidGlassComponent } from '@/engine/render/ui3d/LiquidGlassComponent'
import { useTakeoverLiquidGlassEditor } from '@/hooks/core/takeover/useTakeoverLiquidGlassEditor'
import type { Ui3dComponentInstance } from '@/engine/render/ui3d/Ui3dComponent'
import type { TakeoverSurfaceRenderAdapterInstance } from '@/engine/takeover/TakeoverSurfaceRenderAdapter'

type TakeoverSurfaceUi3dStagingInput = {
  revision: number
  routeId: string | null
  sceneKey: string | null
  capturedAt: string
  activeCount: number
  layerCounts: Record<TakeoverSurfaceLayer, number>
  instances: readonly TakeoverSurfaceRenderAdapterInstance[]
}

export type TakeoverSurfaceUi3dStagingState = {
  revision: number
  routeId: string | null
  sceneKey: string | null
  capturedAt: string
  activeCount: number
  surfaceKeys: readonly string[]
  surfaceLayers: readonly TakeoverSurfaceLayer[]
  layerCounts: Record<TakeoverSurfaceLayer, number>
  components: readonly Ui3dComponentInstance[]
}

const EMPTY_LAYER_COUNTS: Record<TakeoverSurfaceLayer, number> = {
  section: 0,
  article: 0,
  headerbar: 0,
  indicator: 0,
}

export function useTakeoverSurfaceUi3dStaging() {
  const liquidGlassEditor = useTakeoverLiquidGlassEditor()
  const state = ref<TakeoverSurfaceUi3dStagingState>({
    revision: 0,
    routeId: null,
    sceneKey: null,
    capturedAt: '',
    activeCount: 0,
    surfaceKeys: [],
    surfaceLayers: [],
    layerCounts: { ...EMPTY_LAYER_COUNTS },
    components: [],
  })

  function applyRenderAdapterState(adapterState: TakeoverSurfaceUi3dStagingInput) {
    state.value = {
      revision: adapterState.revision,
      routeId: adapterState.routeId,
      sceneKey: adapterState.sceneKey,
      capturedAt: adapterState.capturedAt,
      activeCount: adapterState.activeCount,
      surfaceKeys: adapterState.instances.map(instance => instance.surfaceKey),
      surfaceLayers: adapterState.instances.map(instance => instance.layer),
      layerCounts: { ...adapterState.layerCounts },
      components: adapterState.instances.map((instance, index) => {
        const drawSettings = liquidGlassEditor.resolveDrawSettings({
          routeId: adapterState.routeId,
          sceneKey: adapterState.sceneKey,
          layer: instance.layer,
        })
        const instanceSettings = liquidGlassEditor.resolveInstanceSettings({
          routeId: adapterState.routeId,
          sceneKey: adapterState.sceneKey,
          surfaceKey: instance.surfaceKey,
          kind: instance.kind,
          layer: instance.layer,
          borderRadius: instance.borderRadius,
        })
        return createLiquidGlassComponent(
          instance.id,
          {
            ...instance.effect.payload.panel,
            layer: instance.layer,
            instanceSettings,
          },
          drawSettings,
          instance.layer,
          index,
        )
      }),
    }
  }

  function clear() {
    state.value = {
      revision: state.value.revision + 1,
      routeId: null,
      sceneKey: null,
      capturedAt: '',
      activeCount: 0,
      surfaceKeys: [],
      surfaceLayers: [],
      layerCounts: { ...EMPTY_LAYER_COUNTS },
      components: [],
    }
  }

  return {
    state: readonly(state),
    applyRenderAdapterState,
    clear,
  }
}
