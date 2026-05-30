import { GL } from '@render/utils/gl'
import type { IRenderBackend, RenderQueue } from '@render/backend/IRenderBackend'
import { MODEL_STANDARD_INSTANCED_LAYOUT_ID } from '@render/layout/BuiltinLayouts'
import {
  matchesEntityPipelineContract,
  matchesTerrainPipelineContract,
} from '@render/backend/PipelineContracts'
import { WebGL2PipelineLibrary } from '@render/backend/webgl2/WebGL2PipelineLibrary'
import { applyCharacterAnimationUniforms } from '@render/bindings/MaterialBindings'
import vsh from '@shaders/terrain/shadow.vsh'
import fsh from '@shaders/common/shadow.fsh'
import characterCutoutVsh from '@shaders/entity/character_shadow.vsh'
import characterCutoutFsh from '@shaders/entity/character_shadow.fsh'
import { ShadowManager } from '@render/core/lighting/ShadowManager'
import { SHADOW_TEXTURE_UNITS } from '@render/bindings/TextureUnits'
import { injectShaderDefine } from '@render/utils/shaderDefines'

const SHADOW_OPAQUE_FSH = injectShaderDefine(
  injectShaderDefine(fsh, 'SHADOW_ALPHA_TEST', false),
  'SHADOW_TRANSPARENT_COLOR',
  false,
)
const SHADOW_CUTOUT_FSH = injectShaderDefine(
  injectShaderDefine(fsh, 'SHADOW_ALPHA_TEST', true),
  'SHADOW_TRANSPARENT_COLOR',
  true,
)

const SHADOW_UNIFORM_NAMES = [
  'uLightSpaceMatrix',
  'uModel',
  'uTextureArray',
  'uHasTexture',
  'uIsTransparent',
  'uCharacterAnimation',
  'uSkinIndex',
  'uUseInstanceData',
] as const

/**
 * 级联阴影 (CSM) 生成 Pass。
 *
 * 负责从光源视角渲染深度贴图，支持 3–4 级级联阴影。
 * 处理 opaque、cutout 与半透明阴影路径，通过 polygon offset 与背面剪裁降低 shadow acne。
 */
export class ShadowPass {
  private program: WebGLProgram
  private readonly cutoutProgram: WebGLProgram
  private readonly entityCutoutProgram: WebGLProgram
  private gl: WebGL2RenderingContext
  private readonly pipelineLibrary = new WebGL2PipelineLibrary()
  public shadowManager: ShadowManager
  private readonly opaqueUniforms: ReturnType<typeof GL.getUniformLocations>
  private readonly cutoutUniforms: ReturnType<typeof GL.getUniformLocations>
  private readonly entityCutoutUniforms: ReturnType<typeof GL.getUniformLocations>

