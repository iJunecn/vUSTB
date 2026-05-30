import init, {
  configure_sab_layout,
  describe_block_state,
  describe_block_state_from_registry,
  get_block_state_flags,
  init_core,
  init_sab,
  init_resources_binary,
  lookup_block_state_id,
  set_dev_logging,
} from '@world-core'
import wasmUrl from '@world-core/world_core_bg.wasm?url'

import { GAME_CONFIG } from '@/engine/config'
import { DEBUG_FLAGS } from '@/config/debug'
import type { ResourceDefinition } from '@/engine/config'
import { loadResourceBinary } from '@/resource/resourceBinary'

export const BLOCK_FLAG_FULL_CUBE = 1 << 1
export const BLOCK_FLAG_OPAQUE_FULL_CUBE = 1 << 2
export const BLOCK_FLAG_WATER_FILLED = 1 << 3
export const BLOCK_FLAG_LAVA = 1 << 4
export const BLOCK_FLAG_DECAL = 1 << 5
export const BLOCK_FLAG_SOLID_RENDER_LAYER = 1 << 6
export const BLOCK_FLAG_TRANSLUCENT_RENDER_LAYER = 1 << 7
export const BLOCK_FLAG_VARIANTS = 1 << 8

class MainThreadBlockStateBridge {
  private wasmInitPromise: Promise<void> | null = null
  private initPromise: Promise<void> | null = null
  private resourceKey: string | null = null
  private currentSab: SharedArrayBuffer | null = null

  public async init(resource: ResourceDefinition, sab: SharedArrayBuffer) {
    if (this.initPromise && this.resourceKey === resource.key && this.currentSab === sab) {
      return this.initPromise
    }

    this.resourceKey = resource.key
    this.currentSab = sab
    this.initPromise = (async () => {
      await this.ensureWasmInitialized()
      configure_sab_layout(GAME_CONFIG.CHUNK.SAB_MAX_SLOTS)
      init_sab(sab)

      init_resources_binary(await loadResourceBinary(resource))
    })()

    return this.initPromise
  }

  private async ensureWasmInitialized() {
    if (!this.wasmInitPromise) {
      this.wasmInitPromise = (async () => {
        await init({ module_or_path: wasmUrl })
        set_dev_logging(DEBUG_FLAGS.rust)
        init_core()
      })()
    }

    return this.wasmInitPromise
  }

  public lookupBlockStateId(blockstate: string) {
    return lookup_block_state_id(blockstate)
  }

  public describeBlockState(blockId: number) {
    return describe_block_state(blockId >>> 0)
  }

  public describeBlockStateFromRegistry(blockId: number) {
    return describe_block_state_from_registry(blockId >>> 0)
  }

  public getBlockStateFlags(blockId: number) {
    return get_block_state_flags(blockId >>> 0) >>> 0
  }

  public describeBlockStateLabel(blockId: number | null | undefined) {
    if (blockId == null) {
      return 'null'
    }

    if (blockId < 0) {
      return `#${blockId}`
    }

    const description =
      this.describeBlockStateFromRegistry(blockId) || this.describeBlockState(blockId)
    return description.length > 0 ? description : `#${blockId}`
  }

  public getInteractionFlags(blockId: number | null | undefined) {
    if (blockId == null) {
      return 0
    }

    if (blockId < 0) {
      return BLOCK_FLAG_FULL_CUBE | BLOCK_FLAG_OPAQUE_FULL_CUBE
    }

    return this.getBlockStateFlags(blockId >>> 0)
  }

  public canRaycastBlockStateId(blockId: number | null | undefined) {
    if (blockId == null) return false
    if (blockId < 0) return true
    return blockId !== 0
  }

  public explainBlockStateID(blockId: number | null | undefined): string {
    if (blockId == null) return `[ID=${blockId}] (Null)`
    const normalized = blockId >>> 0
    const flags = this.getBlockStateFlags(normalized)
    const canRaycast = this.canRaycastBlockStateId(blockId)
    const desc = this.describeBlockStateLabel(blockId)

    return `[ID=${blockId}] Label="${desc}" Flags=${flags.toString(2).padStart(9, '0')} CanRaycast=${canRaycast}`
  }

  public getAirBlockStateId(): number {
    return 0
  }

  public isAirBlockStateId(blockId: number | null | undefined) {
    if (blockId == null) return false
    return blockId === 0
  }
}

export const mainThreadBlockStateBridge = new MainThreadBlockStateBridge()
