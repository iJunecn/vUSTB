import { TERRAIN_COMPACT_LAYOUT_ID } from '@render/layout/BuiltinLayouts'
import {
  createChunkPayloadArenaView,
  resolveChunkPayloadArenaSpan,
  type ChunkPayloadArenaSpan,
} from '../memory/PayloadArenaProtocol'

/**
 * @file chunk/domain/index.ts
 * @brief 区块构建产物与 Worker 消息协议
 *
 * 说明：
 *  - 定义 Worker 与主线程之间共享的构建产物、描述符与消息形状
 *  - 约束主线数据流为 `worker payload envelope -> descriptor + resolver -> terrain runtime`
 *  - 将 arena 相关协议单独收敛到 payload arena 边界，避免与主线 span 语义混杂
 */

// 区块网格提取阶段收集出的局部光源数据。
export interface ExtractedLight {
  x: number
  y: number
  z: number
  r: number
  g: number
  b: number
  intensity: number
  radius: number
}

// 工作线程输出的单个材质桶几何缓冲区。
export interface TypedGeometryBuffers {
  interleaved: Uint8Array
  indices?: Uint16Array | Uint32Array
}

// 旧主线程路径仍可直接消费的区块几何体结构。
export interface ChunkGeometryData {
  opaque: TypedGeometryBuffers
  translucent: TypedGeometryBuffers
  decal?: TypedGeometryBuffers
}

// 旧版 artifact 接口，仅用于回退解析。
// 不对外导出；外部统一使用 `AnyChunkBuildArtifact` 或 `ChunkArtifactEnvelope`。
interface ChunkDrawSegmentArtifact {
  facing: string
  vertex_count: number
  first_vertex: number
  index_count: number
  first_index: number
  base_vertex: number
}

interface ChunkItemArtifact {
  item: string
  layout_id: string
  vertex_stride: number
  vertex_bytes: Uint8Array
  index_bytes?: Uint8Array | null
  vertex_count: number
  index_count: number
  segments?: ChunkDrawSegmentArtifact[]
}

interface ChunkSectionArtifact {
  chunk_x: number
  section_y: number
  chunk_z: number
  build_version: number
  items: ChunkItemArtifact[]
  bounds_min: [number, number, number]
  bounds_max: [number, number, number]
}

interface ChunkBuildArtifact {
  chunk_x: number
  chunk_z: number
  sections: ChunkSectionArtifact[]
  lights?: ExtractedLight[]
}

// 当前正式主线只有一种 span 存储模型：工作线程通过可转移缓冲交付原始字节，
// 主线程再通过偏移量与长度在这些字节上建立只读视图。
export interface PayloadSpan {
  storage: 'transferable'
  sourceKey: string
  byteOffset: number
  byteLength: number
}

// 供主线程 terrain/runtime 在需要时按 span 解析字节视图。
export interface ChunkArtifactPayloadResolver {
  resolve(span: PayloadSpan | null | undefined): Uint8Array | null
}

// 主线程稳定消费的单个 item 描述符。
export interface ChunkItemDescriptor {
  item: string
  layoutId?: string
  vertexStride?: number
  vertexCount: number
  indexCount: number
  vertexSpan: PayloadSpan
  indexSpan?: PayloadSpan | null
}

export interface ChunkSectionDescriptor {
  chunkX: number
  sectionY: number
  chunkZ: number
  buildVersion: number
  boundsMin: [number, number, number]
  boundsMax: [number, number, number]
  items: ChunkItemDescriptor[]
}

export interface ChunkArtifactDescriptor {
  chunkX: number
  chunkZ: number
  sectionCount: number
  itemCount: number
  sections: ChunkSectionDescriptor[]
}

// 仅描述主线程稳定消费的描述封套，不承诺携带 payload。
export interface ChunkArtifactEnvelope {
  descriptor: ChunkArtifactDescriptor
}

export interface ChunkArtifactPayloadArena {
  workerId: number
  sab: SharedArrayBuffer
  arenaId: number
  generation: number
  sources: Record<string, ChunkPayloadArenaSpan>
}

export interface ChunkArtifactPayloadArenaReleaseHandle {
  workerId: number
  arenaId: number
  generation: number
}

// 工作线程回传形态：描述封套必有，payload 可来自完整构建产物或独立 arena 后备区。
export interface ChunkArtifactEnvelopeWithPayload extends ChunkArtifactEnvelope {
  artifact?: AnyChunkBuildArtifact
  payloadArena?: ChunkArtifactPayloadArena
}