  /**
   * 创建阴影阶段 Pass。
   * @param gl WebGL2 上下文
   * @param resolution 阴影贴图分辨率
   */
  constructor(gl: WebGL2RenderingContext, resolution: number = 2048, cascadeCount: number = 3) {
    this.gl = gl
    this.program = GL.createProgram(gl, vsh, SHADOW_OPAQUE_FSH)
    this.cutoutProgram = GL.createProgram(gl, vsh, SHADOW_CUTOUT_FSH)
    this.entityCutoutProgram = GL.createProgram(gl, characterCutoutVsh, characterCutoutFsh)
    this.shadowManager = new ShadowManager(gl, resolution, cascadeCount)
    this.opaqueUniforms = GL.getUniformLocations(gl, this.program, SHADOW_UNIFORM_NAMES)
    this.cutoutUniforms = GL.getUniformLocations(gl, this.cutoutProgram, SHADOW_UNIFORM_NAMES)
    this.entityCutoutUniforms = GL.getUniformLocations(
      gl,
      this.entityCutoutProgram,
      SHADOW_UNIFORM_NAMES,
    )
    this.pipelineLibrary.registerVariant({
      id: 'terrain.shadow.deferred.opaque',
      program: this.program,
      uniforms: this.opaqueUniforms,
      matches: key => matchesTerrainPipelineContract(key, 'deferredOpaque'),
      applyState: (stateGl, context) => {
        const cascadeIndex = Number(context?.cascadeIndex ?? 0)
        stateGl.enable(stateGl.DEPTH_TEST)
        stateGl.depthFunc(stateGl.LEQUAL)
        stateGl.enable(stateGl.CULL_FACE)
        stateGl.cullFace(stateGl.BACK)
        stateGl.enable(stateGl.POLYGON_OFFSET_FILL)
        stateGl.polygonOffset(2.0, 4.0)
        stateGl.depthMask(true)
        stateGl.disable(stateGl.BLEND)
        stateGl.colorMask(
          cascadeIndex === 0,
          cascadeIndex === 0,
          cascadeIndex === 0,
          cascadeIndex === 0,
        )
      },
    })
    this.pipelineLibrary.registerVariant({
      id: 'terrain.shadow.deferred.cutout',
      program: this.cutoutProgram,
      uniforms: this.cutoutUniforms,
      matches: key => matchesTerrainPipelineContract(key, 'deferredCutout'),
      applyState: (stateGl, context) => {
        const cascadeIndex = Number(context?.cascadeIndex ?? 0)
        stateGl.enable(stateGl.DEPTH_TEST)
        stateGl.depthFunc(stateGl.LEQUAL)
        stateGl.enable(stateGl.CULL_FACE)
        stateGl.cullFace(stateGl.BACK)
        stateGl.enable(stateGl.POLYGON_OFFSET_FILL)
        stateGl.polygonOffset(2.0, 4.0)
        stateGl.depthMask(true)
        stateGl.disable(stateGl.BLEND)
        stateGl.colorMask(
          cascadeIndex === 0,
          cascadeIndex === 0,
          cascadeIndex === 0,
          cascadeIndex === 0,
        )
      },
    })
    this.pipelineLibrary.registerVariant({
      id: 'terrain.shadow.forward.translucent',
      program: this.cutoutProgram,
      uniforms: this.cutoutUniforms,
      matches: key => matchesTerrainPipelineContract(key, 'forwardTranslucent'),
      applyState: stateGl => {
        stateGl.enable(stateGl.DEPTH_TEST)
        stateGl.depthFunc(stateGl.LEQUAL)
        stateGl.enable(stateGl.CULL_FACE)
        stateGl.cullFace(stateGl.BACK)
        stateGl.enable(stateGl.POLYGON_OFFSET_FILL)
        stateGl.polygonOffset(2.0, 4.0)
        stateGl.depthMask(false)
        stateGl.enable(stateGl.BLEND)
        stateGl.blendFunc(stateGl.ONE, stateGl.ONE)
        stateGl.colorMask(true, true, true, true)
      },
    })
    this.pipelineLibrary.registerVariant({
      id: 'entity.shadow.deferred.cutout',
      program: this.entityCutoutProgram,
      uniforms: this.entityCutoutUniforms,
      matches: key => matchesEntityPipelineContract(key, 'deferredCutout'),
      applyState: (stateGl, context) => {
        const cascadeIndex = Number(context?.cascadeIndex ?? 0)
        stateGl.enable(stateGl.DEPTH_TEST)
        stateGl.depthFunc(stateGl.LEQUAL)
        stateGl.enable(stateGl.CULL_FACE)
        stateGl.cullFace(stateGl.BACK)
        stateGl.enable(stateGl.POLYGON_OFFSET_FILL)
        stateGl.polygonOffset(2.0, 4.0)
        stateGl.depthMask(true)
        stateGl.disable(stateGl.BLEND)
        stateGl.colorMask(
          cascadeIndex === 0,
          cascadeIndex === 0,
          cascadeIndex === 0,
          cascadeIndex === 0,
        )
      },
    })
  }

  get shadowMap() {
    return this.shadowManager.shadowMap
  }

  get shadowColorMap() {
    return this.shadowManager.shadowColorMap
  }

  get cascadeCount() {
    return this.shadowManager.cascadeCount
  }

  /** 释放 GPU 资源。 */
  dispose() {
    this.gl.deleteProgram(this.program)
    this.gl.deleteProgram(this.cutoutProgram)
    this.gl.deleteProgram(this.entityCutoutProgram)
    this.shadowManager.dispose()
  }

