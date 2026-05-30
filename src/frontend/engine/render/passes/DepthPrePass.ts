import { GL } from '@render/utils/gl'
import { FrameBuffer } from '@render/core/buffer/FrameBuffer'
import type { IRenderBackend, RenderQueue } from '@render/backend/IRenderBackend'
import { MODEL_STANDARD_INSTANCED_LAYOUT_ID } from '@render/layout/BuiltinLayouts'
import { applyCharacterAnimationUniforms } from '@render/bindings/MaterialBindings'
import {
  matchesEntityPipelineContract,
  matchesTerrainPipelineContract,
} from '@render/backend/PipelineContracts'
import { GEOMETRY_TEXTURE_UNITS } from '@render/bindings/TextureUnits'
import { WebGL2PipelineLibrary } from '@render/backend/webgl2/WebGL2PipelineLibrary'
import vsh from '@shaders/terrain/depth_prepass.vsh'
import fsh from '@shaders/common/depth_prepass.fsh'
import characterCutoutVsh from '@shaders/entity/character_depth_prepass.vsh'
import characterCutoutFsh from '@shaders/entity/character_depth_prepass.fsh'
import { injectShaderDefine } from '@render/utils/shaderDefines'

const DEPTH_PREPASS_OPAQUE_FSH = injectShaderDefine(fsh, 'DEPTH_PREPASS_ALPHA_TEST', false)
const DEPTH_PREPASS_CUTOUT_FSH = injectShaderDefine(fsh, 'DEPTH_PREPASS_ALPHA_TEST', true)

const DEPTH_PREPASS_UNIFORM_NAMES = [
  'uTextureArray',
  'uHasTexture',
  'uModel',
  'uCharacterAnimation',
  'uSkinIndex',
  'uUseInstanceData',
] as const

/**
 * 深度预写 Pass (Z-Prepass)。
 *
 * 仅写入深度，不输出颜色附件。使用轻量 Shader 提前建立稳定深度缓冲，
 * 为后续 GeometryPass 降低 overdraw 压力。
 */
export class DepthPrePass {
  public program: WebGLProgram
  public readonly cutoutProgram: WebGLProgram
  public readonly entityCutoutProgram: WebGLProgram
  private gl: WebGL2RenderingContext
  private readonly pipelineLibrary = new WebGL2PipelineLibrary()
  private readonly opaqueUniforms: ReturnType<typeof GL.getUniformLocations>
  private readonly cutoutUniforms: ReturnType<typeof GL.getUniformLocations>
  private readonly entityCutoutUniforms: ReturnType<typeof GL.getUniformLocations>

