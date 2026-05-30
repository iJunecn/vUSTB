import { GAME_CONFIG } from '@/engine/config'
import type { TerrainIndexMode, TerrainItem, ClusterItemBumpState } from '../types'

// Shared quad index template (baseVertex=0, lazy-init once)
// Uses QUAD_INDICES_CCW pattern [0,2,1,0,3,2] per quad — see terrain/TerrainMeshConventions.ts
let sharedQuadTemplate: Uint32Array | null = null
const QUAD_TEMPLATE_MAX_QUADS = 32768

function getSharedQuadTemplate(): Uint32Array {
  if (!sharedQuadTemplate) {
    sharedQuadTemplate = new Uint32Array(QUAD_TEMPLATE_MAX_QUADS * 6)
    for (let q = 0; q < QUAD_TEMPLATE_MAX_QUADS; q++) {
      const v = q * 4
      const i = q * 6
      sharedQuadTemplate[i] = v
      sharedQuadTemplate[i + 1] = v + 2
      sharedQuadTemplate[i + 2] = v + 1
      sharedQuadTemplate[i + 3] = v
      sharedQuadTemplate[i + 4] = v + 3
      sharedQuadTemplate[i + 5] = v + 2
    }
  }
  return sharedQuadTemplate
}

// Reusable scratch buffer for per-section index generation
let indexScratchBuffer = new Uint32Array(4096)

function getIndexScratch(minElements: number): Uint32Array {
  if (indexScratchBuffer.length < minElements) {
    indexScratchBuffer = new Uint32Array(Math.max(minElements, indexScratchBuffer.length * 2))
  }
  return indexScratchBuffer
}

export interface TerrainClusterBufferUploadResult {
  uploadedSectionKeys: string[]
  removedSectionKeys: string[]
  vertexBytes: number
  indexBytes: number
  partialVertexUploadCalls: number
  indexBuildMs: number
  vertexReallocated: boolean
  rebuildSuggested: boolean
}

export interface TerrainClusterBufferRebuildResult {
  vertexBytes: number
  indexBytes: number
}

export interface TerrainClusterBufferSectionData {
  sectionKey: string
  vertexBytes: Uint8Array
  indexBytes?: Uint8Array | null
  indexMode: TerrainIndexMode
  vertexStride: number
  vertexCount: number
  indexCount: number
}

interface TerrainClusterBufferSectionRecord {
  sectionKey: string
  indexMode: TerrainIndexMode
  vertexStride: number
  vertexCount: number
  indexCount: number
  vertexOffsetBytes: number
  vertexSizeBytes: number
  indexBytes: Uint8Array | null
  generatedIndexOffsetBytes: number
  generatedIndexSizeBytes: number
}

