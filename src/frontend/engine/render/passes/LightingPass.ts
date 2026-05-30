import { GL } from '@render/utils/gl'
import { GBuffer } from '@render/core/buffer/GBuffer'
import { LightManager } from '@render/core/lighting/LightManager'
import { type LightCuller } from '@render/core/lighting/LightCuller'
import { drawCallStats } from '@render/debug/DrawCallStats'
import { LIGHTING_TEXTURE_UNITS } from '@render/bindings/TextureUnits'
import vsh from '@shaders/screen/lighting.vsh'
import fsh from '@shaders/common/lighting.fsh'

export interface LightingPassRenderParams {
  gBuffer: GBuffer
  shadowMap: WebGLTexture
  shadowColorMap: WebGLTexture
  lightManager: LightManager
  lightCount: number
  cameraNear: number
  cameraFar: number
  useLinearDepth: boolean
  ssaoTexture: WebGLTexture | null
  lightCuller: LightCuller | null
  pointShadowMap: WebGLTexture | null
  shadowedLightIndices: Int32Array | null
  shadowedLightCount: number
}

/**
 * @file LightingPass.ts
 * @brief 延迟光照通道
 *
 * 说明：
 *  - 从 G-Buffer 重建材质与深度信息
 *  - 叠加太阳光、点光源、阴影与环境光
 *  - 负责延迟管线中的主光照计算输出
 */
export class LightingPass {
  public program: WebGLProgram
  private gl: WebGL2RenderingContext
  private quadVBO: WebGLBuffer
  private quadVAO: WebGLVertexArrayObject
  private fallbackShadowArray: WebGLTexture
  private readonly uniforms: ReturnType<typeof GL.getUniformLocations>

  /**
   * 创建延迟光照 Pass。
   * @param gl WebGL2 上下文
   */
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl
    this.program = GL.createProgram(gl, vsh, fsh)
    this.uniforms = GL.getUniformLocations(gl, this.program, [
      'uRT0',
      'uRT1',
      'uGDepth',
      'uLinearDepth',
      'uRT2',
      'uShadowMap',
      'uShadowColorMap',
      'uSSAO',
      'uUseSSAO',
      'uClusterCounts',
      'uClusterIndices',
      'uUseClusteredLights',
      'uClusterDims',
      'uClusterMaxLights',
      'uClusterZParams',
      'uClusterIndexTexSize',
      'uPointShadowMap',
      'uUsePointShadows',
      'uPointShadowCount',
      'uPointShadowLightIndices',
      'uUseRSM',
      'uLightBuffer',
      'uLightCount',
    ] as const)

