import { FrameBuffer } from '@render/core/buffer/FrameBuffer'
import { UI_TEXTURE_UNITS } from '@render/bindings/TextureUnits'
import { GL } from '@render/utils/gl'
import {
  createDefaultLiquidGlassEffectSettings,
  type LiquidGlassEffectSettings,
} from '@render/ui3d/LiquidGlassEffectSettings'
import { createDefaultLiquidGlassInstanceSettings } from '@render/ui3d/LiquidGlassInstanceSettings'
import type { LiquidGlassPanel } from '@render/ui3d/LiquidGlassPanel'
import INSTANCED_VERTEX_SHADER from '@shaders/screen/liquid_glass_instanced.vsh'
import COMPOSITE_FRAGMENT_SHADER from '@shaders/screen/liquid_glass_composite.fsh'
import { InstancedQuad } from './InstancedQuad'
import { TextureCompositePass } from './TextureCompositePass'
import { UIBlurPass } from './UIBlurPass'

const BLUR_PADDING_PX = 72
const BLUR_DOWNSAMPLE = 0.5

type BlurRegion = {
  x: number
  y: number
  width: number
  height: number
}

export class LiquidGlassTechnique {
  private readonly gl: WebGL2RenderingContext
  private readonly blurPass: UIBlurPass
  private readonly compositeProgram: WebGLProgram
  private readonly copyPass: TextureCompositePass
  private readonly compositeQuad: InstancedQuad
  private readonly compositeUniformLocations: {
    sceneTexture: WebGLUniformLocation | null
    blurTexture: WebGLUniformLocation | null
    blurRegionUvRect: WebGLUniformLocation | null
    viewportSize: WebGLUniformLocation | null
    liquidGlassPanelCount: WebGLUniformLocation | null
    liquidGlassPanelRects: WebGLUniformLocation | null
    time: WebGLUniformLocation | null
    blurEnabled: WebGLUniformLocation | null
    flowEnabled: WebGLUniformLocation | null
    flowStrength: WebGLUniformLocation | null
    flowWidth: WebGLUniformLocation | null
    flowFalloff: WebGLUniformLocation | null
    chromaticEnabled: WebGLUniformLocation | null
    chromaticStrength: WebGLUniformLocation | null
    chromaticWidth: WebGLUniformLocation | null
    chromaticFalloff: WebGLUniformLocation | null
    chromaticOffsets: WebGLUniformLocation | null
    highlightEnabled: WebGLUniformLocation | null
    highlightWidth: WebGLUniformLocation | null
    highlightAngle: WebGLUniformLocation | null
    highlightStrength: WebGLUniformLocation | null
    highlightRange: WebGLUniformLocation | null
    highlightMode: WebGLUniformLocation | null
    highlightDiagonal: WebGLUniformLocation | null
    antiAliasingEnabled: WebGLUniformLocation | null
    antiAliasingBlurRadius: WebGLUniformLocation | null
    antiAliasingEdgeRange: WebGLUniformLocation | null
    antiAliasingStrength: WebGLUniformLocation | null
    colorGradingEnabled: WebGLUniformLocation | null
    brightnessContrastSaturationHue: WebGLUniformLocation | null
    exposureGammaTemperatureHighlights: WebGLUniformLocation | null
    shadowsVibranceFadeoutVignetteStrength: WebGLUniformLocation | null
    vignetteRadiusSoftness: WebGLUniformLocation | null
    shadowColor: WebGLUniformLocation | null
    midtoneColor: WebGLUniformLocation | null
    highlightColor: WebGLUniformLocation | null
    colorOverlayEnabled: WebGLUniformLocation | null
    colorOverlayColor: WebGLUniformLocation | null
    colorOverlayStrength: WebGLUniformLocation | null
    transparentBackground: WebGLUniformLocation | null
  }
  private effectSettings: LiquidGlassEffectSettings

