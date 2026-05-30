/// <reference lib="webworker" />

/**
 * @file world.worker.ts
 * @brief 区块计算 Worker 入口
 *
 * 说明：
 *  - 负责解析、SAB 写入、网格构建与统计上报
 *  - 维护 parse 与 mesh 两条独立队列
 *  - 协调 WasmManager、ChunkProcessor 与 payload arena 生命周期
 */

import { WasmManager, type WorkerResources } from './WasmManager'
import { ChunkProcessor, type ChunkMeshResult, type ArenaDirectMeshResult } from './ChunkProcessor'
import type {
  AnyChunkBuildArtifact,
  ChunkArtifactEnvelopeWithPayload,
  CompactChunkBuildArtifact,
  FlatCompactChunkBuildArtifact,
  ArenaDirectArtifactMeta,
} from '../domain'
import {
  createChunkArtifactArenaEnvelope,
  createChunkArtifactDescriptor,
  createChunkArtifactEnvelope,
  createCompactIndexSourceKey,
  createCompactVertexSourceKey,
  isCompactChunkBuildArtifact,
  isFlatCompactChunkBuildArtifact,
} from '../domain'
import { ChunkPayloadArenaWriter } from '../memory/ChunkPayloadArenaWriter'
import {
  type ChunkPayloadArenaSpan,
  commitChunkPayloadArenaBytes,
  createChunkPayloadArenaView,
  getChunkPayloadArenaRequiredBytes,
  initializeChunkPayloadArena,
  readChunkPayloadArenaHeader,
} from '../memory/PayloadArenaProtocol'

type LegacyChunkItem = {
  vertex_bytes: Uint8Array
  index_bytes?: Uint8Array | null
}

type LegacyChunkSection = {
  items?: LegacyChunkItem[]
  passes?: LegacyChunkItem[]
}

// Chunk Worker 在后台线程中执行解析与网格构建，避免阻塞主线程渲染循环。
const wasmManager = new WasmManager()

// 由主线程注入的 Worker 编号，用于统计与诊断消息上报。
let workerId = -1
let nextPayloadArenaId = 1

interface ActivePayloadArenaEntry {
  sab: SharedArrayBuffer
  byteLength: number
  generation: number
}

interface PooledPayloadArenaEntry {
  sab: SharedArrayBuffer
  byteLength: number
  arenaId: number
  nextGeneration: number
}

const MAX_POOLED_ARENAS = 32

const activePayloadArenas = new Map<number, ActivePayloadArenaEntry>()
const pooledPayloadArenas: PooledPayloadArenaEntry[] = []
let arenaPoolHits = 0
let arenaPoolMisses = 0

// Arena 直写路径的默认预估容量。
// 默认关闭；一旦检测到 WASM trap，会永久禁用，避免分配器损坏继续扩散。
const DEFAULT_ARENA_DATA_BYTES = 2 * 1024 * 1024 // 2 MB 下限
let maxObservedArenaDataBytes = 0
let arenaDirectEnabled = false

function estimateArenaDataBytes(): number {
  return Math.max(DEFAULT_ARENA_DATA_BYTES, Math.ceil(maxObservedArenaDataBytes * 1.25))
}

function acquirePayloadArena(requiredBytes: number) {
  let bestIndex = -1
  let bestByteLength = Number.POSITIVE_INFINITY

  for (let index = 0; index < pooledPayloadArenas.length; index++) {
    const candidate = pooledPayloadArenas[index]
    if (candidate.byteLength < requiredBytes) {
      continue
    }
    if (candidate.byteLength < bestByteLength) {
      bestByteLength = candidate.byteLength
      bestIndex = index
    }
  }

  if (bestIndex >= 0) {
    const candidate = pooledPayloadArenas.splice(bestIndex, 1)[0]
    arenaPoolHits++
    return {
      sab: candidate.sab,
      arenaId: candidate.arenaId,
      generation: candidate.nextGeneration,
    }
  }

  arenaPoolMisses++
  return {
    sab: new SharedArrayBuffer(requiredBytes),
    arenaId: nextPayloadArenaId++,
    generation: 1,
  }
}

function releasePayloadArena(arenaId: number, generation: number) {
  const active = activePayloadArenas.get(arenaId)
  if (!active || active.generation !== generation) {
    return
  }

  activePayloadArenas.delete(arenaId)
  pooledPayloadArenas.push({
    sab: active.sab,
    byteLength: active.byteLength,
    arenaId,
    nextGeneration: generation + 1,
  })

  // 超过池上限时，逐出最大的 arena，避免内存无限增长。
  while (pooledPayloadArenas.length > MAX_POOLED_ARENAS) {
    let largestIndex = 0
    for (let i = 1; i < pooledPayloadArenas.length; i++) {
      if (pooledPayloadArenas[i].byteLength > pooledPayloadArenas[largestIndex].byteLength) {
        largestIndex = i
      }
    }
    pooledPayloadArenas.splice(largestIndex, 1)
  }
}

