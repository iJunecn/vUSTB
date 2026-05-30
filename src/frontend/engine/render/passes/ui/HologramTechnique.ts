import { UI_TEXTURE_UNITS } from '@render/bindings/TextureUnits'
import type { HologramEffectInstance } from '@render/ui3d/HologramPanel'
import { MAX_HOLOGRAM_PANELS } from '@render/ui3d/HologramPanel'
import { GL } from '@render/utils/gl'
import FULLSCREEN_VERTEX_SHADER from '@shaders/screen/postprocess.vsh'
import HOLOGRAM_FRAGMENT_SHADER from '@shaders/screen/hologram_composite.fsh'
import { FullscreenTriangle } from './FullscreenTriangle'

export class HologramTechnique {
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly triangle: FullscreenTriangle
  private readonly uniformLocations: {
    sceneTexture: WebGLUniformLocation | null
    time: WebGLUniformLocation | null
    panelCount: WebGLUniformLocation | null
    panelRects: WebGLUniformLocation | null
    panelTintOpacity: WebGLUniformLocation | null
    panelStyle: WebGLUniformLocation | null
    panelMotion: WebGLUniformLocation | null
    transparentBackground: WebGLUniformLocation | null
  }
  private width = 1
  private height = 1

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.program = GL.createProgram(gl, FULLSCREEN_VERTEX_SHADER, HOLOGRAM_FRAGMENT_SHADER)
    this.triangle = new FullscreenTriangle(gl, this.program)
    this.uniformLocations = {
      sceneTexture: GL.getUniformLocation(gl, this.program, 'uSceneTexture'),
      time: GL.getUniformLocation(gl, this.program, 'uTime'),
      panelCount: GL.getUniformLocation(gl, this.program, 'uHologramPanelCount'),
      panelRects: GL.getUniformLocation(gl, this.program, 'uHologramPanelRects[0]'),
      panelTintOpacity: GL.getUniformLocation(gl, this.program, 'uHologramPanelTintOpacity[0]'),
      panelStyle: GL.getUniformLocation(gl, this.program, 'uHologramPanelStyle[0]'),
      panelMotion: GL.getUniformLocation(gl, this.program, 'uHologramPanelMotion[0]'),
      transparentBackground: GL.getUniformLocation(gl, this.program, 'uTransparentBackground'),
    }
  }

  public resize(width: number, height: number) {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
  }

  private toViewportBottomY(yFromTop: number, height: number) {
    return this.height - yFromTop - height
  }

  public render(
    sceneTexture: WebGLTexture,
    panels: readonly HologramEffectInstance[],
    timeSeconds: number,
    targetFramebuffer: WebGLFramebuffer | null = null,
    transparentBackground: boolean = false,
  ) {
    if (panels.length === 0) {
      return
    }

    const gl = this.gl
    const count = Math.min(panels.length, MAX_HOLOGRAM_PANELS)
    const panelRects = new Float32Array(MAX_HOLOGRAM_PANELS * 4)
    const panelTintOpacity = new Float32Array(MAX_HOLOGRAM_PANELS * 4)
    const panelStyle = new Float32Array(MAX_HOLOGRAM_PANELS * 4)
    const panelMotion = new Float32Array(MAX_HOLOGRAM_PANELS * 4)

    for (let index = 0; index < count; index++) {
      const panel = panels[index]
      const rectOffset = index * 4
      panelRects[rectOffset + 0] = panel.payload.panel.x
      panelRects[rectOffset + 1] = this.toViewportBottomY(
        panel.payload.panel.y,
        panel.payload.panel.height,
      )
      panelRects[rectOffset + 2] = panel.payload.panel.width
      panelRects[rectOffset + 3] = panel.payload.panel.height

      panelTintOpacity[rectOffset + 0] = panel.payload.settings.tint[0]
      panelTintOpacity[rectOffset + 1] = panel.payload.settings.tint[1]
      panelTintOpacity[rectOffset + 2] = panel.payload.settings.tint[2]
      panelTintOpacity[rectOffset + 3] = panel.payload.settings.opacity

      panelStyle[rectOffset + 0] = panel.payload.settings.scanlineDensity
      panelStyle[rectOffset + 1] = panel.payload.settings.glowStrength
      panelStyle[rectOffset + 2] = panel.payload.settings.distortionStrength
      panelStyle[rectOffset + 3] = panel.payload.settings.noiseStrength

      panelMotion[rectOffset + 0] = panel.payload.settings.scanlineSpeed
      panelMotion[rectOffset + 1] = panel.payload.settings.edgeGlow
      panelMotion[rectOffset + 2] = panel.payload.settings.gridScale
      panelMotion[rectOffset + 3] = panel.payload.settings.cornerRadius
    }

    gl.useProgram(this.program)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer)
    gl.viewport(0, 0, this.width, this.height)
    gl.clearColor(0.0, 0.0, 0.0, transparentBackground ? 0.0 : 1.0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    GL.bindTextureSampler(
      gl,
      this.uniformLocations.sceneTexture,
      UI_TEXTURE_UNITS.scene,
      gl.TEXTURE_2D,
      sceneTexture,
    )

    if (this.uniformLocations.time) {
      gl.uniform1f(this.uniformLocations.time, timeSeconds)
    }
    if (this.uniformLocations.transparentBackground) {
      gl.uniform1i(this.uniformLocations.transparentBackground, transparentBackground ? 1 : 0)
    }
    if (this.uniformLocations.panelCount) {
      gl.uniform1i(this.uniformLocations.panelCount, count)
    }
    if (this.uniformLocations.panelRects) {
      gl.uniform4fv(this.uniformLocations.panelRects, panelRects)
    }
    if (this.uniformLocations.panelTintOpacity) {
      gl.uniform4fv(this.uniformLocations.panelTintOpacity, panelTintOpacity)
    }
    if (this.uniformLocations.panelStyle) {
      gl.uniform4fv(this.uniformLocations.panelStyle, panelStyle)
    }
    if (this.uniformLocations.panelMotion) {
      gl.uniform4fv(this.uniformLocations.panelMotion, panelMotion)
    }

    this.triangle.draw(gl)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  public dispose() {
    this.gl.deleteProgram(this.program)
    this.triangle.dispose(this.gl)
  }
}
