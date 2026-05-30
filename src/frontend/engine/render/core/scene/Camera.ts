import { mat4, vec3, degToRad } from '@/engine/render/utils/math'

/**
 * @file Camera.ts
 * @brief 相机状态与矩阵更新
 *
 * 说明：
 *  - 维护相机位置、朝向目标和上方向
 *  - 统一更新视图、投影及逆矩阵
 *  - 为剔除、拾取和空间重建提供基础矩阵数据
 */
export class Camera {
  public position: vec3 = vec3.create()
  public target: vec3 = vec3.create()
  public up: vec3 = vec3.fromValues(0, 1, 0)

  public viewMatrix: Float32Array = new Float32Array(16)
  public projectionMatrix: Float32Array = new Float32Array(16)
  public inverseProjectionMatrix: Float32Array = new Float32Array(16)
  public inverseViewProjMatrix: Float32Array = new Float32Array(16)
  public viewProjectionMatrix: Float32Array = new Float32Array(16)
  public worldMatrix: Float32Array = new Float32Array(16) // 视图矩阵的逆矩阵。
  public positionArray: Float32Array = new Float32Array(3)

  private fov: number
  private aspect: number
  private near: number
  private far: number
  private reverseZ: boolean

  public getNear() {
    return this.near
  }

  public getFar() {
    return this.far
  }

  public getReverseZ() {
    return this.reverseZ
  }

  public setReverseZ(reverseZ: boolean) {
    this.reverseZ = reverseZ
  }

  /**
   * 构造相机。
   * @param fov 垂直视场角。
   * @param aspect 宽高比。
   * @param near 近裁剪面。
   * @param far 远裁剪面。
   */
  constructor(fov: number, aspect: number, near: number, far: number, reverseZ: boolean = false) {
    this.fov = fov
    this.aspect = aspect
    this.near = near
    this.far = far
    this.reverseZ = reverseZ
  }

  /**
   * 更新相机矩阵。
   * @param aspect 可选的新宽高比。
   */
  update(aspect?: number) {
    if (aspect !== undefined) {
      this.aspect = aspect
    }

    // 更新投影矩阵。
    mat4.perspective(
      this.projectionMatrix as mat4,
      degToRad(this.fov),
      this.aspect,
      this.near,
      this.far,
    )
    if (this.reverseZ) {
      // Reverse-Z：翻转深度映射，使 near 对应 1、far 对应 0。
      this.projectionMatrix[10] *= -1
      this.projectionMatrix[14] *= -1
    }

    // 更新逆投影矩阵。
    mat4.invert(this.inverseProjectionMatrix as mat4, this.projectionMatrix as mat4)

    // 更新视图矩阵。
    // gl-matrix 的 lookAt 会生成世界空间到相机空间的变换。
    mat4.lookAt(this.viewMatrix as mat4, this.position, this.target, this.up)

    // 世界矩阵等于视图矩阵的逆矩阵。
    mat4.invert(this.worldMatrix as mat4, this.viewMatrix as mat4)

    // 更新视图投影矩阵。
    mat4.multiply(
      this.viewProjectionMatrix as mat4,
      this.projectionMatrix as mat4,
      this.viewMatrix as mat4,
    )

    // 更新逆视图投影矩阵。
    mat4.invert(this.inverseViewProjMatrix as mat4, this.viewProjectionMatrix as mat4)

    // 同步位置数组，便于上传 Uniform。
    this.positionArray[0] = this.position[0]
    this.positionArray[1] = this.position[1]
    this.positionArray[2] = this.position[2]
  }
}