// 收集 compact artifact 的原始 ArrayBuffer。
// 在内容复制进 arena 后，可通过 transfer 让这些旧 buffer 失效，从而尽快释放 Worker 内存。
function collectCompactArtifactBuffers(artifact: CompactChunkBuildArtifact): ArrayBuffer[] {
  const seen = new Set<ArrayBuffer>()
  for (const vertexBytes of artifact.vertex_buffers) {
    if (vertexBytes?.buffer instanceof ArrayBuffer) seen.add(vertexBytes.buffer)
  }
  for (const indexBytes of artifact.index_buffers) {
    if (indexBytes?.buffer instanceof ArrayBuffer) seen.add(indexBytes.buffer)
  }
  return Array.from(seen)
}

function collectFlatCompactArtifactBuffers(artifact: FlatCompactChunkBuildArtifact): ArrayBuffer[] {
  const buf = artifact.payload_blob?.buffer
  return buf instanceof ArrayBuffer ? [buf] : []
}

function createFlatBlobArenaEnvelope(artifact: FlatCompactChunkBuildArtifact): {
  envelope: ChunkArtifactEnvelopeWithPayload
  neuterBuffers: ArrayBuffer[]
} {
  const blob = artifact.payload_blob
  if (!blob || blob.byteLength === 0) {
    return { envelope: createChunkArtifactEnvelope(artifact), neuterBuffers: [] }
  }

  const arenaAllocation = acquirePayloadArena(getChunkPayloadArenaRequiredBytes(blob.byteLength))
  const { sab, arenaId, generation } = arenaAllocation
  const arenaView = createChunkPayloadArenaView(sab)
  initializeChunkPayloadArena(arenaView, {
    arenaId,
    generation,
    dataByteLength: blob.byteLength,
  })
  activePayloadArenas.set(arenaId, { sab, byteLength: sab.byteLength, generation })

  // 单次复制：把整个 flat blob 写入 arena 数据区。
  const dataByteOffset = readChunkPayloadArenaHeader(arenaView).dataByteOffset
  arenaView.bytes.set(blob, dataByteOffset)
  commitChunkPayloadArenaBytes(arenaView, blob.byteLength)

  // 为每个条目建立 span，引用 blob 内部对应区间。
  const sources: Record<string, ChunkPayloadArenaSpan> = {}
  const itemCount = artifact.vertex_byte_lengths.length
  for (let i = 0; i < itemCount; i++) {
    const vLen = artifact.vertex_byte_lengths[i]
    if (vLen > 0) {
      sources[createCompactVertexSourceKey(i)] = {
        arenaId,
        generation,
        kind: 'vertex',
        byteOffset: dataByteOffset + artifact.vertex_byte_offsets[i],
        byteLength: vLen,
      }
    }
    const iLen = artifact.index_byte_lengths[i]
    if (iLen > 0) {
      sources[createCompactIndexSourceKey(i)] = {
        arenaId,
        generation,
        kind: 'index',
        byteOffset: dataByteOffset + artifact.index_byte_offsets[i],
        byteLength: iLen,
      }
    }
  }

  const neuterBuffers = collectFlatCompactArtifactBuffers(artifact)
  return {
    envelope: createChunkArtifactArenaEnvelope(artifact, {
      workerId,
      sab,
      arenaId,
      generation,
      sources,
    }),
    neuterBuffers,
  }
}

// 基于 ArenaDirectMeshResult 构建 arena envelope。
// 此时 WASM 已经把 payload 直接写入 SAB 数据区。
function createArenaDirectEnvelope(
  meta: ArenaDirectArtifactMeta,
  arenaId: number,
  generation: number,
  sab: SharedArrayBuffer,
  dataByteOffset: number,
): ChunkArtifactEnvelopeWithPayload {
  const sources: Record<string, ChunkPayloadArenaSpan> = {}
  const itemCount = meta.vertex_byte_lengths.length
  for (let i = 0; i < itemCount; i++) {
    const vLen = meta.vertex_byte_lengths[i]
    if (vLen > 0) {
      sources[createCompactVertexSourceKey(i)] = {
        arenaId,
        generation,
        kind: 'vertex',
        byteOffset: dataByteOffset + meta.vertex_byte_offsets[i],
        byteLength: vLen,
      }
    }
    const iLen = meta.index_byte_lengths[i]
    if (iLen > 0) {
      sources[createCompactIndexSourceKey(i)] = {
        arenaId,
        generation,
        kind: 'index',
        byteOffset: dataByteOffset + meta.index_byte_offsets[i],
        byteLength: iLen,
      }
    }
  }

  return {
    descriptor: createChunkArtifactDescriptor(meta),
    payloadArena: { workerId, sab, arenaId, generation, sources },
  }
}

