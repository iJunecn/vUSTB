export const CHUNK_WIDTH = 16
export const CHUNK_HEIGHT = 384 // 1.18+ 高度范围为 -64 到 320
export const SECTIONS_PER_CHUNK = CHUNK_HEIGHT / 16 // 纵向共 24 个 section
export const BLOCKS_PER_SECTION = CHUNK_WIDTH * CHUNK_WIDTH * 16 // 每个 section 含 4096 个方块

// 基于块的分配常量
export const BLOCK_SIZE = 4096 // 4 KB 对齐
// 新区块默认分配大小。
// F(x)=2 KiB(调色板) + 20 KiB(数据) + 12 KiB(光照) + 576 B(索引) ≈ 34 KiB
// 向上取整后约为 36 KiB，即 9 个块；保守起步取 16 个块。
export const DEFAULT_BLOCKS_PER_CHUNK = 16

// 调色板 + 位打包存储布局（需与 sab_layout.rs 保持一致）
export const MAX_PALETTE_ENTRIES = BLOCKS_PER_SECTION
export const PALETTE_ENTRY_BYTES = 2 // 全局注册表 ID 使用 u16 存储
export const MAX_PALETTE_BYTES = MAX_PALETTE_ENTRIES * PALETTE_ENTRY_BYTES // 8 KiB

export const MAX_DATA_ENTRIES = Math.ceil(BLOCKS_PER_SECTION / 4) // 最坏情况需要 ≥16 bit
export const DATA_ENTRY_BYTES = 8
export const MAX_DATA_BYTES = MAX_DATA_ENTRIES * DATA_ENTRY_BYTES // 8 KiB

export const LIGHT_BYTES_PER_SECTION = BLOCKS_PER_SECTION / 2 // 4 bit 打包光照

export const SECTION_ENTRY_BYTES = 24
export const SECTION_INDEX_BYTES = SECTIONS_PER_CHUNK * SECTION_ENTRY_BYTES
export const BIOME_MAP_BYTES = CHUNK_WIDTH * CHUNK_WIDTH * 2
export const HEIGHTMAP_BYTES = CHUNK_WIDTH * CHUNK_WIDTH * 2

// 槽头元数据布局（Int32，方便 Atomics 操作）
// [0] ownerX, [1] ownerZ, [2] version, [3] readyFlag
// [4] blockIndex（SAB Data 区域的起始块索引）
// [5] blockCount (分配的块数量)
// [6] padding
// [7] padding
export const MASK_CENTER = 1
export const MASK_NORTH = 2
export const MASK_SOUTH = 4
export const MASK_EAST = 8
export const MASK_WEST = 16
export const MASK_FULL = 31

export const SLOT_HEADER_INT32S = 8
export const SLOT_HEADER_BYTES = SLOT_HEADER_INT32S * 4

import { GAME_CONFIG } from '@/engine/config'

// 允许的最大区块槽位数，由配置动态决定。
export const MAX_SLOTS = GAME_CONFIG.CHUNK.SAB_MAX_SLOTS

// --- 全局方块 ID 注册表 ---
// SAB 起始偏移 0 预留给全局注册表，布局如下：
// [0..1MB]: 哈希映射 (Hash -> ID)
//  - 槽数量：65536
//  - 条目格式：[U32: Hash_Low, U32: Hash_High, U32: ID, U32: Padding]（16 字节）
//  - 策略：开放寻址 + 线性探测
// [>=1MB]: 区块槽位起始位置

// 常量定义
export const REGISTRY_ENTRIES = 65536
export const REGISTRY_ENTRY_BYTES = 16
export const REGISTRY_HASH_BYTES = REGISTRY_ENTRIES * REGISTRY_ENTRY_BYTES // 1 MB
export const REGISTRY_META_BYTES = 64
export const REGISTRY_REVERSE_ENTRY_BYTES = 8
export const REGISTRY_REVERSE_BYTES = REGISTRY_ENTRIES * REGISTRY_REVERSE_ENTRY_BYTES
export const REGISTRY_STRING_POOL_BYTES = 4 * 1024 * 1024
export const REGISTRY_SIZE_BYTES =
  REGISTRY_HASH_BYTES + REGISTRY_META_BYTES + REGISTRY_REVERSE_BYTES + REGISTRY_STRING_POOL_BYTES
export const REGISTRY_ID_COUNTER_OFFSET = REGISTRY_HASH_BYTES
export const REGISTRY_STRING_COUNTER_OFFSET = REGISTRY_HASH_BYTES + 4
export const REGISTRY_REVERSE_OFFSET = REGISTRY_HASH_BYTES + REGISTRY_META_BYTES
export const REGISTRY_STRING_POOL_OFFSET = REGISTRY_REVERSE_OFFSET + REGISTRY_REVERSE_BYTES

// 头部区起点 = 注册表区 + 对齐填充
export const HEADER_AREA_START = REGISTRY_SIZE_BYTES + 64
// 数据堆起点 = 头部区末尾 + 对齐填充
export const DATA_HEAP_START = HEADER_AREA_START + MAX_SLOTS * SLOT_HEADER_BYTES + 64