export class WebGL2TerrainClusterBuffer {
  private vertexBuffer: WebGLBuffer
  private indexBuffer: WebGLBuffer
  private vertexCapacityBytes = 0
  private indexCapacityBytes = 0
  private vertexBumpBytes = 0
  private liveVertexBytes = 0
  private deadVertexBytes = 0
  private currentIndexBytes = 0
  private readonly sectionRecords = new Map<string, TerrainClusterBufferSectionRecord>()

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly clusterKey: string,
    readonly item: TerrainItem,
  ) {
    this.vertexBuffer = gl.createBuffer()!
    this.indexBuffer = gl.createBuffer()!
  }

  public uploadDelta(params: {
    updates: TerrainClusterBufferSectionData[]
    removals: string[]
  }): TerrainClusterBufferUploadResult {
    const gl = this.gl
    const previousBumpBytes = this.vertexBumpBytes
    let uploadedVertexBytes = 0
    let partialVertexUploadCalls = 0

    // Determine whether we can use the fast incremental index append path:
    // only when there are no removals AND all updates are for new (not existing) sections
    const needsFullIndexRebuild =
      params.removals.length > 0 || params.updates.some(u => this.sectionRecords.has(u.sectionKey))

    // Process removals — mark dead
    for (const sectionKey of params.removals) {
      const existing = this.sectionRecords.get(sectionKey)
      if (existing) {
        this.deadVertexBytes += existing.vertexSizeBytes
        this.liveVertexBytes -= existing.vertexSizeBytes
        this.sectionRecords.delete(sectionKey)
      }
    }

    // Process updates — append at bump pointer
    for (const update of params.updates) {
      const existing = this.sectionRecords.get(update.sectionKey)
      if (existing) {
        this.deadVertexBytes += existing.vertexSizeBytes
        this.liveVertexBytes -= existing.vertexSizeBytes
      }

      const vertexSizeBytes = update.vertexBytes.byteLength
      const vertexOffsetBytes = this.vertexBumpBytes
      this.vertexBumpBytes += vertexSizeBytes
      this.liveVertexBytes += vertexSizeBytes

      const indexBytes =
        update.indexBytes && update.indexBytes.byteLength > 0
          ? this.ensureAlignedIndexBytes(update.indexBytes)
          : null

      this.sectionRecords.set(update.sectionKey, {
        sectionKey: update.sectionKey,
        indexMode: update.indexMode,
        vertexStride: update.vertexStride,
        vertexCount: update.vertexCount,
        indexCount: update.indexCount,
        vertexOffsetBytes,
        vertexSizeBytes,
        indexBytes,
        generatedIndexOffsetBytes: 0,
        generatedIndexSizeBytes: 0,
      })

      uploadedVertexBytes += vertexSizeBytes
    }

    // Ensure vertex capacity — grow if bump exceeds capacity
    const vertexReallocated =
      this.vertexBumpBytes > this.vertexCapacityBytes
        ? this.growVertexBuffer(this.vertexBumpBytes, previousBumpBytes)
        : false

    // Upload vertex data via bufferSubData
    if (params.updates.length > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
      for (const update of params.updates) {
        if (update.vertexBytes.byteLength > 0) {
          const record = this.sectionRecords.get(update.sectionKey)!
          gl.bufferSubData(gl.ARRAY_BUFFER, record.vertexOffsetBytes, update.vertexBytes)
          partialVertexUploadCalls++
        }
      }
    }

    // Index update: incremental append for pure-new sections, full rebuild otherwise
    const indexBuildStart = performance.now()
    if (params.updates.length > 0 || params.removals.length > 0) {
      if (needsFullIndexRebuild) {
        this.rebuildWholeItemIndex()
      } else {
        this.appendSectionIndices(params.updates)
      }
    }
    const indexBuildMs = performance.now() - indexBuildStart

    return {
      uploadedSectionKeys: params.updates.map(u => u.sectionKey),
      removedSectionKeys: [...params.removals],
      vertexBytes: uploadedVertexBytes,
      indexBytes: this.currentIndexBytes,
      partialVertexUploadCalls,
      indexBuildMs,
      vertexReallocated,
      rebuildSuggested: this.needsRebuild(),
    }
  }

  public get itemKey() {
    return this.item
  }

  public dispose() {
    this.gl.deleteBuffer(this.vertexBuffer)
    this.gl.deleteBuffer(this.indexBuffer)
    this.sectionRecords.clear()
    this.vertexCapacityBytes = 0
    this.indexCapacityBytes = 0
    this.vertexBumpBytes = 0
    this.liveVertexBytes = 0
    this.deadVertexBytes = 0
    this.currentIndexBytes = 0
  }

  public getVertexBuffer() {
    return this.vertexBuffer
  }

  public getIndexBuffer() {
    return this.indexBuffer
  }

  public getVertexByteLength() {
    return this.vertexBumpBytes
  }

  public getIndexByteLength() {
    return this.currentIndexBytes
  }

  public needsRebuild(): boolean {
    if (this.sectionRecords.size === 0) return false
    return this.deadVertexBytes > this.liveVertexBytes
  }

  public getDeadVertexBytes() {
    return this.deadVertexBytes
  }

  public getLiveVertexBytes() {
    return this.liveVertexBytes
  }

  public getBumpState(): ClusterItemBumpState {
    return {
      vertexCapacityBytes: this.vertexCapacityBytes,
      indexCapacityBytes: this.indexCapacityBytes,
      vertexBumpBytes: this.vertexBumpBytes,
      indexBumpBytes: this.currentIndexBytes,
      liveVertexBytes: this.liveVertexBytes,
      liveIndexBytes: this.currentIndexBytes,
      deadVertexBytes: this.deadVertexBytes,
      deadIndexBytes: 0,
      sectionCount: this.sectionRecords.size,
    }
  }

  public rebuild(): TerrainClusterBufferRebuildResult {
    const gl = this.gl
    const records = [...this.sectionRecords.values()]

    if (records.length === 0) {
      this.vertexBumpBytes = 0
      this.liveVertexBytes = 0
      this.deadVertexBytes = 0
      this.currentIndexBytes = 0
      return { vertexBytes: 0, indexBytes: 0 }
    }

    // Compute packed layout — record old offsets then assign new packed offsets
    const moves: Array<{ fromOffset: number; toOffset: number; size: number }> = []
    let vertexWriteOffset = 0
    for (const record of records) {
      moves.push({
        fromOffset: record.vertexOffsetBytes,
        toOffset: vertexWriteOffset,
        size: record.vertexSizeBytes,
      })
      record.vertexOffsetBytes = vertexWriteOffset
      vertexWriteOffset += record.vertexSizeBytes
    }

    const totalLiveVertexBytes = vertexWriteOffset
    const nextVertexCapacity = this.computeCapacity(totalLiveVertexBytes, true)
    const nextVertexBuffer = gl.createBuffer()
    if (!nextVertexBuffer) {
      throw new Error(
        `Failed to allocate vertex buffer for rebuild: ${this.clusterKey}:${this.item}`,
      )
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, nextVertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, nextVertexCapacity, gl.DYNAMIC_DRAW)

    // Copy live sections from old buffer to new buffer
    if (totalLiveVertexBytes > 0) {
      gl.bindBuffer(gl.COPY_READ_BUFFER, this.vertexBuffer)
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, nextVertexBuffer)
      for (const move of moves) {
        if (move.size > 0) {
          gl.copyBufferSubData(
            gl.COPY_READ_BUFFER,
            gl.COPY_WRITE_BUFFER,
            move.fromOffset,
            move.toOffset,
            move.size,
          )
        }
      }
      gl.bindBuffer(gl.COPY_READ_BUFFER, null)
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null)
    }

    gl.deleteBuffer(this.vertexBuffer)
    this.vertexBuffer = nextVertexBuffer
    this.vertexCapacityBytes = nextVertexCapacity
    this.vertexBumpBytes = totalLiveVertexBytes
    this.liveVertexBytes = totalLiveVertexBytes
    this.deadVertexBytes = 0

    // Rebuild index with updated offsets
    this.rebuildWholeItemIndex()

    return {
      vertexBytes: totalLiveVertexBytes,
      indexBytes: this.currentIndexBytes,
    }
  }

  private growVertexBuffer(requiredBytes: number, previousUsedBytes: number): boolean {
    const gl = this.gl
    const nextCapacity = this.computeCapacity(requiredBytes, true)
    const nextBuffer = gl.createBuffer()
    if (!nextBuffer) {
      throw new Error(`Failed to allocate vertex buffer for grow: ${this.clusterKey}:${this.item}`)
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, nextBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, nextCapacity, gl.DYNAMIC_DRAW)

    if (previousUsedBytes > 0 && this.vertexCapacityBytes > 0) {
      gl.bindBuffer(gl.COPY_READ_BUFFER, this.vertexBuffer)
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, nextBuffer)
      gl.copyBufferSubData(
        gl.COPY_READ_BUFFER,
        gl.COPY_WRITE_BUFFER,
        0,
        0,
        Math.min(previousUsedBytes, this.vertexCapacityBytes),
      )
      gl.bindBuffer(gl.COPY_READ_BUFFER, null)
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null)
    }

    gl.deleteBuffer(this.vertexBuffer)
    this.vertexBuffer = nextBuffer
    this.vertexCapacityBytes = nextCapacity
    return true
  }

  private rebuildWholeItemIndex() {
    const gl = this.gl

    // First pass: estimate total index bytes for capacity check
    let totalIndexBytes = 0
    for (const record of this.sectionRecords.values()) {
      totalIndexBytes += this.estimateSectionIndexByteSize(record)
    }

    if (totalIndexBytes === 0) {
      this.currentIndexBytes = 0
      return
    }

    // Ensure index buffer capacity
    if (totalIndexBytes > this.indexCapacityBytes) {
      const nextIndexCapacity = this.computeCapacity(totalIndexBytes, false)
      const nextIndexBuffer = gl.createBuffer()
      if (!nextIndexBuffer) {
        throw new Error(`Failed to allocate index buffer: ${this.clusterKey}:${this.item}`)
      }
      gl.deleteBuffer(this.indexBuffer)
      this.indexBuffer = nextIndexBuffer
      this.indexCapacityBytes = nextIndexCapacity
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, nextIndexCapacity, gl.DYNAMIC_DRAW)
    }

    // Second pass: generate + upload each section's indices directly via scratch
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer)
    let writeOffset = 0
    for (const record of this.sectionRecords.values()) {
      const baseVertex = Math.floor(record.vertexOffsetBytes / Math.max(record.vertexStride, 1))
      const indexData = this.buildSectionIndexBytes(record, baseVertex)
      record.generatedIndexOffsetBytes = writeOffset
      record.generatedIndexSizeBytes = indexData.byteLength
      if (indexData.byteLength > 0) {
        gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, writeOffset, indexData)
        writeOffset += indexData.byteLength
      }
    }

    this.currentIndexBytes = writeOffset
  }

  private buildSectionIndexBytes(
    record: TerrainClusterBufferSectionRecord,
    baseVertex: number,
  ): Uint8Array {
    switch (record.indexMode) {
      case 'shared-static':
        return record.indexBytes && record.indexBytes.byteLength > 0
          ? this.buildRebasedIndexBytes(record.indexBytes, baseVertex)
          : this.buildSharedQuadIndexBytes(baseVertex, record.vertexCount)
      case 'local-dynamic':
      default:
        return record.indexBytes && record.indexBytes.byteLength > 0
          ? this.buildRebasedIndexBytes(record.indexBytes, baseVertex)
          : new Uint8Array(0)
    }
  }

  private estimateSectionIndexByteSize(record: TerrainClusterBufferSectionRecord): number {
    switch (record.indexMode) {
      case 'shared-static':
        return record.indexBytes && record.indexBytes.byteLength > 0
          ? record.indexBytes.byteLength
          : Math.floor(record.vertexCount / 4) * 6 * 4
      case 'local-dynamic':
      default:
        return record.indexBytes && record.indexBytes.byteLength > 0
          ? record.indexBytes.byteLength
          : 0
    }
  }

  private appendSectionIndices(updates: TerrainClusterBufferSectionData[]) {
    const gl = this.gl
    let appendOffset = this.currentIndexBytes

    // First pass: estimate total new bytes for grow check
    let estimatedNewBytes = 0
    for (const update of updates) {
      const record = this.sectionRecords.get(update.sectionKey)
      if (!record) continue
      estimatedNewBytes += this.estimateSectionIndexByteSize(record)
    }

    // Grow index buffer if needed (preserving existing data)
    const requiredBytes = this.currentIndexBytes + estimatedNewBytes
    if (requiredBytes > this.indexCapacityBytes) {
      this.growIndexBuffer(requiredBytes)
    }

    // Second pass: generate + upload each section's indices directly via scratch
    if (estimatedNewBytes > 0) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer)
    }
    for (const update of updates) {
      const record = this.sectionRecords.get(update.sectionKey)
      if (!record) continue
      const baseVertex = Math.floor(record.vertexOffsetBytes / Math.max(record.vertexStride, 1))
      const indexData = this.buildSectionIndexBytes(record, baseVertex)
      record.generatedIndexOffsetBytes = appendOffset
      record.generatedIndexSizeBytes = indexData.byteLength
      if (indexData.byteLength > 0) {
        gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, appendOffset, indexData)
      }
      appendOffset += indexData.byteLength
    }

    this.currentIndexBytes = appendOffset
  }

  private growIndexBuffer(requiredBytes: number) {
    const gl = this.gl
    const nextCapacity = this.computeCapacity(requiredBytes, false)
    const nextBuffer = gl.createBuffer()
    if (!nextBuffer) {
      throw new Error(`Failed to allocate index buffer for grow: ${this.clusterKey}:${this.item}`)
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, nextBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, nextCapacity, gl.DYNAMIC_DRAW)

    // Copy existing index data
    if (this.currentIndexBytes > 0 && this.indexCapacityBytes > 0) {
      gl.bindBuffer(gl.COPY_READ_BUFFER, this.indexBuffer)
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, nextBuffer)
      gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, this.currentIndexBytes)
      gl.bindBuffer(gl.COPY_READ_BUFFER, null)
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null)
    }

    gl.deleteBuffer(this.indexBuffer)
    this.indexBuffer = nextBuffer
    this.indexCapacityBytes = nextCapacity
  }

  private buildRebasedIndexBytes(indexBytes: Uint8Array, baseVertex: number): Uint8Array {
    const sourceIndices = new Uint32Array(
      indexBytes.buffer,
      indexBytes.byteOffset,
      indexBytes.byteLength / 4,
    )
    const count = sourceIndices.length
    const scratch = getIndexScratch(count)
    for (let i = 0; i < count; i++) {
      scratch[i] = sourceIndices[i] + baseVertex
    }
    return new Uint8Array(scratch.buffer, scratch.byteOffset, count * 4)
  }

  private buildSharedQuadIndexBytes(baseVertex: number, vertexCount: number): Uint8Array {
    const quadCount = Math.floor(vertexCount / 4)
    if (quadCount <= 0) {
      return new Uint8Array(0)
    }

    const indexCount = quadCount * 6
    const template = getSharedQuadTemplate()
    const scratch = getIndexScratch(indexCount)

    if (baseVertex === 0) {
      scratch.set(template.subarray(0, indexCount))
    } else {
      for (let i = 0; i < indexCount; i++) {
        scratch[i] = template[i] + baseVertex
      }
    }

    return new Uint8Array(scratch.buffer, scratch.byteOffset, indexCount * 4)
  }

  private computeCapacity(requiredBytes: number, isVertexBuffer: boolean): number {
    const minInitialCapacity = isVertexBuffer ? 512 * 1024 : 128 * 1024
    const pageSizeBytes = isVertexBuffer
      ? GAME_CONFIG.RENDER.ARTIFACT_RUNTIME.RESIDENT_VERTEX_PAGE_BYTES
      : GAME_CONFIG.RENDER.ARTIFACT_RUNTIME.RESIDENT_INDEX_PAGE_BYTES
    const headroomPages = Math.max(
      0,
      GAME_CONFIG.RENDER.ARTIFACT_RUNTIME.RESIDENT_PAGE_HEADROOM_PAGES,
    )
    return Math.max(
      minInitialCapacity,
      this.alignToPageBytes(requiredBytes + headroomPages * pageSizeBytes, pageSizeBytes),
    )
  }

  private alignToPageBytes(byteLength: number, pageSizeBytes: number): number {
    if (byteLength <= 0) {
      return 0
    }
    return Math.ceil(byteLength / Math.max(pageSizeBytes, 1)) * Math.max(pageSizeBytes, 1)
  }

  private ensureAlignedIndexBytes(indexBytes: Uint8Array): Uint8Array {
    return indexBytes.byteOffset % 4 === 0 ? indexBytes : indexBytes.slice()
  }
}