function createCompactArtifactArenaEnvelope(artifact: AnyChunkBuildArtifact): {
  envelope: ChunkArtifactEnvelopeWithPayload
  neuterBuffers: ArrayBuffer[]
} {
  if (isFlatCompactChunkBuildArtifact(artifact)) {
    return createFlatBlobArenaEnvelope(artifact)
  }

  if (!isCompactChunkBuildArtifact(artifact)) {
    return { envelope: createChunkArtifactEnvelope(artifact), neuterBuffers: [] }
  }

  let requiredBytes = 0
  for (const vertexBytes of artifact.vertex_buffers) {
    requiredBytes += vertexBytes?.byteLength ?? 0
  }
  for (const indexBytes of artifact.index_buffers) {
    requiredBytes += indexBytes?.byteLength ?? 0
  }

  if (requiredBytes === 0) {
    return { envelope: createChunkArtifactEnvelope(artifact), neuterBuffers: [] }
  }

  const arenaAllocation = acquirePayloadArena(getChunkPayloadArenaRequiredBytes(requiredBytes))
  const sab = arenaAllocation.sab
  const arenaId = arenaAllocation.arenaId
  const generation = arenaAllocation.generation
  const arenaView = createChunkPayloadArenaView(sab)
  initializeChunkPayloadArena(arenaView, {
    arenaId,
    generation,
    itemCount: artifact.vertex_buffers.length,
    dataByteLength: requiredBytes,
  })
  activePayloadArenas.set(arenaId, {
    sab,
    byteLength: sab.byteLength,
    generation,
  })

  const writer = new ChunkPayloadArenaWriter(arenaView)
  const sources: Record<string, ReturnType<ChunkPayloadArenaWriter['append']>> = {}

  for (let itemIndex = 0; itemIndex < artifact.vertex_buffers.length; itemIndex++) {
    const vertexBytes = artifact.vertex_buffers[itemIndex]
    if (vertexBytes) {
      sources[createCompactVertexSourceKey(itemIndex)] = writer.append('vertex', vertexBytes)
    }

    const indexBytes = artifact.index_buffers[itemIndex]
    if (indexBytes) {
      sources[createCompactIndexSourceKey(itemIndex)] = writer.append('index', indexBytes)
    }
  }

  writer.publish()

  // 拷入 arena 后收集原始缓冲区，便于调用方通过 transfer 失效原对象。
  const neuterBuffers = collectCompactArtifactBuffers(artifact)

  return {
    envelope: createChunkArtifactArenaEnvelope(artifact, {
      workerId,
      sab,
      arenaId,
      generation,
      sources,
    }),
    neuterBuffers,
  }
}

function appendArtifactTransferables(
  artifactInput: AnyChunkBuildArtifact | ChunkArtifactEnvelopeWithPayload | undefined,
  transferList: Transferable[],
) {
  const artifact =
    artifactInput && 'descriptor' in artifactInput ? artifactInput.artifact : artifactInput
  if (!artifact) {
    return
  }

  if (isFlatCompactChunkBuildArtifact(artifact)) {
    if (artifact.payload_blob?.buffer instanceof ArrayBuffer) {
      transferList.push(artifact.payload_blob.buffer)
    }
    return
  }

  if (isCompactChunkBuildArtifact(artifact)) {
    for (const vertexBytes of artifact.vertex_buffers) {
      transferList.push(vertexBytes.buffer)
    }

    for (const indexBytes of artifact.index_buffers) {
      if (indexBytes) {
        transferList.push(indexBytes.buffer)
      }
    }
    return
  }

  for (const section of (artifact as { sections?: LegacyChunkSection[] }).sections ?? []) {
    for (const item of section.items ?? section.passes ?? []) {
      transferList.push(item.vertex_bytes.buffer)
      if (item.index_bytes) {
        transferList.push(item.index_bytes.buffer)
      }
    }
  }
}

