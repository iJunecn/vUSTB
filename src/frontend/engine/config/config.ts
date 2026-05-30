import { DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_UNLOAD_BUFFER, DEFAULT_LOAD_DISTANCE } from './init'

export type EngineConfigDomain = 'world' | 'render' | 'chunk' | 'controls' | 'resource' | 'legacy'

export type EngineConfigTiming =
  | 'startup-latched'
  | 'runtime-live'
  | 'mixed'
  | 'runtime-owned'
  | 'legacy-unused'

export type EngineConfigEntryMeta = {
  path: string
  domain: EngineConfigDomain
  timing: EngineConfigTiming
  summary: string
}

/**
 * 配置分类与时态元数据。
 *
 * 用途：
 * - 记录每个配置子树属于哪个领域。
 * - 标记配置是在启动时锁存、运行时可变，还是已经迁出到 runtime/store。
 * - 为后续配置迁移和设置面板改造提供静态语义依据。
 */
export const GAME_CONFIG_META: readonly EngineConfigEntryMeta[] = [
  {
    path: 'WORLD',
    domain: 'world',
    timing: 'mixed',
    summary: '世界角色注册表与玩家默认行为参数的组合域；MCA 世界源已迁到 scene 级显式配置。',
  },
  {
    path: 'WORLD.CHARACTER',
    domain: 'world',
    timing: 'startup-latched',
    summary: '角色皮肤目录；作为资源注册表使用，不应在运行中直接改写。',
  },
  {
    path: 'WORLD.NPC',
    domain: 'world',
    timing: 'startup-latched',
    summary: 'NPC 默认皮肤池；本质上属于内容注册表，而不是交互期调参项。',
  },
  {
    path: 'WORLD.PLAYER',
    domain: 'world',
    timing: 'mixed',
    summary: '玩家出生点、默认视角、手部姿态和皮肤默认值；语义上属于玩法/相机默认配置。',
  },
  {
    path: 'TIME',
    domain: 'legacy',
    timing: 'legacy-unused',
    summary:
      '旧时间配置壳；当前昼夜控制已迁入 runtime DayNightCycle + sceneController，不再由 GAME_CONFIG.TIME 驱动。',
  },
  {
    path: 'RENDER',
    domain: 'render',
    timing: 'mixed',
    summary: '渲染全局参数；其中既有资源/管线启动默认值，也有运行期画质和光照默认值。',
  },
  {
    path: 'RENDER.TEXTURE_BIN',
    domain: 'render',
    timing: 'startup-latched',
    summary: '纹理包二进制读取策略；更接近资源装载阶段，而不是运行中频繁切换的画质项。',
  },
  {
    path: 'RENDER.MAX_TEXTURE_SIZE',
    domain: 'render',
    timing: 'startup-latched',
    summary: '纹理阵列容量上限；语义上更接近资源/GPU 管线初始化约束。',
  },
  {
    path: 'RENDER.TAA',
    domain: 'render',
    timing: 'runtime-live',
    summary: 'TAA 开关由 Renderer 渲染路径直接读取，理论上属于运行时可切换项。',
  },
  {
    path: 'RENDER.FOG',
    domain: 'render',
    timing: 'runtime-live',
    summary:
      '雾效起止参数在渲染调用时读取；若未来进入设置面板，应通过 runtime facade 改，不直接改 GAME_CONFIG。',
  },
  {
    path: 'RENDER.SHADOW',
    domain: 'render',
    timing: 'mixed',
    summary: '阴影有运行时读取项，也有在 renderer/CSM 初始化时锁存的项。',
  },
  {
    path: 'RENDER.LIGHTING',
    domain: 'render',
    timing: 'mixed',
    summary: '光照与后处理能力开关部分会在渲染期读取，部分会在 runtime 初始化或缓存构建时锁存。',
  },
  {
    path: 'RENDER.ARTIFACT_RUNTIME',
    domain: 'render',
    timing: 'startup-latched',
    summary: 'terrain resident/runtime 调度预算；当前 useEngine 创建时读取为局部常量。',
  },
  {
    path: 'CHUNK',
    domain: 'chunk',
    timing: 'mixed',
    summary:
      '区块尺寸、距离、SAB 规划与更新节流；SAB/Director 相关项偏启动前，少量节流项在运行中直接读取。',
  },
  {
    path: 'CHUNK.SAB_SIZE_MB',
    domain: 'chunk',
    timing: 'startup-latched',
    summary: 'SharedArrayBuffer 布局容量；必须在 worker/director 初始化前确定。',
  },
  {
    path: 'CHUNK.SAB_MAX_SLOTS',
    domain: 'chunk',
    timing: 'startup-latched',
    summary: 'SAB 槽位布局常量；compute/worker 初始化前必须固定。',
  },
  {
    path: 'CONTROLS',
    domain: 'controls',
    timing: 'runtime-live',
    summary: '移动速度、鼠标/触摸灵敏度在控制器 update / event path 中实时读取。',
  },
  {
    path: 'RESOURCE',
    domain: 'resource',
    timing: 'startup-latched',
    summary: '资源包注册表与默认 key；资源 store 初始化时读取。',
  },
] as const

