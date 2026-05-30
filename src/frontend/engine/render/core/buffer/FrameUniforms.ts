import { UniformBuffer } from './UniformBuffer'

export const FRAME_UNIFORM_BLOCK_NAME = 'FrameUniforms'
export const FRAME_UNIFORM_BINDING_POINT = 2

// std140 偏移表，单位为字节。
export const FRAME_UNIFORM_OFFSETS = {
  fogColor: 0,
  fogParams: 16,
  renderParams0: 32,
  renderParams1: 48,
  renderFlags: 64,
  renderParams2: 80,
  size: 96,
} as const

/**
 * 帧级 uniform 值集合。
 * 这些字段最终会被打包成 6 个 vec4，与 GLSL include 中的读取函数一一对应。
 */
export interface FrameUniformValues {
  fogStart: number
  fogEnd: number
  fogColor: Float32Array
  cameraNear: number
  cameraFar: number
  inverseWidth: number
  inverseHeight: number
  useReverseZ: boolean
  useLinearDepth: boolean
  depthFilterMode: number
  shadowBiasScale: number
  usePBR: boolean
  useShadows: boolean
  usePointLights: boolean
  useVertexLighting: boolean
  pointShadowBias: number
  useWboit: boolean
  cloudCover: number
}

export class FrameUniforms {
  private readonly buffer: UniformBuffer

  constructor(gl: WebGL2RenderingContext) {
    this.buffer = new UniformBuffer(gl, FRAME_UNIFORM_OFFSETS.size, FRAME_UNIFORM_BINDING_POINT)
  }

  /**
   * 按固定 vec4 槽位更新整块帧级参数。
   * 这里不做增量字段判断，保证 CPU 与 shader 侧布局始终同步。
   */
  public update(values: FrameUniformValues) {
    this.buffer.writeVec4(FRAME_UNIFORM_OFFSETS.fogColor, [
      values.fogColor[0],
      values.fogColor[1],
      values.fogColor[2],
      values.fogColor[3] ?? 0,
    ])
    this.buffer.writeVec4(FRAME_UNIFORM_OFFSETS.fogParams, [values.fogStart, values.fogEnd, 0, 0])
    this.buffer.writeVec4(FRAME_UNIFORM_OFFSETS.renderParams0, [
      values.cameraNear,
      values.cameraFar,
      values.inverseWidth,
      values.inverseHeight,
    ])
    this.buffer.writeVec4(FRAME_UNIFORM_OFFSETS.renderParams1, [
      values.useReverseZ ? 1 : 0,
      values.useLinearDepth ? 1 : 0,
      values.depthFilterMode,
      values.shadowBiasScale,
    ])
    this.buffer.writeVec4(FRAME_UNIFORM_OFFSETS.renderFlags, [
      values.usePBR ? 1 : 0,
      values.useShadows ? 1 : 0,
      values.usePointLights ? 1 : 0,
      values.useVertexLighting ? 1 : 0,
    ])
    this.buffer.writeVec4(FRAME_UNIFORM_OFFSETS.renderParams2, [
      values.pointShadowBias,
      values.useWboit ? 1 : 0,
      values.cloudCover,
      0,
    ])
    this.buffer.flush()
  }

  public bindToProgram(program: WebGLProgram) {
    this.buffer.bindToProgram(program, FRAME_UNIFORM_BLOCK_NAME)
  }

  public dispose() {
    this.buffer.dispose()
  }
}