// 尝试走零拷贝的 arena-direct mesh 路径；返回 true 表示已处理，false 表示回退常规路径。
function tryArenaDirectMesh(task: MeshTaskData, msgId: number): boolean {
  const estimate = estimateArenaDataBytes()
  const requiredSabBytes = getChunkPayloadArenaRequiredBytes(estimate)
  const { sab, arenaId, generation } = acquirePayloadArena(requiredSabBytes)
  const arenaView = createChunkPayloadArenaView(sab)

  initializeChunkPayloadArena(arenaView, {
    arenaId,
    generation,
    dataByteLength: estimate,
  })

  const dataByteOffset = readChunkPayloadArenaHeader(arenaView).dataByteOffset
  const arenaDataView = new Uint8Array(sab, dataByteOffset, estimate)

  let result: ArenaDirectMeshResult | null
  try {
    result = chunkProcessor.tryMeshIntoArena({
      chunkX: task.chunkX,
      chunkZ: task.chunkZ,
      generation: task.generation,
      slotIndex: task.slotIndex,
      slotVersion: task.slotVersion,
      dirtySectionYs: task.dirtySectionYs,
      remeshReason: task.remeshReason,
      neighborSlotIndices: task.neighborSlotIndices ?? [],
      arenaDataView,
    })
  } catch (err) {
    // WASM trap 会破坏其内部 allocator，后续调用通常都会继续失败。
    // 因此这里直接永久关闭 arena-direct 路径。
    if (err instanceof WebAssembly.RuntimeError) {
      arenaDirectEnabled = false
      console.error(
        `[Worker] Arena-direct wasm trap detected, disabling arena-direct path permanently:`,
        err,
      )
    } else {
      console.warn(`[Worker] Arena-direct mesh error (fallback to 2-copy):`, err)
    }
    // 回收 arena，并回退到常规路径。
    pooledPayloadArenas.push({
      sab,
      byteLength: sab.byteLength,
      arenaId,
      nextGeneration: generation + 1,
    })
    return false
  }

  if (!result) {
    // 任务已中止，返还 arena 到池中。
    pooledPayloadArenas.push({
      sab,
      byteLength: sab.byteLength,
      arenaId,
      nextGeneration: generation + 1,
    })
    self.postMessage({ type: 'chunkLoaded', id: msgId, error: 'aborted' })
    return true
  }

  // 以实际使用字节数提交 arena。
  commitChunkPayloadArenaBytes(arenaView, result.arenaUsedBytes)
  activePayloadArenas.set(arenaId, { sab, byteLength: sab.byteLength, generation })
  maxObservedArenaDataBytes = Math.max(maxObservedArenaDataBytes, result.arenaUsedBytes)

  const envelope = createArenaDirectEnvelope(
    result.artifactMeta,
    arenaId,
    generation,
    sab,
    dataByteOffset,
  )

  const transferList: Transferable[] = [result.lights.buffer]

  // 更新本轮统计。
  const meshMs = result.meshMs
  if (meshMs > 0) {
    meshTimeSum += meshMs
    meshWasmTimeSum += result.wasmMs
    meshNormalizeTimeSum += 0
    meshBuildTimeSum += 0
    meshWasmDecodeTimeSum += result.wasmDecodeMs
    meshWasmGenerateTimeSum += result.wasmGenerateMs
    meshWasmLegacyPackTimeSum += result.wasmLegacyPackMs
    meshWasmArtifactSerializeTimeSum += result.wasmArtifactSerializeMs
    meshWasmJsBridgeTimeSum += result.wasmJsBridgeMs
    meshTimeCount++
    stats.meshCompleted++
  }
  stats.meshArenaDelivered++

  self.postMessage(
    {
      type: msgId ? 'chunkLoaded' : 'chunkUpdate',
      id: msgId,
      chunkX: result.chunkX,
      chunkZ: result.chunkZ,
      generation: result.generation,
      dirtySectionYs: result.dirtySectionYs,
      remeshReason: result.remeshReason,
      geometry: null,
      artifact: envelope,
      lights: result.lights,
      fetchMs: 0,
      meshMs,
      totalMs: meshMs,
    },
    transferList,
  )
  reportStats()
  return true
}

