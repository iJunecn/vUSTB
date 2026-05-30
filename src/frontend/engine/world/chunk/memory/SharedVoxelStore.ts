import { HeapAllocator } from './HeapAllocator'
import {
  MAX_SLOTS,
  REGISTRY_HASH_BYTES,
  REGISTRY_ID_COUNTER_OFFSET,
  REGISTRY_STRING_COUNTER_OFFSET,
  REGISTRY_REVERSE_OFFSET,
  REGISTRY_REVERSE_BYTES,
  REGISTRY_STRING_POOL_OFFSET,
  REGISTRY_STRING_POOL_BYTES,
  SLOT_HEADER_BYTES,
  HEADER_AREA_START,
  DATA_HEAP_START,
  DEFAULT_BLOCKS_PER_CHUNK,
  MASK_CENTER,
  BLOCK_SIZE,
  SLOT_HEADER_INT32S,
  SECTION_ENTRY_BYTES,
  SECTION_INDEX_BYTES,
  BIOME_MAP_BYTES,
  BLOCKS_PER_SECTION,
} from './Layout'

// 兼容旧调用方，继续透出布局常量。
export * from './Layout'

interface ExtendedGlobal {
  SharedArrayBuffer?: typeof SharedArrayBuffer
  crossOriginIsolated?: boolean
}

const SharedArrayBufferCtor: typeof SharedArrayBuffer | undefined =
  typeof globalThis !== 'undefined'
    ? (globalThis as unknown as ExtendedGlobal).SharedArrayBuffer
    : undefined

const isCrossOriginIsolated =
  typeof globalThis !== 'undefined' &&
  (globalThis as unknown as ExtendedGlobal).crossOriginIsolated === true

function ensureSharedArrayBufferSupport(): void {
  if (!SharedArrayBufferCtor) {
    const isolationState =
      typeof globalThis !== 'undefined' &&
      (globalThis as unknown as ExtendedGlobal).crossOriginIsolated === false
        ? 'cross-origin isolation disabled (missing COOP/COEP headers)'
        : 'this browser does not expose SharedArrayBuffer yet'
    throw new Error(`[ChunkAtlas] SharedArrayBuffer unavailable: ${isolationState}`)
  }
  if (!isCrossOriginIsolated) {
    console.warn(
      '[ChunkAtlas] SharedArrayBuffer present but page is not crossOriginIsolated. Atomics will fail on some browsers. Ensure COOP/COEP headers are set.',
    )
  }
}

/**
 * @file SharedVoxelStore.ts
 * @brief 基于 SharedArrayBuffer 的体素共享存储
 *
 * 说明：
 *  - 在主线程与多个 Worker 之间共享区块体素数据与槽位元数据
 *  - 通过 Atomics 维护槽位版本、就绪位与分配信息
 *  - 结合 `HeapAllocator` 管理 payload 区的连续块分配与整理
 */
export class SharedVoxelStore {
  // 整体共享内存缓冲区。
  public readonly sab: SharedArrayBuffer
  // 基础视图，用于字节级写入与读取。
  private readonly bufferView: Uint8Array
  private readonly headerView: Int32Array
  private readonly dataView: DataView

  // 全局注册表相关视图。
  private readonly registryView: Uint32Array
  private readonly nextIdCounter: Uint32Array
  private readonly registryStringCounter: Uint32Array
  private readonly reverseRegistryView: Uint32Array

  // 槽位状态。
  public readonly totalSlots: number = MAX_SLOTS
  private readonly freeSlots: number[] = [] // 空闲槽位 ID 栈
  private readonly slotVersions: Uint32Array

  // 载荷区分配器。
  private readonly allocator: HeapAllocator
  public readonly totalBlocks: number

  // 区块键到槽位索引的映射。
  private readonly chunkMap = new Map<string, number>()

  /** 空气方块的规范 ID；0 表示空气。 */
  public static AIR_BLOCK_ID = 0
  public static AIR_BLOCK_IDS = new Set<number>([0])

  /**
   * @param sizeMBOrBuffer 共享内存大小，单位 MB；也可直接传入现成的 SharedArrayBuffer
   */
  constructor(sizeMBOrBuffer: number | SharedArrayBuffer = 128) {
    ensureSharedArrayBufferSupport()
    const SabCtor = SharedArrayBufferCtor!

    if (typeof sizeMBOrBuffer !== 'number' && sizeMBOrBuffer instanceof SabCtor) {
      this.sab = sizeMBOrBuffer
    } else {
      const sizeMB = sizeMBOrBuffer
      const totalBytes = sizeMB * 1024 * 1024

      // 最小容量保护，避免 header 与 data heap 重叠。
      if (totalBytes < DATA_HEAP_START + 1024 * 1024) {
        throw new Error(
          `[ChunkAtlas] SAB size too small. Min: ${(DATA_HEAP_START / 1024 / 1024).toFixed(1)}MB`,
        )
      }

      console.log(`[ChunkAtlas] Allocating ${sizeMB}MB. Max Slots: ${this.totalSlots}.`)

      try {
        this.sab = new SabCtor(totalBytes)
      } catch (e) {
        console.error('[ChunkAtlas] SharedArrayBuffer not supported! Check COOP/COEP headers.')
        throw e
      }
    }

    this.bufferView = new Uint8Array(this.sab)
    this.headerView = new Int32Array(this.sab)
    this.dataView = new DataView(this.sab)

    // 初始化 payload 区分配器。
    const heapBytes = this.sab.byteLength - DATA_HEAP_START
    this.totalBlocks = Math.floor(heapBytes / BLOCK_SIZE)
    this.allocator = new HeapAllocator(this.totalBlocks)
    console.log(
      `[ChunkAtlas] Heap Capacity: ${this.totalBlocks} blocks (${(heapBytes / 1024 / 1024).toFixed(1)} MB)`,
    )

    // 初始化全局注册表视图。
    this.registryView = new Uint32Array(this.sab, 0, REGISTRY_HASH_BYTES / 4)
    this.nextIdCounter = new Uint32Array(this.sab, REGISTRY_ID_COUNTER_OFFSET, 1)
    this.registryStringCounter = new Uint32Array(this.sab, REGISTRY_STRING_COUNTER_OFFSET, 1)
    this.reverseRegistryView = new Uint32Array(
      this.sab,
      REGISTRY_REVERSE_OFFSET,
      REGISTRY_REVERSE_BYTES / 4,
    )

    this.slotVersions = new Uint32Array(this.totalSlots)

    // 预填空闲槽位栈，并初始化版本号。
    for (let i = this.totalSlots - 1; i >= 0; i--) {
      this.freeSlots.push(i)
      this.slotVersions[i] = 1
    }
  }