// Rust/工作线程主线输出的紧凑构建产物，适合跨线程传输与常驻上传。
export interface CompactChunkBuildArtifact {
  chunk_x: number
  chunk_z: number
  section_ys: Int32Array
  build_versions: Uint32Array
  bounds_mins: Float32Array
  bounds_maxs: Float32Array
  section_item_offsets: Uint32Array
  section_item_counts: Uint8Array
  item_kinds: Uint8Array
  vertex_counts: Uint32Array
  vertex_buffers: Uint8Array[]
  index_buffers: Array<Uint8Array | null>
}

// 扁平字节块变体：将全部 vertex/index 字节拼成单个 Uint8Array，
// 再通过每个条目的偏移量与长度做零拷贝切片，避免 Rust 侧逐项构造 JS TypedArray。
export interface FlatCompactChunkBuildArtifact {
  chunk_x: number
  chunk_z: number
  section_ys: Int32Array
  build_versions: Uint32Array
  bounds_mins: Float32Array
  bounds_maxs: Float32Array
  section_item_offsets: Uint32Array
  section_item_counts: Uint8Array
  item_kinds: Uint8Array
  vertex_counts: Uint32Array
  payload_blob: Uint8Array
  vertex_byte_offsets: Uint32Array
  vertex_byte_lengths: Uint32Array
  index_byte_offsets: Uint32Array
  index_byte_lengths: Uint32Array
}

// Arena 直写变体：WASM 直接把 payload 写入预分配的 SAB arena。
// 返回给 JS 的只有元数据，不再携带 `payload_blob`。
export interface ArenaDirectArtifactMeta {
  chunk_x: number
  chunk_z: number
  section_ys: Int32Array
  build_versions: Uint32Array
  bounds_mins: Float32Array
  bounds_maxs: Float32Array
  section_item_offsets: Uint32Array
  section_item_counts: Uint8Array
  item_kinds: Uint8Array
  vertex_counts: Uint32Array
  vertex_byte_offsets: Uint32Array
  vertex_byte_lengths: Uint32Array
  index_byte_offsets: Uint32Array
  index_byte_lengths: Uint32Array
}

export type AnyChunkBuildArtifact =
  | ChunkBuildArtifact
  | CompactChunkBuildArtifact
  | FlatCompactChunkBuildArtifact
  | ArenaDirectArtifactMeta
export type ChunkArtifactDescriptorInput = AnyChunkBuildArtifact | ChunkArtifactEnvelope

// 兼容历史字段命名，避免 descriptor 化过程中一次性打断旧数据源。
type LegacyChunkItemArtifact = ChunkItemArtifact & { pass?: string }
type LegacyChunkSectionArtifact = ChunkSectionArtifact & { passes?: LegacyChunkItemArtifact[] }
type LegacyCompactChunkBuildArtifact = CompactChunkBuildArtifact & {
  section_pass_offsets?: Uint32Array
  section_pass_counts?: Uint8Array
  pass_kinds?: Uint8Array
}

function createPayloadSpan(sourceKey: string, bytes?: Uint8Array | null): PayloadSpan | null {
  if (!bytes) {
    return null
  }

  return {
    storage: 'transferable',
    sourceKey,
    byteOffset: bytes.byteOffset,
    byteLength: bytes.byteLength,
  }
}

export function createCompactVertexSourceKey(itemIndex: number) {
  return `compact:${itemIndex}:vertex`
}

export function createCompactIndexSourceKey(itemIndex: number) {
  return `compact:${itemIndex}:index`
}

function createSectionVertexSourceKey(sectionIndex: number, itemIndex: number) {
  return `section:${sectionIndex}:item:${itemIndex}:vertex`
}

function createSectionIndexSourceKey(sectionIndex: number, itemIndex: number) {
  return `section:${sectionIndex}:item:${itemIndex}:index`
}

function resolvePayloadSpanSlice(source: Uint8Array, span: PayloadSpan) {
  const localOffset = span.byteOffset - source.byteOffset
  if (localOffset < 0) {
    return null
  }

  const endOffset = localOffset + span.byteLength
  if (endOffset > source.byteLength) {
    return null
  }

  return source.subarray(localOffset, endOffset)
}