  private blurTempFrameBuffer: FrameBuffer
  private blurTempTexture: WebGLTexture
  private blurFrameBuffer: FrameBuffer
  private blurTexture: WebGLTexture
  private width: number
  private height: number
  private blurWidth: number
  private blurHeight: number

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl
    this.blurPass = new UIBlurPass(gl)
    this.copyPass = new TextureCompositePass(gl)
    this.compositeProgram = GL.createProgram(gl, INSTANCED_VERTEX_SHADER, COMPOSITE_FRAGMENT_SHADER)
    this.compositeQuad = new InstancedQuad(gl, this.compositeProgram)
    this.compositeUniformLocations = {
      sceneTexture: GL.getUniformLocation(gl, this.compositeProgram, 'uSceneTexture'),
      blurTexture: GL.getUniformLocation(gl, this.compositeProgram, 'uBlurTexture'),
      blurRegionUvRect: GL.getUniformLocation(gl, this.compositeProgram, 'uBlurRegionUvRect'),
      viewportSize: GL.getUniformLocation(gl, this.compositeProgram, 'uViewportSize'),
      liquidGlassPanelCount: GL.getUniformLocation(
        gl,
        this.compositeProgram,
        'uLiquidGlassPanelCount',
      ),
      liquidGlassPanelRects: GL.getUniformLocation(
        gl,
        this.compositeProgram,
        'uLiquidGlassPanelRects[0]',
      ),
      time: GL.getUniformLocation(gl, this.compositeProgram, 'uTime'),
      blurEnabled: GL.getUniformLocation(gl, this.compositeProgram, 'uBlurEnabled'),
      flowEnabled: GL.getUniformLocation(gl, this.compositeProgram, 'uFlowEnabled'),
      flowStrength: GL.getUniformLocation(gl, this.compositeProgram, 'uFlowStrength'),
      flowWidth: GL.getUniformLocation(gl, this.compositeProgram, 'uFlowWidth'),
      flowFalloff: GL.getUniformLocation(gl, this.compositeProgram, 'uFlowFalloff'),
      chromaticEnabled: GL.getUniformLocation(gl, this.compositeProgram, 'uChromaticEnabled'),
      chromaticStrength: GL.getUniformLocation(gl, this.compositeProgram, 'uChromaticStrength'),
      chromaticWidth: GL.getUniformLocation(gl, this.compositeProgram, 'uChromaticWidth'),
      chromaticFalloff: GL.getUniformLocation(gl, this.compositeProgram, 'uChromaticFalloff'),
      chromaticOffsets: GL.getUniformLocation(gl, this.compositeProgram, 'uChromaticOffsets'),
      highlightEnabled: GL.getUniformLocation(gl, this.compositeProgram, 'uHighlightEnabled'),
      highlightWidth: GL.getUniformLocation(gl, this.compositeProgram, 'uHighlightWidth'),
      highlightAngle: GL.getUniformLocation(gl, this.compositeProgram, 'uHighlightAngle'),
      highlightStrength: GL.getUniformLocation(gl, this.compositeProgram, 'uHighlightStrength'),
      highlightRange: GL.getUniformLocation(gl, this.compositeProgram, 'uHighlightRange'),
      highlightMode: GL.getUniformLocation(gl, this.compositeProgram, 'uHighlightMode'),
      highlightDiagonal: GL.getUniformLocation(gl, this.compositeProgram, 'uHighlightDiagonal'),
      antiAliasingEnabled: GL.getUniformLocation(gl, this.compositeProgram, 'uAntiAliasingEnabled'),
      antiAliasingBlurRadius: GL.getUniformLocation(
        gl,
        this.compositeProgram,
        'uAntiAliasingBlurRadius',
      ),
      antiAliasingEdgeRange: GL.getUniformLocation(
        gl,
        this.compositeProgram,
        'uAntiAliasingEdgeRange',
      ),
      antiAliasingStrength: GL.getUniformLocation(
        gl,
        this.compositeProgram,
        'uAntiAliasingStrength',
      ),
      colorGradingEnabled: GL.getUniformLocation(gl, this.compositeProgram, 'uColorGradingEnabled'),
      brightnessContrastSaturationHue: GL.getUniformLocation(
        gl,
        this.compositeProgram,
        'uBrightnessContrastSaturationHue',
      ),
      exposureGammaTemperatureHighlights: GL.getUniformLocation(
        gl,
        this.compositeProgram,
        'uExposureGammaTemperatureHighlights',
      ),
      shadowsVibranceFadeoutVignetteStrength: GL.getUniformLocation(
        gl,
        this.compositeProgram,
        'uShadowsVibranceFadeoutVignetteStrength',
      ),
      vignetteRadiusSoftness: GL.getUniformLocation(
        gl,
        this.compositeProgram,
        'uVignetteRadiusSoftness',
      ),
      shadowColor: GL.getUniformLocation(gl, this.compositeProgram, 'uShadowColor'),
      midtoneColor: GL.getUniformLocation(gl, this.compositeProgram, 'uMidtoneColor'),
      highlightColor: GL.getUniformLocation(gl, this.compositeProgram, 'uHighlightColor'),
      colorOverlayEnabled: GL.getUniformLocation(gl, this.compositeProgram, 'uColorOverlayEnabled'),
      colorOverlayColor: GL.getUniformLocation(gl, this.compositeProgram, 'uColorOverlayColor'),
      colorOverlayStrength: GL.getUniformLocation(
        gl,
        this.compositeProgram,
        'uColorOverlayStrength',
      ),
      transparentBackground: GL.getUniformLocation(
        gl,
        this.compositeProgram,
        'uTransparentBackground',
      ),
    }
    this.effectSettings = createDefaultLiquidGlassEffectSettings()

