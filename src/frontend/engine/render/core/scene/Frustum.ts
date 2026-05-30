/**
 * @file Frustum.ts
 * @brief 视锥体剔除工具
 *
 * 说明：
 *  - 从视图投影矩阵中提取 6 个裁剪平面
 *  - 提供 AABB 与球体的可见性判断能力
 *  - 用于 CPU 侧的基础可见性剔除
 */
export class Frustum {
  private planes: Float32Array[] = [] // 视锥体的 6 个平面
  constructor() {
    for (let i = 0; i < 6; i++) {
      this.planes.push(new Float32Array(4))
    }
  }

  /**
   * 从投影矩阵提取视锥体平面
   * @param m 视图投影矩阵 (View-Projection Matrix)
   */
  setFromProjectionMatrix(m: Float32Array, reverseZ: boolean = false) {
    const planes = this.planes
    const me = m

    // 左平面
    planes[0][0] = me[3] + me[0]
    planes[0][1] = me[7] + me[4]
    planes[0][2] = me[11] + me[8]
    planes[0][3] = me[15] + me[12]

    // 右平面
    planes[1][0] = me[3] - me[0]
    planes[1][1] = me[7] - me[4]
    planes[1][2] = me[11] - me[8]
    planes[1][3] = me[15] - me[12]

    // 下平面
    planes[2][0] = me[3] + me[1]
    planes[2][1] = me[7] + me[5]
    planes[2][2] = me[11] + me[9]
    planes[2][3] = me[15] + me[13]

    // 上平面
    planes[3][0] = me[3] - me[1]
    planes[3][1] = me[7] - me[5]
    planes[3][2] = me[11] - me[9]
    planes[3][3] = me[15] - me[13]

    // 近平面
    if (reverseZ) {
      planes[4][0] = me[3] - me[2]
      planes[4][1] = me[7] - me[6]
      planes[4][2] = me[11] - me[10]
      planes[4][3] = me[15] - me[14]
    } else {
      planes[4][0] = me[3] + me[2]
      planes[4][1] = me[7] + me[6]
      planes[4][2] = me[11] + me[10]
      planes[4][3] = me[15] + me[14]
    }

    // 远平面
    if (reverseZ) {
      planes[5][0] = me[3] + me[2]
      planes[5][1] = me[7] + me[6]
      planes[5][2] = me[11] + me[10]
      planes[5][3] = me[15] + me[14]
    } else {
      planes[5][0] = me[3] - me[2]
      planes[5][1] = me[7] - me[6]
      planes[5][2] = me[11] - me[10]
      planes[5][3] = me[15] - me[14]
    }

    // 归一化平面方程
    for (let i = 0; i < 6; i++) {
      const plane = planes[i]
      const len = Math.sqrt(plane[0] * plane[0] + plane[1] * plane[1] + plane[2] * plane[2])
      if (len > 0) {
        plane[0] /= len
        plane[1] /= len
        plane[2] /= len
        plane[3] /= len
      }
    }
  }

  /**
   * 检查 AABB 是否与视锥体相交。
   * @param min 包围盒最小点
   * @param max 包围盒最大点
   * @returns 相交或包含时返回 `true`
   */
  intersectsBox(
    min: { x: number; y: number; z: number },
    max: { x: number; y: number; z: number },
  ): boolean {
    for (let i = 0; i < 6; i++) {
      const plane = this.planes[i]
      const px = plane[0] > 0 ? max.x : min.x
      const py = plane[1] > 0 ? max.y : min.y
      const pz = plane[2] > 0 ? max.z : min.z

      if (plane[0] * px + plane[1] * py + plane[2] * pz + plane[3] < 0) {
        return false
      }
    }
    return true
  }

  /** 检查单个点是否落在视锥体内。 */
  containsPoint(p: { x: number; y: number; z: number }): boolean {
    for (let i = 0; i < 6; i++) {
      const plane = this.planes[i]
      if (plane[0] * p.x + plane[1] * p.y + plane[2] * p.z + plane[3] < 0) {
        return false
      }
    }
    return true
  }
}
