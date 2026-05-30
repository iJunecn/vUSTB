/**
 * 从 `.mca` 文件的二进制内容中提取指定 chunk 的原始压缩数据。
 * @param regionBuffer 整个 `.mca` 文件的 ArrayBuffer
 * @param chunkX 全局区块 X
 * @param chunkZ 全局区块 Z
 * @returns 压缩数据 `Uint8Array`，格式为 `[CompressionType, ...CompressedData]`；不存在时返回 `undefined`
 */
export function extractChunkData(
  regionBuffer: ArrayBuffer,
  chunkX: number,
  chunkZ: number,
): Uint8Array | undefined {
  const view = new DataView(regionBuffer)

  // 1. 计算 Region 内局部坐标，范围为 0 到 31。
  const rx = ((chunkX % 32) + 32) % 32
  const rz = ((chunkZ % 32) + 32) % 32

  // 2. 读取 Location Table，偏移区间为 0 到 4095。
  // 表项格式为 `[偏移量: 3 字节] [扇区数: 1 字节]`。
  // 偏移量以 4 KB 为单位记录扇区起始位置。
  const locIdx = 4 * (rx + rz * 32)

  // 安全检查
  if (locIdx + 4 > regionBuffer.byteLength) {
    return undefined
  }

  // 读取 3 字节 offset，使用大端序。
  const offset =
    (view.getUint8(locIdx) << 16) | (view.getUint8(locIdx + 1) << 8) | view.getUint8(locIdx + 2)

  const sectorCount = view.getUint8(locIdx + 3)

  // 偏移量为 0 或扇区数为 0 表示该 chunk 尚未生成。
  if (offset === 0 || sectorCount === 0) {
    return undefined
  }

  // 3. 定位到 sector 起始字节位置。
  const sectorByteOffset = offset * 4096

  // 4. 读取 chunk 头部，前 4 字节是实际数据长度，使用大端序。
  if (sectorByteOffset + 4 > regionBuffer.byteLength) {
    return undefined
  }
  const length = view.getUint32(sectorByteOffset, false) // 大端序

  // 长度字段覆盖 `压缩类型(1 字节) + 压缩数据`。
  // 这里跳过前 4 字节长度字段，直接返回后续压缩数据。

  // 校验数据完整性：`length + 4` 不能越过 Region 文件末尾。
  if (sectorByteOffset + 4 + length > regionBuffer.byteLength) {
    console.warn(`[RegionParser] Corrupt Chunk ${chunkX},${chunkZ}: length overflow`)
    return undefined
  }

  // 数据起始位置，跳过 4 字节长度字段。
  const dataStart = sectorByteOffset + 4

  // 压缩类型位于 dataStart 处，常见值为 1=GZip、2=ZLib。
  // const compressionType = view.getUint8(dataStart);

  // 创建切片副本，便于后续通过 `postMessage(transfer)` 转移所有权。
  return new Uint8Array(regionBuffer.slice(dataStart, dataStart + length))
}
