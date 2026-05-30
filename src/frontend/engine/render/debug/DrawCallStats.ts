export type DrawCallPassName =
  | 'shadow'
  | 'depth-prepass'
  | 'geometry'
  | 'ssao'
  | 'point-shadow'
  | 'lighting'
  | 'forward'
  | 'forward-composite'
  | 'postprocess'
  | 'ui'
  | 'unknown'

export interface DrawCallStatsSnapshot {
  total: number
  drawArrays: number
  drawElements: number
  byPass: Record<DrawCallPassName, number>
}

function createEmptySnapshot(): DrawCallStatsSnapshot {
  return {
    total: 0,
    drawArrays: 0,
    drawElements: 0,
    byPass: {
      shadow: 0,
      'depth-prepass': 0,
      geometry: 0,
      ssao: 0,
      'point-shadow': 0,
      lighting: 0,
      forward: 0,
      'forward-composite': 0,
      postprocess: 0,
      ui: 0,
      unknown: 0,
    },
  }
}

class DrawCallStatsCollector {
  private currentPass: DrawCallPassName = 'unknown'
  private currentFrame: DrawCallStatsSnapshot = createEmptySnapshot()
  private lastFrame: DrawCallStatsSnapshot = createEmptySnapshot()

  public beginFrame(): void {
    this.currentPass = 'unknown'
    this.currentFrame = createEmptySnapshot()
  }

  public endFrame(): void {
    this.lastFrame = {
      total: this.currentFrame.total,
      drawArrays: this.currentFrame.drawArrays,
      drawElements: this.currentFrame.drawElements,
      byPass: { ...this.currentFrame.byPass },
    }
    this.currentPass = 'unknown'
  }

  public setCurrentPass(passName: DrawCallPassName): void {
    this.currentPass = passName
  }

  public clearCurrentPass(): void {
    this.currentPass = 'unknown'
  }

  public recordDrawCall(kind: 'arrays' | 'elements'): void {
    this.currentFrame.total += 1
    if (kind === 'arrays') {
      this.currentFrame.drawArrays += 1
    } else {
      this.currentFrame.drawElements += 1
    }
    this.currentFrame.byPass[this.currentPass] += 1
  }

  public getLastFrameStats(): DrawCallStatsSnapshot {
    return {
      total: this.lastFrame.total,
      drawArrays: this.lastFrame.drawArrays,
      drawElements: this.lastFrame.drawElements,
      byPass: { ...this.lastFrame.byPass },
    }
  }
}

export const drawCallStats = new DrawCallStatsCollector()