export function getGameConfigMeta(path: string) {
  return GAME_CONFIG_META.find(entry => entry.path === path) ?? null
}

const LOAD_RADIUS_BLOCKS = DEFAULT_LOAD_DISTANCE * DEFAULT_CHUNK_SIZE
const FOG_START = LOAD_RADIUS_BLOCKS * 0.9
const FOG_END = LOAD_RADIUS_BLOCKS * 0.99

/**
 * 引擎运行配置默认值。
 *
 * 这里先保留当前项目仍通过 `GAME_CONFIG` 暴露的运行期配置键。
 * 这一步只做文件边界拆分，不改变现有字段和值。
 */
export const ENGINE_RUNTIME_CONFIG = {
  /**
   * 世界运行默认值。
   *
   * 这里放玩法、相机和角色表现的默认参数。
   * 它们即便当前多数仍在创建期读取，语义上也更接近 runtime config 而不是资源注册表。
   */
  WORLD: {
    PLAYER: {
      SKIN_ID: 'miku',
      DEFAULT_PERSPECTIVE: 'first-person',
      MODEL_WORLD_HEIGHT: 1.8,
      CAMERA_EYE_HEIGHT: 1.62,
      MODEL_MOUNT_OFFSET_Y: 0.0,
      THIRD_PERSON_BACK_DISTANCE: 4.0,
      THIRD_PERSON_FRONT_DISTANCE: 4.0,
      THIRD_PERSON_HEIGHT_OFFSET: 0.2,
      FIRST_PERSON_HAND_OFFSET: { x: 0.22, y: -0.87, z: 0.41 },
      FIRST_PERSON_HAND_ROTATION: { pitch: -35, yaw: 28, roll: 6 },
      FIRST_PERSON_HELD_BLOCK_OFFSET: { x: 0.36, y: -0.42, z: 0.62 },
      FIRST_PERSON_HELD_BLOCK_ROTATION: { pitch: -24, yaw: 34, roll: -10 },
      FIRST_PERSON_HELD_BLOCK_SCALE: 0.34,
      FIRST_PERSON_HAND_ANIMATION: {
        EQUIP_DURATION_SECONDS: 0.18,
        BREAK_SWING_DURATION_SECONDS: 0.22,
        PLACE_SWING_DURATION_SECONDS: 0.16,
        EQUIP_OFFSET: { y: -0.16, z: -0.06 },
        EQUIP_ROTATION: { roll: -4 },
        BREAK_SWING: {
          OFFSET: { x: 0.05, y: -0.09, z: -0.12 },
          ROTATION: { pitch: 56, yaw: -18, roll: -12 },
        },
        PLACE_SWING: {
          OFFSET: { x: 0.03, y: -0.06, z: -0.08 },
          ROTATION: { pitch: 30, yaw: -10, roll: -8 },
        },
      },
    },
  },

  // 旧时间配置壳。
  // 当前主线昼夜控制已迁移到 runtime (`DayNightCycle`) + scene controller。
  // 这里保留仅用于兼容旧语义和迁移对照，不再作为主驱动配置。
  TIME: {
    /** 旧的一天持续时间定义（毫秒）。 */
    DAY_DURATION: 600000,
    START_HOUR: 9,
    END_HOUR: 10,
  },

  /** 渲染默认值。 */
  RENDER: {
    /** 渲染距离参考值（Chunk）。 */
    RENDER_DISTANCE: DEFAULT_LOAD_DISTANCE,

    /** 透视相机视场角。 */
    FOV: 60,
    /** 桌面端默认近裁剪面。 */
    NEAR_PLANE: 0.1,
    /** 桌面端默认远裁剪面。 */
    FAR_PLANE: 2000.0,
    /** 是否启用 reverse-Z 深度策略。 */
    REVERSE_Z: true,

    /** 时间抗锯齿默认开关。 */
    TAA: {
      ENABLED: true,
    },

    /** 移动端裁剪面覆盖值。 */
    MOBILE_NEAR_PLANE: 0.5,
    MOBILE_FAR_PLANE: 2000.0,

    /** 法线贴图强度缩放。 */
    NORMAL_SCALE: 1.4,
    /** 视差遮蔽映射深度。 */
    PARALLAX_DEPTH: 0.3,

    /** 阴影默认值。 */
    SHADOW: {
      /** 是否开启阴影。 */
      ENABLED: true,
      /** 阴影贴图尺寸（像素）。 */
      MAP_SIZE: 2048,

      /** 移动端单阴影路径默认值。 */
      MOBILE_SINGLE: {
        ENABLED: true,
        MAP_SIZE: 2048,
        COVERAGE: 30,
        /** 垂直 padding（米）。 */
        VERTICAL_PAD: 6,
        /** 额外近裁剪 padding，避免包围盒过紧。 */
        NEAR_PAD: 1,
      },

      /** CSM 级联切分距离。 */
      CASCADE_SPLITS: [70, 120, 200],

      /** 阴影系统未就绪时使用的默认 light matrices。 */
      DEFAULT_LIGHT_MATRICES: [
        new Float32Array([0.05, 0, 0, 0, 0, 0.05, 0, 0, 0, 0, 0.005, 0, 0, 0, 0, 1]),
        new Float32Array([0.05, 0, 0, 0, 0, 0.05, 0, 0, 0, 0, 0.005, 0, 0, 0, 0, 1]),
        new Float32Array([0.05, 0, 0, 0, 0, 0.05, 0, 0, 0, 0, 0.005, 0, 0, 0, 0, 1]),
      ],
    },

    /** 雾效默认值。 */
    FOG: {
      START: FOG_START,
      END: FOG_END,
      COLOR: [0.5, 0.6, 0.7],
    },

    /** 光照与材质路径默认值。 */
    LIGHTING: {
      /** 默认太阳方向（归一化向量）。 */
      SUN_DIRECTION: [0.5, -1.0, 0.5],
      /** 默认太阳颜色（PBR 高强度 RGB）。 */
      SUN_COLOR: [4.0, 3.8, 3.2],

      /**
       * 是否开启 PBR 延迟渲染。
       * - false: 极速模式 (仅顶点光)
       * - true: 画质模式
       */
      ENABLE_PBR: true,

      /** 是否开启点光源。 */
      ENABLE_POINT_LIGHTS: true,
      ENABLE_CLUSTERED_LIGHTS: true,
      CLUSTER_DIM_X: 16,
      CLUSTER_DIM_Y: 9,
      CLUSTER_DIM_Z: 16,
      CLUSTER_MAX_LIGHTS: 6412,
      ENABLE_POINT_SHADOWS: false,
      POINT_SHADOW_MAX_LIGHTS: 4,
      POINT_SHADOW_MAP_SIZE: 256,
      POINT_SHADOW_BIAS: 0.002,
      MAX_POINT_LIGHTS: 128,
      MAX_POINT_LIGHT_DISTANCE: FOG_END,
      POINT_LIGHT_NEAR_KEEP: 16,
      POINT_LIGHT_FRUSTUM_DISTANCE: 256,
      ENABLE_SSAO: true,
      ENABLE_VERTEX_LIGHTING: false,
      ENABLE_SMOOTH_LIGHTING: true,
      ENABLE_VERTEX_AO: true,
    },

    /** Terrain artifact resident/runtime 调度默认值。 */
    ARTIFACT_RUNTIME: {
      UPLOAD_BUDGET_BASE_MS: 4.0,
      UPLOAD_BUDGET_MAX_MS: 7.5,
      UPLOAD_BUDGET_BACKLOG_STEP: 12,
      UPLOAD_BATCH_SIZE: 12,
      UPLOAD_MAX_BATCHES_PER_FRAME: 2,
      UPLOAD_EXEC_BYTES_BASE: 1572864,
      UPLOAD_EXEC_BYTES_MAX: 6291456,
      UPLOAD_EXEC_BYTES_BACKLOG_STEP: 4,
      UPLOAD_EXEC_MAX_REGIONS_PER_FRAME: 6,
      BATCH_TARGET_EXEC_MS: 2.0,
      REBUILD_TARGET_MS: 0.75,
      REBUILD_MIN_TARGET_MS: 0.35,
      REBUILD_MAX_PASSES_PER_FRAME: 3,
      RESIDENT_VERTEX_PAGE_BYTES: 262144,
      RESIDENT_INDEX_PAGE_BYTES: 65536,
      RESIDENT_PAGE_HEADROOM_PAGES: 1,
      RESIDENT_PAGE_SHRINK_MIN_DELTA_PAGES: 2,
      COMMIT_QUEUE_SOFT_REGION_LIMIT: 2,
      COMMIT_QUEUE_HARD_REGION_LIMIT: 5,
      COMMIT_BASE_REGIONS_PER_FRAME: 2,
      COMMIT_MAX_REGIONS_PER_FRAME: 5,
      COMMIT_BACKLOG_STEP: 2,
      RETIRE_DELAY_GENERATIONS: 2,
    },
  },

  /** 区块运行期默认值。 */
  CHUNK: {
    /** 加载距离（Chunk）。 */
    LOAD_DISTANCE: DEFAULT_LOAD_DISTANCE,

    /**
     * 卸载缓冲距离（Chunk）。
     * 区块超出 `LOAD_DISTANCE + UNLOAD_BUFFER` 后才会被卸载，避免边界抖动。
     */
    UNLOAD_BUFFER: DEFAULT_CHUNK_UNLOAD_BUFFER,

    /** 单次网格处理的最大时间片（毫秒）。 */
    MESH_PROCESS_TIME_LIMIT: 10,

    /** 区块更新检查间隔（毫秒）。 */
    UPDATE_INTERVAL: 200,
  },

  /** 输入控制默认值。 */
  CONTROLS: {
    /** 玩家移动速度。 */
    MOVE_SPEED: 40,
    /** 鼠标视角灵敏度。 */
    MOUSE_SENSITIVITY: 0.1,
    /** 触摸视角灵敏度。 */
    TOUCH_SENSITIVITY: 0.5,
    /** 触摸摇杆最大半径。 */
    TOUCH_JOYSTICK_RADIUS: 50,
  },
}