function createEmptyPayloadResolver(): ChunkArtifactPayloadResolver {
  return {
    resolve(span) {
      if (!span || span.byteLength === 0) {
        return span ? new Uint8Array(0) : null
      }

      return null
    },
  }
}

export function isCompactChunkBuildArtifact(value: unknown): value is CompactChunkBuildArtifact {
  return (
    !!value &&
    typeof value === 'object' &&
    'section_ys' in value &&
    ('item_kinds' in value || 'pass_kinds' in value) &&
    'vertex_buffers' in value
  )
}

export function isFlatCompactChunkBuildArtifact(
  value: unknown,
): value is FlatCompactChunkBuildArtifact {
  return (
    !!value &&
    typeof value === 'object' &&
    'section_ys' in value &&
    'item_kinds' in value &&
    'payload_blob' in value
  )
}

export function isArenaDirectArtifactMeta(value: unknown): value is ArenaDirectArtifactMeta {
  return (
    !!value &&
    typeof value === 'object' &&
    'section_ys' in value &&
    'vertex_byte_offsets' in value &&
    !('payload_blob' in value) &&
    !('vertex_buffers' in value)
  )
}

function getCompactItemOffsets(artifact: LegacyCompactChunkBuildArtifact) {
  return artifact.section_item_offsets ?? artifact.section_pass_offsets ?? new Uint32Array(0)
}

function getCompactItemCounts(artifact: LegacyCompactChunkBuildArtifact) {
  return artifact.section_item_counts ?? artifact.section_pass_counts ?? new Uint8Array(0)
}

function getCompactItemKinds(artifact: LegacyCompactChunkBuildArtifact) {
  return artifact.item_kinds ?? artifact.pass_kinds ?? new Uint8Array(0)
}

function getSectionItems(section: LegacyChunkSectionArtifact): LegacyChunkItemArtifact[] {
  return section.items ?? section.passes ?? []
}

function getSectionItemName(item: LegacyChunkItemArtifact): string {
  return item.item ?? item.pass ?? 'unknown'
}

function isChunkArtifactEnvelope(value: unknown): value is ChunkArtifactEnvelope {
  return !!value && typeof value === 'object' && 'descriptor' in value
}

