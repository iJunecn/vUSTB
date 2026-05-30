import { vec3, clamp, lerp } from '@/engine/render/utils/math'

export type DayNightCycleMode = 'realtime-beijing' | 'fixed-midnight' | 'fixed-time'

const BEIJING_UTC_OFFSET_HOURS = 8
const HOURS_PER_DAY = 24
const MINUTES_PER_HOUR = 60
const SECONDS_PER_MINUTE = 60
const MILLISECONDS_PER_SECOND = 1000
const MIDNIGHT_TIME_PROGRESS = 0.75

/**
 * @file DayNightCycle.ts
 * @brief 昼夜循环与环境光照控制
 *
 * 说明：
 *  - 根据时间进度驱动太阳方向、雾色和环境光
 *  - 支持实时北京时间、固定时刻和固定午夜三种模式
 *  - 为渲染层提供稳定的昼夜参数输出
 */
export class DayNightCycle {
  private mode: DayNightCycleMode = 'realtime-beijing'
  private fixedTimeHours = 20
  private realtimeOffsetHours = 0

  /** 太阳方向。 */
  public sunDirection = new Float32Array([0.5, -1.0, 0.5])
  /** 太阳颜色。 */
  public sunColor = new Float32Array([4.0, 3.8, 3.2])
  /** 雾颜色。 */
  public fogColor = new Float32Array([0.5, 0.6, 0.7])
  /** 环境天空光颜色。 */
  public ambientSkyColor = new Float32Array([0.2, 0.3, 0.5])
  /** 环境地面光颜色。 */
  public ambientGroundColor = new Float32Array([0.08, 0.07, 0.06])
  /** 环境光强度。 */
  public ambientIntensity = 0.6
  /** 基于图像的光照强度。 */
  public iblIntensity = 0.3
  /** 时间进度，`0.0/0.25/0.5/0.75` 分别对应日出、正午、日落与午夜。 */
  public timeProgress = MIDNIGHT_TIME_PROGRESS
  /** 当前钟表时间，单位为小时，范围为 `[0, 24)`。 */
  public clockTimeHours = 0

  constructor() {
    this.syncTimeState()
    this.updateLightingFromTimeProgress()
  }

  setMode(mode: DayNightCycleMode) {
    if (this.mode === mode) {
      return
    }

    this.mode = mode
    this.syncTimeState()
    this.updateLightingFromTimeProgress()
  }