// 将区块构建结果回传主线程，并优先通过 Transferable 减少额外内存复制。
const onChunkProcessed = (result: ChunkMeshResult, msgId?: number) => {
  const {
    geometry,
    lights,
    artifact,
    chunkX,
    chunkZ,
    generation,
    dirtySectionYs,
    remeshReason,
    fetchMs,
    meshMs,
    totalMs,
    wasmMs,
    normalizeMs,
    buildMs,
    wasmDecodeMs,
    wasmGenerateMs,
    wasmLegacyPackMs,
    wasmArtifactSerializeMs,
    wasmJsBridgeMs,
  } = result
  const transferList: Transferable[] = [lights.buffer]
  let artifactEnvelope: ChunkArtifactEnvelopeWithPayload | undefined
  if (artifact) {
    if (isFlatCompactChunkBuildArtifact(artifact) || isCompactChunkBuildArtifact(artifact)) {
      const { envelope, neuterBuffers } = createCompactArtifactArenaEnvelope(artifact)
      artifactEnvelope = envelope
      // 复制进 arena 后，把旧 buffer 一并 transfer 掉，尽快释放 Worker 内存。
      for (const buf of neuterBuffers) {
        transferList.push(buf)
      }
      stats.meshArenaDelivered++
    } else {
      artifactEnvelope = createChunkArtifactEnvelope(artifact)
      stats.meshTransferableDelivered++
    }
  }
  const payloadGeometry = artifactEnvelope ? null : geometry

  if (payloadGeometry) {
    const { opaque, decal, translucent } = payloadGeometry
    transferList.push(
      opaque.interleaved.buffer,
      decal.interleaved.buffer,
      translucent.interleaved.buffer,
    )

    if (opaque.indices) transferList.push(opaque.indices.buffer)
    if (decal.indices) transferList.push(decal.indices.buffer)
    if (translucent.indices) transferList.push(translucent.indices.buffer)
  }

  appendArtifactTransferables(artifactEnvelope, transferList)

  // 统计网格构建阶段的耗时，用于主线程侧运行时诊断。
  if (meshMs !== undefined && meshMs > 0) {
    meshTimeSum += meshMs
    meshWasmTimeSum += wasmMs ?? 0
    meshNormalizeTimeSum += normalizeMs ?? 0
    meshBuildTimeSum += buildMs ?? 0
    meshWasmDecodeTimeSum += wasmDecodeMs ?? 0
    meshWasmGenerateTimeSum += wasmGenerateMs ?? 0
    meshWasmLegacyPackTimeSum += wasmLegacyPackMs ?? 0
    meshWasmArtifactSerializeTimeSum += wasmArtifactSerializeMs ?? 0
    meshWasmJsBridgeTimeSum += wasmJsBridgeMs ?? 0
    meshTimeCount++
    stats.meshCompleted++
  }
  // Parse 阶段吞吐通过 `parseComplete` 消息单独统计。

  // 使用 Transferable 传输底层缓冲，尽量避免结构化克隆开销。
  self.postMessage(
    {
      type: msgId ? 'chunkLoaded' : 'chunkUpdate',
      id: msgId,
      chunkX,
      chunkZ,
      generation,
      dirtySectionYs,
      remeshReason,
      geometry: payloadGeometry,
      artifact: artifactEnvelope,
      lights,
      fetchMs,
      meshMs,
      totalMs,
    },
    transferList,
  )
  reportStats()
}

// 对于 load 请求，错误需要回传给主线程以便释放活跃请求状态。
const onChunkError = (msgId: number | undefined, error: string) => {
  if (msgId) {
    self.postMessage({ type: 'chunkLoaded', id: msgId, error })
  } else {
    console.error('[Worker] Chunk update error:', error)
  }
}

const chunkProcessor = new ChunkProcessor(onChunkProcessed, onChunkError)

// IO 解析与网格构建分为两条独立队列，分别施加不同的并发上限。
const MAX_IO_INFLIGHT = 256 // IO 队列允许更高并发，因为解析阶段主要受异步资源与 SAB 写入约束。
const MAX_MESH_INFLIGHT = 16 // mesh 队列更重，需要限制并发以控制缓存与内存压力。
let inflightIO = 0
let inflightMesh = 0
let isWorkerReady = false

// 每秒上报一次吞吐与平均耗时统计。
interface WorkerStats {
  parseReceived: number
  parseCompleted: number
  meshReceived: number
  meshCompleted: number
  meshArenaDelivered: number
  meshTransferableDelivered: number
  avgMeshTimeMs: number
  avgMeshWasmTimeMs: number
  avgMeshNormalizeTimeMs: number
  avgMeshBuildTimeMs: number
  avgMeshWasmDecodeTimeMs: number
  avgMeshWasmGenerateTimeMs: number
  avgMeshWasmLegacyPackTimeMs: number
  avgMeshWasmArtifactSerializeTimeMs: number
  avgMeshWasmJsBridgeTimeMs: number
}

const stats: WorkerStats = {
  parseReceived: 0,
  parseCompleted: 0,
  meshReceived: 0,
  meshCompleted: 0,
  meshArenaDelivered: 0,
  meshTransferableDelivered: 0,
  avgMeshTimeMs: 0,
  avgMeshWasmTimeMs: 0,
  avgMeshNormalizeTimeMs: 0,
  avgMeshBuildTimeMs: 0,
  avgMeshWasmDecodeTimeMs: 0,
  avgMeshWasmGenerateTimeMs: 0,
  avgMeshWasmLegacyPackTimeMs: 0,
  avgMeshWasmArtifactSerializeTimeMs: 0,
  avgMeshWasmJsBridgeTimeMs: 0,
}

let meshTimeSum = 0
let meshTimeCount = 0
let meshWasmTimeSum = 0
let meshNormalizeTimeSum = 0
let meshBuildTimeSum = 0
let meshWasmDecodeTimeSum = 0
let meshWasmGenerateTimeSum = 0
let meshWasmLegacyPackTimeSum = 0
let meshWasmArtifactSerializeTimeSum = 0
let meshWasmJsBridgeTimeSum = 0
let lastStatsReport = performance.now()

