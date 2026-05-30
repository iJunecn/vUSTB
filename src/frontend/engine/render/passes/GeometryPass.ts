import { GL } from '@render/utils/gl'
import { GBuffer } from '@render/core/buffer/GBuffer'
import type { IRenderBackend, RenderQueue } from '@render/backend/IRenderBackend'
import { MODEL_STANDARD_INSTANCED_LAYOUT_ID } from '@render/layout/BuiltinLayouts'
import {
  matchesEntityPipelineContract,
  matchesTerrainPipelineContract,
} from '@render/backend/PipelineContracts'
import { WebGL2PipelineLibrary } from '@render/backend/webgl2/WebGL2PipelineLibrary'
import { GEOMETRY_TEXTURE_UNITS } from '@render/bindings/TextureUnits'
import {
  applyCharacterAnimationUniforms,
  applyGeometryMaterialUniforms,
  bindSurfaceTextureSet,
  clearSurfaceTextureSet,
} from '@render/bindings/MaterialBindings'
import { type RuntimeDebugState } from '@/engine/debug/runtimeDebug'
import vsh from '@shaders/terrain/geometry.vsh'
import fsh from '@shaders/common/geometry.fsh'
import characterCutoutVsh from '@shaders/entity/character_geometry.vsh'
import characterCutoutFsh from '@shaders/entity/character_geometry.fsh'
import { injectShaderDefine } from '@render/utils/shaderDefines'

const GEOMETRY_OPAQUE_FSH = injectShaderDefine(fsh, 'GEOMETRY_ALPHA_TEST', false)
const GEOMETRY_CUTOUT_FSH = injectShaderDefine(fsh, 'GEOMETRY_ALPHA_TEST', true)

const GEOMETRY_UNIFORM_NAMES = [
  'uModel',
  'uBaseColor',
  'uRoughness',
  'uMetallic',
  'uTextureArray',
  'uNormalArray',
  'uSpecularArray',
  'uVariantLUT',
  'uHasSpecularMap',
  'uHasNormalMap',
  'uHasTexture',
  'uAlphaCutoff',
  'uNormalScale',
  'uParallaxDepth',
  'uEnableParallaxSelfShadow',
  'uWriteLinearDepth',
  'uCameraFar',
  'uShowDebugBorders',
  'uShowLightNumbers',
  'uShowVariantIndices',
  'uDebugCutout',
  'uCharacterAnimation',
  'uSkinIndex',
  'uUseInstanceData',
] as const

/**
 * 几何阶段 G-Buffer 写入 Pass。
 *
 * 负责执行延迟渲染架构中的几何阶段，将场景中的不透明几何体渲染到 G-Buffer
 * 的 Albedo, Normal, PBR, Depth 附件。支持标准材质、Alpha Cutout 以及实体渲染。
 *
 * 仅处理不透明与 Cutout 几何；半透明物体在 ForwardPass 处理。
 */
export class GeometryPass {
  public program: WebGLProgram
  public readonly cutoutProgram: WebGLProgram
  public readonly entityCutoutProgram: WebGLProgram
  private gl: WebGL2RenderingContext
  private fallbackVariantLUT: WebGLTexture
  private readonly pipelineLibrary = new WebGL2PipelineLibrary()
  private readonly opaqueUniforms: ReturnType<typeof GL.getUniformLocations>
  private readonly cutoutUniforms: ReturnType<typeof GL.getUniformLocations>
  private readonly entityCutoutUniforms: ReturnType<typeof GL.getUniformLocations>

  public get programs(): readonly WebGLProgram[] {
    return this.pipelineLibrary.listVariantPrograms()
  }