  /**
   * 清空所有槽位、注册表与分配器状态。
   */
  public clear() {
    this.chunkMap.clear()
    this.freeSlots.length = 0
    for (let i = this.totalSlots - 1; i >= 0; i--) {
      this.freeSlots.push(i)
      // 递增版本号，让旧 Worker 任务在校验时自然失效。
      this.slotVersions[i] += 10

      const byteOffset = this.getSlotOffset(i)
      const base = (byteOffset / 4) | 0
      // 重置槽位头部。
      this.headerView[base] = -2147483648
      this.headerView[base + 1] = -2147483648
      this.headerView[base + 2] = this.slotVersions[i]
      this.headerView[base + 3] = 0 // 就绪标记
      this.headerView[base + 4] = 0 // 起始块索引
      this.headerView[base + 5] = 0 // 分配块数量
    }

    // 重置 payload 分配器。
    this.allocator.clear(this.totalBlocks)

    // 清空注册表与字符串池。
    this.nextIdCounter[0] = 0
    this.registryStringCounter[0] = 0
    this.registryView.fill(0)
    this.reverseRegistryView.fill(0)
    this.bufferView.fill(
      0,
      REGISTRY_STRING_POOL_OFFSET,
      REGISTRY_STRING_POOL_OFFSET + REGISTRY_STRING_POOL_BYTES,
    )
  }

  /**
   * 获取共享存储的诊断信息。
   */
  public getDiagnosis() {
    return {
      totalSlots: this.totalSlots,
      usedSlots: this.chunkMap.size,
      freeSlots: this.freeSlots.length,
      fragmentationRatio: this.allocator.getFragmentationRatio(),
      ...this.allocator.getFragmentationInfo(),
    }
  }

  /**
   * 整理 payload 区内存碎片。
   * ⚠️ 仅应在 Worker 已暂停且不会并发读写时调用。
   */
  public compact(): { moved: number; newEnd: number } {
    console.warn('[SharedVoxelStore] Starting Defragmentation...')
    const slots: { slotIndex: number; blockIndex: number; blockCount: number }[] = []

    // 1. 收集所有已分配且带有效 payload 的槽位。
    for (const [_, slotIndex] of this.chunkMap) {
      const byteOffset = this.getSlotOffset(slotIndex)
      const base = (byteOffset / 4) | 0
      const blockIndex = this.headerView[base + 4]
      const blockCount = this.headerView[base + 5]
      if (blockIndex >= 0 && blockCount > 0) {
        slots.push({ slotIndex, blockIndex, blockCount })
      }
    }

    // 2. 按当前 blockIndex 排序，保持原有相对顺序。
    slots.sort((a, b) => a.blockIndex - b.blockIndex)

    // 3. 向前压缩，消除空洞。
    const heapView = new Uint8Array(this.sab, DATA_HEAP_START)
    let currentBlock = 0
    let movedCount = 0

    // 使用 copyWithin 前移数据；当前实现只做向前搬运，因此不会覆盖未读区域。

    for (const slot of slots) {
      if (slot.blockIndex !== currentBlock) {
        // 搬移 payload 数据。
        const srcOffset = slot.blockIndex * BLOCK_SIZE
        const dstOffset = currentBlock * BLOCK_SIZE
        const byteLength = slot.blockCount * BLOCK_SIZE

        // 更新槽位头部。
        heapView.copyWithin(dstOffset, srcOffset, srcOffset + byteLength)

        const byteOffset = this.getSlotOffset(slot.slotIndex)
        const base = (byteOffset / 4) | 0

        // 更新 blockIndex。
        Atomics.store(this.headerView, base + 4, currentBlock)

        movedCount++
      }
      currentBlock += slot.blockCount
    }

    // 4. 依据新堆顶重建分配器状态。
    this.allocator.resetWithTotal(this.totalBlocks, currentBlock)

    console.info(
      `[SharedVoxelStore] Defragmentation complete. Moved ${movedCount}/${slots.length} chunks. New Heap Top: ${currentBlock}/${this.totalBlocks}`,
    )

    return { moved: movedCount, newEnd: currentBlock }
  }

