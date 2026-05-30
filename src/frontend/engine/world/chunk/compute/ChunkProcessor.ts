import {
  mesh_chunk_from_sab,
  mesh_chunk_from_sab_into_arena,
  buffer_chunk_data,
  describe_block_state,
  flush_chunk_data,
  init_sab,
  fill_slot_with_air,
  lookup_block_state_id,
  set_mesher_options,
  configure_sab_layout,
} from '@world-core'
import { GAME_CONFIG } from '@/engine/config'
import type { AnyChunkBuildArtifact, ArenaDirectArtifactMeta, ChunkRemeshReason } from '../domain'
import {
  SharedVoxelStore,
  MASK_NORTH,
  MASK_SOUTH,
  MASK_EAST,
  MASK_WEST,
  MASK_FULL,
} from '../memory/SharedVoxelStore'
import { SECTIONS_PER_CHUNK } from '../memory/Layout'

const SAB_START_SECTION_Y = -4

function createMeshSectionFilter(dirtySectionYs?: number[]) {
  if (dirtySectionYs && dirtySectionYs.length > 0) {
    return new Int32Array(dirtySectionYs)
  }

  const fullSectionYs = new Int32Array(SECTIONS_PER_CHUNK)
  for (let index = 0; index < SECTIONS_PER_CHUNK; index++) {
    fullSectionYs[index] = SAB_START_SECTION_Y + index
  }
  return fullSectionYs
}

/**
 * @file ChunkProcessor.ts
 * @brief Worker 侧区块处理流水线
 *
 * 说明：
 *  - 消费主线程已准备好的压缩区块数据
 *  - 负责 SAB 写入、解析完成通知与网格构建
 *  - 通过槽位版本校验避免旧任务覆盖新数据
 */

export interface ChunkMeshResult {
  chunkX: number
  chunkZ: number
  generation?: number
  dirtySectionYs?: number[]
  remeshReason?: ChunkRemeshReason
  fetchMs?: number
  meshMs?: number
  totalMs?: number
  wasmMs?: number
  normalizeMs?: number
  buildMs?: number
  wasmDecodeMs?: number
  wasmGenerateMs?: number
  wasmLegacyPackMs?: number
  wasmArtifactSerializeMs?: number
  wasmJsBridgeMs?: number
  geometry: {
    opaque: {
      interleaved: Uint8Array
      indices?: Uint32Array
    }
    decal: {
      interleaved: Uint8Array
      indices?: Uint32Array
    }
    translucent: {
      interleaved: Uint8Array
      indices?: Uint32Array
    }
  }
  lights: Float32Array
  artifact?: AnyChunkBuildArtifact
}

// Arena 直写路径的网格结果，payload 已直接写入 SAB。
export interface ArenaDirectMeshResult {
  chunkX: number
  chunkZ: number
  generation?: number
  dirtySectionYs?: number[]
  remeshReason?: ChunkRemeshReason
  lights: Float32Array
  arenaUsedBytes: number
  artifactMeta: ArenaDirectArtifactMeta
  meshMs: number
  wasmMs: number
  wasmDecodeMs: number
  wasmGenerateMs: number
  wasmLegacyPackMs: number
  wasmArtifactSerializeMs: number
  wasmJsBridgeMs: number
}

const EMPTY_GEOMETRY = {
  opaque: {
    interleaved: new Uint8Array(0),
    indices: undefined,
  },
  decal: {
    interleaved: new Uint8Array(0),
    indices: undefined,
  },
  translucent: {
    interleaved: new Uint8Array(0),
    indices: undefined,
  },
}

export class ChunkProcessor {
  private onChunkProcessed: (result: ChunkMeshResult, msgId?: number) => void
  private onChunkError: (msgId: number | undefined, error: string) => void

  // 槽位头部视图，用于读取元数据与版本校验。
  private sabManager: SharedVoxelStore | null = null
  private headerView: Int32Array | null = null
  private explicitMaxSlots: number | null = null

  private mesherOptions: { vertexLighting: boolean; smoothLighting: boolean; vertexAO: boolean } = {
    vertexLighting: true,
    smoothLighting: true,
    vertexAO: true,
  }
  private wasmMesherInitialized = false