  /**
   * 创建几何阶段 Pass。
   * @param gl WebGL2 上下文
   */
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.program = GL.createProgram(gl, vsh, GEOMETRY_OPAQUE_FSH)
    this.cutoutProgram = GL.createProgram(gl, vsh, GEOMETRY_CUTOUT_FSH)
    this.entityCutoutProgram = GL.createProgram(gl, characterCutoutVsh, characterCutoutFsh)
    this.opaqueUniforms = GL.getUniformLocations(gl, this.program, GEOMETRY_UNIFORM_NAMES)
    this.cutoutUniforms = GL.getUniformLocations(gl, this.cutoutProgram, GEOMETRY_UNIFORM_NAMES)
    this.entityCutoutUniforms = GL.getUniformLocations(
      gl,
      this.entityCutoutProgram,
      GEOMETRY_UNIFORM_NAMES,
    )
    this.pipelineLibrary.registerVariant({
      id: 'terrain.geometry.deferred.opaque',
      program: this.program,
      uniforms: this.opaqueUniforms,
      matches: key => matchesTerrainPipelineContract(key, 'deferredOpaque'),
      applyState: (stateGl, context) => {
        const reverseZ = context?.useReverseZ === true
        const zPrepass = context?.useZPrepass === true
        stateGl.enable(stateGl.DEPTH_TEST)
        stateGl.depthFunc(reverseZ ? stateGl.GEQUAL : stateGl.LEQUAL)
        stateGl.depthMask(!zPrepass)
        stateGl.enable(stateGl.CULL_FACE)
        stateGl.disable(stateGl.BLEND)
        stateGl.disable(stateGl.POLYGON_OFFSET_FILL)
      },
    })
    this.pipelineLibrary.registerVariant({
      id: 'terrain.geometry.deferred.cutout',
      program: this.cutoutProgram,
      uniforms: this.cutoutUniforms,
      matches: key => matchesTerrainPipelineContract(key, 'deferredCutout'),
      applyState: (stateGl, context) => {
        const reverseZ = context?.useReverseZ === true
        const zPrepass = context?.useZPrepass === true
        stateGl.enable(stateGl.DEPTH_TEST)
        stateGl.depthFunc(reverseZ ? stateGl.GEQUAL : stateGl.LEQUAL)
        stateGl.depthMask(!zPrepass)
        stateGl.enable(stateGl.CULL_FACE)
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
      id: 'entity.geometry.deferred.cutout',
      program: this.entityCutoutProgram,
      uniforms: this.entityCutoutUniforms,
      matches: key => matchesEntityPipelineContract(key, 'deferredCutout'),
      applyState: (stateGl, context) => {
        const reverseZ = context?.useReverseZ === true
        const zPrepass = context?.useZPrepass === true
        stateGl.enable(stateGl.DEPTH_TEST)
        stateGl.depthFunc(reverseZ ? stateGl.GEQUAL : stateGl.LEQUAL)
        stateGl.depthMask(!zPrepass)
        stateGl.enable(stateGl.CULL_FACE)
        stateGl.disable(stateGl.BLEND)
        stateGl.enable(stateGl.POLYGON_OFFSET_FILL)
        if (reverseZ) {
          stateGl.polygonOffset(2.0, 2.0)
        } else {
          stateGl.polygonOffset(-2.0, -2.0)
        }
      },
    })

    // Fallback 1x1 LUT so sampler2D always has a valid TEXTURE_2D binding.
    // This prevents undefined behavior when uVariantLUT is sampled but the real LUT failed to load.
    const fallback = gl.createTexture()
    if (!fallback) throw new Error('Failed to create fallback Variant LUT texture')
    this.fallbackVariantLUT = fallback
    gl.bindTexture(gl.TEXTURE_2D, this.fallbackVariantLUT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 0]),
    )
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  /** 释放 GPU 资源。 */
  dispose() {
    this.gl.deleteProgram(this.program)
    this.gl.deleteProgram(this.cutoutProgram)
    this.gl.deleteProgram(this.entityCutoutProgram)
    this.gl.deleteTexture(this.fallbackVariantLUT)
  }

  private bindSharedState(
    gl: WebGL2RenderingContext,
    uniforms: ReturnType<typeof GL.getUniformLocations>,
    gBuffer: GBuffer,
    normalScale: number,
    parallaxDepth: number,
    cameraFar: number | undefined,
    debugState: RuntimeDebugState,
  ) {
    if (uniforms.uBaseColor) gl.uniform3f(uniforms.uBaseColor, 1.0, 1.0, 1.0)
    if (uniforms.uRoughness) gl.uniform1f(uniforms.uRoughness, 1.0)
    if (uniforms.uMetallic) gl.uniform1f(uniforms.uMetallic, 0.0)
    if (uniforms.uShowDebugBorders) {
      gl.uniform1f(uniforms.uShowDebugBorders, debugState.showMeshBorders ? 1.0 : 0.0)
    }
    if (uniforms.uShowLightNumbers) {
      gl.uniform1f(uniforms.uShowLightNumbers, debugState.showLightNumbers ? 1.0 : 0.0)
    }
    if (uniforms.uShowVariantIndices) {
      gl.uniform1f(uniforms.uShowVariantIndices, debugState.showVariantIndices ? 1.0 : 0.0)
    }
    if (uniforms.uParallaxDepth) gl.uniform1f(uniforms.uParallaxDepth, parallaxDepth)
    if (uniforms.uEnableParallaxSelfShadow) gl.uniform1f(uniforms.uEnableParallaxSelfShadow, 0.0)
    if (uniforms.uWriteLinearDepth) {
      gl.uniform1i(uniforms.uWriteLinearDepth, gBuffer.linearDepth ? 1 : 0)
    }
    if (uniforms.uCameraFar) gl.uniform1f(uniforms.uCameraFar, cameraFar ?? 1.0)
    if (uniforms.uNormalScale) gl.uniform1f(uniforms.uNormalScale, normalScale)
  }

  /**
   * 执行几何阶段渲染。
   * @param gBuffer G-Buffer 对象，包含多渲染目标与深度附件
   * @param textureArray 基础颜色纹理数组
   * @param normalArray 法线纹理数组
   * @param specularArray 高光或 PBR 参数纹理数组
   * @param normalScale 法线纹理缩放因子
   */
  render(
    gBuffer: GBuffer,
    textureArray: WebGLTexture | null,
    normalArray: WebGLTexture | null,
    specularArray: WebGLTexture | null,
    normalScale: number = 1.0,
    parallaxDepth: number = 0.0,
    cameraFar?: number,
    debugState: RuntimeDebugState = {
      showMeshBorders: false,
      showLightNumbers: false,
      showCutoutDebug: false,
      showVariantIndices: false,
    },
    variantLUT: WebGLTexture | null = null, // Add Variant LUT parameter
    useReverseZ: boolean = false,
    useZPrepass: boolean = false,
    terrainGeometryQueue: RenderQueue | null = null,
    backend: IRenderBackend | null = null,
    backendFrameId: number = 0,
  ) {
    const gl = this.gl

    // 绑定 G-Buffer FBO，准备写入多渲染目标。
    gl.bindFramebuffer(gl.FRAMEBUFFER, gBuffer.fbo)
    gl.viewport(0, 0, gBuffer.width, gBuffer.height)
    gl.drawBuffers([
      gl.COLOR_ATTACHMENT0,
      gl.COLOR_ATTACHMENT1,
      gl.COLOR_ATTACHMENT2,
      ...(gBuffer.linearDepth ? [gl.COLOR_ATTACHMENT3] : []),
    ])

    // 清空颜色附件与深度缓冲。
    gl.clearColor(0.0, 0.0, 0.0, 0.0)
    // If Z-Prepass is used, we DO NOT clear depth here, as it was filled by prepass.
    if (!useZPrepass) {
      gl.clearDepth(useReverseZ ? 0.0 : 1.0)
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    } else {
      // Only clear color, keep depth from prepass
      gl.clear(gl.COLOR_BUFFER_BIT)
    }

    // For the optional linearDepth RG8 attachment, clear to 1.0 (encoded far) so sky pixels behave like depth==1.
    if (gBuffer.linearDepth) {
      gl.clearBufferfv(gl.COLOR, 3, [1.0, 1.0, 0.0, 0.0])
    }

    if (terrainGeometryQueue && backend) {
      const opaquePipeline = this.pipelineLibrary.useVariant<typeof this.opaqueUniforms>(
        gl,
        'terrain.geometry.deferred.opaque',
        { useReverseZ, useZPrepass },
      )
      const uniforms = opaquePipeline.uniforms
      this.bindSharedState(gl, uniforms, gBuffer, normalScale, parallaxDepth, cameraFar, debugState)
      bindSurfaceTextureSet(gl, uniforms, GEOMETRY_TEXTURE_UNITS, {
        albedoArray: textureArray,
        normalArray,
        specularArray,
        variantLut: variantLUT ?? this.fallbackVariantLUT,
      })

      backend.executeQueue(terrainGeometryQueue, {
        frameId: backendFrameId,
        beforeBucket: bucket => this.pipelineLibrary.matchesVariant(bucket.key, opaquePipeline.id),
        beforeObject: object => {
          const colorConstant = object.material.constants?.color
          applyGeometryMaterialUniforms(gl, uniforms, {
            modelMatrix: object.transform,
            color:
              colorConstant instanceof Float32Array || Array.isArray(colorConstant)
                ? colorConstant
                : null,
            roughness:
              typeof object.material.constants?.roughness === 'number'
                ? object.material.constants.roughness
                : undefined,
            metallic:
              typeof object.material.constants?.metallic === 'number'
                ? object.material.constants.metallic
                : undefined,
            debugCutout: false,
            alphaCutoff: 0.0,
          })
        },
      })

      clearSurfaceTextureSet(gl, GEOMETRY_TEXTURE_UNITS, {
        albedoArray: textureArray,
        normalArray,
        specularArray,
        variantLut: variantLUT ?? this.fallbackVariantLUT,
      })
    }

    if (terrainGeometryQueue && backend) {
      const cutoutPipeline = this.pipelineLibrary.useVariant<typeof this.cutoutUniforms>(
        gl,
        'terrain.geometry.deferred.cutout',
        { useReverseZ, useZPrepass },
      )
      const uniforms = cutoutPipeline.uniforms
      this.bindSharedState(gl, uniforms, gBuffer, normalScale, parallaxDepth, cameraFar, debugState)
      bindSurfaceTextureSet(gl, uniforms, GEOMETRY_TEXTURE_UNITS, {
        albedoArray: textureArray,
        normalArray,
        specularArray,
        variantLut: variantLUT ?? this.fallbackVariantLUT,
      })

      backend.executeQueue(terrainGeometryQueue, {
        frameId: backendFrameId,
        beforeBucket: bucket => this.pipelineLibrary.matchesVariant(bucket.key, cutoutPipeline.id),
        beforeObject: object => {
          if (!object.mainViewVisible) {
            return false
          }

          const colorConstant = object.material.constants?.color
          applyGeometryMaterialUniforms(gl, uniforms, {
            modelMatrix: object.transform,
            color:
              colorConstant instanceof Float32Array || Array.isArray(colorConstant)
                ? colorConstant
                : null,
            roughness:
              typeof object.material.constants?.roughness === 'number'
                ? object.material.constants.roughness
                : undefined,
            metallic:
              typeof object.material.constants?.metallic === 'number'
                ? object.material.constants.metallic
                : undefined,
            debugCutout: debugState.showCutoutDebug,
            alphaCutoff: 0.5,
          })
        },
      })

      clearSurfaceTextureSet(gl, GEOMETRY_TEXTURE_UNITS, {
        albedoArray: textureArray,
        normalArray,
        specularArray,
        variantLut: variantLUT ?? this.fallbackVariantLUT,
      })
    }

    if (terrainGeometryQueue && backend) {
      const entityCutoutPipeline = this.pipelineLibrary.useVariant<
        typeof this.entityCutoutUniforms
      >(gl, 'entity.geometry.deferred.cutout', { useReverseZ, useZPrepass })
      const uniforms = entityCutoutPipeline.uniforms
      this.bindSharedState(gl, uniforms, gBuffer, normalScale, parallaxDepth, cameraFar, debugState)

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
          const colorConstant = object.material.constants?.color
          const animationConstant = object.material.constants?.animation
          applyGeometryMaterialUniforms(gl, uniforms, {
            modelMatrix: usesInstanceData ? undefined : object.transform,
            color:
              colorConstant instanceof Float32Array || Array.isArray(colorConstant)
                ? colorConstant
                : null,
            roughness:
              typeof object.material.constants?.roughness === 'number'
                ? object.material.constants.roughness
                : undefined,
            metallic:
              typeof object.material.constants?.metallic === 'number'
                ? object.material.constants.metallic
                : undefined,
            debugCutout: false,
            alphaCutoff: 0.5,
          })
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

    // 解除 G-Buffer FBO 绑定，恢复默认帧缓冲。
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }
}
