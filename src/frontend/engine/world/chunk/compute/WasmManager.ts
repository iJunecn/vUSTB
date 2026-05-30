import init, {
  init_colormaps,
  init_core,
  init_resources_binary,
  set_dev_logging,
  set_fluid_texture_indices,
} from '@world-core'
import wasmUrl from '@world-core/world_core_bg.wasm?url'

import { DEBUG_FLAGS, debugLog, debugWarn } from '@/config/debug'
import type { ResourceDefinition } from '@/engine/config'
import { loadMinecraftColormap } from './colormap'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface WorkerResources {
  textureMap: any
  binary: Uint8Array
  resource: ResourceDefinition
  mesherOptions?: {
    vertexLighting: boolean
    smoothLighting: boolean
    vertexAO: boolean
  }
}

const DEFAULT_FLUID_TEXTURES = {
  waterFlow: 1818,
  waterOverlay: 1819,
  waterStill: 1820,
  lavaFlow: 1148,
  lavaStill: 1149,
}

/**
 * @file WasmManager.ts
 * @brief Worker 侧 WASM 引导器
 *
 * 说明：
 *  - 负责 WASM 模块的单次初始化
 *  - 负责资源二进制与颜色图的装载
 *  - 为 Rust 侧准备流体纹理索引等运行参数
 */
export class WasmManager {
  private initialized = false

  // 加载并初始化 WASM 模块，确保只执行一次。
  async init() {
    if (this.initialized) return

    try {
      // 加载并实例化 WASM 模块。
      await init({ module_or_path: wasmUrl })
      // 初始化 Rust 侧核心状态。
      set_dev_logging(DEBUG_FLAGS.rust)
      init_core()
      this.initialized = true
      debugLog(DEBUG_FLAGS.worker, '[Worker] WASM initialized')
    } catch (e) {
      console.error('[Worker] WASM init failed:', e)
      throw e
    }
  }

  // 将主线程准备好的资源同步到 Rust 侧。
  initResources(resources: WorkerResources) {
    if (!this.initialized) {
      throw new Error('WASM not initialized')
    }

    const { binary } = resources

    if (binary) {
      // 优先走二进制资源初始化路径。
      try {
        init_resources_binary(binary)
        this.initFluidTextureIndices(resources.textureMap)
        debugLog(DEBUG_FLAGS.worker, '[Worker] Resources initialized using binary format')
      } catch (e) {
        console.error('[Worker] init_resources_binary failed:', e)
        throw e // 继续抛出异常，终止当前 Worker 初始化。
      }
    } else {
      throw new Error('[Worker] Missing binary resources')
    }
  }

  private initFluidTextureIndices(textureMap: unknown) {
    const lookup = (key: string) => {
      if (textureMap instanceof Map) {
        return textureMap.get(key)
      }
      if (textureMap && typeof textureMap === 'object') {
        const record = textureMap as Record<string, number>
        return record[key]
      }
      return undefined
    }

    const pick = (candidates: string[], fallback: number) => {
      for (const name of candidates) {
        const v = lookup(name)
        if (typeof v === 'number' && Number.isFinite(v)) return v
      }
      return fallback
    }

    const waterFlow = pick(
      ['water_flow', 'block/water_flow', 'minecraft:block/water_flow'],
      DEFAULT_FLUID_TEXTURES.waterFlow,
    )
    const waterOverlay = pick(
      ['water_overlay', 'block/water_overlay', 'minecraft:block/water_overlay'],
      DEFAULT_FLUID_TEXTURES.waterOverlay,
    )
    const waterStill = pick(
      ['water_still', 'block/water_still', 'minecraft:block/water_still'],
      DEFAULT_FLUID_TEXTURES.waterStill,
    )
    const lavaFlow = pick(
      ['lava_flow', 'block/lava_flow', 'minecraft:block/lava_flow'],
      DEFAULT_FLUID_TEXTURES.lavaFlow,
    )
    const lavaStill = pick(
      ['lava_still', 'block/lava_still', 'minecraft:block/lava_still'],
      DEFAULT_FLUID_TEXTURES.lavaStill,
    )

    set_fluid_texture_indices(waterFlow, waterOverlay, waterStill, lavaFlow, lavaStill)
  }

  async initColormaps(resource: ResourceDefinition) {
    if (!this.initialized) {
      throw new Error('WASM not initialized')
    }

    try {
      const grass = await loadMinecraftColormap(resource, 'grass')
      const foliage = await loadMinecraftColormap(resource, 'foliage')

      if (!grass || !foliage) {
        debugWarn(
          DEBUG_FLAGS.worker,
          '[Worker] Missing/invalid colormaps; biome tint will fallback',
        )
        return
      }

      init_colormaps(
        grass.data,
        grass.width,
        grass.height,
        foliage.data,
        foliage.width,
        foliage.height,
      )
      debugLog(DEBUG_FLAGS.worker, '[Worker] Colormaps initialized')
    } catch (e) {
      debugWarn(DEBUG_FLAGS.worker, '[Worker] Colormap init failed; biome tint will fallback', e)
    }
  }

  // 返回当前初始化状态，供外层做短路判断。
  isInitialized() {
    return this.initialized
  }
}
