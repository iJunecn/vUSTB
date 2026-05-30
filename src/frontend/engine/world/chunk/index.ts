/**
 * @file index.ts
 * @brief 区块模块公共出口
 *
 * 说明：
 *  - 汇总 system、memory、compute、domain、io、utils 子模块
 *  - 作为世界区块系统的统一导出入口
 */

// 系统调度与状态管理
export { ChunkDirector as ChunkManager } from './system/ChunkDirector'
export * from './system/ChunkState'
export * from './system/ChunkScheduler'
export * from './system/FailureTracker'

// 内存与共享数据布局
export * from './memory/SharedVoxelStore'
export * from './memory/LightCache'
export * from './memory/Layout'

// 工作线程计算与调度
export * from './compute/pool'

// 领域类型与消息协议
export * from './domain'

// 区域文件读取与缓存
export * from './io'

// 通用工具
export * from './utils'