// 定时向主线程发送当前 Worker 的统计快照。
function reportStats() {
  const now = performance.now()
  const elapsed = (now - lastStatsReport) / 1000
  if (elapsed >= 1.0) {
    const avgMeshTime = meshTimeCount > 0 ? meshTimeSum / meshTimeCount : 0
    const avgMeshWasmTime = meshTimeCount > 0 ? meshWasmTimeSum / meshTimeCount : 0
    const avgMeshNormalizeTime = meshTimeCount > 0 ? meshNormalizeTimeSum / meshTimeCount : 0
    const avgMeshBuildTime = meshTimeCount > 0 ? meshBuildTimeSum / meshTimeCount : 0
    const avgMeshWasmDecodeTime = meshTimeCount > 0 ? meshWasmDecodeTimeSum / meshTimeCount : 0
    const avgMeshWasmGenerateTime = meshTimeCount > 0 ? meshWasmGenerateTimeSum / meshTimeCount : 0
    const avgMeshWasmLegacyPackTime =
      meshTimeCount > 0 ? meshWasmLegacyPackTimeSum / meshTimeCount : 0
    const avgMeshWasmArtifactSerializeTime =
      meshTimeCount > 0 ? meshWasmArtifactSerializeTimeSum / meshTimeCount : 0
    const avgMeshWasmJsBridgeTime = meshTimeCount > 0 ? meshWasmJsBridgeTimeSum / meshTimeCount : 0
    self.postMessage({
      type: 'workerStats',
      workerId,
      stats: {
        parseReceived: stats.parseReceived / elapsed,
        parseCompleted: stats.parseCompleted / elapsed,
        meshReceived: stats.meshReceived / elapsed,
        meshCompleted: stats.meshCompleted / elapsed,
        meshArenaDelivered: stats.meshArenaDelivered / elapsed,
        meshTransferableDelivered: stats.meshTransferableDelivered / elapsed,
        arenaPoolActiveCount: activePayloadArenas.size,
        arenaPooledCount: pooledPayloadArenas.length,
        arenaPoolHitRate:
          arenaPoolHits + arenaPoolMisses > 0
            ? arenaPoolHits / (arenaPoolHits + arenaPoolMisses)
            : 0,
        avgMeshTimeMs: avgMeshTime,
        avgMeshWasmTimeMs: avgMeshWasmTime,
        avgMeshNormalizeTimeMs: avgMeshNormalizeTime,
        avgMeshBuildTimeMs: avgMeshBuildTime,
        avgMeshWasmDecodeTimeMs: avgMeshWasmDecodeTime,
        avgMeshWasmGenerateTimeMs: avgMeshWasmGenerateTime,
        avgMeshWasmLegacyPackTimeMs: avgMeshWasmLegacyPackTime,
        avgMeshWasmArtifactSerializeTimeMs: avgMeshWasmArtifactSerializeTime,
        avgMeshWasmJsBridgeTimeMs: avgMeshWasmJsBridgeTime,
      },
    })
    // 重置本统计窗口的累计值。
    stats.parseReceived = 0
    stats.parseCompleted = 0
    stats.meshReceived = 0
    stats.meshCompleted = 0
    stats.meshArenaDelivered = 0
    stats.meshTransferableDelivered = 0
    arenaPoolHits = 0
    arenaPoolMisses = 0
    meshTimeSum = 0
    meshTimeCount = 0
    meshWasmTimeSum = 0
    meshNormalizeTimeSum = 0
    meshBuildTimeSum = 0
    meshWasmDecodeTimeSum = 0
    meshWasmGenerateTimeSum = 0
    meshWasmLegacyPackTimeSum = 0
    meshWasmArtifactSerializeTimeSum = 0
    meshWasmJsBridgeTimeSum = 0
    lastStatsReport = now
  }
}

// 主线程发送给 Worker 的解析任务数据。
interface ParseTaskData {
  id: number
  chunkX: number
  chunkZ: number
  generation?: number
  chunkData?: Uint8Array // 主线程已拉取并压缩编码后的区块字节流。
  slotIndex: number
  slotVersion: number
  neighborSlots: Record<number, number>
}

interface MeshTaskData {
  id: number
  chunkX: number
  chunkZ: number
  generation?: number
  slotIndex: number
  slotVersion: number
  dirtySectionYs?: number[]
  remeshReason?: 'chunk-load' | 'block-update' | 'neighbor-update' | 'debug'
  neighborSlotIndices?: number[]
  centerData?: Uint8Array
  neighborData?: Uint8Array[]
}

// 解析队列与网格队列分别缓存待执行任务。
const ioQueue: ParseTaskData[] = []
const meshQueue: MeshTaskData[] = []