  constructor(
    onChunkProcessed: (result: ChunkMeshResult, msgId?: number) => void,
    onChunkError: (msgId: number | undefined, error: string) => void,
  ) {
    this.onChunkProcessed = onChunkProcessed
    this.onChunkError = onChunkError
  }

  public setSAB(sab: SharedArrayBuffer) {
    this.sabManager = new SharedVoxelStore(sab)
    // 通过 Int32 视图读取槽位头部，便于配合 Atomics 使用。
    this.headerView = new Int32Array(sab)
  }

  public setExplicitMaxSlots(maxSlots: number) {
    this.explicitMaxSlots = maxSlots
  }

  public initWasmSAB() {
    if (!this.sabManager) return
    try {
      // 先配置 SAB 布局，再初始化 Rust 侧绑定。
      const explicitMaxSlots = this.explicitMaxSlots ?? GAME_CONFIG.CHUNK.SAB_MAX_SLOTS
      configure_sab_layout(explicitMaxSlots)
      init_sab(this.sabManager.sab)
      set_mesher_options(
        this.mesherOptions.vertexLighting,
        this.mesherOptions.smoothLighting,
        this.mesherOptions.vertexAO,
      )
      this.wasmMesherInitialized = true
      console.log('[Worker] Rust SAB initialized with max slots:', explicitMaxSlots)
    } catch (e) {
      console.error('[Worker] Failed to init Rust SAB:', e)
    }
  }

  public setMesherOptions(options: {
    vertexLighting: boolean
    smoothLighting: boolean
    vertexAO: boolean
  }) {
    const vertexLighting = !!options.vertexLighting
    const smoothLighting = !!options.smoothLighting && vertexLighting
    const vertexAO = !!options.vertexAO && smoothLighting

    this.mesherOptions = {
      vertexLighting,
      smoothLighting,
      vertexAO,
    }

    if (this.wasmMesherInitialized) {
      try {
        set_mesher_options(vertexLighting, smoothLighting, vertexAO)
      } catch (error) {
        console.error('[Worker] Failed to update Rust mesher options:', error)
      }
    }
  }

  public ensureBlockStateRegistered(blockState: string) {
    const normalized = normalizeResolvableBlockState(blockState)
    if (!normalized) {
      return -1
    }

    try {
      return lookup_block_state_id(normalized)
    } catch (error) {
      console.warn('[Worker] Failed to ensure blockstate registration:', normalized, error)
      return -1
    }
  }

  public describeBlockState(blockStateId: number) {
    try {
      return describe_block_state(blockStateId >>> 0)
    } catch (error) {
      console.warn('[Worker] Failed to describe blockstate id:', blockStateId, error)
      return ''
    }
  }

  // 校验槽位版本是否仍与任务预期一致。
  private checkSlotVersion(slotIndex: number, expectedVersion: number): boolean {
    if (!this.sabManager) return false
    if (!this.headerView) return false

    const byteOffset = this.sabManager.getSlotOffset(slotIndex)
    const base = (byteOffset / 4) | 0

    // 防止头部读取越界。
    if (base + 3 >= this.headerView.length) return false

    const currentVersion = Atomics.load(this.headerView, base + 2) // 第 2 项存放版本号

    return currentVersion === expectedVersion
  }

  // 通知主线程当前任务已中止，可清理活跃请求状态。
  private notifyAborted(id: number) {
    self.postMessage({ type: 'taskAborted', id })
  }