export function createChunkArtifactDescriptor(
  artifact: AnyChunkBuildArtifact,
): ChunkArtifactDescriptor {
  if (isFlatCompactChunkBuildArtifact(artifact) || isArenaDirectArtifactMeta(artifact)) {
    const sections: ChunkSectionDescriptor[] = []
    let itemCount = 0

    for (let sectionIndex = 0; sectionIndex < artifact.section_ys.length; sectionIndex++) {
      const boundsOffset = sectionIndex * 3
      const itemOffset = artifact.section_item_offsets[sectionIndex] ?? 0
      const sectionItemCount = artifact.section_item_counts[sectionIndex] ?? 0
      const items: ChunkItemDescriptor[] = []

      for (let offset = 0; offset < sectionItemCount; offset++) {
        const itemIndex = itemOffset + offset
        const itemKindCode = artifact.item_kinds[itemIndex] ?? -1
        const item =
          itemKindCode === 0
            ? 'opaque'
            : itemKindCode === 1
              ? 'decal'
              : itemKindCode === 2
                ? 'translucent'
                : 'unknown'
        const vertexByteLength = artifact.vertex_byte_lengths[itemIndex] ?? 0
        const indexByteLength = artifact.index_byte_lengths[itemIndex] ?? 0
        items.push({
          item,
          layoutId: TERRAIN_COMPACT_LAYOUT_ID,
          vertexStride: 32,
          vertexCount: artifact.vertex_counts[itemIndex] ?? 0,
          indexCount:
            item === 'translucent'
              ? Math.floor(indexByteLength / 4)
              : Math.floor((artifact.vertex_counts[itemIndex] ?? 0) / 4) * 6,
          vertexSpan:
            vertexByteLength > 0
              ? {
                  storage: 'transferable',
                  sourceKey: createCompactVertexSourceKey(itemIndex),
                  byteOffset: 0,
                  byteLength: vertexByteLength,
                }
              : {
                  storage: 'transferable',
                  sourceKey: createCompactVertexSourceKey(itemIndex),
                  byteOffset: 0,
                  byteLength: 0,
                },
          indexSpan:
            indexByteLength > 0
              ? {
                  storage: 'transferable',
                  sourceKey: createCompactIndexSourceKey(itemIndex),
                  byteOffset: 0,
                  byteLength: indexByteLength,
                }
              : null,
        })
      }

      itemCount += items.length
      sections.push({
        chunkX: artifact.chunk_x,
        sectionY: artifact.section_ys[sectionIndex] ?? 0,
        chunkZ: artifact.chunk_z,
        buildVersion: artifact.build_versions[sectionIndex] ?? 0,
        boundsMin: [
          artifact.bounds_mins[boundsOffset] ?? 0,
          artifact.bounds_mins[boundsOffset + 1] ?? 0,
          artifact.bounds_mins[boundsOffset + 2] ?? 0,
        ],
        boundsMax: [
          artifact.bounds_maxs[boundsOffset] ?? 0,
          artifact.bounds_maxs[boundsOffset + 1] ?? 0,
          artifact.bounds_maxs[boundsOffset + 2] ?? 0,
        ],
        items,
      })
    }

    return {
      chunkX: artifact.chunk_x,
      chunkZ: artifact.chunk_z,
      sectionCount: sections.length,
      itemCount,
      sections,
    }
  }

  if (isCompactChunkBuildArtifact(artifact)) {
    const compactArtifact = artifact as LegacyCompactChunkBuildArtifact
    const sections: ChunkSectionDescriptor[] = []
    let itemCount = 0
    const compactItemOffsets = getCompactItemOffsets(compactArtifact)
    const compactItemCounts = getCompactItemCounts(compactArtifact)
    const compactItemKinds = getCompactItemKinds(compactArtifact)

    for (let sectionIndex = 0; sectionIndex < compactArtifact.section_ys.length; sectionIndex++) {
      const boundsOffset = sectionIndex * 3
      const itemOffset = compactItemOffsets[sectionIndex] ?? 0
      const sectionItemCount = compactItemCounts[sectionIndex] ?? 0
      const items: ChunkItemDescriptor[] = []

      for (let offset = 0; offset < sectionItemCount; offset++) {
        const itemIndex = itemOffset + offset
        const itemKindCode = compactItemKinds[itemIndex] ?? -1
        const item =
          itemKindCode === 0
            ? 'opaque'
            : itemKindCode === 1
              ? 'decal'
              : itemKindCode === 2
                ? 'translucent'
                : 'unknown'
        items.push({
          item,
          layoutId: TERRAIN_COMPACT_LAYOUT_ID,
          vertexStride: 32,
          vertexCount: compactArtifact.vertex_counts[itemIndex] ?? 0,
          indexCount:
            item === 'translucent'
              ? Math.floor((compactArtifact.index_buffers[itemIndex]?.byteLength ?? 0) / 4)
              : Math.floor((compactArtifact.vertex_counts[itemIndex] ?? 0) / 4) * 6,
          vertexSpan: createPayloadSpan(
            createCompactVertexSourceKey(itemIndex),
            compactArtifact.vertex_buffers[itemIndex] ?? undefined,
          ) ?? {
            storage: 'transferable',
            sourceKey: createCompactVertexSourceKey(itemIndex),
            byteOffset: 0,
            byteLength: 0,
          },
          indexSpan: createPayloadSpan(
            createCompactIndexSourceKey(itemIndex),
            compactArtifact.index_buffers[itemIndex] ?? null,
          ),
        })
      }

      itemCount += items.length
      sections.push({
        chunkX: compactArtifact.chunk_x,
        sectionY: compactArtifact.section_ys[sectionIndex] ?? 0,
        chunkZ: compactArtifact.chunk_z,
        buildVersion: compactArtifact.build_versions[sectionIndex] ?? 0,
        boundsMin: [
          compactArtifact.bounds_mins[boundsOffset] ?? 0,
          compactArtifact.bounds_mins[boundsOffset + 1] ?? 0,
          compactArtifact.bounds_mins[boundsOffset + 2] ?? 0,
        ],
        boundsMax: [
          compactArtifact.bounds_maxs[boundsOffset] ?? 0,
          compactArtifact.bounds_maxs[boundsOffset + 1] ?? 0,
          compactArtifact.bounds_maxs[boundsOffset + 2] ?? 0,
        ],
        items,
      })
    }

    return {
      chunkX: compactArtifact.chunk_x,
      chunkZ: compactArtifact.chunk_z,
      sectionCount: sections.length,
      itemCount,
      sections,
    }
  }

  const sections = ((artifact as { sections?: LegacyChunkSectionArtifact[] }).sections ?? []).map(
    (section, sectionIndex) => ({
      chunkX: section.chunk_x,
      sectionY: section.section_y,
      chunkZ: section.chunk_z,
      buildVersion: section.build_version,
      boundsMin: section.bounds_min,
      boundsMax: section.bounds_max,
      items: getSectionItems(section).map((item, itemIndex) => ({
        item: getSectionItemName(item),
        layoutId: item.layout_id,
        vertexStride: item.vertex_stride,
        vertexCount: item.vertex_count,
        indexCount: item.index_count,
        vertexSpan: createPayloadSpan(
          createSectionVertexSourceKey(sectionIndex, itemIndex),
          item.vertex_bytes,
        ) ?? {
          storage: 'transferable',
          sourceKey: createSectionVertexSourceKey(sectionIndex, itemIndex),
          byteOffset: 0,
          byteLength: 0,
        },
        indexSpan: createPayloadSpan(
          createSectionIndexSourceKey(sectionIndex, itemIndex),
          item.index_bytes ?? null,
        ),
      })),
    }),
  )

  return {
    chunkX: artifact.chunk_x,
    chunkZ: artifact.chunk_z,
    sectionCount: sections.length,
    itemCount: sections.reduce((sum, section) => sum + section.items.length, 0),
    sections,
  }
}