  /**
   * 分配一个新区块槽位。
   * @param reservedBlocks 预留 block 数，默认取 `DEFAULT_BLOCKS_PER_CHUNK`
   * @param evictCallback 内存不足时触发驱逐；返回 `true` 表示已释放出空间
   */
  public allocSlot(
    chunkX: number,
    chunkZ: number,
    reservedBlocks = DEFAULT_BLOCKS_PER_CHUNK,
    evictCallback?: (needed: number) => boolean,
  ): { slotIndex: number; version: number } | null {
    const rawSlot = this.allocateRawSlot(reservedBlocks, evictCallback)
    if (!rawSlot) {
      return null
    }

    const key = this.getChunkKey(chunkX, chunkZ)
    this.chunkMap.set(key, rawSlot.slotIndex)

    const version = ++this.slotVersions[rawSlot.slotIndex]
    this.writeSlotHeader(
      rawSlot.slotIndex,
      chunkX,
      chunkZ,
      version,
      0,
      rawSlot.blockIndex,
      rawSlot.blockCount,
    )

    return { slotIndex: rawSlot.slotIndex, version }
  }

  public resizeChunkSlot(
    chunkX: number,
    chunkZ: number,
    reservedBlocks: number,
    evictCallback?: (needed: number) => boolean,
  ): { slotIndex: number; version: number } | null {
    const key = this.getChunkKey(chunkX, chunkZ)
    const currentSlot = this.chunkMap.get(key)
    if (currentSlot === undefined) {
      return null
    }

    const currentBlockCount = this.getSlotBlockCount(currentSlot)
    if (currentBlockCount >= reservedBlocks) {
      return {
        slotIndex: currentSlot,
        version: this.slotVersions[currentSlot],
      }
    }

    const oldByteOffset = this.getSlotOffset(currentSlot)
    const oldBase = (oldByteOffset / 4) | 0
    const readyMask = this.headerView[oldBase + 3]
    const oldBlockIndex = this.headerView[oldBase + 4]
    const oldBlockCount = this.headerView[oldBase + 5]

    const rawSlot = this.allocateRawSlot(reservedBlocks, evictCallback)
    if (!rawSlot) {
      return null
    }

    const version = ++this.slotVersions[rawSlot.slotIndex]
    this.writeSlotHeader(
      rawSlot.slotIndex,
      chunkX,
      chunkZ,
      version,
      readyMask,
      rawSlot.blockIndex,
      rawSlot.blockCount,
    )

    const oldDataOffset = DATA_HEAP_START + oldBlockIndex * BLOCK_SIZE
    const newDataOffset = DATA_HEAP_START + rawSlot.blockIndex * BLOCK_SIZE
    const copyBytes = Math.max(0, oldBlockCount) * BLOCK_SIZE
    if (copyBytes > 0) {
      const existingBytes = this.bufferView.slice(oldDataOffset, oldDataOffset + copyBytes)
      this.bufferView.set(existingBytes, newDataOffset)
    }

    this.chunkMap.set(key, rawSlot.slotIndex)
    this.releaseAllocatedSlot(currentSlot)

    return { slotIndex: rawSlot.slotIndex, version }
  }

  /**
   * 释放指定区块占用的槽位。
   */
  public freeSlot(chunkX: number, chunkZ: number) {
    const key = this.getChunkKey(chunkX, chunkZ)
    const slot = this.chunkMap.get(key)
    if (slot !== undefined) {
      this.chunkMap.delete(key)
      this.releaseAllocatedSlot(slot)
    }
  }

  /**
   * 读取指定槽位已分配的 block 数量。
   */
  public getSlotBlockCount(slotIndex: number): number {
    if (!this.checkSlotValid(slotIndex)) return 0
    const byteOffset = this.getSlotOffset(slotIndex)
    const base = (byteOffset / 4) | 0
    // 头部布局：X、Z、版本、就绪位、起始块索引、块数量。
    return this.headerView[base + 5]
  }

  /**
   * 检查槽位索引是否合法。
   */
  public checkSlotValid(slotIndex: number): boolean {
    return slotIndex >= 0 && slotIndex < this.totalSlots
  }

  /**
   * 获取槽位头部在 SAB 中的字节偏移。
   */
  public getSlotOffset(slotIndex: number): number {
    return HEADER_AREA_START + slotIndex * SLOT_HEADER_BYTES
  }

  /** 获取指定槽位 payload 区的起始偏移。 */
  public getDataOffset(slotIndex: number): number {
    const byteOffset = this.getSlotOffset(slotIndex)
    const base = (byteOffset / 4) | 0
    const blockIndex = this.headerView[base + 4]
    return DATA_HEAP_START + blockIndex * BLOCK_SIZE
  }

  /**
   * 检查指定区块是否已经分配槽位。
   */
  public hasChunk(chunkX: number, chunkZ: number): boolean {
    return this.chunkMap.has(this.getChunkKey(chunkX, chunkZ))
  }

  public getSlotIndex(chunkX: number, chunkZ: number): number | undefined {
    return this.chunkMap.get(this.getChunkKey(chunkX, chunkZ))
  }