  /**
   * 解析任务入口。
   *
   * 说明：
   *  - 先用 `buffer_chunk_data` 估算精确的 SAB 占用大小
   *  - 槽位缺失或容量不足时向主线程申请扩容
   *  - 分配完成后再把缓冲数据刷入目标槽位
   */
  async performParse(task: {
    id: number
    chunkX: number
    chunkZ: number
    generation?: number
    chunkData?: Uint8Array
    slotIndex: number // 允许为 -1，表示当前尚未分配槽位
    slotVersion: number
    neighborSlots: Record<number, number>
  }) {
    const { chunkX, chunkZ, generation, chunkData, slotIndex, slotVersion, neighborSlots, id } =
      task

    // 空区块仍然需要槽位，但可以跳过常规解析缓冲流程。
    // 它的 payload 很小，默认最小分配即可容纳。
    const isAir = !chunkData || chunkData.byteLength === 0

    // 第 1 阶段：预解析并估算所需容量。
    if (this.sabManager) {
      if (!isAir) {
        try {
          // `chunkData` 编码格式为 `[compressionType, payload...]`。
          const compression = chunkData[0]
          const payload = chunkData.subarray(1)

          const result = buffer_chunk_data(chunkX, chunkZ, compression, payload)
          const bufferId = result[0]
          const neededBytes = result[1]
          const neededBlocks = Math.ceil(neededBytes / 4096)

          // 第 2 阶段：检查现有槽位是否足够大。

          let currentCapacity = 0
          if (slotIndex !== -1 && this.sabManager.checkSlotValid(slotIndex)) {
            const blocks = this.sabManager.getSlotBlockCount(slotIndex)
            currentCapacity = blocks
          }

          if (slotIndex === -1 || currentCapacity < neededBlocks) {
            self.postMessage({
              type: 'chunkAllocRequest',
              id,
              generation,
              chunkX,
              chunkZ,
              neededBlocks,
              bufferId, // 传回 bufferId，避免把中间数据再发回主线程
            })
            return // 等待主线程分配完成后重新进入
          }

          // 第 3 阶段：把缓冲数据刷入目标槽位。
          flush_chunk_data(bufferId, slotIndex)
        } catch (e) {
          console.error(`[Worker] Phase 1/2 Error ${chunkX},${chunkZ}:`, e)
          this.onChunkError(id, String(e))
          return
        }
      } else {
        // 空区块在没有槽位时先申请一个，再直接写入空气数据。
        if (slotIndex === -1) {
          self.postMessage({
            type: 'chunkAllocRequest',
            id,
            generation,
            chunkX,
            chunkZ,
            neededBlocks: 1, // 空区块只需 1 个 block
            bufferId: 0, // 0 表示空气路径
          })
          return
        }

        if (this.checkSlotVersion(slotIndex, slotVersion)) {
          fill_slot_with_air(slotIndex)
        }
      }
    }

    // 槽位就绪后，继续走统一的解析完成路径。
    const tStart = performance.now()

    this.finalizeParse(
      id,
      chunkX,
      chunkZ,
      generation,
      slotIndex,
      slotVersion,
      neighborSlots,
      tStart,
    )
  }

  /** 解析完成收尾：更新 SAB、通知邻居，并把结果回报主线程。 */
  public finalizeParse(
    id: number,
    chunkX: number,
    chunkZ: number,
    generation: number | undefined,
    slotIndex: number,
    slotVersion: number,
    neighborSlots: Record<number, number>,
    startTime: number,
  ) {
    const fetchMs = 0
    const parseMs = performance.now() - startTime
    const meshCandidates: { cx: number; cz: number }[] = []

    if (this.sabManager) {
      if (!this.checkSlotVersion(slotIndex, slotVersion)) {
        this.notifyAborted(id)
        return
      }
      // 1. 标记中心槽位已就绪。
      this.sabManager.markCenterReady(slotIndex)

      // 2. 若邻域 ready mask 已完整，当前区块可立即进入 mesh 候选。
      const myMask = this.sabManager.getReadyMask(slotIndex)
      if (myMask === MASK_FULL) {
        meshCandidates.push({ cx: chunkX, cz: chunkZ })
      }

      // 3. 把就绪状态传播给四邻域。
      if (neighborSlots[0] !== undefined) {
        const old = this.sabManager.setNeighborBit(neighborSlots[0], MASK_SOUTH)
        if ((old | MASK_SOUTH) === MASK_FULL) meshCandidates.push({ cx: chunkX, cz: chunkZ - 1 })
      }
      if (neighborSlots[1] !== undefined) {
        const old = this.sabManager.setNeighborBit(neighborSlots[1], MASK_NORTH)
        if ((old | MASK_NORTH) === MASK_FULL) meshCandidates.push({ cx: chunkX, cz: chunkZ + 1 })
      }
      if (neighborSlots[2] !== undefined) {
        const old = this.sabManager.setNeighborBit(neighborSlots[2], MASK_WEST)
        if ((old | MASK_WEST) === MASK_FULL) meshCandidates.push({ cx: chunkX + 1, cz: chunkZ })
      }
      if (neighborSlots[3] !== undefined) {
        const old = this.sabManager.setNeighborBit(neighborSlots[3], MASK_EAST)
        if ((old | MASK_EAST) === MASK_FULL) meshCandidates.push({ cx: chunkX - 1, cz: chunkZ })
      }
    }

    self.postMessage({
      type: 'parseComplete',
      id,
      chunkX,
      chunkZ,
      generation,
      fetchMs,
      parseMs,
      meshCandidates,
    })
  }

