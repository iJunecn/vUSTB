/**
 * 兼容入口。
 *
 * 当前仍保留 `GAME_CONFIG` 这个组合对象，以避免现有引擎调用点一次性迁移。
 * 文件边界已经拆分为：
 * - `init.ts`: 启动阶段默认值和容量规划
 * - `config.ts`: 运行配置默认值与配置元数据
 */

import { ENGINE_RUNTIME_CONFIG } from './config'
import { ENGINE_INIT_CONFIG } from './init'

export type { ResourceDefinition } from './init'
export { DEFAULT_CHUNK_SIZE, DEFAULT_LOAD_DISTANCE, ENGINE_INIT_CONFIG } from './init'
export {
  GAME_CONFIG_META,
  ENGINE_RUNTIME_CONFIG,
  getGameConfigMeta,
  type EngineConfigDomain,
  type EngineConfigEntryMeta,
  type EngineConfigTiming,
} from './config'

export const GAME_CONFIG = {
  WORLD: {
    ...ENGINE_INIT_CONFIG.WORLD,
    ...ENGINE_RUNTIME_CONFIG.WORLD,
  },
  TIME: ENGINE_RUNTIME_CONFIG.TIME,
  RENDER: {
    ...ENGINE_INIT_CONFIG.RENDER,
    ...ENGINE_RUNTIME_CONFIG.RENDER,
  },
  CHUNK: {
    ...ENGINE_INIT_CONFIG.CHUNK,
    ...ENGINE_RUNTIME_CONFIG.CHUNK,
  },
  CONTROLS: ENGINE_RUNTIME_CONFIG.CONTROLS,
  get RESOURCE() {
    return ENGINE_INIT_CONFIG.RESOURCE
  },
}
