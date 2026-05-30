import { GL } from '@render/utils/gl'
import type { IRenderBackend, RenderQueue } from '@render/backend/IRenderBackend'
import { matchesTerrainPipelineContract } from '@render/backend/PipelineContracts'
import { WebGL2PipelineLibrary } from '@render/backend/webgl2/WebGL2PipelineLibrary'
import vsh from '@shaders/terrain/forward.vsh'
import fsh from '@shaders/common/forward.fsh'
import wboitVsh from '@shaders/screen/wboit.vsh'
import wboitFsh from '@shaders/screen/wboit.fsh'
import { SimpleMeshFactory, type SimpleMesh } from '@render/utils/SimpleMeshFactory'
import { LightManager } from '@render/core/lighting/LightManager'
import { FORWARD_TEXTURE_UNITS } from '@render/bindings/TextureUnits'
import {
  applyForwardMaterialUniforms,
  bindSurfaceTextureSet,
  clearSurfaceTextureSet,
} from '@render/bindings/MaterialBindings'

export interface ForwardPassRenderParams {
  textureArray: WebGLTexture | null
  normalArray: WebGLTexture | null
  specularArray: WebGLTexture | null
  shadowMap: WebGLTexture
  shadowColorMap: WebGLTexture
  normalScale: number
  lightManager?: LightManager
  usePointLights?: boolean
  lightCount?: number
  useReverseZ?: boolean
  terrainForwardQueue?: RenderQueue | null
  backend?: IRenderBackend | null
  backendFrameId?: number
}

/**
 * @file ForwardPass.ts
 * @brief 前向渲染与 WBOIT 合成 Pass
 *
 * 说明：
 *  - 渲染半透明对象与前向阶段材质
 *  - 在支持时使用 WBOIT 处理半透明累积
 *  - 在不支持 WBOIT 的设备上回退到标准 alpha blending
 */
/**
 * @class ForwardPass
 * @brief 前向渲染与透明物体通道
 *
 * 说明：
 *  - 作为延迟渲染的补充，处理前向材质与透明对象
 *  - 在支持时使用 WBOIT 进行透明累积
 *  - 在不支持时回退到常规 alpha 混合
 */
export class ForwardPass {
  public program: WebGLProgram
  private wboitProgram: WebGLProgram
  private gl: WebGL2RenderingContext
  private quadMesh: SimpleMesh // 全屏四边形。
  private readonly pipelineLibrary = new WebGL2PipelineLibrary()
  public readonly isWBOITSupported: boolean
  private readonly uniforms: ReturnType<typeof GL.getUniformLocations>
  private readonly wboitUniforms: ReturnType<typeof GL.getUniformLocations>

  /**
   * 创建前向渲染 Pass。
   * @param gl WebGL2 上下文
   */
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.program = GL.createProgram(gl, vsh, fsh)

    this.wboitProgram = GL.createProgram(gl, wboitVsh, wboitFsh)
    this.uniforms = GL.getUniformLocations(gl, this.program, [
      'uHasTexture',
      'uTextureArray',
      'uNormalArray',
      'uHasNormalMap',
      'uSpecularArray',
      'uHasSpecularMap',
      'uRoughness',
      'uMetallic',
      'uNormalScale',
      'uModel',
      'uColor',
      'uShadowMap',
      'uShadowColorMap',
      'uLightBuffer',
      'uLightCount',
    ] as const)
    this.wboitUniforms = GL.getUniformLocations(gl, this.wboitProgram, [
      'uAccumulate',
      'uRevealage',
    ] as const)
    this.isWBOITSupported =
      !!gl.getExtension('OES_draw_buffers_indexed') && !!gl.getExtension('EXT_color_buffer_float')
    this.pipelineLibrary.registerVariant({
      id: 'terrain.forward.translucent',
      program: this.program,
      uniforms: this.uniforms,
      matches: key => matchesTerrainPipelineContract(key, 'forwardTranslucent'),
      applyState: (stateGl, context) => {
        const reverseZ = context?.useReverseZ === true
        stateGl.enable(stateGl.DEPTH_TEST)
        stateGl.depthFunc(reverseZ ? stateGl.GEQUAL : stateGl.LEQUAL)
        stateGl.enable(stateGl.CULL_FACE)
        stateGl.enable(stateGl.BLEND)

        if (this.isWBOITSupported) {
          const ext = stateGl.getExtension('OES_draw_buffers_indexed')
          if (ext) {
            ext.blendFunciOES(0, stateGl.ONE, stateGl.ONE)
            ext.blendFunciOES(1, stateGl.ZERO, stateGl.ONE_MINUS_SRC_COLOR)
          }
        } else {
          stateGl.blendFunc(stateGl.SRC_ALPHA, stateGl.ONE_MINUS_SRC_ALPHA)
        }

        stateGl.depthMask(false)
      },
    })

    if (!this.program) console.error('[ForwardPass] Main program creation failed')
    if (!this.wboitProgram) console.error('[ForwardPass] WBOIT program creation failed')