  /** 主线程完成分配后的二阶段入口。 */
  public handleAllocResponse(
    id: number,
    generation: number | undefined,
    bufferId: number,
    slotIndex: number,
    slotVersion: number,
    neighborSlots: Record<number, number>,
    chunkX: number,
    chunkZ: number,
  ) {
    if (!this.sabManager) return

    // 第 3 阶段：把缓冲数据写入已分配槽位。
    try {
      if (bufferId === 0) {
        // 空区块路径。
        if (this.checkSlotVersion(slotIndex, slotVersion)) {
          fill_slot_with_air(slotIndex)
        }
      } else {
        // 普通区块路径，bufferId > 0 表示已有缓冲数据。
        flush_chunk_data(bufferId, slotIndex)
      }

      // 这里无法精确回溯解析耗时，使用当前时间作为收尾起点。
      const tStart = performance.now()
      this.finalizeParse(
        id,
        chunkX,
        chunkZ,
        generation,
        slotIndex,
        slotVersion,
        neighborSlots,
        tStart,
      )
    } catch (e) {
      console.error(`[Worker] Flush failed for ${chunkX},${chunkZ}:`, e)
      this.onChunkError(id, String(e))
    }
  }

  // 基于 SAB 中的区块状态调用 WASM mesher 构建网格。
  async performMesh(task: {
    id: number
    chunkX: number
    chunkZ: number
    generation?: number
    slotIndex: number
    slotVersion: number
    dirtySectionYs?: number[]
    remeshReason?: ChunkRemeshReason
    neighborSlotIndices: number[] // 以槽位索引替代旧的 centerData/neighborData
  }) {
    const {
      chunkX,
      chunkZ,
      generation,
      slotIndex,
      slotVersion,
      neighborSlotIndices,
      id,
      dirtySectionYs,
      remeshReason,
    } = task

    // 槽位版本失配时立即中止，避免读取过期数据。
    if (!this.checkSlotVersion(slotIndex, slotVersion)) {
      this.notifyAborted(id)
      return
    }

    try {
      const meshStart = performance.now()

      const wasmStart = performance.now()
      const meshSectionFilter = createMeshSectionFilter(dirtySectionYs)
      const resultObj = mesh_chunk_from_sab(
        chunkX,
        chunkZ,
        slotIndex,
        new Uint32Array(neighborSlotIndices),
        meshSectionFilter,
        false,
      )
      const wasmMs = performance.now() - wasmStart

      // Mesh 完成后再次校验版本，防止构建途中槽位被回收。
      if (!this.checkSlotVersion(slotIndex, slotVersion)) {
        this.notifyAborted(id)
        return
      }

      const rawArtifact = resultObj.artifact as AnyChunkBuildArtifact | undefined
      const buildStart = performance.now()
      const geometry = rawArtifact
        ? EMPTY_GEOMETRY
        : {
            opaque: {
              interleaved: resultObj.opaque as Uint8Array,
              indices: resultObj.opaqueIndices as Uint32Array | undefined,
            },
            decal: {
              interleaved: resultObj.decal as Uint8Array,
              indices: resultObj.decalIndices as Uint32Array | undefined,
            },
            translucent: {
              interleaved: resultObj.translucent as Uint8Array,
              indices: resultObj.translucentIndices as Uint32Array | undefined,
            },
          }
      const buildMs = performance.now() - buildStart

      const lights = resultObj.lights
      const artifact = rawArtifact
      const normalizeMs = 0
      const meshMs = performance.now() - meshStart
      const wasmDecodeMs = Number(resultObj.wasmDecodeMs ?? 0)
      const wasmGenerateMs = Number(resultObj.wasmGenerateMs ?? 0)
      const wasmLegacyPackMs = Number(resultObj.wasmLegacyPackMs ?? 0)
      const wasmArtifactSerializeMs = Number(resultObj.wasmArtifactSerializeMs ?? 0)
      const wasmJsBridgeMs = Number(resultObj.wasmJsBridgeMs ?? 0)

      this.onChunkProcessed(
        {
          geometry,
          lights,
          artifact,
          chunkX,
          chunkZ,
          generation,
          dirtySectionYs,
          remeshReason,
          fetchMs: 0, // 解析阶段已单独统计
          meshMs,
          totalMs: meshMs,
          wasmMs,
          normalizeMs,
          buildMs,
          wasmDecodeMs,
          wasmGenerateMs,
          wasmLegacyPackMs,
          wasmArtifactSerializeMs,
          wasmJsBridgeMs,
        },
        id,
      )
    } catch (e: unknown) {
      const err = e as Error
      console.error(`[Worker] Mesh Error ${chunkX},${chunkZ}:`, err)
      this.onChunkError(id, err.message || 'Mesh Failed')
    }
  }