  /** 复制指定区块的原始 payload 数据，主要用于调试或离线检查。 */
  public getChunkDataCopy(chunkX: number, chunkZ: number): Uint8Array | null {
    const slot = this.getSlotIndex(chunkX, chunkZ)
    if (slot === undefined) return null

    const offset = this.getDataOffset(slot)
    const byteOffset = this.getSlotOffset(slot)
    const base = (byteOffset / 4) | 0
    const blockCount = this.headerView[base + 5]

    return this.bufferView.slice(offset, offset + blockCount * BLOCK_SIZE)
  }

  /** 复制运行时 chunk 数据，供调试与只读分析使用。 */
  public getChunkRuntimeDataCopy(chunkX: number, chunkZ: number): Uint8Array | null {
    const slot = this.getSlotIndex(chunkX, chunkZ)
    if (slot === undefined) return null

    const offset = this.getDataOffset(slot)
    const byteOffset = this.getSlotOffset(slot)
    const base = (byteOffset / 4) | 0
    const blockCount = this.headerView[base + 5]

    return this.bufferView.slice(offset, offset + blockCount * BLOCK_SIZE)
  }

  public getBlockStateId(worldX: number, worldY: number, worldZ: number): number | null {
    const coords = this.resolveWorldCoords(worldX, worldY, worldZ)
    if (!coords) {
      return null
    }

    const slot = this.getSlotIndex(coords.chunkX, coords.chunkZ)
    if (slot === undefined) {
      return null
    }

    return this.readBlockStateIdFromSlot(
      slot,
      coords.sectionIndex,
      coords.localX,
      coords.localY,
      coords.localZ,
    )
  }

  public setBlockStateId(params: {
    worldX: number
    worldY: number
    worldZ: number
    blockStateId: number
  }): {
    changed: boolean
    previousBlockStateId: number | null
    chunkX: number
    chunkZ: number
    sectionY: number
    version: number
    overflowBytes: number
  } | null {
    const coords = this.resolveWorldCoords(params.worldX, params.worldY, params.worldZ)
    if (!coords) {
      return null
    }

    const slot = this.getSlotIndex(coords.chunkX, coords.chunkZ)
    if (slot === undefined) {
      return null
    }

    const nextBlockStateId = this.canonicalizeAirLikeId(params.blockStateId)

    const previousBlockStateId = this.readBlockStateIdFromSlot(
      slot,
      coords.sectionIndex,
      coords.localX,
      coords.localY,
      coords.localZ,
    )

    if (
      previousBlockStateId === nextBlockStateId ||
      (previousBlockStateId === null && nextBlockStateId === SharedVoxelStore.AIR_BLOCK_ID)
    ) {
      return {
        changed: false,
        previousBlockStateId,
        chunkX: coords.chunkX,
        chunkZ: coords.chunkZ,
        sectionY: coords.sectionY,
        version: this.slotVersions[slot],
        overflowBytes: 0,
      }
    }

    const snapshot = this.readChunkSnapshot(slot)
    const sectionWasMissing = snapshot.sections[coords.sectionIndex] === null
    const blockIds = this.decodeSectionBlockIds(snapshot.sections[coords.sectionIndex])
    const linearIndex = this.getSectionLinearIndex(coords.localX, coords.localY, coords.localZ)
    blockIds[linearIndex] = nextBlockStateId
    snapshot.sections[coords.sectionIndex] = this.rebuildSectionSnapshot(
      coords.sectionY,
      blockIds,
      snapshot.sections[coords.sectionIndex]?.blockLight ?? null,
      snapshot.sections[coords.sectionIndex]?.skyLight ?? null,
    )

    const requiredBytes = this.calculateChunkPayloadBytes(snapshot)
    const blockCapacityBytes = this.getSlotBlockCount(slot) * BLOCK_SIZE
    const totalUsedBytes = SECTION_INDEX_BYTES + requiredBytes
    if (totalUsedBytes > blockCapacityBytes) {
      return {
        changed: false,
        previousBlockStateId,
        chunkX: coords.chunkX,
        chunkZ: coords.chunkZ,
        sectionY: coords.sectionY,
        version: this.slotVersions[slot],
        overflowBytes: totalUsedBytes - blockCapacityBytes,
      }
    }

    this.writeChunkSnapshot(slot, snapshot, totalUsedBytes)
    const version = this.bumpSlotVersion(slot)

    if (sectionWasMissing && nextBlockStateId !== SharedVoxelStore.AIR_BLOCK_ID) {
      console.log(
        `[SharedVoxelStore] Materialized missing section for block edit at chunk=${coords.chunkX},${coords.chunkZ} sectionY=${coords.sectionY} local=${coords.localX},${coords.localY},${coords.localZ} newBlock=${nextBlockStateId} totalUsedBytes=${totalUsedBytes}`,
      )
    }

    return {
      changed: true,
      previousBlockStateId,
      chunkX: coords.chunkX,
      chunkZ: coords.chunkZ,
      sectionY: coords.sectionY,
      version,
      overflowBytes: 0,
    }
  }

  /** 写入槽位头部元数据。 */
  public writeHeader(slot: number, ownerX: number, ownerZ: number, version: number, ready: number) {
    // 槽位头部按 Int32 对齐存储。
    const byteOffset = this.getSlotOffset(slot)
    const base = (byteOffset / 4) | 0

    this.headerView[base] = ownerX
    this.headerView[base + 1] = ownerZ
    this.headerView[base + 2] = version
    this.headerView[base + 3] = ready
  }

