/**
 * @file PayloadArenaProtocol.ts
 * @brief 区块 payload arena 协议
 *
 * 说明：
 *  - 当前 arena 以单区块、整批提交的方式工作
 *  - 写入方可以持续向 SAB 数据区追加字节，但读取方只信任已提交长度以内的 span
 *  - item 目录字段先保留给未来的 arena 内索引，当前主线仍通过 Worker 消息携带 descriptor/span 元数据
 */
const PAYLOAD_ARENA_HEADER_U32S = 16

export const PAYLOAD_ARENA_HEADER_BYTES = PAYLOAD_ARENA_HEADER_U32S * 4
export const PAYLOAD_ARENA_ALIGNMENT_BYTES = 64
export const PAYLOAD_ARENA_MAGIC = 0x5041524e
export const PAYLOAD_ARENA_VERSION = 1

const HEADER_MAGIC_INDEX = 0
const HEADER_VERSION_INDEX = 1
const HEADER_ARENA_ID_INDEX = 2
const HEADER_GENERATION_INDEX = 3
const HEADER_ITEM_COUNT_INDEX = 4
const HEADER_DATA_OFFSET_INDEX = 5
const HEADER_DATA_LENGTH_INDEX = 6
const HEADER_COMMITTED_LENGTH_INDEX = 7
const HEADER_ITEM_DIRECTORY_OFFSET_INDEX = 8
const HEADER_ITEM_DIRECTORY_LENGTH_INDEX = 9

export type ChunkPayloadArenaBufferKind = 'vertex' | 'index'

export interface ChunkPayloadArenaSpan {
  arenaId: number
  generation: number
  kind: ChunkPayloadArenaBufferKind
  byteOffset: number
  byteLength: number
}

export interface ChunkPayloadArenaHeader {
  arenaId: number
  generation: number
  itemCount: number
  itemDirectoryByteOffset: number
  itemDirectoryByteLength: number
  dataByteOffset: number
  dataByteLength: number
  committedByteLength: number
}

export interface ChunkPayloadArenaView {
  sab: SharedArrayBuffer
  header: Uint32Array
  bytes: Uint8Array
}

export interface InitializeChunkPayloadArenaOptions {
  arenaId: number
  generation: number
  itemCount?: number
  itemDirectoryByteOffset?: number
  itemDirectoryByteLength?: number
  dataByteLength?: number
  committedByteLength?: number
}

function loadHeaderU32(view: ChunkPayloadArenaView, index: number) {
  return Atomics.load(view.header, index) >>> 0
}

function storeHeaderU32(view: ChunkPayloadArenaView, index: number, value: number) {
  Atomics.store(view.header, index, value >>> 0)
}

export function alignPayloadArenaByteLength(byteLength: number) {
  if (byteLength <= 0) {
    return PAYLOAD_ARENA_HEADER_BYTES
  }

  const remainder = byteLength % PAYLOAD_ARENA_ALIGNMENT_BYTES
  return remainder === 0 ? byteLength : byteLength + (PAYLOAD_ARENA_ALIGNMENT_BYTES - remainder)
}

export function getChunkPayloadArenaRequiredBytes(dataByteLength: number) {
  return alignPayloadArenaByteLength(PAYLOAD_ARENA_HEADER_BYTES + Math.max(0, dataByteLength))
}

export function createChunkPayloadArenaView(sab: SharedArrayBuffer): ChunkPayloadArenaView {
  if (sab.byteLength < PAYLOAD_ARENA_HEADER_BYTES) {
    throw new Error(
      `[ChunkPayloadArena] Buffer too small. Need at least ${PAYLOAD_ARENA_HEADER_BYTES} bytes.`,
    )
  }

  return {
    sab,
    header: new Uint32Array(sab, 0, PAYLOAD_ARENA_HEADER_U32S),
    bytes: new Uint8Array(sab),
  }
}