  private bindTexturedShadowState(
    textureArray: WebGLTexture | null,
    isTransparent: boolean,
    cascadeIndex: number,
  ) {
    const gl = this.gl
    const variantId = isTransparent
      ? 'terrain.shadow.forward.translucent'
      : 'terrain.shadow.deferred.cutout'
    const pipeline = this.pipelineLibrary.useVariant<typeof this.cutoutUniforms>(gl, variantId, {
      cascadeIndex,
    })
    const uniforms = pipeline.uniforms

    if (textureArray) {
      GL.bindTextureSampler(
        gl,
        uniforms.uTextureArray,
        SHADOW_TEXTURE_UNITS.albedoArray,
        gl.TEXTURE_2D_ARRAY,
        textureArray,
      )
      if (uniforms.uHasTexture) gl.uniform1i(uniforms.uHasTexture, 1)
    } else {
      if (uniforms.uHasTexture) gl.uniform1i(uniforms.uHasTexture, 0)
    }

    if (uniforms.uIsTransparent) gl.uniform1i(uniforms.uIsTransparent, isTransparent ? 1 : 0)
    return uniforms
  }

  /**
   * 执行阴影阶段渲染。
   * @param lightSpaceMatrices 级联阴影矩阵数组
   * @param textureArray 基础颜色纹理数组，用于 alpha test
   */
  render(
    lightSpaceMatrices: Float32Array[],
    textureArray: WebGLTexture | null,
    terrainGeometryQueue: RenderQueue | null = null,
    terrainForwardQueue: RenderQueue | null = null,
    backend: IRenderBackend | null = null,
    backendFrameId: number = 0,
  ) {
    const gl = this.gl

    this.shadowManager.frameBuffer.bind()
    gl.viewport(0, 0, this.shadowManager.resolution, this.shadowManager.resolution)

    // 遍历全部级联层级。
    for (let i = 0; i < this.shadowManager.cascadeCount; i++) {
      this.shadowManager.frameBuffer.bind()

      // 绑定当前级联层级的贴图层。
      this.shadowManager.frameBuffer.attachTextureLayer(
        this.shadowManager.shadowMap,
        gl.DEPTH_ATTACHMENT,
        i,
      )
      this.shadowManager.frameBuffer.attachTextureLayer(
        this.shadowManager.shadowColorMap,
        gl.COLOR_ATTACHMENT0,
        i,
      )

      // `attachTextureLayer` 可能改变当前 FBO 绑定状态，这里重新 bind。
      this.shadowManager.frameBuffer.bind()

      if (i === 0) {
        gl.drawBuffers([gl.COLOR_ATTACHMENT0])
      } else {
        gl.drawBuffers([gl.COLOR_ATTACHMENT0])
      }

      // Each cascade may inherit write masks from the previous pass.
      // Restore them before clearing the newly attached layer, otherwise
      // cascade 1/2 can keep undefined depth and collapse into full shadow.
      gl.depthMask(true)
      gl.colorMask(true, true, true, true)

      // 清空深度与颜色附件。
      // 颜色缓冲初始化为黑色，表示当前层级没有额外吸收信息。
      gl.clearColor(0.0, 0.0, 0.0, 0.0)
      gl.clearDepth(1.0)
      gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT)

      const opaquePipeline = this.pipelineLibrary.useVariant<typeof this.opaqueUniforms>(
        gl,
        'terrain.shadow.deferred.opaque',
        { cascadeIndex: i },
      )
      if (opaquePipeline.uniforms.uLightSpaceMatrix) {
        gl.uniformMatrix4fv(opaquePipeline.uniforms.uLightSpaceMatrix, false, lightSpaceMatrices[i])
      }

      if (terrainGeometryQueue && backend) {
        backend.executeQueue(terrainGeometryQueue, {
          frameId: backendFrameId,
          beforeBucket: bucket =>
            this.pipelineLibrary.matchesVariant(bucket.key, opaquePipeline.id),
          beforeObject: object => {
            if (!object.castShadow || object.transparent) {
              return false
            }

            if (opaquePipeline.uniforms.uModel)
              gl.uniformMatrix4fv(opaquePipeline.uniforms.uModel, false, object.transform)
          },
        })
      }

      const cutoutUniforms = this.bindTexturedShadowState(textureArray, false, i)
      if (cutoutUniforms.uLightSpaceMatrix) {
        gl.uniformMatrix4fv(cutoutUniforms.uLightSpaceMatrix, false, lightSpaceMatrices[i])
      }
      if (terrainGeometryQueue && backend) {
        backend.executeQueue(terrainGeometryQueue, {
          frameId: backendFrameId,
          beforeBucket: bucket =>
            this.pipelineLibrary.matchesVariant(bucket.key, 'terrain.shadow.deferred.cutout'),
          beforeObject: object => {
            if (!object.castShadow || object.transparent) {
              return false
            }

            if (cutoutUniforms.uModel)
              gl.uniformMatrix4fv(cutoutUniforms.uModel, false, object.transform)
          },
        })
      }
      const transparentUniforms = this.bindTexturedShadowState(textureArray, true, i)
      if (transparentUniforms.uLightSpaceMatrix) {
        gl.uniformMatrix4fv(transparentUniforms.uLightSpaceMatrix, false, lightSpaceMatrices[i])
      }
      if (terrainForwardQueue && backend) {
        backend.executeQueue(terrainForwardQueue, {
          frameId: backendFrameId,
          beforeBucket: bucket =>
            this.pipelineLibrary.matchesVariant(bucket.key, 'terrain.shadow.forward.translucent'),
          beforeObject: object => {
            if (!object.castShadow) {
              return false
            }

            if (object.material.doubleSided) {
              gl.disable(gl.CULL_FACE)
            } else {
              gl.enable(gl.CULL_FACE)
            }

            if (transparentUniforms.uModel)
              gl.uniformMatrix4fv(transparentUniforms.uModel, false, object.transform)
          },
        })
      }

      const entityCutoutPipeline = this.pipelineLibrary.useVariant<
        typeof this.entityCutoutUniforms
      >(gl, 'entity.shadow.deferred.cutout', { cascadeIndex: i })
      if (entityCutoutPipeline.uniforms.uLightSpaceMatrix) {
        gl.uniformMatrix4fv(
          entityCutoutPipeline.uniforms.uLightSpaceMatrix,
          false,
          lightSpaceMatrices[i],
        )
      }
      if (terrainGeometryQueue && backend) {
        backend.executeQueue(terrainGeometryQueue, {
          frameId: backendFrameId,
          beforeBucket: bucket => {
            const matches = this.pipelineLibrary.matchesVariant(bucket.key, entityCutoutPipeline.id)
            if (matches && entityCutoutPipeline.uniforms.uUseInstanceData) {
              gl.uniform1i(
                entityCutoutPipeline.uniforms.uUseInstanceData,
                bucket.key.layoutId === MODEL_STANDARD_INSTANCED_LAYOUT_ID ? 1 : 0,
              )
            }
            return matches
          },
          beforeObject: object => {
            const usesInstanceData = object.geometry.layoutId === MODEL_STANDARD_INSTANCED_LAYOUT_ID
            if (!object.castShadow || object.transparent) {
              return false
            }

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
              entityCutoutPipeline.uniforms.uTextureArray,
              SHADOW_TEXTURE_UNITS.albedoArray,
              gl.TEXTURE_2D_ARRAY,
              albedoTextureArray,
            )
            if (entityCutoutPipeline.uniforms.uHasTexture) {
              gl.uniform1i(entityCutoutPipeline.uniforms.uHasTexture, 1)
            }
            if (entityCutoutPipeline.uniforms.uSkinIndex) {
              const skinIndex = object.material.constants?.skinIndex
              gl.uniform1f(
                entityCutoutPipeline.uniforms.uSkinIndex,
                typeof skinIndex === 'number' ? skinIndex : 0,
              )
            }

            if (!usesInstanceData && entityCutoutPipeline.uniforms.uModel) {
              gl.uniformMatrix4fv(entityCutoutPipeline.uniforms.uModel, false, object.transform)
            }
            const animationConstant = object.material.constants?.animation
            applyCharacterAnimationUniforms(
              gl,
              entityCutoutPipeline.uniforms,
              !usesInstanceData &&
                (animationConstant instanceof Float32Array || Array.isArray(animationConstant))
                ? animationConstant
                : null,
            )
          },
        })
        GL.clearTextureUnit(gl, SHADOW_TEXTURE_UNITS.albedoArray, gl.TEXTURE_2D_ARRAY)
      }
    }

    gl.disable(gl.POLYGON_OFFSET_FILL)
    gl.depthMask(true)
    gl.colorMask(true, true, true, true)
    gl.disable(gl.BLEND)
    if (textureArray) {
      GL.clearTextureUnit(gl, SHADOW_TEXTURE_UNITS.albedoArray, gl.TEXTURE_2D_ARRAY)
    }
    this.shadowManager.frameBuffer.unbind()
  }
}
