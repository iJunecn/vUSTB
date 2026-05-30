import { FrameBuffer } from '@render/core/buffer/FrameBuffer'
import { GL } from '@render/utils/gl'
import {
  createDefaultLiquidGlassEffectSettings,
  type LiquidGlassEffectSettings,
} from '@render/ui3d/LiquidGlassEffectSettings'
import type { HologramEffectInstance } from '@render/ui3d/HologramPanel'
import type { LiquidGlassPanel } from '@render/ui3d/LiquidGlassPanel'
import type { TextLabelEffectInstance } from '@render/ui3d/TextLabel'
import { HologramTechnique } from './HologramTechnique'
import { LiquidGlassTechnique } from './LiquidGlassTechnique'
import { TextLabelTechnique } from './TextLabelTechnique'
import { TextureCompositePass } from './TextureCompositePass'

export interface Ui3dPassInputs {
  liquidGlass: {
    panels: {
      section: readonly LiquidGlassPanel[]
      article: readonly LiquidGlassPanel[]
      headerbar: readonly LiquidGlassPanel[]
      indicator: readonly LiquidGlassPanel[]
    }
    settings: {
      section: LiquidGlassEffectSettings
      article: LiquidGlassEffectSettings
      headerbar: LiquidGlassEffectSettings
      indicator: LiquidGlassEffectSettings
    }
  }
  hologram: {
    panels: readonly HologramEffectInstance[]
  }
  text: {
    labels: readonly TextLabelEffectInstance[]
  }
}

export interface Ui3dPassRenderOptions {
  transparentBackground?: boolean
}

export class Ui3dPass {
  private readonly gl: WebGL2RenderingContext
  private readonly liquidGlassTechnique: LiquidGlassTechnique
  private readonly hologramTechnique: HologramTechnique
  private readonly textLabelTechnique: TextLabelTechnique
  private readonly textureCompositePass: TextureCompositePass
  private readonly composeFrameBuffers: [FrameBuffer, FrameBuffer]
  private readonly composeTextures: [WebGLTexture, WebGLTexture]
  private readonly transparentSceneTexture: WebGLTexture
  private width: number
  private height: number

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.liquidGlassTechnique = new LiquidGlassTechnique(gl, width, height)
    this.hologramTechnique = new HologramTechnique(gl, width, height)
    this.textLabelTechnique = new TextLabelTechnique(gl, width, height)
    this.textureCompositePass = new TextureCompositePass(gl)
    this.composeFrameBuffers = [
      new FrameBuffer(gl, this.width, this.height),
      new FrameBuffer(gl, this.width, this.height),
    ]
    this.composeTextures = [
      GL.createTexture(gl, this.width, this.height, {
        internalFormat: gl.RGBA8,
        format: gl.RGBA,
        type: gl.UNSIGNED_BYTE,
        minFilter: gl.LINEAR,
        magFilter: gl.LINEAR,
      }),
      GL.createTexture(gl, this.width, this.height, {
        internalFormat: gl.RGBA8,
        format: gl.RGBA,
        type: gl.UNSIGNED_BYTE,
        minFilter: gl.LINEAR,
        magFilter: gl.LINEAR,
      }),
    ]
    this.transparentSceneTexture = GL.createTexture(gl, this.width, this.height, {
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
    })
    for (let index = 0; index < this.composeFrameBuffers.length; index += 1) {
      this.composeFrameBuffers[index].attachTexture(
        this.composeTextures[index],
        gl.COLOR_ATTACHMENT0,
      )
      this.composeFrameBuffers[index].setDrawBuffers([gl.COLOR_ATTACHMENT0])
      this.composeFrameBuffers[index].checkStatus()
    }
  }

  public resize(width: number, height: number) {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    this.liquidGlassTechnique.resize(width, height)
    this.hologramTechnique.resize(width, height)
    this.textLabelTechnique.resize(width, height)
    for (const frameBuffer of this.composeFrameBuffers) {
      frameBuffer.resize(this.width, this.height)
    }
    for (const texture of this.composeTextures) {
      GL.resizeTexture(
        this.gl,
        texture,
        this.width,
        this.height,
        this.gl.RGBA8,
        this.gl.RGBA,
        this.gl.UNSIGNED_BYTE,
      )
    }
    GL.resizeTexture(
      this.gl,
      this.transparentSceneTexture,
      this.width,
      this.height,
      this.gl.RGBA8,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
    )
  }

  public render(
    sceneTexture: WebGLTexture,
    inputs: Ui3dPassInputs,
    timeSeconds: number,
    options: Ui3dPassRenderOptions = {},
  ) {
    const transparentBackground = options.transparentBackground ?? false
    const liquidGlass = inputs.liquidGlass
    let currentTexture = sceneTexture
    let composeIndex = 0
    let hasFullscreenComposition = false

    const composeFullscreen = (
      renderPass: (sourceTexture: WebGLTexture, targetFramebuffer: WebGLFramebuffer) => void,
    ) => {
      const targetFrameBuffer = this.composeFrameBuffers[composeIndex]
      renderPass(currentTexture, targetFrameBuffer.fbo)
      currentTexture = this.composeTextures[composeIndex]
      composeIndex = composeIndex === 0 ? 1 : 0
      hasFullscreenComposition = true
    }

    const layerRenderOrder = ['section', 'article', 'headerbar', 'indicator'] as const
    for (const layer of layerRenderOrder) {
      const panels = liquidGlass.panels[layer]
      if (panels && panels.length > 0) {
        this.liquidGlassTechnique.setEffectSettings(
          liquidGlass.settings[layer] ?? createDefaultLiquidGlassEffectSettings(),
        )
        composeFullscreen((sourceTexture, targetFramebuffer) => {
          this.liquidGlassTechnique.render(
            sourceTexture,
            panels,
            timeSeconds,
            targetFramebuffer,
            transparentBackground,
          )
        })
      }
    }

    if (inputs.hologram.panels.length > 0) {
      composeFullscreen((sourceTexture, targetFramebuffer) => {
        this.hologramTechnique.render(
          sourceTexture,
          inputs.hologram.panels,
          timeSeconds,
          targetFramebuffer,
          transparentBackground,
        )
      })
    }

    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null)
    this.gl.viewport(0, 0, this.width, this.height)
    this.gl.clearColor(0.0, 0.0, 0.0, transparentBackground ? 0.0 : 1.0)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT)

    if (hasFullscreenComposition) {
      this.textureCompositePass.render(currentTexture)
    } else {
      this.textureCompositePass.render(sceneTexture)
    }

    this.textLabelTechnique.render(inputs.text.labels)
  }

  public dispose() {
    this.liquidGlassTechnique.dispose()
    this.hologramTechnique.dispose()
    this.textLabelTechnique.dispose()
    this.textureCompositePass.dispose()
    for (const frameBuffer of this.composeFrameBuffers) {
      frameBuffer.dispose()
    }
    for (const texture of this.composeTextures) {
      this.gl.deleteTexture(texture)
    }
    this.gl.deleteTexture(this.transparentSceneTexture)
  }
}
