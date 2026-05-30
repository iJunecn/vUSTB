/**
 * 引擎初始化默认值。
 *
 * 这里放启动前需要确定的静态资源注册、容量规划和默认拓扑常量。
 * 这类值更适合作为 init 配置，而不是运行中频繁调节的 config。
 */

import { getEnvConfig } from '@/config/env'
import { getResourcePackCatalog } from '@/resource/catalog'
import { isLikelyMobileDevice } from '@/utils/platformCapabilities'

export interface ResourceDefinition {
  /** 资源包唯一标识。 */
  key: string
  /** 面向 UI 的显示名称。 */
  label: string
  /** 资源包补充说明。 */
  description?: string
  /** public/packs 下的产物目录名。 */
  DIRECTORY: string
  /** 资源包原生主纹理尺寸上限。 */
  MAX_TEXTURE_SIZE: number
  /** 是否启用 LabPBR 管线。 */
  LABPBR: boolean
  /** 原始资源包叠加顺序。数组顺序即构建读取顺序。 */
  SOURCE_PACKS: readonly string[]
}

export const DEFAULT_CHUNK_SIZE = 16
export const DEFAULT_LOAD_DISTANCE = 16
export const DEFAULT_CHUNK_UNLOAD_BUFFER = 4

const ENGINE_PERSISTENCE_STORAGE_KEY = 'world-engine-persistence'
const SAB_TRANSIENT_RING_BUFFER = 2
const MOBILE_DEFAULT_LOAD_DISTANCE = 8

function buildResourcePresets(): {
  defaultKey: string
  resources: ResourceDefinition[]
} {
  const catalog = getResourcePackCatalog()
  return {
    defaultKey: catalog.defaultKey,
    resources: catalog.packs.map(entry => ({
      key: entry.key,
      label: entry.label,
      description: entry.description || undefined,
      DIRECTORY: entry.directory,
      MAX_TEXTURE_SIZE: entry.maxTextureSize,
      LABPBR: entry.labPbr,
      SOURCE_PACKS: [...entry.sourcePacks],
    })),
  }
}

let _resourceCache: ReturnType<typeof buildResourcePresets> | null = null
function getResourcePresets() {
  if (!_resourceCache) {
    _resourceCache = buildResourcePresets()
  }
  return _resourceCache
}

function resolveBootLoadDistance() {
  const fallbackLoadDistance = isLikelyMobileDevice()
    ? MOBILE_DEFAULT_LOAD_DISTANCE
    : DEFAULT_LOAD_DISTANCE

  if (typeof window === 'undefined') {
    return fallbackLoadDistance
  }

  try {
    const raw = window.localStorage.getItem(ENGINE_PERSISTENCE_STORAGE_KEY)
    if (!raw) {
      return fallbackLoadDistance
    }

    const parsed = JSON.parse(raw)
    if (typeof parsed?.runtimeConfig?.chunk?.loadDistance !== 'number') {
      return fallbackLoadDistance
    }

    return Math.max(2, Math.round(parsed.runtimeConfig.chunk.loadDistance))
  } catch (error) {
    console.warn('Failed to parse persisted runtime config, using defaults.', error)
    return fallbackLoadDistance
  }
}

const bootLoadDistance = resolveBootLoadDistance()
const plannedResidentDistance =
  bootLoadDistance + DEFAULT_CHUNK_UNLOAD_BUFFER + SAB_TRANSIENT_RING_BUFFER
const LOAD_AREA_CHUNKS = Math.pow(2 * plannedResidentDistance + 1, 2)
const SAB_BUFFER_FACTOR = 1.8
const SAB_MAX_SLOTS = Math.ceil(LOAD_AREA_CHUNKS * SAB_BUFFER_FACTOR)
const CHUNK_AVG_SIZE_MB = 0.04
const RAW_SAB_SIZE = LOAD_AREA_CHUNKS * SAB_BUFFER_FACTOR * CHUNK_AVG_SIZE_MB
const SAB_SIZE_MB = Math.min(Math.ceil(RAW_SAB_SIZE), 2045)

/**
 * 启动阶段默认值。
 *
 * 内容包括：
 * - 世界资源路径与静态注册表
 * - 资源/渲染管线启动默认值
 * - 区块容量规划
 */
export const ENGINE_INIT_CONFIG = {
  WORLD: {
    /** 可用角色皮肤目录。 */
    CHARACTER: {
      get SKINS() {
        return [{ id: 'miku', url: `${getEnvConfig().skinBaseUrl}/miku.png` }]
      },
    },

    /** NPC 默认可选皮肤池。 */
    NPC: {
      SKIN_IDS: ['miku'],
    },
  },

  CHUNK: {
    /** 单个区块边长（Block）。 */
    SIZE: DEFAULT_CHUNK_SIZE,
    /** SharedArrayBuffer 容量（MB）。 */
    SAB_SIZE_MB,
    /** SAB 最大 slot 数量。 */
    SAB_MAX_SLOTS,
  },

  /**
   * 渲染管线启动默认值。
   * 这里保留更接近资源装载与 GPU 管线建制的默认项。
   */
  RENDER: {
    /**
     * 纹理二进制格式策略。
     * - auto: 优先使用 deflate，不存在则回退到 raw
     * - deflate: 强制尝试压缩格式
     * - raw: 仅使用未压缩格式
     */
    TEXTURE_BIN: 'deflate',

    /** GPU 纹理数组允许的最大尺寸。 */
    MAX_TEXTURE_SIZE: 128,
  },

  /** 资源包注册表与默认资源键。延迟求值，需先完成 loadResourcePackCatalog()。 */
  get RESOURCE() {
    const { defaultKey, resources } = getResourcePresets()
    return {
      DEFAULT_KEY: defaultKey,
      RESOURCES: resources,
    }
  },
}