// 当队列堆积明显时通知主线程进行背压处理。
function checkBackpressure() {
  const ioBacklog = ioQueue.length
  const meshBacklog = meshQueue.length
  // 当前阈值是经验值，目标是避免任务继续无上限堆积。
  if (ioBacklog > 32 || meshBacklog > 16) {
    self.postMessage({
      type: 'backpressure',
      ioBacklog,
      meshBacklog,
    })
  }
}

let pendingResources: WorkerResources | null = null
let wasmModuleInitialized = false
let sabReceived: SharedArrayBuffer | null = null
let pendingMesherOptions: WorkerResources['mesherOptions'] | null = null
const pendingBlockStatesToEnsure = new Set<string>()

type BlockStateResolutionResult = {
  blockStateId: number
  ok: boolean
  error?: string
}

function ensureBlockStateRegistered(blockState: string) {
  const normalized = normalizeResolvableBlockState(blockState)
  if (!normalized) {
    return
  }

  if (!isWorkerReady) {
    pendingBlockStatesToEnsure.add(normalized)
    return
  }

  chunkProcessor.ensureBlockStateRegistered(normalized)
}

function normalizeResolvableBlockState(blockState: string) {
  const normalized = blockState.trim()
  if (!normalized || normalized.startsWith('#')) {
    return null
  }

  return normalized
}

function createBlockStateSyncResult(blockState: string, context: 'sync' | 'deferred') {
  const normalized = normalizeResolvableBlockState(blockState)
  if (!normalized) {
    return {
      blockStateId: -1,
      ok: true,
      error: undefined,
    } satisfies BlockStateResolutionResult
  }

  const blockStateId = chunkProcessor.ensureBlockStateRegistered(normalized)
  const ok = blockStateId >= 0
  return {
    blockStateId,
    ok,
    error: ok ? undefined : `Worker failed to register ${context} blockstate: ${normalized}`,
  } satisfies BlockStateResolutionResult
}

function flushPendingBlockStatesToEnsure() {
  for (const blockState of pendingBlockStatesToEnsure) {
    const result = createBlockStateSyncResult(blockState, 'deferred')
    self.postMessage({
      type: 'blockStateSyncResult',
      workerId,
      blockState,
      blockStateId: result.blockStateId,
      ok: result.ok,
      error: result.error,
    })
  }
  pendingBlockStatesToEnsure.clear()
}

// 当 WASM、SAB 和资源三者都就绪后，完成 Worker 的最终初始化。
async function tryFinalizeInit() {
  // 前提 1：WASM 模块已完成初始化。
  if (!wasmModuleInitialized) return
  // 前提 2：主线程已经发送共享内存。
  if (!sabReceived) return

  // 先建立 SAB 视图，并在资源初始化前完成 Rust 侧 SAB 绑定。
  chunkProcessor.setSAB(sabReceived)

  if (pendingMesherOptions) {
    chunkProcessor.setMesherOptions(pendingMesherOptions)
  }
  chunkProcessor.initWasmSAB()

  // 资源包、颜色图与注册表需要在 SAB 就绪后再初始化。
  if (pendingResources) {
    console.log('[Worker] Finalizing Resource Initialization...')
    try {
      wasmManager.initResources(pendingResources)
      await wasmManager.initColormaps(pendingResources.resource)
      pendingResources = null // 释放已消费的资源初始化输入。
      console.log('[Worker] Fully Initialized.')
      isWorkerReady = true
      flushPendingBlockStatesToEnsure()
      self.postMessage({ type: 'init_complete' })

      // Worker 准备完成后立即尝试清空积压任务。
      tryStartIO()
      tryStartMesh()
    } catch (e) {
      console.error('[Worker] Resource Init Failed:', e)
      onChunkError(undefined, `Resource Init Failed: ${e}`)
    }
  }
}

// 尝试启动 IO/解析队列中的待处理任务。
function tryStartIO() {
  // 暂停状态下不再继续派发新任务。
  if (!isWorkerReady || isPaused) return

  while (inflightIO < MAX_IO_INFLIGHT && ioQueue.length > 0) {
    if (isPaused) break // 循环内部再次确认暂停状态

    const task = ioQueue.shift()!
    inflightIO++

    // 解析任务进入 ChunkProcessor，由其负责 SAB 写入与必要的扩容申请。
    chunkProcessor
      .performParse(task)
      .then(() => {
        stats.parseCompleted++
      })
      .finally(() => {
        inflightIO--
        checkPausedState() // 若暂停请求已发出且队列耗尽，则通知主线程暂停完成。
        tryStartIO()
      })
  }
}