  setFixedTimeHours(hours: number) {
    const normalized = ((hours % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY
    if (this.fixedTimeHours === normalized) {
      return
    }

    this.fixedTimeHours = normalized

    if (this.mode === 'fixed-time') {
      this.syncTimeState()
      this.updateLightingFromTimeProgress()
    }
  }

  setRealtimeOffsetHours(hours: number) {
    if (this.realtimeOffsetHours === hours) {
      return
    }

    this.realtimeOffsetHours = hours

    if (this.mode === 'realtime-beijing') {
      this.syncTimeState()
      this.updateLightingFromTimeProgress()
    }
  }

  getMode() {
    return this.mode
  }

  /**
   * 按当前模式同步时间并刷新光照参数。
   * @param deltaTime 时间增量（毫秒）
   */
  update(deltaTime: number) {
    void deltaTime

    this.syncTimeState()
    this.updateLightingFromTimeProgress()
  }

  private syncTimeState() {
    if (this.mode === 'fixed-midnight') {
      this.clockTimeHours = 0
      this.timeProgress = MIDNIGHT_TIME_PROGRESS
      return
    }

    if (this.mode === 'fixed-time') {
      this.clockTimeHours = this.fixedTimeHours
      this.timeProgress = (this.clockTimeHours / HOURS_PER_DAY + MIDNIGHT_TIME_PROGRESS) % 1
      return
    }

    const beijingNow = new Date(
      Date.now() +
        BEIJING_UTC_OFFSET_HOURS * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND,
    )
    const totalSeconds =
      beijingNow.getUTCHours() * MINUTES_PER_HOUR * SECONDS_PER_MINUTE +
      beijingNow.getUTCMinutes() * SECONDS_PER_MINUTE +
      beijingNow.getUTCSeconds() +
      beijingNow.getUTCMilliseconds() / MILLISECONDS_PER_SECOND

    this.clockTimeHours =
      (totalSeconds / (MINUTES_PER_HOUR * SECONDS_PER_MINUTE) +
        this.realtimeOffsetHours +
        HOURS_PER_DAY) %
      HOURS_PER_DAY
    this.timeProgress = (this.clockTimeHours / HOURS_PER_DAY + MIDNIGHT_TIME_PROGRESS) % 1
  }

  private updateLightingFromTimeProgress() {
    // 计算太阳方向。
    // 0.0 (Sunrise) -> -PI/2
    // 0.25 (Noon) -> 0
    // 0.5 (Sunset) -> PI/2
    // 0.75 (Midnight) -> PI
    const sunAngle = (this.timeProgress - 0.25) * Math.PI * 2

    const sunX = Math.sin(sunAngle)
    const sunY = -Math.cos(sunAngle)
    const sunZ = -0.2

    const sunDirVec = vec3.fromValues(sunX, sunY, sunZ)
    vec3.normalize(sunDirVec, sunDirVec)
    this.setVec3(this.sunDirection, [sunDirVec[0], sunDirVec[1], sunDirVec[2]])

    // 计算太阳颜色与雾颜色。
    let sunColorArr: [number, number, number]
    let fogColorArr: [number, number, number]

    if (this.timeProgress < 0.1) {
      // 日出。
      const t = this.timeProgress / 0.1
      sunColorArr = this.lerpColor([0.1, 0.1, 0.2], [1.0, 0.6, 0.3], t) as [number, number, number]
      fogColorArr = this.lerpColor([0.05, 0.05, 0.1], [0.6, 0.4, 0.3], t) as [
        number,
        number,
        number,
      ]
    } else if (this.timeProgress < 0.2) {
      // 清晨。
      const t = (this.timeProgress - 0.1) / 0.1
      sunColorArr = this.lerpColor([1.0, 0.6, 0.3], [1.0, 0.9, 0.8], t) as [number, number, number]
      fogColorArr = this.lerpColor([0.6, 0.4, 0.3], [0.5, 0.6, 0.7], t) as [number, number, number]
    } else if (this.timeProgress < 0.4) {
      // 白天。
      sunColorArr = [1.0, 1.0, 1.0]
      fogColorArr = [0.5, 0.6, 0.7]
    } else if (this.timeProgress < 0.5) {
      // 下午到日落。
      const t = (this.timeProgress - 0.4) / 0.1
      sunColorArr = this.lerpColor([1.0, 1.0, 1.0], [1.0, 0.5, 0.2], t) as [number, number, number]
      fogColorArr = this.lerpColor([0.5, 0.6, 0.7], [0.6, 0.4, 0.3], t) as [number, number, number]
    } else if (this.timeProgress < 0.6) {
      // 日落到黄昏。
      const t = (this.timeProgress - 0.5) / 0.1
      sunColorArr = this.lerpColor([1.0, 0.5, 0.2], [0.2, 0.2, 0.3], t) as [number, number, number]
      fogColorArr = this.lerpColor([0.6, 0.4, 0.3], [0.1, 0.1, 0.2], t) as [number, number, number]
    } else {
      // 夜晚。
      sunColorArr = [0.1, 0.1, 0.2]
      fogColorArr = [0.05, 0.05, 0.1]
    }

    // 提升太阳直射光强度。
    this.setVec3(this.sunColor, [sunColorArr[0] * 4, sunColorArr[1] * 4, sunColorArr[2] * 4])
    this.setVec3(this.fogColor, fogColorArr)

    // 计算环境色，供 Ambient 与 IBL 使用。
    const sunHeight = clamp((-sunDirVec[1] + 0.1) / 1.1, 0, 1)
    const twilightFactor = clamp(1 - Math.abs(sunDirVec[1]) * 1.6, 0, 1)

    const daySky = [0.45, 0.62, 0.88]
    const nightSky = [0.06, 0.08, 0.12]
    const dayGround = [0.26, 0.22, 0.18]
    const nightGround = [0.05, 0.05, 0.06]

    const baseSky = this.lerpColor(nightSky, daySky, sunHeight)
    const baseGround = this.lerpColor(nightGround, dayGround, sunHeight)

    const tintedSky = this.lerpColor(baseSky, sunColorArr, twilightFactor * 0.35)
    const tintedGround = this.lerpColor(baseGround, fogColorArr, twilightFactor * 0.25)

    this.setVec3(this.ambientSkyColor, tintedSky)
    this.setVec3(this.ambientGroundColor, tintedGround)

    this.ambientIntensity = lerp(0.15, 1.0, sunHeight) + twilightFactor * 0.1
    this.iblIntensity = lerp(0.08, 0.85, sunHeight)
  }

  /**
   * 对颜色做线性插值。
   * @param c1 起始颜色 `[r, g, b]`
   * @param c2 结束颜色 `[r, g, b]`
   * @param t 插值因子，范围为 `[0, 1]`
   * @returns 插值后的颜色数组 `[r, g, b]`
   */
  private lerpColor(c1: number[], c2: number[], t: number) {
    return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]
  }

  /**
   * 将 3 分量数值写入目标 `Float32Array`。
   * @param target 目标数组
   * @param values 源数组
   */
  private setVec3(target: Float32Array, values: number[]) {
    target[0] = values[0]
    target[1] = values[1]
    target[2] = values[2]
  }
}