  public get programs(): readonly WebGLProgram[] {
    return this.pipelineLibrary.listVariantPrograms()
  }

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.program = GL.createProgram(gl, vsh, DEPTH_PREPASS_OPAQUE_FSH)
    this.cutoutProgram = GL.createProgram(gl, vsh, DEPTH_PREPASS_CUTOUT_FSH)
    this.entityCutoutProgram = GL.createProgram(gl, characterCutoutVsh, characterCutoutFsh)
    this.opaqueUniforms = GL.getUniformLocations(gl, this.program, DEPTH_PREPASS_UNIFORM_NAMES)
    this.cutoutUniforms = GL.getUniformLocations(
      gl,
      this.cutoutProgram,
      DEPTH_PREPASS_UNIFORM_NAMES,
    )
    this.entityCutoutUniforms = GL.getUniformLocations(
      gl,
      this.entityCutoutProgram,
      DEPTH_PREPASS_UNIFORM_NAMES,
    )
    this.pipelineLibrary.registerVariant({
      id: 'terrain.depth-prepass.deferred.opaque',
      program: this.program,
      uniforms: this.opaqueUniforms,
      matches: key => matchesTerrainPipelineContract(key, 'deferredOpaque'),
      applyState: (stateGl, context) => {
        const reverseZ = context?.useReverseZ === true
        stateGl.colorMask(false, false, false, false)
        stateGl.depthMask(true)
        stateGl.depthFunc(reverseZ ? stateGl.GEQUAL : stateGl.LEQUAL)
        stateGl.enable(stateGl.CULL_FACE)
        stateGl.cullFace(stateGl.BACK)
        stateGl.disable(stateGl.BLEND)
        stateGl.disable(stateGl.POLYGON_OFFSET_FILL)
      },
    })
    this.pipelineLibrary.registerVariant({
      id: 'terrain.depth-prepass.deferred.cutout',
      program: this.cutoutProgram,
      uniforms: this.cutoutUniforms,
      matches: key => matchesTerrainPipelineContract(key, 'deferredCutout'),
      applyState: (stateGl, context) => {
        const reverseZ = context?.useReverseZ === true
        stateGl.colorMask(false, false, false, false)
        stateGl.depthMask(true)
        stateGl.depthFunc(reverseZ ? stateGl.GEQUAL : stateGl.LEQUAL)
        stateGl.enable(stateGl.CULL_FACE)
        stateGl.cullFace(stateGl.BACK)
        stateGl.disable(stateGl.BLEND)
        stateGl.enable(stateGl.POLYGON_OFFSET_FILL)
        if (reverseZ) {
          stateGl.polygonOffset(2.0, 2.0)
        } else {
          stateGl.polygonOffset(-2.0, -2.0)
        }
      },
    })
    this.pipelineLibrary.registerVariant({
      id: 'entity.depth-prepass.deferred.cutout',
      program: this.entityCutoutProgram,
      uniforms: this.entityCutoutUniforms,
      matches: key => matchesEntityPipelineContract(key, 'deferredCutout'),
      applyState: (stateGl, context) => {
        const reverseZ = context?.useReverseZ === true
        stateGl.colorMask(false, false, false, false)
        stateGl.depthMask(true)
        stateGl.depthFunc(reverseZ ? stateGl.GEQUAL : stateGl.LEQUAL)
        stateGl.enable(stateGl.CULL_FACE)
        stateGl.cullFace(stateGl.BACK)
        stateGl.disable(stateGl.BLEND)
        stateGl.enable(stateGl.POLYGON_OFFSET_FILL)
        if (reverseZ) {
          stateGl.polygonOffset(2.0, 2.0)
        } else {
          stateGl.polygonOffset(-2.0, -2.0)
        }
      },
    })
  }

  dispose() {
    this.gl.deleteProgram(this.program)
    this.gl.deleteProgram(this.cutoutProgram)
    this.gl.deleteProgram(this.entityCutoutProgram)
  }

  /**
   * 执行深度预写阶段。
   * @param gBuffer G-Buffer 或其底层 FBO，复用深度附件
   * @param textureArray 纹理数组，用于 cutout alpha test
   */
  render(
    gBuffer: FrameBuffer | WebGLFramebuffer,
    textureArray: WebGLTexture | null,
    useReverseZ: boolean = false,
    terrainGeometryQueue: RenderQueue | null = null,
    backend: IRenderBackend | null = null,
    backendFrameId: number = 0,
  ) {
    const gl = this.gl

    // Bind FBO if provided (FrameBuffer wrapper or WebGLFramebuffer)
    if (gBuffer) {
      if ('bind' in gBuffer) {
        ;(gBuffer as FrameBuffer).bind()
      } else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, gBuffer as WebGLFramebuffer)
      }
    }

    // Opaque Items
    if (terrainGeometryQueue && backend) {
      const opaquePipeline = this.pipelineLibrary.useVariant<typeof this.opaqueUniforms>(
        gl,
        'terrain.depth-prepass.deferred.opaque',
        { useReverseZ },
      )
      const uniforms = opaquePipeline.uniforms
      backend.executeQueue(terrainGeometryQueue, {
        frameId: backendFrameId,
        beforeBucket: bucket => this.pipelineLibrary.matchesVariant(bucket.key, opaquePipeline.id),
        beforeObject: object => {
          if (uniforms.uModel) gl.uniformMatrix4fv(uniforms.uModel, false, object.transform)
        },
      })
    }

    if (terrainGeometryQueue && backend) {
      const cutoutPipeline = this.pipelineLibrary.useVariant<typeof this.cutoutUniforms>(
        gl,
        'terrain.depth-prepass.deferred.cutout',
        { useReverseZ },
      )
      const uniforms = cutoutPipeline.uniforms
      if (textureArray) {
        GL.bindTextureSampler(gl, uniforms.uTextureArray, 0, gl.TEXTURE_2D_ARRAY, textureArray)
      }

      backend.executeQueue(terrainGeometryQueue, {
        frameId: backendFrameId,
        beforeBucket: bucket => this.pipelineLibrary.matchesVariant(bucket.key, cutoutPipeline.id),
        beforeObject: object => {
          if (!object.mainViewVisible) {
            return false
          }

          if (uniforms.uModel) gl.uniformMatrix4fv(uniforms.uModel, false, object.transform)
        },
      })
    }

    if (terrainGeometryQueue && backend) {
      const entityCutoutPipeline = this.pipelineLibrary.useVariant<
        typeof this.entityCutoutUniforms
      >(gl, 'entity.depth-prepass.deferred.cutout', { useReverseZ })
      const uniforms = entityCutoutPipeline.uniforms
      backend.executeQueue(terrainGeometryQueue, {
        frameId: backendFrameId,
        beforeBucket: bucket => {
          const matches = this.pipelineLibrary.matchesVariant(bucket.key, entityCutoutPipeline.id)
          if (matches && uniforms.uUseInstanceData) {
            gl.uniform1i(
              uniforms.uUseInstanceData,
              bucket.key.layoutId === MODEL_STANDARD_INSTANCED_LAYOUT_ID ? 1 : 0,
            )
          }
          return matches
        },
        beforeObject: object => {
          if (!object.mainViewVisible) {
            return false
          }

          const usesInstanceData = object.geometry.layoutId === MODEL_STANDARD_INSTANCED_LAYOUT_ID
          if (object.material.doubleSided) {
            gl.disable(gl.CULL_FACE)
          } else {
            gl.enable(gl.CULL_FACE)
            gl.cullFace(gl.BACK)
          }
          const albedoTextureArray = object.material.resources?.albedoTextureArray2D
          if (!albedoTextureArray) {
            return false
          }
          GL.bindTextureSampler(
            gl,
            uniforms.uTextureArray,
            GEOMETRY_TEXTURE_UNITS.albedoArray,
            gl.TEXTURE_2D_ARRAY,
            albedoTextureArray,
          )
          if (uniforms.uHasTexture) {
            gl.uniform1i(uniforms.uHasTexture, 1)
          }
          if (uniforms.uSkinIndex) {
            const skinIndex = object.material.constants?.skinIndex
            gl.uniform1f(uniforms.uSkinIndex, typeof skinIndex === 'number' ? skinIndex : 0)
          }
          if (!usesInstanceData && uniforms.uModel) {
            gl.uniformMatrix4fv(uniforms.uModel, false, object.transform)
          }
          const animationConstant = object.material.constants?.animation
          applyCharacterAnimationUniforms(
            gl,
            uniforms,
            !usesInstanceData &&
              (animationConstant instanceof Float32Array || Array.isArray(animationConstant))
              ? animationConstant
              : null,
          )
        },
      })
      GL.clearTextureUnit(gl, GEOMETRY_TEXTURE_UNITS.albedoArray, gl.TEXTURE_2D_ARRAY)
    }

    if (textureArray) {
      GL.clearTextureUnit(gl, 0, gl.TEXTURE_2D_ARRAY)
    }

    // 3. Restore State
    gl.bindVertexArray(null)
    gl.colorMask(true, true, true, true)
    gl.depthMask(true)
  }
}
