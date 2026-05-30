export class LightCache {
  private readonly lights = new Map<string, Float32Array>()
  private aggregated = new Float32Array(0) // 全量聚合后的点光数组
  private filteredAggregated = new Float32Array(0)
  private filteredSignature = ''
  private dirty = true // 为 true 时需要重新拼接缓存

  setLights(key: string, data: Float32Array) {
    this.lights.set(key, data)
    this.dirty = true
    this.filteredSignature = ''
  }

  delete(key: string) {
    if (this.lights.delete(key)) {
      this.dirty = true
      this.filteredSignature = ''
    }
  }

  clear() {
    if (this.lights.size === 0) return
    this.lights.clear()
    this.dirty = true
    this.filteredSignature = ''
  }

  /**
   * 返回聚合后的点光数组；禁用点光时返回空数组。
   */
  getAggregatedLights(enablePointLights: boolean, allowedKeys?: readonly string[]): Float32Array {
    if (!enablePointLights) return new Float32Array(0)
    if (allowedKeys && allowedKeys.length > 0) {
      const signature = allowedKeys.join('|')
      if (!this.dirty && this.filteredSignature === signature) {
        return this.filteredAggregated
      }

      const allowed = new Set(allowedKeys)
      let total = 0
      for (const [key, buf] of this.lights.entries()) {
        if (allowed.has(key)) {
          total += buf.length
        }
      }

      if (this.filteredAggregated.length !== total) {
        this.filteredAggregated = new Float32Array(total)
      }

      let offset = 0
      for (const [key, buf] of this.lights.entries()) {
        if (!allowed.has(key)) {
          continue
        }
        this.filteredAggregated.set(buf, offset)
        offset += buf.length
      }

      this.filteredSignature = signature
      return this.filteredAggregated
    }

    if (!this.dirty) return this.aggregated

    let total = 0
    for (const buf of this.lights.values()) {
      total += buf.length
    }

    if (this.aggregated.length !== total) {
      this.aggregated = new Float32Array(total)
    }

    let offset = 0
    for (const buf of this.lights.values()) {
      this.aggregated.set(buf, offset)
      offset += buf.length
    }

    this.dirty = false
    this.filteredSignature = ''
    return this.aggregated
  }
}
