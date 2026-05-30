import { UI_TEXTURE_UNITS } from '@render/bindings/TextureUnits'
import type { TextLabelEffectInstance } from '@render/ui3d/TextLabel'
import { GL } from '@render/utils/gl'
import FULLSCREEN_VERTEX_SHADER from '@shaders/screen/postprocess.vsh'
import TEXT_LABEL_FRAGMENT_SHADER from '@shaders/screen/text_label_composite.fsh'
import { FullscreenTriangle } from './FullscreenTriangle'

const TEXT_SUPERSAMPLE = 2

type TextTextureCacheEntry = {
  texture: WebGLTexture
  key: string
}

export class TextLabelTechnique {
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly triangle: FullscreenTriangle
  private readonly uniformLocations: {
    textTexture: WebGLUniformLocation | null
    rectPx: WebGLUniformLocation | null
    viewportSize: WebGLUniformLocation | null
    opacity: WebGLUniformLocation | null
  }
  private readonly textCanvas: HTMLCanvasElement
  private readonly textContext: CanvasRenderingContext2D
  private readonly textureCache = new Map<number, TextTextureCacheEntry>()
  private viewportWidth = 1
  private viewportHeight = 1

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl
    this.program = GL.createProgram(gl, FULLSCREEN_VERTEX_SHADER, TEXT_LABEL_FRAGMENT_SHADER)
    this.triangle = new FullscreenTriangle(gl, this.program)
    this.uniformLocations = {
      textTexture: GL.getUniformLocation(gl, this.program, 'uTextTexture'),
      rectPx: GL.getUniformLocation(gl, this.program, 'uRectPx'),
      viewportSize: GL.getUniformLocation(gl, this.program, 'uViewportSize'),
      opacity: GL.getUniformLocation(gl, this.program, 'uOpacity'),
    }

    this.textCanvas = document.createElement('canvas')
    const context = this.textCanvas.getContext('2d')
    if (!context) {
      throw new Error('Failed to create 2D canvas for text label technique')
    }
    this.textContext = context
    this.resize(width, height)
  }

  public resize(width: number, height: number) {
    this.viewportWidth = Math.max(1, width)
    this.viewportHeight = Math.max(1, height)
  }

  private toViewportBottomY(yFromTop: number, height: number) {
    return this.viewportHeight - yFromTop - height
  }

  private buildCacheKey(label: TextLabelEffectInstance) {
    return JSON.stringify({ rect: label.rect, style: label.payload.style })
  }

  private ensureTexture(label: TextLabelEffectInstance): WebGLTexture {
    const key = this.buildCacheKey(label)
    const cached = this.textureCache.get(label.id)
    if (cached && cached.key === key) {
      return cached.texture
    }

    const texture = cached?.texture ?? this.gl.createTexture()
    if (!texture) {
      throw new Error('Failed to create text label texture')
    }

    const rasterScale = TEXT_SUPERSAMPLE
    const canvasWidth = Math.max(1, Math.ceil(label.rect.width * rasterScale))
    const canvasHeight = Math.max(1, Math.ceil(label.rect.height * rasterScale))
    const style = label.payload.style
    const ctx = this.textContext

    this.textCanvas.width = canvasWidth
    this.textCanvas.height = canvasHeight
    ctx.setTransform(rasterScale, 0, 0, rasterScale, 0, 0)
    ctx.clearRect(0, 0, label.rect.width, label.rect.height)
    ctx.textBaseline = 'top'

    if (style.backgroundColor !== 'transparent') {
      ctx.fillStyle = style.backgroundColor
      ctx.fillRect(0, 0, label.rect.width, label.rect.height)
    }

    ctx.font = `${style.fontWeight} ${style.fontSize}px ${style.fontFamily}`
    ctx.textAlign = style.align
    ctx.fillStyle = style.color
    ctx.shadowColor = style.shadowColor
    ctx.shadowBlur = style.shadowBlur
    ctx.lineJoin = 'round'
    ctx.lineWidth = style.outlineWidth
    ctx.strokeStyle = style.outlineColor

    const x =
      style.align === 'center'
        ? label.rect.width * 0.5
        : style.align === 'right'
          ? label.rect.width - style.padding
          : style.padding
    const lines = style.text.split(/\r?\n/)
    const lineAdvance = style.fontSize * style.lineHeight
    const totalHeight = lineAdvance * lines.length
    let y = Math.max(style.padding, (label.rect.height - totalHeight) * 0.5)

    for (const line of lines) {
      if (style.outlineWidth > 0) {
        ctx.strokeText(line, x, y, Math.max(1, label.rect.width - style.padding * 2))
      }
      ctx.fillText(line, x, y, Math.max(1, label.rect.width - style.padding * 2))
      y += lineAdvance
    }

    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.textCanvas)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    gl.bindTexture(gl.TEXTURE_2D, null)

    this.textureCache.set(label.id, { texture, key })
    return texture
  }

  public render(labels: readonly TextLabelEffectInstance[]) {
    if (labels.length === 0) {
      return
    }

    const gl = this.gl
    const liveIds = new Set<number>()

    gl.useProgram(this.program)
    gl.disable(gl.DEPTH_TEST)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)

    if (this.uniformLocations.viewportSize) {
      gl.uniform2f(this.uniformLocations.viewportSize, this.viewportWidth, this.viewportHeight)
    }

    for (const label of labels) {
      liveIds.add(label.id)
      const texture = this.ensureTexture(label)
      GL.bindTextureSampler(
        gl,
        this.uniformLocations.textTexture,
        UI_TEXTURE_UNITS.text,
        gl.TEXTURE_2D,
        texture,
      )

      if (this.uniformLocations.rectPx) {
        gl.uniform4f(
          this.uniformLocations.rectPx,
          label.rect.x,
          this.toViewportBottomY(label.rect.y, label.rect.height),
          label.rect.width,
          label.rect.height,
        )
      }
      if (this.uniformLocations.opacity) {
        gl.uniform1f(this.uniformLocations.opacity, label.payload.style.opacity)
      }

      this.triangle.draw(gl)
    }

    for (const [id, entry] of this.textureCache.entries()) {
      if (liveIds.has(id)) {
        continue
      }
      gl.deleteTexture(entry.texture)
      this.textureCache.delete(id)
    }

    gl.disable(gl.BLEND)
  }

  public dispose() {
    for (const entry of this.textureCache.values()) {
      this.gl.deleteTexture(entry.texture)
    }
    this.textureCache.clear()
    this.gl.deleteProgram(this.program)
    this.triangle.dispose(this.gl)
  }
}
