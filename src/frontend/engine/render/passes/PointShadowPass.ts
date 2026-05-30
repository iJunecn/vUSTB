import { GL } from '@render/utils/gl'
import { FrameBuffer } from '@render/core/buffer/FrameBuffer'
import { mat4, vec3 } from '@render/utils/math'
import type { IRenderBackend, RenderQueue } from '@render/backend/IRenderBackend'
import { MODEL_STANDARD_INSTANCED_LAYOUT_ID } from '@render/layout/BuiltinLayouts'
import { applyCharacterAnimationUniforms } from '@render/bindings/MaterialBindings'
import {
  matchesEntityPipelineContract,
  matchesTerrainPipelineContract,
} from '@render/backend/PipelineContracts'
import { WebGL2PipelineLibrary } from '@render/backend/webgl2/WebGL2PipelineLibrary'
import vsh from '@shaders/terrain/point_shadow.vsh'
import fsh from '@shaders/common/point_shadow.fsh'
import characterCutoutVsh from '@shaders/entity/character_point_shadow.vsh'
import characterCutoutFsh from '@shaders/entity/character_point_shadow.fsh'
import { POINT_SHADOW_TEXTURE_UNITS } from '@render/bindings/TextureUnits'
import { injectShaderDefine } from '@render/utils/shaderDefines'

const POINT_SHADOW_OPAQUE_FSH = injectShaderDefine(fsh, 'POINT_SHADOW_ALPHA_TEST', false)
const POINT_SHADOW_CUTOUT_FSH = injectShaderDefine(fsh, 'POINT_SHADOW_ALPHA_TEST', true)

const POINT_SHADOW_UNIFORM_NAMES = [
  'uLightViewProj',
  'uModel',
  'uTextureArray',
  'uHasTexture',
  'uLightPos',
  'uLightFar',
  'uCharacterAnimation',
  'uSkinIndex',
  'uUseInstanceData',
] as const

export class PointShadowPass {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private readonly cutoutProgram: WebGLProgram
  private readonly entityCutoutProgram: WebGLProgram
  private readonly pipelineLibrary = new WebGL2PipelineLibrary()
  private frameBuffer: FrameBuffer
  private depthRbo: WebGLRenderbuffer | null = null
  private resolution: number
  private maxLights: number

  public shadowMap: WebGLTexture
  public shadowedLightIndices: Int32Array
  public shadowedLightCount: number = 0
  private readonly opaqueUniforms: ReturnType<typeof GL.getUniformLocations>
  private readonly cutoutUniforms: ReturnType<typeof GL.getUniformLocations>
  private readonly entityCutoutUniforms: ReturnType<typeof GL.getUniformLocations>

