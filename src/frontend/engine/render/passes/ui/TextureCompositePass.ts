import { UI_TEXTURE_UNITS } from '@render/bindings/TextureUnits'
import { GL } from '@render/utils/gl'
import FULLSCREEN_VERTEX_SHADER from '@shaders/screen/postprocess.vsh'
import COPY_FRAGMENT_SHADER from '@shaders/screen/texture_copy.fsh'
import { FullscreenTriangle } from './FullscreenTriangle'

export class TextureCompositePass {
  private readonly gl: WebGL2RenderingContext
  private readonly program: WebGLProgram
  private readonly triangle: FullscreenTriangle
  private readonly textureSampler: WebGLUniformLocation | null

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.program = GL.createProgram(gl, FULLSCREEN_VERTEX_SHADER, COPY_FRAGMENT_SHADER)
    this.triangle = new FullscreenTriangle(gl, this.program)
    this.textureSampler = GL.getUniformLocation(gl, this.program, 'uTexture')
  }

  public render(texture: WebGLTexture) {
    const gl = this.gl
    gl.useProgram(this.program)
    gl.disable(gl.DEPTH_TEST)
    gl.disable(gl.BLEND)
    GL.bindTextureSampler(gl, this.textureSampler, UI_TEXTURE_UNITS.scene, gl.TEXTURE_2D, texture)
    this.triangle.draw(gl)
  }

  public dispose() {
    this.gl.deleteProgram(this.program)
    this.triangle.dispose(this.gl)
  }
}
