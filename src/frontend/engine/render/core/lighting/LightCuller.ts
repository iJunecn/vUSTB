import { GL } from '@render/utils/gl'
import { mat4, vec3 } from '@render/utils/math'

export type ClusteredConfig = {
  dimX: number
  dimY: number
  dimZ: number
  maxLights: number
}

/**
 * @file LightCuller.ts
 * @brief 分簇光源剔除器
 *
 * 说明：
 *  - 将视锥空间划分为 X-Y-Z 三维簇
 *  - 为每个簇生成光源计数与索引纹理
 *  - 让光照阶段仅遍历当前簇内的可见光源
 */
export class LightCuller {
  private gl: WebGL2RenderingContext
  private width: number
  private height: number
  private config: ClusteredConfig

  public countsTex: WebGLTexture
  public indicesTex: WebGLTexture
  public indexTexWidth: number = 1
  public indexTexHeight: number = 1

  private countsData: Float32Array = new Float32Array(0)
  private indicesData: Float32Array = new Float32Array(0)

  constructor(gl: WebGL2RenderingContext, width: number, height: number, config: ClusteredConfig) {
    this.gl = gl
    this.width = width
    this.height = height
    this.config = { ...config }

    this.countsTex = GL.createTexture(gl, 1, 1, {
      internalFormat: gl.R32F,
      format: gl.RED,
      type: gl.FLOAT,
      minFilter: gl.NEAREST,
      magFilter: gl.NEAREST,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
    })

    this.indicesTex = GL.createTexture(gl, 1, 1, {
      internalFormat: gl.RGBA32F,
      format: gl.RGBA,
      type: gl.FLOAT,
      minFilter: gl.NEAREST,
      magFilter: gl.NEAREST,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
    })
  }

  resize(width: number, height: number) {
    this.width = width
    this.height = height
  }

  updateConfig(config: ClusteredConfig) {
    this.config = { ...config }
  }

  getDims() {
    return { x: this.config.dimX, y: this.config.dimY, z: this.config.dimZ }
  }

  getMaxLights() {
    return Math.max(1, Math.min(64, this.config.maxLights | 0))
  }

  /**
   * 构建 clustered light 纹理。
   * F(z)=log(z/near)/log(far/near)，把 view-space 深度映射到对数切片索引。
   */
  build(
    lights: Float32Array,
    lightCount: number,
    viewMatrix: Float32Array,
    projectionMatrix: Float32Array,
    cameraNear: number,
    cameraFar: number,
  ) {
    const dimX = Math.max(1, this.config.dimX | 0)
    const dimY = Math.max(1, this.config.dimY | 0)
    const dimZ = Math.max(1, this.config.dimZ | 0)
    const maxLights = Math.max(1, Math.min(64, this.config.maxLights | 0))
    const clusterCount = dimX * dimY * dimZ

    if (this.countsData.length !== clusterCount) {
      this.countsData = new Float32Array(clusterCount)
    } else {
      this.countsData.fill(0)
    }

    const totalIndices = clusterCount * maxLights
    if (this.indicesData.length !== totalIndices) {
      this.indicesData = new Float32Array(totalIndices)
    }
    this.indicesData.fill(-1)

    if (lightCount === 0) {
      this.uploadTextures(clusterCount, totalIndices)
      return
    }

    const tileW = this.width / dimX
    const tileH = this.height / dimY

    const proj = projectionMatrix
    const proj00 = proj[0]
    const proj11 = proj[5]
    const logFactor = 1.0 / Math.log(cameraFar / cameraNear)

    const viewPos = vec3.create()
    const tmp = vec3.create()

    for (let i = 0; i < lightCount; i++) {
      const base = i * 8
      const lx = lights[base]
      const ly = lights[base + 1]
      const lz = lights[base + 2]
      const radius = lights[base + 7]

      vec3.set(tmp, lx, ly, lz)
      vec3.transformMat4(viewPos, tmp, viewMatrix as unknown as mat4)

      const vz = -viewPos[2]
      if (vz <= 0.01) continue

      const rNdcX = (radius * proj00) / vz
      const rNdcY = (radius * proj11) / vz
      const rNdc = Math.max(Math.abs(rNdcX), Math.abs(rNdcY))

      const ndcX = (viewPos[0] * proj00) / vz
      const ndcY = (viewPos[1] * proj11) / vz

      const minNdcX = ndcX - rNdc
      const maxNdcX = ndcX + rNdc
      const minNdcY = ndcY - rNdc
      const maxNdcY = ndcY + rNdc

      const minPx = Math.max(0, Math.floor((minNdcX * 0.5 + 0.5) * this.width))
      const maxPx = Math.min(this.width - 1, Math.ceil((maxNdcX * 0.5 + 0.5) * this.width))
      const minPy = Math.max(0, Math.floor((minNdcY * 0.5 + 0.5) * this.height))
      const maxPy = Math.min(this.height - 1, Math.ceil((maxNdcY * 0.5 + 0.5) * this.height))

      const minTileX = Math.max(0, Math.floor(minPx / tileW))
      const maxTileX = Math.min(dimX - 1, Math.floor(maxPx / tileW))
      const minTileY = Math.max(0, Math.floor(minPy / tileH))
      const maxTileY = Math.min(dimY - 1, Math.floor(maxPy / tileH))

      const zMin = Math.max(cameraNear, vz - radius)
      const zMax = Math.min(cameraFar, vz + radius)
      const zMinNorm = Math.log(zMin / cameraNear) * logFactor
      const zMaxNorm = Math.log(zMax / cameraNear) * logFactor
      const minZ = Math.max(0, Math.floor(zMinNorm * dimZ))
      const maxZ = Math.min(dimZ - 1, Math.floor(zMaxNorm * dimZ))

      for (let z = minZ; z <= maxZ; z++) {
        for (let y = minTileY; y <= maxTileY; y++) {
          for (let x = minTileX; x <= maxTileX; x++) {
            const clusterIndex = x + y * dimX + z * dimX * dimY
            const count = this.countsData[clusterIndex]
            if (count >= maxLights) continue
            const writeIndex = clusterIndex * maxLights + count
            this.indicesData[writeIndex] = i
            this.countsData[clusterIndex] = count + 1
          }
        }
      }
    }

    this.uploadTextures(clusterCount, totalIndices)
  }

  private uploadTextures(clusterCount: number, totalIndices: number) {
    const gl = this.gl

    gl.bindTexture(gl.TEXTURE_2D, this.countsTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, clusterCount, 1, 0, gl.RED, gl.FLOAT, this.countsData)

    const totalTexels = Math.max(1, Math.ceil(totalIndices / 4))
    const width = Math.min(1024, totalTexels)
    const height = Math.max(1, Math.ceil(totalTexels / width))
    this.indexTexWidth = width
    this.indexTexHeight = height

    gl.bindTexture(gl.TEXTURE_2D, this.indicesTex)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      width,
      height,
      0,
      gl.RGBA,
      gl.FLOAT,
      this.packIndices(totalTexels),
    )
  }

  // 把线性数组重排为 RGBA32F 纹理可消费的 texel 序列。
  private packIndices(totalTexels: number) {
    const total = totalTexels * 4
    if (this.indicesData.length >= total) {
      return this.indicesData.subarray(0, total)
    }
    const padded = new Float32Array(total)
    padded.set(this.indicesData)
    return padded
  }

  dispose() {
    const gl = this.gl
    gl.deleteTexture(this.countsTex)
    gl.deleteTexture(this.indicesTex)
  }
}