  constructor(gl: WebGL2RenderingContext, resolution: number, maxLights: number) {
    this.gl = gl
    this.program = GL.createProgram(gl, vsh, POINT_SHADOW_OPAQUE_FSH)
    this.cutoutProgram = GL.createProgram(gl, vsh, POINT_SHADOW_CUTOUT_FSH)
    this.entityCutoutProgram = GL.createProgram(gl, characterCutoutVsh, characterCutoutFsh)
    this.resolution = resolution
    this.maxLights = maxLights
    this.shadowedLightIndices = new Int32Array(maxLights)

    this.shadowMap = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shadowMap)
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.R32F,
      resolution,
      resolution,
      maxLights * 6,
      0,
      gl.RED,
      gl.FLOAT,
      null,
    )
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    this.frameBuffer = new FrameBuffer(gl, resolution, resolution)
    this.initDepthBuffer()
    this.opaqueUniforms = GL.getUniformLocations(gl, this.program, POINT_SHADOW_UNIFORM_NAMES)
    this.cutoutUniforms = GL.getUniformLocations(gl, this.cutoutProgram, POINT_SHADOW_UNIFORM_NAMES)
    this.entityCutoutUniforms = GL.getUniformLocations(
      gl,
      this.entityCutoutProgram,
      POINT_SHADOW_UNIFORM_NAMES,
    )
    this.pipelineLibrary.registerVariant({
      id: 'terrain.point-shadow.deferred.opaque',
      program: this.program,
      uniforms: this.opaqueUniforms,
      matches: key => matchesTerrainPipelineContract(key, 'deferredOpaque'),
      applyState: stateGl => {
        stateGl.enable(stateGl.DEPTH_TEST)
        stateGl.depthFunc(stateGl.LEQUAL)
        stateGl.enable(stateGl.CULL_FACE)
        stateGl.cullFace(stateGl.BACK)
        stateGl.colorMask(true, true, true, true)
        stateGl.depthMask(true)
        stateGl.disable(stateGl.BLEND)
        stateGl.disable(stateGl.POLYGON_OFFSET_FILL)
      },
    })
    this.pipelineLibrary.registerVariant({
      id: 'terrain.point-shadow.deferred.cutout',
      program: this.cutoutProgram,
      uniforms: this.cutoutUniforms,
      matches: key => matchesTerrainPipelineContract(key, 'deferredCutout'),
      applyState: stateGl => {
        stateGl.enable(stateGl.DEPTH_TEST)
        stateGl.depthFunc(stateGl.LEQUAL)
        stateGl.enable(stateGl.CULL_FACE)
        stateGl.cullFace(stateGl.BACK)
        stateGl.colorMask(true, true, true, true)
        stateGl.depthMask(true)
        stateGl.disable(stateGl.BLEND)
        stateGl.disable(stateGl.POLYGON_OFFSET_FILL)
      },
    })
    this.pipelineLibrary.registerVariant({
      id: 'entity.point-shadow.deferred.cutout',
      program: this.entityCutoutProgram,
      uniforms: this.entityCutoutUniforms,
      matches: key => matchesEntityPipelineContract(key, 'deferredCutout'),
      applyState: stateGl => {
        stateGl.enable(stateGl.DEPTH_TEST)
        stateGl.depthFunc(stateGl.LEQUAL)
        stateGl.enable(stateGl.CULL_FACE)
        stateGl.cullFace(stateGl.BACK)
        stateGl.colorMask(true, true, true, true)
        stateGl.depthMask(true)
        stateGl.disable(stateGl.BLEND)
        stateGl.disable(stateGl.POLYGON_OFFSET_FILL)
      },
    })
  }

  dispose() {
    const gl = this.gl
    gl.deleteProgram(this.program)
    gl.deleteProgram(this.cutoutProgram)
    gl.deleteProgram(this.entityCutoutProgram)
    gl.deleteTexture(this.shadowMap)
    if (this.depthRbo) gl.deleteRenderbuffer(this.depthRbo)
    this.frameBuffer.dispose()
  }

  // cutout 变体需要额外绑定纹理数组与 alpha test 开关。
  private bindCutoutState(textureArray: WebGLTexture | null) {
    const gl = this.gl
    const pipeline = this.pipelineLibrary.useVariant<typeof this.cutoutUniforms>(
      gl,
      'terrain.point-shadow.deferred.cutout',
    )
    const uniforms = pipeline.uniforms
    if (textureArray) {
      GL.bindTextureSampler(
        gl,
        uniforms.uTextureArray,
        POINT_SHADOW_TEXTURE_UNITS.albedoArray,
        gl.TEXTURE_2D_ARRAY,
        textureArray,
      )
      if (uniforms.uHasTexture) gl.uniform1i(uniforms.uHasTexture, 1)
    } else {
      if (uniforms.uHasTexture) gl.uniform1i(uniforms.uHasTexture, 0)
    }

    return uniforms
  }

  resize(resolution: number) {
    if (this.resolution === resolution) return
    this.resolution = resolution

    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.shadowMap)
    gl.texImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      gl.R32F,
      resolution,
      resolution,
      this.maxLights * 6,
      0,
      gl.RED,
      gl.FLOAT,
      null,
    )
    this.frameBuffer.resize(resolution, resolution)
    this.initDepthBuffer()
  }

  updateConfig(resolution: number, maxLights: number) {
    this.maxLights = Math.max(0, maxLights | 0)
    if (this.shadowedLightIndices.length !== this.maxLights) {
      this.shadowedLightIndices = new Int32Array(this.maxLights)
    }
    this.resize(resolution)
  }

  render(
    textureArray: WebGLTexture | null,
    lights: Float32Array,
    lightCount: number,
    cameraPos: Float32Array,
    terrainGeometryQueue: RenderQueue | null = null,
    backend: IRenderBackend | null = null,
    backendFrameId: number = 0,
  ) {
    const gl = this.gl
    const maxLights = this.maxLights

    if (maxLights <= 0 || lightCount <= 0) {
      this.shadowedLightCount = 0
      return
    }

    const scores: { index: number; score: number }[] = []
    const cx = cameraPos[0]
    const cy = cameraPos[1]
    const cz = cameraPos[2]

    for (let i = 0; i < lightCount; i++) {
      const base = i * 8
      const dx = lights[base] - cx
      const dy = lights[base + 1] - cy
      const dz = lights[base + 2] - cz
      const dist2 = dx * dx + dy * dy + dz * dz
      const intensity = lights[base + 6]
      const radius = lights[base + 7]
      const score = (intensity * radius) / (dist2 + 1.0)
      scores.push({ index: i, score })
    }

    scores.sort((a, b) => b.score - a.score)
    const shadowCount = Math.min(maxLights, scores.length)
    this.shadowedLightCount = shadowCount
    for (let i = 0; i < shadowCount; i++) {
      this.shadowedLightIndices[i] = scores[i].index
    }

    gl.viewport(0, 0, this.resolution, this.resolution)

    // 立方体六个朝向与对应 up 向量。
    const dirs = [
      vec3.fromValues(1, 0, 0),
      vec3.fromValues(-1, 0, 0),
      vec3.fromValues(0, 1, 0),
      vec3.fromValues(0, -1, 0),
      vec3.fromValues(0, 0, 1),
      vec3.fromValues(0, 0, -1),
    ]
    const ups = [
      vec3.fromValues(0, -1, 0),
      vec3.fromValues(0, -1, 0),
      vec3.fromValues(0, 0, 1),
      vec3.fromValues(0, 0, -1),
      vec3.fromValues(0, -1, 0),
      vec3.fromValues(0, -1, 0),
    ]

    const lightPos = vec3.create()
    const target = vec3.create()
    const view = mat4.create()
    const proj = mat4.create()
    const viewProj = mat4.create()

    for (let s = 0; s < shadowCount; s++) {
      const lightIndex = this.shadowedLightIndices[s]
      const base = lightIndex * 8
      lightPos[0] = lights[base]
      lightPos[1] = lights[base + 1]
      lightPos[2] = lights[base + 2]
      const radius = lights[base + 7]
      const near = 0.1
      const far = Math.max(near + 0.01, radius)

      const opaquePipeline = this.pipelineLibrary.useVariant<typeof this.opaqueUniforms>(
        gl,
        'terrain.point-shadow.deferred.opaque',
      )
      if (opaquePipeline.uniforms.uLightPos)
        gl.uniform3f(opaquePipeline.uniforms.uLightPos, lightPos[0], lightPos[1], lightPos[2])
      if (opaquePipeline.uniforms.uLightFar) gl.uniform1f(opaquePipeline.uniforms.uLightFar, far)

      mat4.perspective(proj, Math.PI / 2, 1.0, near, far)

      for (let face = 0; face < 6; face++) {
        vec3.add(target, lightPos, dirs[face])
        mat4.lookAt(view, lightPos, target, ups[face])
        mat4.multiply(viewProj, proj, view)

        const layer = s * 6 + face // F(layer)=shadowSlot*6+cubeFace
        this.frameBuffer.attachTextureLayer(this.shadowMap, gl.COLOR_ATTACHMENT0, layer)
        this.frameBuffer.bind()
        if (this.depthRbo) {
          gl.framebufferRenderbuffer(
            gl.FRAMEBUFFER,
            gl.DEPTH_ATTACHMENT,
            gl.RENDERBUFFER,
            this.depthRbo,
          )
        }
        gl.drawBuffers([gl.COLOR_ATTACHMENT0])
        gl.clearColor(1.0, 1.0, 1.0, 1.0)
        gl.clearDepth(1.0)
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

        if (opaquePipeline.uniforms.uLightViewProj) {
          gl.uniformMatrix4fv(opaquePipeline.uniforms.uLightViewProj, false, viewProj)
        }

        if (backend && terrainGeometryQueue) {
          backend.executeQueue(terrainGeometryQueue, {
            frameId: backendFrameId,
            beforeBucket: bucket =>
              this.pipelineLibrary.matchesVariant(bucket.key, opaquePipeline.id),
            beforeObject: object => {
              if (!object.castShadow || object.transparent) return false
              if (opaquePipeline.uniforms.uModel)
                gl.uniformMatrix4fv(opaquePipeline.uniforms.uModel, false, object.transform)
            },
          })
        }

        const cutoutUniforms = this.bindCutoutState(textureArray)
        if (cutoutUniforms.uLightPos)
          gl.uniform3f(cutoutUniforms.uLightPos, lightPos[0], lightPos[1], lightPos[2])
        if (cutoutUniforms.uLightFar) gl.uniform1f(cutoutUniforms.uLightFar, far)
        if (cutoutUniforms.uLightViewProj) {
          gl.uniformMatrix4fv(cutoutUniforms.uLightViewProj, false, viewProj)
        }

        if (backend && terrainGeometryQueue) {
          backend.executeQueue(terrainGeometryQueue, {
            frameId: backendFrameId,
            beforeBucket: bucket =>
              this.pipelineLibrary.matchesVariant(
                bucket.key,
                'terrain.point-shadow.deferred.cutout',
              ),
            beforeObject: object => {
              if (!object.castShadow || object.transparent) return false
              if (cutoutUniforms.uModel)
                gl.uniformMatrix4fv(cutoutUniforms.uModel, false, object.transform)
            },
          })
        }

        const entityCutoutPipeline = this.pipelineLibrary.useVariant<
          typeof this.entityCutoutUniforms
        >(gl, 'entity.point-shadow.deferred.cutout')
        if (entityCutoutPipeline.uniforms.uLightPos) {
          gl.uniform3f(
            entityCutoutPipeline.uniforms.uLightPos,
            lightPos[0],
            lightPos[1],
            lightPos[2],
          )
        }
        if (entityCutoutPipeline.uniforms.uLightFar) {
          gl.uniform1f(entityCutoutPipeline.uniforms.uLightFar, far)
        }
        if (entityCutoutPipeline.uniforms.uLightViewProj) {
          gl.uniformMatrix4fv(entityCutoutPipeline.uniforms.uLightViewProj, false, viewProj)
        }

        if (backend && terrainGeometryQueue) {
          backend.executeQueue(terrainGeometryQueue, {
            frameId: backendFrameId,
            beforeBucket: bucket => {
              const matches = this.pipelineLibrary.matchesVariant(
                bucket.key,
                entityCutoutPipeline.id,
              )
              if (matches && entityCutoutPipeline.uniforms.uUseInstanceData) {
                gl.uniform1i(
                  entityCutoutPipeline.uniforms.uUseInstanceData,
                  bucket.key.layoutId === MODEL_STANDARD_INSTANCED_LAYOUT_ID ? 1 : 0,
                )
              }
              return matches
            },
            beforeObject: object => {
              const usesInstanceData =
                object.geometry.layoutId === MODEL_STANDARD_INSTANCED_LAYOUT_ID
              if (!object.castShadow || object.transparent) return false
              if (object.material.doubleSided) {
                gl.disable(gl.CULL_FACE)
              } else {
                gl.enable(gl.CULL_FACE)
                gl.cullFace(gl.BACK)
              }
              const albedoTextureArray = object.material.resources?.albedoTextureArray2D
              if (!albedoTextureArray) return false
              GL.bindTextureSampler(
                gl,
                entityCutoutPipeline.uniforms.uTextureArray,
                POINT_SHADOW_TEXTURE_UNITS.albedoArray,
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
        }
      }
    }

    if (textureArray) {
      GL.clearTextureUnit(gl, POINT_SHADOW_TEXTURE_UNITS.albedoArray, gl.TEXTURE_2D_ARRAY)
    }
    GL.clearTextureUnit(gl, POINT_SHADOW_TEXTURE_UNITS.albedoArray, gl.TEXTURE_2D_ARRAY)
    gl.colorMask(true, true, true, true)
    this.frameBuffer.unbind()
  }

  private initDepthBuffer() {
    const gl = this.gl
    if (!this.depthRbo) {
      this.depthRbo = gl.createRenderbuffer()
    }
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthRbo)
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.resolution, this.resolution)
    gl.bindRenderbuffer(gl.RENDERBUFFER, null)
  }
}