    const fallback = gl.createTexture()
    if (!fallback) {
      throw new Error('Failed to create fallback shadow array texture')
    }
    this.fallbackShadowArray = fallback
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.fallbackShadowArray)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.R8,
      1,
      1,
      1,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255]),
    )
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)

    // 全屏四边形顶点数据。
    const quadVertices = new Float32Array([
      // pos        // uv
      -1.0, 1.0, 0.0, 1.0, -1.0, -1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 1.0, -1.0, 1.0, 0.0,
    ])

    this.quadVAO = gl.createVertexArray()!
    this.quadVBO = gl.createBuffer()!
    gl.bindVertexArray(this.quadVAO)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVBO)
    gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW)

    // aPosition 位置属性。
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 4 * 4, 0)
    // aTexCoord 纹理坐标属性。
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 4 * 4, 2 * 4)

    gl.bindVertexArray(null)
  }

  /** 释放 GPU 资源。 */
  dispose() {
    this.gl.deleteProgram(this.program)
    this.gl.deleteBuffer(this.quadVBO)
    this.gl.deleteVertexArray(this.quadVAO)
    this.gl.deleteTexture(this.fallbackShadowArray)
  }

  render(params: LightingPassRenderParams) {
    const {
      gBuffer,
      shadowMap,
      shadowColorMap,
      lightManager,
      lightCount,
      cameraNear,
      cameraFar,
      useLinearDepth,
      ssaoTexture,
      lightCuller,
      pointShadowMap,
      shadowedLightIndices,
      shadowedLightCount,
    } = params
    const gl = this.gl
    const uniforms = this.uniforms

    gl.viewport(0, 0, gBuffer.width, gBuffer.height)
    gl.disable(gl.DEPTH_TEST) // 全屏四边形不需要深度测试
    gl.disable(gl.BLEND) // 该阶段直接覆盖写入颜色缓冲
    gl.colorMask(true, true, true, true)

    gl.useProgram(this.program)

    // 绑定 G-Buffer 纹理。
    GL.bindTextureSampler(gl, uniforms.uRT0, LIGHTING_TEXTURE_UNITS.rt0, gl.TEXTURE_2D, gBuffer.RT0)

    GL.bindTextureSampler(gl, uniforms.uRT1, LIGHTING_TEXTURE_UNITS.rt1, gl.TEXTURE_2D, gBuffer.RT1)

    GL.bindTextureSampler(
      gl,
      uniforms.uGDepth,
      LIGHTING_TEXTURE_UNITS.depth,
      gl.TEXTURE_2D,
      gBuffer.depth,
    )

    if (useLinearDepth && gBuffer.linearDepth) {
      GL.bindTextureSampler(
        gl,
        uniforms.uLinearDepth,
        LIGHTING_TEXTURE_UNITS.linearDepth,
        gl.TEXTURE_2D,
        gBuffer.linearDepth,
      )
    }

    GL.bindTextureSampler(gl, uniforms.uRT2, LIGHTING_TEXTURE_UNITS.rt2, gl.TEXTURE_2D, gBuffer.RT2)

    // 绑定阴影贴图数组。
    GL.bindTextureSampler(
      gl,
      uniforms.uShadowMap,
      LIGHTING_TEXTURE_UNITS.shadowMap,
      gl.TEXTURE_2D_ARRAY,
      shadowMap,
    )

    // 绑定彩色阴影贴图数组。
    GL.bindTextureSampler(
      gl,
      uniforms.uShadowColorMap,
      LIGHTING_TEXTURE_UNITS.shadowColorMap,
      gl.TEXTURE_2D_ARRAY,
      shadowColorMap,
    )

    // SSAO Texture (Bind SSAO Texture)
    if (ssaoTexture) {
      GL.bindTextureSampler(
        gl,
        uniforms.uSSAO,
        LIGHTING_TEXTURE_UNITS.ssao,
        gl.TEXTURE_2D,
        ssaoTexture,
      )
      if (uniforms.uUseSSAO) gl.uniform1i(uniforms.uUseSSAO, 1)
    } else {
      if (uniforms.uUseSSAO) gl.uniform1i(uniforms.uUseSSAO, 0)
    }

    if (lightCuller) {
      GL.bindTextureSampler(
        gl,
        uniforms.uClusterCounts,
        LIGHTING_TEXTURE_UNITS.clusterCounts,
        gl.TEXTURE_2D,
        lightCuller.countsTex,
      )

      GL.bindTextureSampler(
        gl,
        uniforms.uClusterIndices,
        LIGHTING_TEXTURE_UNITS.clusterIndices,
        gl.TEXTURE_2D,
        lightCuller.indicesTex,
      )

      if (uniforms.uUseClusteredLights) gl.uniform1i(uniforms.uUseClusteredLights, 1)
      const dims = lightCuller.getDims()
      if (uniforms.uClusterDims) gl.uniform3i(uniforms.uClusterDims, dims.x, dims.y, dims.z)
      if (uniforms.uClusterMaxLights)
        gl.uniform1i(uniforms.uClusterMaxLights, lightCuller.getMaxLights())
      const logFactor = 1.0 / Math.log(Math.max(cameraFar / cameraNear, 1.0001))
      if (uniforms.uClusterZParams) {
        gl.uniform4f(uniforms.uClusterZParams, cameraNear, cameraFar, logFactor, dims.z)
      }
      if (uniforms.uClusterIndexTexSize) {
        gl.uniform2f(
          uniforms.uClusterIndexTexSize,
          lightCuller.indexTexWidth,
          lightCuller.indexTexHeight,
        )
      }
    } else {
      if (uniforms.uUseClusteredLights) gl.uniform1i(uniforms.uUseClusteredLights, 0)
    }

    if (pointShadowMap && shadowedLightIndices && shadowedLightCount > 0) {
      GL.bindTextureSampler(
        gl,
        uniforms.uPointShadowMap,
        LIGHTING_TEXTURE_UNITS.pointShadowMap,
        gl.TEXTURE_2D_ARRAY,
        pointShadowMap,
      )
      if (uniforms.uUsePointShadows) gl.uniform1i(uniforms.uUsePointShadows, 1)
      if (uniforms.uPointShadowCount) gl.uniform1i(uniforms.uPointShadowCount, shadowedLightCount)

      const maxShadowUniform = 8
      const shadowIndices = new Int32Array(maxShadowUniform)
      shadowIndices.fill(-1)
      for (let i = 0; i < Math.min(maxShadowUniform, shadowedLightCount); i++) {
        shadowIndices[i] = shadowedLightIndices[i]
      }
      if (uniforms.uPointShadowLightIndices)
        gl.uniform1iv(uniforms.uPointShadowLightIndices, shadowIndices)
    } else {
      GL.bindTextureSampler(
        gl,
        uniforms.uPointShadowMap,
        LIGHTING_TEXTURE_UNITS.pointShadowMap,
        gl.TEXTURE_2D_ARRAY,
        pointShadowMap ?? this.fallbackShadowArray,
      )
      if (uniforms.uUsePointShadows) gl.uniform1i(uniforms.uUsePointShadows, 0)
      if (uniforms.uPointShadowCount) gl.uniform1i(uniforms.uPointShadowCount, 0)

      if (uniforms.uPointShadowLightIndices) {
        const cleared = new Int32Array(8)
        cleared.fill(-1)
        gl.uniform1iv(uniforms.uPointShadowLightIndices, cleared)
      }
    }

    if (uniforms.uUseRSM) gl.uniform1i(uniforms.uUseRSM, 0)

    if (lightManager.lightBuffer) {
      GL.bindTextureSampler(
        gl,
        uniforms.uLightBuffer,
        LIGHTING_TEXTURE_UNITS.lightBuffer,
        gl.TEXTURE_2D,
        lightManager.lightBuffer,
      )
      if (uniforms.uLightCount) gl.uniform1i(uniforms.uLightCount, lightCount)
    }

    gl.bindVertexArray(this.quadVAO)
    drawCallStats.recordDrawCall('arrays')
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    gl.bindVertexArray(null)

    gl.enable(gl.DEPTH_TEST)
    gl.depthMask(true)
  }
}
