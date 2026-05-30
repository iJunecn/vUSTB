import { UI_TEXTURE_UNITS } from '@render/bindings/TextureUnits'
import { GL } from '@render/utils/gl'
import BLUR_FRAGMENT_SHADER from '@shaders/screen/ui_blur.fsh'
import FULLSCREEN_VERTEX_SHADER from '@shaders/screen/postprocess.vsh'
import { FullscreenTriangle } from './FullscreenTriangle'

export class UIBlurPass {
  public readonly program: WebGLProgram
  private readonly fullscreenTriangle: FullscreenTriangle
  private readonly uniformLocations: {
    inputTexture: WebGLUniformLocation | null
    direction: WebGLUniformLocation | null
    inverseTextureSize: WebGLUniformLocation | null
    blurRadius: WebGLUniformLocation | null
    uvOffset: WebGLUniformLocation | null
    uvScale: WebGLUniformLocation | null
  }

  constructor(gl: WebGL2RenderingContext) {
    this.program = GL.createProgram(gl, FULLSCREEN_VERTEX_SHADER, BLUR_FRAGMENT_SHADER)
    this.fullscreenTriangle = new FullscreenTriangle(gl, this.program)
    this.uniformLocations = {
      inputTexture: GL.getUniformLocation(gl, this.program, 'uInputTexture'),
      direction: GL.getUniformLocation(gl, this.program, 'uDirection'),
      inverseTextureSize: GL.getUniformLocation(gl, this.program, 'uInverseTextureSize'),
      blurRadius: GL.getUniformLocation(gl, this.program, 'uBlurRadius'),
      uvOffset: GL.getUniformLocation(gl, this.program, 'uUvOffset'),
      uvScale: GL.getUniformLocation(gl, this.program, 'uUvScale'),
    }
  }

  render(
    gl: WebGL2RenderingContext,
    inputTexture: WebGLTexture,
    inverseTextureSize: readonly [number, number],
    direction: readonly [number, number],
    blurRadius: number,
    uvOffset: readonly [number, number] = [0, 0],
    uvScale: readonly [number, number] = [1, 1],
  ) {
    gl.useProgram(this.program)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)

    GL.bindTextureSampler(
      gl,
      this.uniformLocations.inputTexture,
      UI_TEXTURE_UNITS.input,
      gl.TEXTURE_2D,
      inputTexture,
    )

    if (this.uniformLocations.direction) {
      gl.uniform2f(this.uniformLocations.direction, direction[0], direction[1])
    }
    if (this.uniformLocations.inverseTextureSize) {
      gl.uniform2f(
        this.uniformLocations.inverseTextureSize,
        inverseTextureSize[0],
        inverseTextureSize[1],
      )
    }
    if (this.uniformLocations.blurRadius) {
      gl.uniform1f(this.uniformLocations.blurRadius, blurRadius)
    }
    if (this.uniformLocations.uvOffset) {
      gl.uniform2f(this.uniformLocations.uvOffset, uvOffset[0], uvOffset[1])
    }
    if (this.uniformLocations.uvScale) {
      gl.uniform2f(this.uniformLocations.uvScale, uvScale[0], uvScale[1])
    }

    this.fullscreenTriangle.draw(gl)
  }

  dispose(gl: WebGL2RenderingContext) {
    gl.deleteProgram(this.program)
    this.fullscreenTriangle.dispose(gl)
  }
}