export function createChunkArtifactEnvelope(
  artifact: AnyChunkBuildArtifact,
): ChunkArtifactEnvelopeWithPayload {
  return {
    descriptor: createChunkArtifactDescriptor(artifact),
    artifact,
  }
}

export function createChunkArtifactArenaEnvelope(
  artifact: AnyChunkBuildArtifact,
  payloadArena: ChunkArtifactPayloadArena,
): ChunkArtifactEnvelopeWithPayload {
  return {
    descriptor: createChunkArtifactDescriptor(artifact),
    payloadArena,
  }
}

export function getChunkArtifactPayloadArenaReleaseHandles(
  artifactEnvelope: ChunkArtifactEnvelopeWithPayload | undefined,
): ChunkArtifactPayloadArenaReleaseHandle[] {
  const payloadArena = artifactEnvelope?.payloadArena
  if (!payloadArena) {
    return []
  }

  return [
    {
      workerId: payloadArena.workerId,
      arenaId: payloadArena.arenaId,
      generation: payloadArena.generation,
    },
  ]
}

export function resolveChunkArtifactDescriptor(
  artifact: ChunkArtifactDescriptorInput | undefined,
): ChunkArtifactDescriptor | undefined {
  if (!artifact) {
    return undefined
  }

  if (isChunkArtifactEnvelope(artifact)) {
    return artifact.descriptor
  }

  return createChunkArtifactDescriptor(artifact)
}

