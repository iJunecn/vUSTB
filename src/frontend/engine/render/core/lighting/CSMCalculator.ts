import { mat4, vec3, degToRad } from '@/engine/render/utils/math'
import { GAME_CONFIG } from '@/engine/config'
import type { Camera } from '@/engine/render/core/scene/Camera'

/**
 * @file CSMCalculator.ts
 * @brief 级联阴影矩阵计算
 *
 * 说明：
 *  - 计算各级联阴影的光源空间矩阵
 *  - 通过稳定投影窗口减少阴影抖动
 *  - 通过 Texel Snapping 降低边缘闪烁
 */
export interface CascadeDebugMeta {
  index: number
  splitDist: number
  prevSplit: number
  radius: number
  diameter: number
  texelSize: number
  near: number
  far: number
  range: number
  zPadding: number
  center: [number, number, number]
}

/**
 * 级联阴影矩阵计算器。
 */
export class CSMCalculator {
  private lightSpaceMatrices: Float32Array[] = []
  private cascadeSplits: number[] = GAME_CONFIG.RENDER.SHADOW.CASCADE_SPLITS
  private prevSplitDist = GAME_CONFIG.RENDER.NEAR_PLANE
  private shadowMapResolution = GAME_CONFIG.RENDER.SHADOW.MAP_SIZE
  private debugMeta: CascadeDebugMeta[] = []

  public setShadowMapResolution(resolution: number) {
    this.shadowMapResolution = resolution
  }

  public getLightSpaceMatrices(): Float32Array[] {
    return this.lightSpaceMatrices
  }

  public getDebugMeta(): CascadeDebugMeta[] {
    return this.debugMeta
  }

  public getCascadeSplits(): Float32Array {
    return new Float32Array(this.cascadeSplits)
  }

  /**
   * 更新级联矩阵。
   * @param camera 当前相机。
   * @param sunDirection 太阳方向。
   * @param aspect 屏幕宽高比。
   * @param maxDistance 可选最大阴影距离。
   */
  public update(camera: Camera, sunDirection: Float32Array, aspect: number, maxDistance?: number) {
    if (maxDistance) {
      // 智能适配：基于最大距离等比缩放级联范围
      // 保持近景精度，同时覆盖远景
      this.cascadeSplits = [maxDistance * 0.125, maxDistance * 0.35, maxDistance]
    } else {
      this.cascadeSplits = GAME_CONFIG.RENDER.SHADOW.CASCADE_SPLITS
    }

    this.lightSpaceMatrices = []
    this.debugMeta = []
    // 使用相机的实际近裁剪面，兼容移动端差异配置。
    this.prevSplitDist =
      typeof camera.getNear === 'function' ? camera.getNear() : GAME_CONFIG.RENDER.NEAR_PLANE

    const sunDir = vec3.fromValues(sunDirection[0], sunDirection[1], sunDirection[2])
    vec3.normalize(sunDir, sunDir)

    // 构建光源视图矩阵。
    const lightView = mat4.create()
    // 使用相机位置作为中心，避免大坐标下的浮点精度问题。
    const center = vec3.clone(camera.position)
    const up = Math.abs(sunDir[1]) > 0.9 ? vec3.fromValues(0, 0, 1) : vec3.fromValues(0, 1, 0)

    // lookAt 需要位置点而不是方向向量。
    // sunDir 表示光照方向，因此光源位置应在反方向上偏移。
    const lightEye = vec3.create()
    const lightTarget = vec3.create()
    vec3.scaleAndAdd(lightEye, center, sunDir, -100.0) // 光源位置 = 中心沿反方向偏移
    vec3.copy(lightTarget, center) // 光源看向场景中心

    // gl-matrix 的 lookAt 会生成世界空间到光源空间的矩阵。
    mat4.lookAt(lightView, lightEye, lightTarget, up)

    for (let i = 0; i < this.cascadeSplits.length; i++) {
      const splitDist = this.cascadeSplits[i]
      const fov = degToRad(GAME_CONFIG.RENDER.FOV)
      const tanHalfFov = Math.tan(fov / 2)

      // 获取当前级联视锥切片的角点。
      const getCorners = (dist: number) => {
        const h = 2 * dist * tanHalfFov
        const w = h * aspect
        const y = h / 2
        const x = w / 2
        return [
          vec3.fromValues(-x, y, -dist),
          vec3.fromValues(x, y, -dist),
          vec3.fromValues(-x, -y, -dist),
          vec3.fromValues(x, -y, -dist),
        ]
      }

      const nearCorners = getCorners(this.prevSplitDist)
      const farCorners = getCorners(splitDist)
      const allCorners = [...nearCorners, ...farCorners]

      // 将角点转换到世界空间。
      const camWorld = camera.worldMatrix as mat4
      allCorners.forEach(v => vec3.transformMat4(v, v, camWorld))

      // 计算包围球中心。
      const sphereCenter = vec3.create()
      allCorners.forEach(v => vec3.add(sphereCenter, sphereCenter, v))
      vec3.scale(sphereCenter, sphereCenter, 1 / allCorners.length)

      let radius = 0
      allCorners.forEach(v => {
        const d = vec3.distance(v, sphereCenter)
        if (d > radius) radius = d
      })

      // 转入光源空间后，需要重新在光源空间中计算包围球半径。
      vec3.transformMat4(sphereCenter, sphereCenter, lightView)

      // 在光源空间中重新计算半径。
      radius = 0
      const tempVec = vec3.create()
      allCorners.forEach(v => {
        vec3.transformMat4(tempVec, v, lightView)
        const d = vec3.distance(tempVec, sphereCenter)
        if (d > radius) radius = d
      })

      // 基于包围球固定投影窗口大小。
      // 使用直径作为窗口大小，确保相机旋转时投影范围稳定。
      const diameter = radius * 2
      const texelSize = diameter / this.shadowMapResolution

      // 像素对齐：将中心点对齐到纹理格点，减少阴影闪烁。
      const centerX = Math.floor(sphereCenter[0] / texelSize) * texelSize
      const centerY = Math.floor(sphereCenter[1] / texelSize) * texelSize

      const minX = centerX - radius
      const maxX = centerX + radius
      const minY = centerY - radius
      const maxY = centerY + radius

      // 计算 Z 轴范围。
      let minZ = Infinity
      let maxZ = -Infinity
      allCorners.forEach(v => {
        vec3.transformMat4(tempVec, v, lightView)
        minZ = Math.min(minZ, tempVec[2])
        maxZ = Math.max(maxZ, tempVec[2])
      })

      // 增加 Z 轴填充，防止相机旋转时阴影被裁切。
      const zMult = 10.0
      const zPadding = radius * zMult + 500.0
      const near = -maxZ - zPadding
      const far = -minZ + zPadding

      const shadowProj = mat4.create()
      mat4.ortho(shadowProj, minX, maxX, minY, maxY, near, far)

      const shadowVP = mat4.create()
      mat4.multiply(shadowVP, shadowProj, lightView)
      this.lightSpaceMatrices.push(shadowVP as Float32Array)

      this.debugMeta.push({
        index: i,
        splitDist,
        prevSplit: this.prevSplitDist,
        radius,
        diameter,
        texelSize,
        near,
        far,
        range: far - near,
        zPadding,
        center: [centerX, centerY, sphereCenter[2]],
      })

      this.prevSplitDist = splitDist
    }
  }