  public markReady(slot: number, ready: 0 | 1, version: number) {
    const byteOffset = this.getSlotOffset(slot)
    const base = (byteOffset / 4) | 0
    // 版本号已由调用方更新，这里只同步就绪位。
    this.headerView[base + 2] = version
    this.headerView[base + 3] = ready
  }

  public getSlotVersion(slot: number): number {
    return this.slotVersions[slot]
  }

  public getChunkVersion(chunkX: number, chunkZ: number): number | null {
    const slot = this.getSlotIndex(chunkX, chunkZ)
    if (slot === undefined) {
      return null
    }

    return this.slotVersions[slot]
  }

  public getReadyMask(slot: number): number {
    const byteOffset = this.getSlotOffset(slot)
    const base = (byteOffset / 4) | 0
    return Atomics.load(this.headerView, base + 3)
  }

  private resolveWorldCoords(worldX: number, worldY: number, worldZ: number) {
    const chunkX = Math.floor(worldX / 16)
    const chunkZ = Math.floor(worldZ / 16)
    const sectionY = Math.floor(worldY / 16)
    const sectionIndex = sectionY + 4
    if (sectionIndex < 0 || sectionIndex >= 24) {
      return null
    }

    return {
      chunkX,
      chunkZ,
      sectionY,
      sectionIndex,
      localX: ((worldX % 16) + 16) % 16,
      localY: ((worldY % 16) + 16) % 16,
      localZ: ((worldZ % 16) + 16) % 16,
    }
  }

  private getSectionLinearIndex(localX: number, localY: number, localZ: number) {
    return localY * 256 + localZ * 16 + localX
  }

  private readBlockStateIdFromSlot(
    slotIndex: number,
    sectionIndex: number,
    localX: number,
    localY: number,
    localZ: number,
  ): number | null {
    const dataBase = this.getDataOffset(slotIndex)
    const payloadBase = dataBase + SECTION_INDEX_BYTES
    const entryOffset = dataBase + sectionIndex * SECTION_ENTRY_BYTES
    const paletteLen = this.dataView.getUint16(entryOffset + 4, true)
    if (paletteLen === 0) {
      return null
    }

    const paletteRel = this.dataView.getUint32(entryOffset, true)
    const paletteOffset = payloadBase + paletteRel
    if (paletteLen === 1) {
      return this.normalizeRuntimeBlockStateId(this.dataView.getUint16(paletteOffset, true))
    }

    const dataLen = this.dataView.getUint16(entryOffset + 10, true)
    if (dataLen === 0) {
      return this.normalizeRuntimeBlockStateId(this.dataView.getUint16(paletteOffset, true))
    }

    const index = this.getSectionLinearIndex(localX, localY, localZ)
    const bitsPerIndex = Math.max(4, Math.ceil(Math.log2(Math.max(1, paletteLen))))
    const blocksPerLong = Math.floor(64 / bitsPerIndex)
    if (blocksPerLong <= 0) {
      return this.normalizeRuntimeBlockStateId(this.dataView.getUint16(paletteOffset, true))
    }

    const longIndex = Math.floor(index / blocksPerLong)
    if (longIndex >= dataLen) {
      return this.normalizeRuntimeBlockStateId(this.dataView.getUint16(paletteOffset, true))
    }

    const subIndex = index % blocksPerLong
    const shift = BigInt(subIndex * bitsPerIndex)
    const mask = (1n << BigInt(bitsPerIndex)) - 1n
    const dataRel = this.dataView.getUint32(entryOffset + 6, true)
    const longValue = this.dataView.getBigInt64(payloadBase + dataRel + longIndex * 8, true)
    const paletteIndex = Number((longValue >> shift) & mask)
    if (paletteIndex >= paletteLen) {
      return this.normalizeRuntimeBlockStateId(this.dataView.getUint16(paletteOffset, true))
    }

    return this.normalizeRuntimeBlockStateId(
      this.dataView.getUint16(paletteOffset + paletteIndex * 2, true),
    )
  }

  private readChunkSnapshot(slotIndex: number) {
    const dataBase = this.getDataOffset(slotIndex)
    const payloadBase = dataBase + SECTION_INDEX_BYTES
    const biomes = this.bufferView.slice(payloadBase, payloadBase + BIOME_MAP_BYTES)
    const sections: Array<null | {
      palette: number[]
      data: bigint[] | null
      blockLight: Uint8Array | null
      skyLight: Uint8Array | null
    }> = new Array(24).fill(null)

    for (let sectionIndex = 0; sectionIndex < 24; sectionIndex++) {
      const entryOffset = dataBase + sectionIndex * SECTION_ENTRY_BYTES
      const paletteLen = this.dataView.getUint16(entryOffset + 4, true)
      if (paletteLen === 0) {
        continue
      }

      const paletteRel = this.dataView.getUint32(entryOffset, true)
      const paletteOffset = payloadBase + paletteRel
      const palette: number[] = new Array(paletteLen)
      for (let index = 0; index < paletteLen; index++) {
        palette[index] = this.normalizeStoredBlockStateId(
          this.dataView.getUint16(paletteOffset + index * 2, true),
        )
      }

      const dataLen = this.dataView.getUint16(entryOffset + 10, true)
      const data =
        dataLen > 0
          ? Array.from({ length: dataLen }, (_, index) => {
              const dataRel = this.dataView.getUint32(entryOffset + 6, true)
              return this.dataView.getBigInt64(payloadBase + dataRel + index * 8, true)
            })
          : null

      const lightFlags = this.bufferView[entryOffset + 20] ?? 0
      const blockLightRel = this.dataView.getUint32(entryOffset + 12, true)
      const skyLightRel = this.dataView.getUint32(entryOffset + 16, true)
      sections[sectionIndex] = {
        palette,
        data,
        blockLight:
          (lightFlags & 0b01) !== 0
            ? this.bufferView.slice(payloadBase + blockLightRel, payloadBase + blockLightRel + 2048)
            : null,
        skyLight:
          (lightFlags & 0b10) !== 0
            ? this.bufferView.slice(payloadBase + skyLightRel, payloadBase + skyLightRel + 2048)
            : null,
      }
    }

    return { biomes, sections }
  }