  /**
   * 尝试走零拷贝的 arena-direct 网格构建路径。
   * 调用方需要先分配并初始化 SAB arena，再把数据区视图传入。
   * 槽位版本失配时返回 `null`；WASM 调用失败时抛出异常。
   */
  tryMeshIntoArena(task: {
    chunkX: number
    chunkZ: number
    generation?: number
    slotIndex: number
    slotVersion: number
    dirtySectionYs?: number[]
    remeshReason?: ChunkRemeshReason
    neighborSlotIndices: number[]
    arenaDataView: Uint8Array
  }): ArenaDirectMeshResult | null {
    const {
      chunkX,
      chunkZ,
      generation,
      slotIndex,
      slotVersion,
      neighborSlotIndices,
      dirtySectionYs,
      remeshReason,
      arenaDataView,
    } = task

    if (!this.checkSlotVersion(slotIndex, slotVersion)) {
      return null
    }

    const meshStart = performance.now()
    const wasmStart = performance.now()
    const meshSectionFilter = createMeshSectionFilter(dirtySectionYs)

    const resultObj = mesh_chunk_from_sab_into_arena(
      chunkX,
      chunkZ,
      slotIndex,
      new Uint32Array(neighborSlotIndices),
      meshSectionFilter,
      arenaDataView,
    )

    const wasmMs = performance.now() - wasmStart

    if (!this.checkSlotVersion(slotIndex, slotVersion)) {
      return null
    }

    const artifactMeta = resultObj.artifact as ArenaDirectArtifactMeta

    return {
      chunkX,
      chunkZ,
      generation,
      dirtySectionYs,
      remeshReason,
      lights: resultObj.lights as Float32Array,
      arenaUsedBytes: Number(resultObj.arenaUsedBytes ?? 0),
      artifactMeta,
      meshMs: performance.now() - meshStart,
      wasmMs,
      wasmDecodeMs: Number(resultObj.wasmDecodeMs ?? 0),
      wasmGenerateMs: Number(resultObj.wasmGenerateMs ?? 0),
      wasmLegacyPackMs: Number(resultObj.wasmLegacyPackMs ?? 0),
      wasmArtifactSerializeMs: Number(resultObj.wasmArtifactSerializeMs ?? 0),
      wasmJsBridgeMs: Number(resultObj.wasmJsBridgeMs ?? 0),
    }
  }
}

function normalizeResolvableBlockState(blockState: string) {
  const normalized = blockState.trim()
  if (!normalized || normalized.startsWith('#')) {
    return null
  }

  return normalized
}