    this.quadMesh = SimpleMeshFactory.createFullscreenQuad(gl)
  }

  /** 释放 GPU 资源。 */
  dispose() {
    this.gl.deleteProgram(this.program)
    this.gl.deleteProgram(this.wboitProgram)
    this.quadMesh.dispose()
  }

  render(params: ForwardPassRenderParams) {
    const {
      textureArray,
      normalArray,
      specularArray,
      shadowMap,
      shadowColorMap,
      normalScale,
      lightManager,
      usePointLights,
      lightCount,
      useReverseZ = false,
      terrainForwardQueue = null,
      backend = null,
      backendFrameId = 0,
    } = params
    const gl = this.gl
    const pipeline = this.pipelineLibrary.useVariant<typeof this.uniforms>(
      gl,
      'terrain.forward.translucent',
      { useReverseZ },
    )
    const uniforms = pipeline.uniforms

    GL.bindTextureSampler(
      gl,
      uniforms.uShadowMap,
      FORWARD_TEXTURE_UNITS.shadowMap,
      gl.TEXTURE_2D_ARRAY,
      shadowMap,
    )

    // IMPORTANT: shadowColorMap must NOT share the same texture unit with uSpecularArray.
    // Otherwise ShadowCalculation() samples the specular array and produces cascade-aligned artifacts.
    GL.bindTextureSampler(
      gl,
      uniforms.uShadowColorMap,
      FORWARD_TEXTURE_UNITS.shadowColorMap,
      gl.TEXTURE_2D_ARRAY,
      shadowColorMap,
    )

    // Keep the light buffer sampler valid even when point lights are disabled.
    // The shader gates usage via uLightCount/frameUsePointLights, but some drivers
    // are sensitive to forward programs sampling from an unbound texture slot.
    if (lightManager?.lightBuffer) {
      GL.bindTextureSampler(
        gl,
        uniforms.uLightBuffer,
        FORWARD_TEXTURE_UNITS.lightBuffer,
        gl.TEXTURE_2D,
        lightManager.lightBuffer,
      )
      if (uniforms.uLightCount)
        gl.uniform1i(
          uniforms.uLightCount,
          usePointLights ? (lightCount ?? lightManager.numLights ?? 0) : 0,
        )
    } else {
      GL.clearTextureUnit(gl, FORWARD_TEXTURE_UNITS.lightBuffer, gl.TEXTURE_2D)
      if (uniforms.uLightCount) gl.uniform1i(uniforms.uLightCount, 0)
    }

    if (uniforms.uNormalScale) gl.uniform1f(uniforms.uNormalScale, normalScale)

    bindSurfaceTextureSet(gl, uniforms, FORWARD_TEXTURE_UNITS, {
      albedoArray: textureArray,
      normalArray,
      specularArray,
    })

    // 渲染所有可见的半透明对象。
    if (terrainForwardQueue && backend) {
      backend.executeQueue(terrainForwardQueue, {
        frameId: backendFrameId,
        beforeBucket: bucket => this.pipelineLibrary.matchesVariant(bucket.key, pipeline.id),
        beforeObject: object => {
          if (!object.transparent) {
            return false
          }

          if (object.material.doubleSided) {
            gl.disable(gl.CULL_FACE)
          } else {
            gl.enable(gl.CULL_FACE)
            gl.cullFace(gl.BACK)
          }

          const colorConstant = object.material.constants?.color
          applyForwardMaterialUniforms(gl, uniforms, {
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
          })
        },
      })
    }

    clearSurfaceTextureSet(gl, FORWARD_TEXTURE_UNITS, {
      albedoArray: textureArray,
      normalArray,
      specularArray,
    })

    GL.clearTextureUnit(gl, FORWARD_TEXTURE_UNITS.shadowMap, gl.TEXTURE_2D_ARRAY)
    GL.clearTextureUnit(gl, FORWARD_TEXTURE_UNITS.shadowColorMap, gl.TEXTURE_2D_ARRAY)

    if (lightManager?.lightBuffer) {
      GL.clearTextureUnit(gl, FORWARD_TEXTURE_UNITS.lightBuffer, gl.TEXTURE_2D)
    }

    gl.depthMask(true)
    gl.disable(gl.BLEND)
  }

  /**
   * 将 WBOIT 累积缓冲合成到当前帧缓冲。
   * @param accumTexture 累积纹理，`RGBA16F` 中存储加权颜色与权重和
   * @param revealTexture 透射率纹理，`R8` 中存储 revealage
   *
   * 公式：
   *   finalColor.rgb = accum.rgb / max(accum.a, 0.00001)
   *   finalColor.a = 1.0 - reveal
   */
  composite(accumTexture: WebGLTexture, revealTexture: WebGLTexture) {
    const gl = this.gl

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.depthMask(false)
    gl.disable(gl.DEPTH_TEST) // Fullscreen quad doesn't need depth test
    gl.disable(gl.CULL_FACE)

    gl.useProgram(this.wboitProgram)

    GL.bindTextureSampler(
      gl,
      this.wboitUniforms.uAccumulate,
      FORWARD_TEXTURE_UNITS.wboitAccum,
      gl.TEXTURE_2D,
      accumTexture,
    )

    GL.bindTextureSampler(
      gl,
      this.wboitUniforms.uRevealage,
      FORWARD_TEXTURE_UNITS.wboitRevealage,
      gl.TEXTURE_2D,
      revealTexture,
    )

    this.quadMesh.draw()

    gl.enable(gl.DEPTH_TEST)
    gl.depthMask(true)
    gl.disable(gl.BLEND)
  }
}