  private decodeSectionBlockIds(
    section: null | {
      palette: number[]
      data: bigint[] | null
      blockLight: Uint8Array | null
      skyLight: Uint8Array | null
    },
  ) {
    const ids = new Uint16Array(BLOCKS_PER_SECTION)
    if (!section || section.palette.length === 0) {
      ids.fill(SharedVoxelStore.AIR_BLOCK_ID)
      return ids
    }

    if (!section.data || section.palette.length === 1) {
      ids.fill(this.canonicalizeAirLikeId(section.palette[0] ?? SharedVoxelStore.AIR_BLOCK_ID))
      return ids
    }

    const bitsPerIndex = Math.max(4, Math.ceil(Math.log2(Math.max(1, section.palette.length))))
    const blocksPerLong = Math.floor(64 / bitsPerIndex)
    const mask = (1n << BigInt(bitsPerIndex)) - 1n

    for (let index = 0; index < BLOCKS_PER_SECTION; index++) {
      const longIndex = Math.floor(index / blocksPerLong)
      const subIndex = index % blocksPerLong
      const value = section.data[longIndex] ?? 0n
      const paletteIndex = Number((value >> BigInt(subIndex * bitsPerIndex)) & mask)
      ids[index] = this.canonicalizeAirLikeId(
        (section.palette[paletteIndex] ?? SharedVoxelStore.AIR_BLOCK_ID) & 0xffff,
      )
    }

    return ids
  }

  private rebuildSectionSnapshot(
    sectionY: number,
    blockIds: Uint16Array,
    blockLight: Uint8Array | null,
    skyLight: Uint8Array | null,
  ) {
    let hasNonAir = false
    for (let index = 0; index < blockIds.length; index++) {
      if (!this.isAirLikeBlockId(blockIds[index])) {
        hasNonAir = true
        break
      }
    }

    if (!hasNonAir) {
      return null
    }

    const palette: number[] = [SharedVoxelStore.AIR_BLOCK_ID]
    const paletteIndexByBlock = new Map<number, number>([[SharedVoxelStore.AIR_BLOCK_ID, 0]])
    for (const blockId of blockIds) {
      const canonicalBlockId = this.canonicalizeAirLikeId(blockId)
      if (paletteIndexByBlock.has(canonicalBlockId)) {
        continue
      }
      paletteIndexByBlock.set(canonicalBlockId, palette.length)
      palette.push(canonicalBlockId)
    }

    const data =
      palette.length <= 1
        ? null
        : (() => {
            const bitsPerIndex = Math.max(4, Math.ceil(Math.log2(Math.max(1, palette.length))))
            const blocksPerLong = Math.floor(64 / bitsPerIndex)
            const packed = new Array<bigint>(Math.ceil(BLOCKS_PER_SECTION / blocksPerLong)).fill(0n)
            const mask = (1n << BigInt(bitsPerIndex)) - 1n

            for (let index = 0; index < BLOCKS_PER_SECTION; index++) {
              const paletteIndex = BigInt(
                paletteIndexByBlock.get(this.canonicalizeAirLikeId(blockIds[index])) ?? 0,
              )
              const longIndex = Math.floor(index / blocksPerLong)
              const subIndex = index % blocksPerLong
              const shift = BigInt(subIndex * bitsPerIndex)
              const current = packed[longIndex]
              packed[longIndex] = (current & ~(mask << shift)) | ((paletteIndex & mask) << shift)
            }

            return packed
          })()

    return {
      sectionY,
      palette,
      data,
      blockLight: blockLight ? new Uint8Array(blockLight) : null,
      skyLight: skyLight ? new Uint8Array(skyLight) : null,
    }
  }

  private calculateChunkPayloadBytes(snapshot: {
    biomes: Uint8Array
    sections: Array<null | {
      sectionY?: number
      palette: number[]
      data: bigint[] | null
      blockLight: Uint8Array | null
      skyLight: Uint8Array | null
    }>
  }) {
    let bytes = BIOME_MAP_BYTES
    for (const section of snapshot.sections) {
      if (!section) {
        continue
      }
      bytes += section.palette.length * 2
      bytes += (section.data?.length ?? 0) * 8
      bytes += section.blockLight?.byteLength ?? 0
      bytes += section.skyLight?.byteLength ?? 0
    }
    return bytes
  }