// 尝试启动 Mesh 队列中的待处理任务。
function tryStartMesh() {
  if (!isWorkerReady || isPaused) return

  while (inflightMesh < MAX_MESH_INFLIGHT && meshQueue.length > 0) {
    if (isPaused) break

    const task = meshQueue.shift()!
    inflightMesh++

    // 启用时优先尝试零拷贝 arena-direct 路径，失败后回退到常规 mesh。
    if (arenaDirectEnabled) {
      const handled = tryArenaDirectMesh(task, task.id)
      if (handled) {
        inflightMesh--
        continue
      }
    }

    // @ts-expect-error Mesh 队列的载荷收窄由工作线程分发器保证。
    chunkProcessor.performMesh(task).finally(() => {
      inflightMesh--
      checkPausedState()
      tryStartMesh()
    })
  }
}

// 暂停控制逻辑。
let isPaused = false

function checkPausedState() {
  if (isPaused && inflightIO === 0 && inflightMesh === 0) {
    self.postMessage({ type: 'WORKER_PAUSED', workerId })
  }
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data

  try {
    if (msg.type === 'PAUSE_WORK') {
      isPaused = true
      checkPausedState()
      return
    }

    if (msg.type === 'RESUME_WORK') {
      isPaused = false
      tryStartIO()
      tryStartMesh()
      return
    }
    if (msg.type === 'PAUSE_WORK') {
      isPaused = true
      // 重新检查暂停状态，处理“队列已空但暂停消息刚到”的情况。
      checkPausedState()
      return
    }

    if (msg.type === 'initSAB') {
      sabReceived = msg.sab
      if (typeof msg.maxSlots === 'number') {
        chunkProcessor.setExplicitMaxSlots(msg.maxSlots)
      }
      tryFinalizeInit()
      return
    }

    if (msg.type === 'setWorkerId') {
      workerId = msg.workerId
      return
    }

    if (msg.type === 'releasePayloadArena') {
      releasePayloadArena(msg.arenaId >>> 0, msg.generation >>> 0)
      return
    }

    if (msg.type === 'TOGGLE_ARENA_DIRECT') {
      arenaDirectEnabled = !!msg.enabled
      return
    }

    if (msg.type === 'ENSURE_BLOCKSTATE') {
      const blockState = String(msg.blockState ?? '')
      if (!isWorkerReady) {
        ensureBlockStateRegistered(blockState)
        self.postMessage({
          type: 'blockStateSyncResult',
          workerId,
          blockState,
          blockStateId: -1,
          ok: true,
        })
        return
      }

      const result = createBlockStateSyncResult(blockState, 'sync')
      self.postMessage({
        type: 'blockStateSyncResult',
        workerId,
        blockState,
        blockStateId: result.blockStateId,
        ok: result.ok,
        error: result.error,
      })
      return
    }

    if (msg.type === 'DESCRIBE_BLOCKSTATE') {
      const requestId = Number(msg.requestId ?? 0)
      const blockStateId = Number(msg.blockStateId ?? 0)
      const blockState = isWorkerReady ? chunkProcessor.describeBlockState(blockStateId) : ''
      self.postMessage({
        type: 'describeBlockStateResult',
        requestId,
        workerId,
        blockStateId,
        blockState,
        ok: blockState.length > 0,
        error:
          blockStateId >= 0 && blockState.length === 0
            ? `Worker failed to describe blockstate id ${blockStateId}`
            : undefined,
      })
      return
    }

    if (msg.type === 'init') {
      await wasmManager.init()
      wasmModuleInitialized = true
      pendingResources = msg as WorkerResources
      pendingMesherOptions = (msg as WorkerResources).mesherOptions ?? null
      tryFinalizeInit()
      return
    }
    if (msg.type === 'setMesherOptions') {
      pendingMesherOptions = msg.mesherOptions ?? null
      if (pendingMesherOptions) {
        chunkProcessor.setMesherOptions(pendingMesherOptions)
      }
      return
    }
    // 正式分发解析任务。
    else if (msg.type === 'PARSE_TASK') {
      stats.parseReceived++
      ioQueue.push(msg.task as ParseTaskData)
      tryStartIO()
      checkBackpressure()
    } else if (msg.type === 'ALLOC_RESPONSE') {
      const { id, generation, bufferId, slotIndex, slotVersion, neighborSlots, chunkX, chunkZ } =
        msg
      chunkProcessor.handleAllocResponse(
        id,
        generation,
        bufferId,
        slotIndex,
        slotVersion,
        neighborSlots,
        chunkX,
        chunkZ,
      )
    }
    // 正式分发网格构建任务。
    else if (msg.type === 'MESH_TASK') {
      stats.meshReceived++
      meshQueue.push(msg.task as MeshTaskData)
      tryStartMesh()
      checkBackpressure()
    }
  } catch (e) {
    console.error('[Worker Error]', e)
  }
}
