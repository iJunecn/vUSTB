import {
  type ChunkPayloadArenaBufferKind,
  type ChunkPayloadArenaSpan,
  type ChunkPayloadArenaView,
  commitChunkPayloadArenaBytes,
  isChunkPayloadArenaInitialized,
  readChunkPayloadArenaHeader,
} from './PayloadArenaProtocol'

export class ChunkPayloadArenaWriter {
  private readonly arenaId: number
  private readonly generation: number
  private readonly dataByteOffset: number
  private readonly dataByteLength: number
  private committedByteLength = 0

  constructor(private readonly view: ChunkPayloadArenaView) {
    if (!isChunkPayloadArenaInitialized(view)) {
      throw new Error('[ChunkPayloadArenaWriter] Arena must be initialized before writing.')
    }

    const header = readChunkPayloadArenaHeader(view)
    this.arenaId = header.arenaId
    this.generation = header.generation
    this.dataByteOffset = header.dataByteOffset
    this.dataByteLength = header.dataByteLength
    this.committedByteLength = header.committedByteLength
  }

  public getCommittedByteLength() {
    return this.committedByteLength
  }

  public append(kind: ChunkPayloadArenaBufferKind, bytes: Uint8Array): ChunkPayloadArenaSpan {
    const byteLength = bytes.byteLength >>> 0
    const byteOffset = this.dataByteOffset + this.committedByteLength
    const nextCommittedByteLength = this.committedByteLength + byteLength

    if (nextCommittedByteLength > this.dataByteLength) {
      throw new Error(
        `[ChunkPayloadArenaWriter] Arena overflow. need=${nextCommittedByteLength} capacity=${this.dataByteLength}`,
      )
    }

    this.view.bytes.set(bytes, byteOffset)
    this.committedByteLength = nextCommittedByteLength

    return {
      arenaId: this.arenaId,
      generation: this.generation,
      kind,
      byteOffset,
      byteLength,
    }
  }

  public publish() {
    commitChunkPayloadArenaBytes(this.view, this.committedByteLength)
  }
}