  private writeChunkSnapshot(
    slotIndex: number,
    snapshot: {
      biomes: Uint8Array
      sections: Array<null | {
        sectionY?: number
        palette: number[]
        data: bigint[] | null
        blockLight: Uint8Array | null
        skyLight: Uint8Array | null
      }>
    },
    totalUsedBytes: number,
  ) {
    const dataBase = this.getDataOffset(slotIndex)
    const payloadBase = dataBase + SECTION_INDEX_BYTES
    let cursor = BIOME_MAP_BYTES

    this.bufferView.fill(0, dataBase, dataBase + SECTION_INDEX_BYTES)
    this.bufferView.set(snapshot.biomes, payloadBase)

    for (let sectionIndex = 0; sectionIndex < 24; sectionIndex++) {
      const entryOffset = dataBase + sectionIndex * SECTION_ENTRY_BYTES
      const section = snapshot.sections[sectionIndex]
      if (!section || section.palette.length === 0) {
        this.bufferView.fill(0, entryOffset, entryOffset + SECTION_ENTRY_BYTES)
        continue
      }

      this.dataView.setUint16(entryOffset + 4, section.palette.length, true)
      this.writePayloadSegment(payloadBase, cursor, this.encodePalette(section.palette), rel => {
        this.dataView.setUint32(entryOffset, rel, true)
      })
      cursor += section.palette.length * 2

      const dataBytes = this.encodePackedData(section.data)
      this.dataView.setUint16(entryOffset + 10, section.data?.length ?? 0, true)
      if (dataBytes) {
        this.writePayloadSegment(payloadBase, cursor, dataBytes, rel => {
          this.dataView.setUint32(entryOffset + 6, rel, true)
        })
        cursor += dataBytes.byteLength
      }

      let flags = 0
      if (section.blockLight) {
        this.writePayloadSegment(payloadBase, cursor, section.blockLight, rel => {
          this.dataView.setUint32(entryOffset + 12, rel, true)
        })
        cursor += section.blockLight.byteLength
        flags |= 0b01
      }
      if (section.skyLight) {
        this.writePayloadSegment(payloadBase, cursor, section.skyLight, rel => {
          this.dataView.setUint32(entryOffset + 16, rel, true)
        })
        cursor += section.skyLight.byteLength
        flags |= 0b10
      }
      this.bufferView[entryOffset + 20] = flags
    }

    const headerBase = (this.getSlotOffset(slotIndex) / 4) | 0
    this.headerView[headerBase + 6] = totalUsedBytes
  }

  private allocateRawSlot(
    reservedBlocks: number,
    evictCallback?: (needed: number) => boolean,
  ): { slotIndex: number; blockIndex: number; blockCount: number } | null {
    if (this.freeSlots.length === 0) {
      if (evictCallback) {
        let retries = 0
        const maxSlotRetries = 3
        while (this.freeSlots.length === 0 && retries < maxSlotRetries) {
          if (!evictCallback(reservedBlocks)) break
          retries++
        }
      }

      if (this.freeSlots.length === 0) {
        console.warn('[SharedVoxelStore] No free slot IDs! (Slot limit reached)')
        return null
      }
    }

    let blockIndex = 0
    if (reservedBlocks > 0) {
      let allocIndex = this.allocator.alloc(reservedBlocks)
      if (allocIndex === -1 && evictCallback) {
        let retries = 0
        const maxMemRetries = 10
        while (allocIndex === -1 && retries < maxMemRetries) {
          if (!evictCallback(reservedBlocks)) {
            break
          }
          allocIndex = this.allocator.alloc(reservedBlocks)
          retries++
        }

        if (allocIndex !== -1 && retries > 0) {
          console.log(`[SharedVoxelStore] Recovered from OOM after ${retries} evictions.`)
        }
      }

      if (allocIndex === -1) {
        const diag = this.allocator.getFragmentationInfo()
        console.warn(
          `[SharedVoxelStore] OOM! Failed to alloc ${reservedBlocks} blocks. ` +
            `Free: ${diag.totalFree}, MaxContiguous: ${diag.maxContiguous}, ` +
            `Fragments: ${diag.fragmentCount}`,
        )
        return null
      }

      if (allocIndex + reservedBlocks > this.totalBlocks) {
        console.error(
          `[SharedVoxelStore] CRITICAL: Allocator returned out-of-bounds index! ${allocIndex} + ${reservedBlocks} > ${this.totalBlocks}`,
        )
        return null
      }

      blockIndex = allocIndex
    }

    const slotIndex = this.freeSlots.pop()!
    return {
      slotIndex,
      blockIndex,
      blockCount: reservedBlocks,
    }
  }

  private releaseAllocatedSlot(slotIndex: number) {
    const byteOffset = this.getSlotOffset(slotIndex)
    const base = (byteOffset / 4) | 0
    const blockIndex = this.headerView[base + 4]
    const blockCount = this.headerView[base + 5]

    if (blockCount > 0) {
      this.allocator.free(blockIndex, blockCount)
    }

    const version = ++this.slotVersions[slotIndex]
    this.writeSlotHeader(slotIndex, -2147483648, -2147483648, version, 0, 0, 0)
    this.freeSlots.push(slotIndex)
  }

  private writeSlotHeader(
    slotIndex: number,
    chunkX: number,
    chunkZ: number,
    version: number,
    readyMask: number,
    blockIndex: number,
    blockCount: number,
  ) {
    const byteOffset = this.getSlotOffset(slotIndex)
    const base = (byteOffset / 4) | 0
    this.headerView[base] = chunkX
    this.headerView[base + 1] = chunkZ
    this.headerView[base + 2] = version
    this.headerView[base + 3] = readyMask
    this.headerView[base + 4] = blockIndex
    this.headerView[base + 5] = blockCount
  }