// 当前正式主线里，payload 解析器只从工作线程回传的 payload 封套构造。
// 独立后备区如果未来存在，应在新的真实读写路径落地后单独建模。
export function createChunkArtifactEnvelopePayloadResolver(
  artifactEnvelope: ChunkArtifactEnvelopeWithPayload | undefined,
): ChunkArtifactPayloadResolver {
  const artifact = artifactEnvelope?.artifact
  if (!artifact) {
    const payloadArena = artifactEnvelope?.payloadArena
    if (!payloadArena) {
      return createEmptyPayloadResolver()
    }

    const arenaView = createChunkPayloadArenaView(payloadArena.sab)
    return {
      resolve(span) {
        if (!span) {
          return null
        }

        if (span.byteLength === 0) {
          return new Uint8Array(0)
        }

        const arenaSpan = payloadArena.sources[span.sourceKey]
        if (!arenaSpan) {
          return null
        }

        const bytes = resolveChunkPayloadArenaSpan(arenaView, arenaSpan)
        if (!bytes) {
          return null
        }

        if (span.byteLength >= bytes.byteLength) {
          return bytes
        }

        if (import.meta.env.DEV) {
          console.warn(
            `[PayloadArenaResolver] Span byteLength (${span.byteLength}) < arena bytes (${bytes.byteLength}), truncating. sourceKey=${span.sourceKey}`,
          )
        }
        return bytes.subarray(0, span.byteLength)
      },
    }
  }

  const sources = new Map<string, Uint8Array>()

  if (isFlatCompactChunkBuildArtifact(artifact)) {
    const blob = artifact.payload_blob
    const itemCount = artifact.vertex_byte_lengths.length
    for (let itemIndex = 0; itemIndex < itemCount; itemIndex++) {
      const vLen = artifact.vertex_byte_lengths[itemIndex]
      if (vLen > 0) {
        const vOff = artifact.vertex_byte_offsets[itemIndex]
        sources.set(createCompactVertexSourceKey(itemIndex), blob.subarray(vOff, vOff + vLen))
      }
      const iLen = artifact.index_byte_lengths[itemIndex]
      if (iLen > 0) {
        const iOff = artifact.index_byte_offsets[itemIndex]
        sources.set(createCompactIndexSourceKey(itemIndex), blob.subarray(iOff, iOff + iLen))
      }
    }
  } else if (isCompactChunkBuildArtifact(artifact)) {
    const compactArtifact = artifact as LegacyCompactChunkBuildArtifact
    for (let itemIndex = 0; itemIndex < compactArtifact.vertex_buffers.length; itemIndex++) {
      const vertexBytes = compactArtifact.vertex_buffers[itemIndex]
      if (vertexBytes) {
        sources.set(createCompactVertexSourceKey(itemIndex), vertexBytes)
      }

      const indexBytes = compactArtifact.index_buffers[itemIndex]
      if (indexBytes) {
        sources.set(createCompactIndexSourceKey(itemIndex), indexBytes)
      }
    }
  } else {
    const sections = (artifact as { sections?: LegacyChunkSectionArtifact[] }).sections ?? []
    sections.forEach((section, sectionIndex) => {
      getSectionItems(section).forEach((item, itemIndex) => {
        sources.set(createSectionVertexSourceKey(sectionIndex, itemIndex), item.vertex_bytes)
        if (item.index_bytes) {
          sources.set(createSectionIndexSourceKey(sectionIndex, itemIndex), item.index_bytes)
        }
      })
    })
  }

  return {
    resolve(span) {
      if (!span) {
        return null
      }

      if (span.byteLength === 0) {
        return new Uint8Array(0)
      }

      const source = sources.get(span.sourceKey)
      if (!source) {
        return null
      }

      return resolvePayloadSpanSlice(source, span)
    },
  }
}

export function getChunkArtifactSectionCount(artifact: ChunkArtifactDescriptorInput): number {
  const descriptor = resolveChunkArtifactDescriptor(artifact)
  if (descriptor) {
    return descriptor.sectionCount
  }

  return 0
}

export function getChunkArtifactItemCount(artifact: ChunkArtifactDescriptorInput): number {
  const descriptor = resolveChunkArtifactDescriptor(artifact)
  if (descriptor) {
    return descriptor.itemCount
  }

  return 0
}

export type ChunkRemeshReason = 'chunk-load' | 'block-update' | 'neighbor-update' | 'debug'

export interface DirtySectionRemeshRequest {
  chunkX: number
  chunkZ: number
  dirtySectionYs: number[]
  reason: ChunkRemeshReason
}

export interface BlockUpdateRequest {
  worldX: number
  worldY: number
  worldZ: number
  reason?: Extract<ChunkRemeshReason, 'block-update' | 'neighbor-update' | 'debug'>
  includeNeighborChunks?: boolean
}

// 工作线程与主线程之间共享的通用消息形状。
export interface WorkerMessage {
  type: string
  id?: number
  requestId?: number
  workerId?: number
  generation?: number
  chunkX?: number
  chunkZ?: number
  dirtySectionYs?: number[]
  remeshReason?: ChunkRemeshReason
  blockState?: string
  blockStateId?: number
  ok?: boolean
  geometry?: ChunkGeometryData | null
  artifact?: ChunkArtifactEnvelopeWithPayload
  data?: unknown
  error?: string
  lights?: Float32Array
  fetchMs?: number
  meshMs?: number
  totalMs?: number
}

// ChunkDirector 中排队等待调度的请求快照。
export interface PendingRequest {
  chunkX: number
  chunkZ: number
  generation: number
  isUpdate?: boolean
}

// 主线程调试面板消费的 Worker 吞吐/耗时快照。
export interface WorkerStatsSnapshot {
  parseReceivedPerSec: number
  parseCompletedPerSec: number
  meshReceivedPerSec: number
  meshCompletedPerSec: number
  meshArenaDeliveredPerSec: number
  meshTransferableDeliveredPerSec: number
  arenaPoolActiveCount: number
  arenaPooledCount: number
  arenaPoolHitRate: number
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
