import { glMatrix, mat4, vec3, vec2, vec4, quat } from 'gl-matrix'

/**
 * @file math.ts
 * @brief 数学工具
 *
 * 说明:
 *  - 统一导出 gl-matrix 常用类型与工具
 *  - 提供 Clamp、Lerp、角度/弧度转换等辅助函数
 */

/**
 * 数学辅助模块。
 * 在 gl-matrix 基础上补充项目内高频使用的小工具函数。
 */

// 配置 gl-matrix 默认使用 Float32Array
glMatrix.setMatrixArrayType(Float32Array)

export { mat4, vec3, vec2, vec4, quat, glMatrix }

/**
 * 角度转弧度。
 * @param deg 角度
 * @returns 弧度
 */
export const degToRad = (deg: number): number => glMatrix.toRadian(deg)

/**
 * 弧度转角度。
 * @param rad 弧度
 * @returns 角度
 */
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI

/**
 * 将数值限制在给定区间内。
 * @param value 输入值
 * @param min 最小值
 * @param max 最大值
 * @returns 钳制后的值
 */
export const clamp = (value: number, min: number, max: number): number => {
  return Math.max(min, Math.min(max, value))
}

/**
 * 线性插值。
 * @param start 起始值
 * @param end 结束值
 * @param t 插值因子，通常在 [0, 1]
 * @returns 插值结果
 */
export const lerp = (start: number, end: number, t: number): number => {
  return start + (end - start) * t
}

/**
 * `vec3` 线性插值封装。
 */
export const lerpVec3 = (out: vec3, a: vec3, b: vec3, t: number): vec3 => {
  return vec3.lerp(out, a, b, t)
}