  private isAirLikeBlockId(blockStateId: number) {
    // 负值已用于回退方块，不能再视为空气。
    if (blockStateId < 0) {
      return false
    }

    return SharedVoxelStore.AIR_BLOCK_IDS.has(blockStateId)
  }

  private canonicalizeAirLikeId(blockStateId: number) {
    return this.isAirLikeBlockId(blockStateId)
      ? SharedVoxelStore.AIR_BLOCK_ID
      : blockStateId & 0xffff
  }

  private normalizeStoredBlockStateId(blockStateId: number) {
    if (blockStateId === SharedVoxelStore.AIR_BLOCK_ID) {
      return SharedVoxelStore.AIR_BLOCK_ID
    }

    return blockStateId & 0xffff
  }

  private normalizeRuntimeBlockStateId(blockStateId: number | null | undefined) {
    if (blockStateId == null) {
      return null
    }

    return this.normalizeStoredBlockStateId(blockStateId)
  }

  private encodePalette(palette: number[]) {
    const bytes = new Uint8Array(palette.length * 2)
    for (let index = 0; index < palette.length; index++) {
      const storedBlockStateId = this.isAirLikeBlockId(palette[index])
        ? SharedVoxelStore.AIR_BLOCK_ID
        : palette[index] & 0xffff
      this.writeUint16ToArray(bytes, index * 2, storedBlockStateId)
    }
    return bytes
  }

  private encodePackedData(data: bigint[] | null) {
    if (!data || data.length === 0) {
      return null
    }

    const bytes = new Uint8Array(data.length * 8)
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < data.length; index++) {
      view.setBigInt64(index * 8, data[index], true)
    }
    return bytes
  }

  private writePayloadSegment(
    payloadBase: number,
    cursor: number,
    bytes: Uint8Array,
    writeRelativeOffset: (relative: number) => void,
  ) {
    this.bufferView.set(bytes, payloadBase + cursor)
    writeRelativeOffset(cursor)
  }

  private writeUint16ToArray(target: Uint8Array, offset: number, value: number) {
    target[offset] = value & 0xff
    target[offset + 1] = (value >>> 8) & 0xff
  }

  private bumpSlotVersion(slotIndex: number) {
    const version = ++this.slotVersions[slotIndex]
    const headerBase = (this.getSlotOffset(slotIndex) / 4) | 0
    this.headerView[headerBase + 2] = version
    return version
  }

  /**
   * 原子设置中心区块就绪位。
   */
  public markCenterReady(slot: number) {
    const byteOffset = this.getSlotOffset(slot)
    const base = (byteOffset / 4) | 0
    Atomics.or(this.headerView, base + 3, MASK_CENTER)
  }

  /**
   * 原子设置邻居就绪位。
   * @returns 更新前的 mask 值
   */
  public setNeighborBit(slot: number, mask: number): number {
    const byteOffset = this.getSlotOffset(slot)
    const base = (byteOffset / 4) | 0
    return Atomics.or(this.headerView, base + 3, mask)
  }

  private getChunkKey(x: number, z: number) {
    return `${x},${z}`
  }

  public getStorageStats() {
    let count16k = 0
    let count32k = 0
    let count64k = 0
    let count128k = 0
    let totalAllocatedBytes = 0

    for (const slotIndex of this.chunkMap.values()) {
      // 直接读取头部字段，避免额外包装对象。
      const base = (HEADER_AREA_START / 4 + slotIndex * SLOT_HEADER_INT32S) | 0

      // [5] 为已分配 block 数量，也就是容量。
      const blockCount = this.headerView[base + 5]
      // [6] 为 Rust 写入的实际 payload 字节数。
      // 若尚未写入，则退回到按 blockCount 估算的保守值。
      let usedBytes = this.headerView[base + 6]

      // 在分配阶段尚未落盘真实长度时，使用容量作为保守估计。
      if (blockCount > 0 && usedBytes === 0) {
        usedBytes = blockCount * BLOCK_SIZE // 保守回退值
      }

      if (usedBytes <= 0) continue // 跳过未分配或空气区块

      totalAllocatedBytes += usedBytes

      // 按真实使用量分类统计。
      if (usedBytes <= 16 * 1024) count16k++
      else if (usedBytes <= 32 * 1024) count32k++
      else if (usedBytes <= 64 * 1024) count64k++
      else count128k++
    }

    // 汇总容量利用率与碎片信息。
    const { totalFree, maxContiguous, fragmentCount } = this.allocator.getFragmentationInfo()

    return {
      distribution: {
        '16KB': count16k,
        '32KB': count32k,
        '64KB': count64k,
        '>64KB': count128k,
      },
      sab: {
        usedBytes: totalAllocatedBytes,
        capacityBytes: this.totalBlocks * BLOCK_SIZE,
        usedSlots: this.chunkMap.size,
        totalSlots: this.totalSlots,
      },
      heap: {
        total: this.totalBlocks,
        used: this.totalBlocks - totalFree,
        free: totalFree,
        frag: fragmentCount,
        maxContig: maxContiguous,
      },
    }
  }
}