  /**
   * 更新移动端单级阴影矩阵。
   * @param camera 当前相机。
   * @param sunDirection 太阳方向。
   * @param coverage 覆盖边长。
   * @param verticalPad 垂直填充。
   * @param nearPad 额外近端填充。
   */
  public updateMobileSingle(
    camera: Camera,
    sunDirection: Float32Array,
    coverage: number,
    verticalPad: number,
    nearPad: number,
  ) {
    const half = coverage * 0.5
    const huge = 1e9
    this.cascadeSplits = [huge, huge, huge, huge]
    this.lightSpaceMatrices = []
    this.debugMeta = []

    const sunDir = vec3.fromValues(sunDirection[0], sunDirection[1], sunDirection[2])
    vec3.normalize(sunDir, sunDir)

    const center = vec3.clone(camera.position)
    const up = Math.abs(sunDir[1]) > 0.9 ? vec3.fromValues(0, 0, 1) : vec3.fromValues(0, 1, 0)
    const lightEye = vec3.create()
    const lightTarget = vec3.clone(center)
    vec3.scaleAndAdd(lightEye, center, sunDir, -coverage) // 光源稍远一些以覆盖区域

    const lightView = mat4.create()
    mat4.lookAt(lightView, lightEye, lightTarget, up)

    const centerLS = vec3.create()
    vec3.transformMat4(centerLS, center, lightView)

    // 对齐到像素格
    const texelSize = coverage / this.shadowMapResolution
    const snapX = Math.floor(centerLS[0] / texelSize) * texelSize
    const snapY = Math.floor(centerLS[1] / texelSize) * texelSize

    const minX = snapX - half
    const maxX = snapX + half
    const minY = snapY - half
    const maxY = snapY + half

    const centerZ = centerLS[2]
    const near = -(centerZ + verticalPad + nearPad)
    const far = -(centerZ - verticalPad)

    const shadowProj = mat4.create()
    mat4.ortho(shadowProj, minX, maxX, minY, maxY, near, far)
    const shadowVP = mat4.create()
    mat4.multiply(shadowVP, shadowProj, lightView)
    this.lightSpaceMatrices.push(shadowVP as Float32Array)

    this.debugMeta.push({
      index: 0,
      splitDist: coverage,
      prevSplit: 0,
      radius: half,
      diameter: coverage,
      texelSize,
      near,
      far,
      range: far - near,
      zPadding: verticalPad,
      center: [snapX, snapY, centerZ],
    })
  }
}
