export interface Region {
  key: string // 区域键，格式为 "rx,rz"
  lastUsedAt: number // 最近一次访问时间戳
  sizeBytes?: number // 当前缓存占用字节数
}