    this.width = 0
    this.height = 0
    this.blurWidth = 0
    this.blurHeight = 0

    this.blurTempFrameBuffer = new FrameBuffer(gl, 1, 1)
    this.blurTempTexture = GL.createTexture(gl, 1, 1, {
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
    })
    this.blurTempFrameBuffer.attachTexture(this.blurTempTexture, gl.COLOR_ATTACHMENT0)
    this.blurTempFrameBuffer.setDrawBuffers([gl.COLOR_ATTACHMENT0])
    this.blurTempFrameBuffer.checkStatus()

    this.blurFrameBuffer = new FrameBuffer(gl, 1, 1)
    this.blurTexture = GL.createTexture(gl, 1, 1, {
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
    })
    this.blurFrameBuffer.attachTexture(this.blurTexture, gl.COLOR_ATTACHMENT0)
    this.blurFrameBuffer.setDrawBuffers([gl.COLOR_ATTACHMENT0])
    this.blurFrameBuffer.checkStatus()

    this.resize(width, height)
  }

  resize(width: number, height: number) {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.ensureBlurTargetSize(1, 1)
  }

  setEffectSettings(effectSettings: LiquidGlassEffectSettings) {
    this.effectSettings = JSON.parse(JSON.stringify(effectSettings)) as LiquidGlassEffectSettings
  }

  private toViewportBottomY(yFromTop: number, height: number) {
    return this.height - yFromTop - height
  }

  private ensureBlurTargetSize(width: number, height: number) {
    const nextWidth = Math.max(1, Math.floor(width))
    const nextHeight = Math.max(1, Math.floor(height))
    if (this.blurWidth === nextWidth && this.blurHeight === nextHeight) {
      return
    }

    this.blurWidth = nextWidth
    this.blurHeight = nextHeight

    this.blurTempFrameBuffer.resize(this.blurWidth, this.blurHeight)
    GL.resizeTexture(
      this.gl,
      this.blurTempTexture,
      this.blurWidth,
      this.blurHeight,
      this.gl.RGBA8,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
    )

    this.blurFrameBuffer.resize(this.blurWidth, this.blurHeight)
    GL.resizeTexture(
      this.gl,
      this.blurTexture,
      this.blurWidth,
      this.blurHeight,
      this.gl.RGBA8,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
    )
  }

  private computeBlurRegion(
    liquidGlassPanels: readonly LiquidGlassPanel[],
    panelCount: number,
  ): BlurRegion {
    let minX = this.width
    let minY = this.height
    let maxX = 0
    let maxY = 0

    for (let index = 0; index < panelCount; index++) {
      const panel = liquidGlassPanels[index]
      minX = Math.min(minX, panel.x - BLUR_PADDING_PX)
      const panelBottomY = this.toViewportBottomY(panel.y, panel.height)
      minY = Math.min(minY, panelBottomY - BLUR_PADDING_PX)
      maxX = Math.max(maxX, panel.x + panel.width + BLUR_PADDING_PX)
      maxY = Math.max(maxY, panelBottomY + panel.height + BLUR_PADDING_PX)
    }

    const x = Math.max(0, Math.floor(minX))
    const y = Math.max(0, Math.floor(minY))
    const width = Math.max(1, Math.ceil(Math.min(this.width, maxX) - x))
    const height = Math.max(1, Math.ceil(Math.min(this.height, maxY) - y))

    return { x, y, width, height }
  }

  private writeCompositeUniforms(
    blurRegionUvRect: Float32Array,
    panelCount: number,
    timeSeconds: number,
    transparentBackground: boolean,
  ) {
    const gl = this.gl
    const uniforms = this.compositeUniformLocations
    const settings = this.effectSettings

    if (uniforms.blurRegionUvRect) {
      gl.uniform4fv(uniforms.blurRegionUvRect, blurRegionUvRect)
    }
    if (uniforms.time) {
      gl.uniform1f(uniforms.time, timeSeconds)
    }
    if (uniforms.blurEnabled) {
      gl.uniform1i(
        uniforms.blurEnabled,
        settings.blur.enabled && settings.blur.radius > 0.001 ? 1 : 0,
      )
    }
    if (uniforms.flowEnabled) {
      gl.uniform1i(uniforms.flowEnabled, settings.flow.enabled ? 1 : 0)
    }
    if (uniforms.flowStrength) {
      gl.uniform1f(uniforms.flowStrength, settings.flow.flowStrength)
    }
    if (uniforms.flowWidth) {
      gl.uniform1f(uniforms.flowWidth, settings.flow.flowWidth)
    }
    if (uniforms.flowFalloff) {
      gl.uniform1f(uniforms.flowFalloff, settings.flow.flowFalloff)
    }
    if (uniforms.chromaticEnabled) {
      gl.uniform1i(uniforms.chromaticEnabled, settings.chromaticAberration.enabled ? 1 : 0)
    }
    if (uniforms.chromaticStrength) {
      gl.uniform1f(uniforms.chromaticStrength, settings.chromaticAberration.chromaticStrength)
    }
    if (uniforms.chromaticWidth) {
      gl.uniform1f(uniforms.chromaticWidth, settings.chromaticAberration.chromaticWidth)
    }
    if (uniforms.chromaticFalloff) {
      gl.uniform1f(uniforms.chromaticFalloff, settings.chromaticAberration.chromaticFalloff)
    }
    if (uniforms.chromaticOffsets) {
      gl.uniform3f(
        uniforms.chromaticOffsets,
        settings.chromaticAberration.offsetR,
        settings.chromaticAberration.offsetG,
        settings.chromaticAberration.offsetB,
      )
    }
    if (uniforms.highlightEnabled) {
      gl.uniform1i(uniforms.highlightEnabled, settings.highlight.enabled ? 1 : 0)
    }
    if (uniforms.highlightWidth) {
      gl.uniform1f(uniforms.highlightWidth, settings.highlight.width)
    }
    if (uniforms.highlightAngle) {
      gl.uniform1f(uniforms.highlightAngle, (settings.highlight.angle * Math.PI) / 180)
    }
    if (uniforms.highlightStrength) {
      gl.uniform1f(uniforms.highlightStrength, settings.highlight.strength)
    }
    if (uniforms.highlightRange) {
      gl.uniform1f(uniforms.highlightRange, settings.highlight.range)
    }
    if (uniforms.highlightMode) {
      gl.uniform1i(uniforms.highlightMode, settings.highlight.mode)
    }
    if (uniforms.highlightDiagonal) {
      gl.uniform1i(uniforms.highlightDiagonal, settings.highlight.diagonal ? 1 : 0)
    }
    if (uniforms.antiAliasingEnabled) {
      gl.uniform1i(uniforms.antiAliasingEnabled, settings.antiAliasing.enabled ? 1 : 0)
    }
    if (uniforms.antiAliasingBlurRadius) {
      gl.uniform1f(uniforms.antiAliasingBlurRadius, settings.antiAliasing.blurRadius)
    }
    if (uniforms.antiAliasingEdgeRange) {
      gl.uniform1f(uniforms.antiAliasingEdgeRange, settings.antiAliasing.edgeRange)
    }
    if (uniforms.antiAliasingStrength) {
      gl.uniform1f(uniforms.antiAliasingStrength, settings.antiAliasing.strength)
    }
    if (uniforms.colorGradingEnabled) {
      gl.uniform1i(uniforms.colorGradingEnabled, settings.colorGrading.enabled ? 1 : 0)
    }
    if (uniforms.brightnessContrastSaturationHue) {
      gl.uniform4f(
        uniforms.brightnessContrastSaturationHue,
        settings.colorGrading.brightness,
        settings.colorGrading.contrast,
        settings.colorGrading.saturation,
        settings.colorGrading.hueShift,
      )
    }
    if (uniforms.exposureGammaTemperatureHighlights) {
      gl.uniform4f(
        uniforms.exposureGammaTemperatureHighlights,
        settings.colorGrading.exposure,
        settings.colorGrading.gamma,
        settings.colorGrading.temperature,
        settings.colorGrading.highlights,
      )
    }
    if (uniforms.shadowsVibranceFadeoutVignetteStrength) {
      gl.uniform4f(
        uniforms.shadowsVibranceFadeoutVignetteStrength,
        settings.colorGrading.shadows,
        settings.colorGrading.vibrance,
        settings.colorGrading.fadeout,
        settings.colorGrading.vignetteStrength,
      )
    }
    if (uniforms.vignetteRadiusSoftness) {
      gl.uniform2f(
        uniforms.vignetteRadiusSoftness,
        settings.colorGrading.vignetteRadius,
        settings.colorGrading.vignetteSoftness,
      )
    }
    if (uniforms.shadowColor) {
      gl.uniform3fv(uniforms.shadowColor, settings.colorGrading.shadowColor)
    }
    if (uniforms.midtoneColor) {
      gl.uniform3fv(uniforms.midtoneColor, settings.colorGrading.midtoneColor)
    }
    if (uniforms.highlightColor) {
      gl.uniform3fv(uniforms.highlightColor, settings.colorGrading.highlightColor)
    }
    if (uniforms.colorOverlayEnabled) {
      gl.uniform1i(uniforms.colorOverlayEnabled, settings.colorOverlay.enabled ? 1 : 0)
    }
    if (uniforms.colorOverlayColor) {
      gl.uniform3fv(uniforms.colorOverlayColor, settings.colorOverlay.color)
    }
    if (uniforms.colorOverlayStrength) {
      gl.uniform1f(uniforms.colorOverlayStrength, settings.colorOverlay.strength)
    }
    if (uniforms.transparentBackground) {
      gl.uniform1i(uniforms.transparentBackground, transparentBackground ? 1 : 0)
    }
    if (uniforms.viewportSize) {
      gl.uniform2f(uniforms.viewportSize, this.width, this.height)
    }
    if (uniforms.liquidGlassPanelCount) {
      gl.uniform1i(uniforms.liquidGlassPanelCount, panelCount)
    }
  }

  render(
    sceneTexture: WebGLTexture,
    liquidGlassPanels: readonly LiquidGlassPanel[],
    timeSeconds: number,
    targetFramebuffer: WebGLFramebuffer | null = null,
    transparentBackground: boolean = false,
  ) {
    const gl = this.gl
    const panelCount = liquidGlassPanels.length
    const blurEnabled = this.effectSettings.blur.enabled && this.effectSettings.blur.radius > 0.001
    const blurRegion =
      panelCount > 0
        ? this.computeBlurRegion(liquidGlassPanels, panelCount)
        : { x: 0, y: 0, width: this.width, height: this.height }
    const blurRegionUvRect = new Float32Array([
      blurRegion.x / this.width,
      blurRegion.y / this.height,
      blurRegion.width / this.width,
      blurRegion.height / this.height,
    ])

    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)

    if (panelCount > 0 && blurEnabled) {
      const blurTargetWidth = Math.max(1, Math.ceil(blurRegion.width * BLUR_DOWNSAMPLE))
      const blurTargetHeight = Math.max(1, Math.ceil(blurRegion.height * BLUR_DOWNSAMPLE))
      this.ensureBlurTargetSize(blurTargetWidth, blurTargetHeight)

      this.blurTempFrameBuffer.bind()
      gl.viewport(0, 0, this.blurWidth, this.blurHeight)
      gl.clearColor(0.0, 0.0, 0.0, 1.0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.blurPass.render(
        gl,
        sceneTexture,
        [1 / this.width, 1 / this.height],
        [1, 0],
        this.effectSettings.blur.radius,
        [blurRegionUvRect[0], blurRegionUvRect[1]],
        [blurRegionUvRect[2], blurRegionUvRect[3]],
      )

      this.blurFrameBuffer.bind()
      gl.viewport(0, 0, this.blurWidth, this.blurHeight)
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.blurPass.render(
        gl,
        this.blurTempTexture,
        [1 / this.blurWidth, 1 / this.blurHeight],
        [0, 1],
        this.effectSettings.blur.radius,
      )
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer)
    gl.viewport(0, 0, this.width, this.height)
    gl.clearColor(0.0, 0.0, 0.0, transparentBackground ? 0.0 : 1.0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    this.copyPass.render(sceneTexture)

    gl.useProgram(this.compositeProgram)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    GL.bindTextureSampler(
      gl,
      this.compositeUniformLocations.sceneTexture,
      UI_TEXTURE_UNITS.scene,
      gl.TEXTURE_2D,
      sceneTexture,
    )
    GL.bindTextureSampler(
      gl,
      this.compositeUniformLocations.blurTexture,
      UI_TEXTURE_UNITS.blur,
      gl.TEXTURE_2D,
      panelCount > 0 ? this.blurTexture : sceneTexture,
    )

    this.writeCompositeUniforms(blurRegionUvRect, panelCount, timeSeconds, transparentBackground)
    if (panelCount > 0) {
      const instanceData = new Float32Array(panelCount * 16)
      for (let index = 0; index < panelCount; index++) {
        const panel = liquidGlassPanels[index]
        const settings = panel.instanceSettings ?? createDefaultLiquidGlassInstanceSettings()
        const base = index * 16
        instanceData[base] = panel.x
        instanceData[base + 1] = this.toViewportBottomY(panel.y, panel.height)
        instanceData[base + 2] = panel.width
        instanceData[base + 3] = panel.height
        instanceData[base + 4] = settings.cornerRadius
        instanceData[base + 5] = settings.blurMix
        instanceData[base + 6] = settings.flowStrengthScale
        instanceData[base + 7] = settings.chromaticStrengthScale
        instanceData[base + 8] = settings.highlightStrengthScale
        instanceData[base + 9] = settings.overlayStrengthScale
        instanceData[base + 10] = settings.opacity
        instanceData[base + 11] = 0
        instanceData[base + 12] = settings.overlayColor[0]
        instanceData[base + 13] = settings.overlayColor[1]
        instanceData[base + 14] = settings.overlayColor[2]
        instanceData[base + 15] = 0
      }
      this.compositeQuad.updateInstances(gl, instanceData)
    }

    this.compositeQuad.draw(gl, panelCount)
    gl.disable(gl.BLEND)
  }

  dispose() {
    const gl = this.gl
    this.blurPass.dispose(gl)
    this.copyPass.dispose()
    this.compositeQuad.dispose(gl)
    gl.deleteProgram(this.compositeProgram)
    gl.deleteFramebuffer(this.blurTempFrameBuffer.fbo)
    gl.deleteFramebuffer(this.blurFrameBuffer.fbo)
    gl.deleteTexture(this.blurTempTexture)
    gl.deleteTexture(this.blurTexture)
  }
}