export function initializeChunkPayloadArena(
  view: ChunkPayloadArenaView,
  options: InitializeChunkPayloadArenaOptions,
) {
  const itemDirectoryByteOffset = options.itemDirectoryByteOffset ?? 0
  const itemDirectoryByteLength = options.itemDirectoryByteLength ?? 0
  const dataByteOffset = alignPayloadArenaByteLength(PAYLOAD_ARENA_HEADER_BYTES)
  const maxDataByteLength = Math.max(0, view.sab.byteLength - dataByteOffset)
  const dataByteLength = Math.min(options.dataByteLength ?? maxDataByteLength, maxDataByteLength)
  const committedByteLength = Math.min(options.committedByteLength ?? 0, dataByteLength)

  // `fill(0)` 不是原子操作，但这里是安全的：
  // arena 只会在所属 worker 回收后重新初始化，主线程也已在 release 消息发出前消费完上一代数据。
  view.header.fill(0)

  storeHeaderU32(view, HEADER_ARENA_ID_INDEX, options.arenaId)
  storeHeaderU32(view, HEADER_GENERATION_INDEX, options.generation)
  storeHeaderU32(view, HEADER_ITEM_COUNT_INDEX, options.itemCount ?? 0)
  storeHeaderU32(view, HEADER_ITEM_DIRECTORY_OFFSET_INDEX, itemDirectoryByteOffset)
  storeHeaderU32(view, HEADER_ITEM_DIRECTORY_LENGTH_INDEX, itemDirectoryByteLength)
  storeHeaderU32(view, HEADER_DATA_OFFSET_INDEX, dataByteOffset)
  storeHeaderU32(view, HEADER_DATA_LENGTH_INDEX, dataByteLength)
  storeHeaderU32(view, HEADER_COMMITTED_LENGTH_INDEX, committedByteLength)
  storeHeaderU32(view, HEADER_VERSION_INDEX, PAYLOAD_ARENA_VERSION)
  storeHeaderU32(view, HEADER_MAGIC_INDEX, PAYLOAD_ARENA_MAGIC)
}

export function readChunkPayloadArenaHeader(view: ChunkPayloadArenaView): ChunkPayloadArenaHeader {
  return {
    arenaId: loadHeaderU32(view, HEADER_ARENA_ID_INDEX),
    generation: loadHeaderU32(view, HEADER_GENERATION_INDEX),
    itemCount: loadHeaderU32(view, HEADER_ITEM_COUNT_INDEX),
    itemDirectoryByteOffset: loadHeaderU32(view, HEADER_ITEM_DIRECTORY_OFFSET_INDEX),
    itemDirectoryByteLength: loadHeaderU32(view, HEADER_ITEM_DIRECTORY_LENGTH_INDEX),
    dataByteOffset: loadHeaderU32(view, HEADER_DATA_OFFSET_INDEX) || PAYLOAD_ARENA_HEADER_BYTES,
    dataByteLength: loadHeaderU32(view, HEADER_DATA_LENGTH_INDEX),
    committedByteLength: loadHeaderU32(view, HEADER_COMMITTED_LENGTH_INDEX),
  }
}

export function isChunkPayloadArenaInitialized(view: ChunkPayloadArenaView) {
  return (
    loadHeaderU32(view, HEADER_MAGIC_INDEX) === PAYLOAD_ARENA_MAGIC &&
    loadHeaderU32(view, HEADER_VERSION_INDEX) === PAYLOAD_ARENA_VERSION
  )
}

export function validateChunkPayloadArenaSpan(
  view: ChunkPayloadArenaView,
  span: ChunkPayloadArenaSpan,
) {
  if (!isChunkPayloadArenaInitialized(view)) {
    return false
  }

  const header = readChunkPayloadArenaHeader(view)
  if (span.arenaId !== header.arenaId || span.generation !== header.generation) {
    return false
  }

  const byteOffset = span.byteOffset >>> 0
  const byteLength = span.byteLength >>> 0
  if (byteOffset < header.dataByteOffset) {
    return false
  }

  const endOffset = byteOffset + byteLength
  const committedEnd = header.dataByteOffset + header.committedByteLength
  return endOffset <= committedEnd
}

export function resolveChunkPayloadArenaSpan(
  view: ChunkPayloadArenaView,
  span: ChunkPayloadArenaSpan | null | undefined,
): Uint8Array | null {
  if (!span) {
    return null
  }

  if (!validateChunkPayloadArenaSpan(view, span)) {
    return null
  }

  const byteOffset = span.byteOffset >>> 0
  const byteLength = span.byteLength >>> 0
  return view.bytes.subarray(byteOffset, byteOffset + byteLength)
}

export function commitChunkPayloadArenaBytes(
  view: ChunkPayloadArenaView,
  committedByteLength: number,
) {
  if (!isChunkPayloadArenaInitialized(view)) {
    throw new Error('[ChunkPayloadArena] Cannot commit bytes before initialization.')
  }

  const header = readChunkPayloadArenaHeader(view)
  storeHeaderU32(
    view,
    HEADER_COMMITTED_LENGTH_INDEX,
    Math.min(Math.max(0, committedByteLength), header.dataByteLength),
  )
}
