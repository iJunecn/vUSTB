import { GL } from '@render/utils/gl'
import { Frustum } from '@render/core/scene/Frustum'

/**
 * @file LightManager.ts
 * @brief 场景光源管理器
 *
 * 说明：
 *  - 维护 CPU 侧点光源数据与可见性筛选结果
 *  - 通过数据纹理将光源信息上传到 GPU
 *  - 控制活跃光源数量，避免着色阶段负担失控
 */
export class LightManager {
  private gl: WebGL2RenderingContext

  // GPU 侧点光源数据纹理，内部使用 RGBA32F 存储。
  public lightBuffer: WebGLTexture | null = null

  // CPU 侧暂存缓冲，用于组织上传到纹理的数据布局。
  private lightData: Float32Array = new Float32Array(0)

  private frustum = new Frustum()

  public numLights = 0

  private selectedLights: Float32Array = new Float32Array(0)

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.initTextures()
  }

  /**
   * 初始化光源数据纹理。
   */
  private initTextures() {
    const gl = this.gl

    // 每个光源占用 2 个 texel：
    // texel 0 = [x, y, z, radius]
    // texel 1 = [r, g, b, intensity]
    this.lightBuffer = GL.createTexture(gl, 1, 1, {
      internalFormat: gl.RGBA32F,
      format: gl.RGBA,
      type: gl.FLOAT,
      minFilter: gl.NEAREST,
      magFilter: gl.NEAREST,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
    })
  }

  /**
   * 将点光源数据上传到目标纹理。
   * @param gl WebGL2 上下文。
   * @param tex 目标纹理。
   * @param lights 光源数组，布局为 `[x, y, z, r, g, b, intensity, radius]`。
   */
  private uploadLightBuffer(
    gl: WebGL2RenderingContext,
    tex: WebGLTexture | null,
    lights: number[],
  ) {
    if (!tex) return

    const count = lights.length / 8
    const dataSize = count * 2 * 4
    if (this.lightData.length < dataSize) {
      this.lightData = new Float32Array(dataSize)
    }

    for (let i = 0; i < count; i++) {
      const base = i * 8
      const row0Index = i * 4
      const row1Index = count * 4 + i * 4

      this.lightData[row0Index + 0] = lights[base]
      this.lightData[row0Index + 1] = lights[base + 1]
      this.lightData[row0Index + 2] = lights[base + 2]
      this.lightData[row0Index + 3] = lights[base + 7]

      this.lightData[row1Index + 0] = lights[base + 3]
      this.lightData[row1Index + 1] = lights[base + 4]
      this.lightData[row1Index + 2] = lights[base + 5]
      this.lightData[row1Index + 3] = lights[base + 6]
    }

    gl.bindTexture(gl.TEXTURE_2D, tex)
    const width = Math.max(count, 1)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      width,
      2,
      0,
      gl.RGBA,
      gl.FLOAT,
      count > 0 ? this.lightData.subarray(0, dataSize) : null,
    )
  }

  /**
   * 释放 GPU 资源。
   */
  dispose() {
    const gl = this.gl
    if (this.lightBuffer) gl.deleteTexture(this.lightBuffer)
  }

  /**
   * 根据裁剪与距离约束更新当前帧点光源数据。
   * @param lights 原始光源数组，布局为 `[x, y, z, r, g, b, intensity, radius]`
   */
  update(
    lights: Float32Array,
    cameraPos?: Float32Array,
    maxLights: number = 0,
    nearKeepDistance?: number,
    frustumDistance?: number,
    viewProjection?: Float32Array,
    reverseZ: boolean = false,
  ) {
    const gl = this.gl
    const totalLights = lights.length / 8

    let selected = lights
    if (totalLights > 0) {
      const nearKeepSq =
        nearKeepDistance !== undefined && nearKeepDistance > 0
          ? nearKeepDistance * nearKeepDistance
          : 0
      const frustumDistSq =
        frustumDistance !== undefined && frustumDistance > 0
          ? frustumDistance * frustumDistance
          : Number.POSITIVE_INFINITY
      const hasFrustum = !!viewProjection && frustumDistSq !== Number.POSITIVE_INFINITY

      if (cameraPos && (maxLights > 0 || nearKeepSq > 0 || hasFrustum)) {
        const cx = cameraPos[0]
        const cy = cameraPos[1]
        const cz = cameraPos[2]

        if (hasFrustum && viewProjection) {
          this.frustum.setFromProjectionMatrix(viewProjection, reverseZ)
        }

        const candidates: { index: number; score: number }[] = []
        for (let i = 0; i < totalLights; i++) {
          const base = i * 8
          const dx = lights[base] - cx
          const dy = lights[base + 1] - cy
          const dz = lights[base + 2] - cz
          const dist2 = dx * dx + dy * dy + dz * dz
          const intensity = lights[base + 6]
          const radius = lights[base + 7]
          const score = (intensity * radius) / (dist2 + 1.0)

          let keep = false
          if (nearKeepSq > 0 && dist2 <= nearKeepSq) {
            keep = true
          } else if (hasFrustum && dist2 <= frustumDistSq) {
            const p = { x: lights[base], y: lights[base + 1], z: lights[base + 2] }
            if (this.frustum.containsPoint(p)) keep = true
          }

          if (keep) candidates.push({ index: i, score })
        }

        if (candidates.length > 0) {
          candidates.sort((a, b) => b.score - a.score)
          const target = maxLights > 0 ? Math.min(maxLights, candidates.length) : candidates.length
          const trimmed = new Float32Array(target * 8)
          for (let i = 0; i < target; i++) {
            const srcBase = candidates[i].index * 8
            const dstBase = i * 8
            for (let k = 0; k < 8; k++) {
              trimmed[dstBase + k] = lights[srcBase + k]
            }
          }
          selected = trimmed
        } else if (maxLights > 0 || nearKeepSq > 0 || hasFrustum) {
          selected = new Float32Array(0)
        }
      }
    }

    const numLights = selected.length / 8
    this.numLights = numLights
    this.selectedLights = selected

    // 没有可用光源时上传空纹理内容，保持 Shader 采样路径稳定。
    if (numLights === 0) {
      this.uploadLightBuffer(gl, this.lightBuffer, [])
      return
    }

    const allLights: number[] = Array.from(selected)
    this.uploadLightBuffer(gl, this.lightBuffer, allLights)
  }

  getSelectedLights() {
    return this.selectedLights
  }
}
