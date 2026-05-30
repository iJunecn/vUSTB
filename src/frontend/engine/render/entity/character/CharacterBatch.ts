import type { WebGL2RenderBackend } from '@/engine/render/backend/webgl2/WebGL2RenderBackend'
import {
  MODEL_STANDARD_INSTANCED_LAYOUT_ID,
  MODEL_STANDARD_LAYOUT_ID,
} from '@/engine/render/layout/BuiltinLayouts'
import type { RenderObject } from '@/engine/render/queue/RenderObject'
import { mat4 } from '@/engine/render/utils/math'
import type { CharacterSkinTextureArray } from './CharacterSkinTextureArray'
import type { CharacterModelTemplate } from './CharacterModelTemplate'
import type {
  CharacterBatchMode,
  CharacterCalibrationDebugInfo,
  CharacterRenderGroup,
  CharacterRenderState,
} from './types'

const CHARACTER_INSTANCE_STRIDE = 96

function createStaticMaterialId(baseId: number, index: number) {
  return baseId * 1000 + index
}

export class CharacterBatch implements CharacterRenderGroup {
  private readonly identityTransform = mat4.create() as Float32Array
  private readonly aggregateBoundsMin = new Float32Array(3)
  private readonly aggregateBoundsMax = new Float32Array(3)
  private readonly renderObjects: RenderObject[] = []
  private readonly states: CharacterRenderState[] = []

  private instanceBuffer: WebGLBuffer | null = null
  private instanceCount = 0

  constructor(
    private readonly backend: WebGL2RenderBackend,
    private readonly template: CharacterModelTemplate,
    private readonly skinAtlas: CharacterSkinTextureArray,
    private readonly objectId: number,
    private readonly mode: CharacterBatchMode,
  ) {}

  public initialize(states: readonly CharacterRenderState[]) {
    this.states.length = 0
    this.states.push(...states)

    if (this.mode === 'instanced') {
      this.initializeInstanced(states)
      return
    }

    this.initializeSingles(states)
  }

  public getRenderObjects(): readonly RenderObject[] {
    return this.renderObjects
  }

  public sync(states: readonly CharacterRenderState[]) {
    this.states.length = 0
    this.states.push(...states)

    if (this.mode === 'instanced') {
      this.syncInstanced(states)
      return
    }

    if (states.length !== this.renderObjects.length) {
      throw new Error('CharacterBatch single mode does not support dynamic instance count changes')
    }

    for (let index = 0; index < states.length; index += 1) {
      const object = this.renderObjects[index]
      const state = states[index]
      if (!object || !state) {
        continue
      }

      object.mainViewVisible = state.mainViewVisible
      object.castShadow = state.castShadow
      object.receiveShadow = state.receiveShadow
      object.material.doubleSided = state.doubleSided
      object.material.constants = {
        ...object.material.constants,
        skinIndex: this.resolveSkinIndex(state.skinId),
      }
    }
  }

  public getCalibrationDebugInfo(index: number = 0): CharacterCalibrationDebugInfo | null {
    const state = this.states[index]
    if (!state) {
      return null
    }

    return {
      skinId: state.skinId,
      yawDegrees: (state.yawRadians * 180) / Math.PI,
      modelPosition: [state.modelPosition[0], state.modelPosition[1], state.modelPosition[2]],
      localBoundsSize: [
        this.template.boundsMax[0] - this.template.boundsMin[0],
        this.template.boundsMax[1] - this.template.boundsMin[1],
        this.template.boundsMax[2] - this.template.boundsMin[2],
      ],
      partCount: this.template.partCount,
    }
  }

  public dispose() {
    for (const object of this.renderObjects) {
      this.backend.releaseGeometry(object.geometry)
    }
    this.renderObjects.length = 0

    if (this.instanceBuffer) {
      this.backend.getContext().deleteBuffer(this.instanceBuffer)
      this.instanceBuffer = null
    }

    this.instanceCount = 0
    this.states.length = 0
  }

  private initializeSingles(states: readonly CharacterRenderState[]) {
    for (let index = 0; index < states.length; index += 1) {
      const state = states[index]
      const geometry = this.backend.createResidentGeometry({
        layoutId: MODEL_STANDARD_LAYOUT_ID,
        topology: 'triangles',
        vertexBuffers: [
          {
            slot: 0,
            buffer: this.template.vertexBuffer,
            offsetBytes: 0,
            stride: 36,
            stepMode: 'vertex',
          },
        ],
        vertexCount: this.template.vertexCount,
      })
      geometry.kind = 'dynamic-model'

      this.renderObjects.push({
        id: state.id,
        domain: 'entity',
        transform: state.transform,
        bounds: state.bounds,
        geometry,
        material: {
          id: createStaticMaterialId(this.objectId, index),
          domain: 'entity',
          blendMode: 'masked',
          doubleSided: state.doubleSided,
          shaderTag: 'entity.deferred',
          shaderFamily: 'cutout',
          constants: {
            color: new Float32Array([1, 1, 1]),
            animation: state.animation,
            skinIndex: this.resolveSkinIndex(state.skinId),
            roughness: 0.95,
            metallic: 0.0,
          },
          resources: {
            albedoTextureArray2D: this.skinAtlas.getTexture(),
          },
          features: {
            alphaMask: true,
            receivesLighting: true,
          },
        },
        mainViewVisible: state.mainViewVisible,
        visibilityMask: 0xffffffff,
        transparent: false,
        castShadow: state.castShadow,
        receiveShadow: state.receiveShadow,
      })
    }
  }

  private initializeInstanced(states: readonly CharacterRenderState[]) {
    this.instanceCount = states.length
    const gl = this.backend.getContext()
    this.instanceBuffer = gl.createBuffer()
    if (!this.instanceBuffer) {
      throw new Error('Failed to create model instance buffer')
    }

    const bytes = this.buildInstanceBytes(states)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)

    const geometry = this.backend.createResidentGeometry({
      layoutId: MODEL_STANDARD_INSTANCED_LAYOUT_ID,
      topology: 'triangles',
      vertexBuffers: [
        {
          slot: 0,
          buffer: this.template.vertexBuffer,
          offsetBytes: 0,
          stride: 36,
          stepMode: 'vertex',
        },
        {
          slot: 1,
          buffer: this.instanceBuffer,
          offsetBytes: 0,
          stride: CHARACTER_INSTANCE_STRIDE,
          stepMode: 'instance',
        },
      ],
      vertexCount: this.template.vertexCount,
      instanceCount: states.length,
    })
    geometry.kind = 'dynamic-model'

    this.renderObjects.push({
      id: this.objectId,
      domain: 'entity',
      transform: this.identityTransform,
      bounds: {
        min: this.aggregateBoundsMin,
        max: this.aggregateBoundsMax,
      },
      geometry,
      material: {
        id: this.objectId,
        domain: 'entity',
        blendMode: 'masked',
        doubleSided: states.some(state => state.doubleSided),
        shaderTag: 'entity.deferred',
        shaderFamily: 'cutout',
        constants: {
          color: new Float32Array([1, 1, 1]),
          skinIndex: 0,
          roughness: 0.95,
          metallic: 0.0,
        },
        resources: {
          albedoTextureArray2D: this.skinAtlas.getTexture(),
        },
        features: {
          alphaMask: true,
          receivesLighting: true,
        },
      },
      mainViewVisible: states.some(state => state.mainViewVisible),
      visibilityMask: 0xffffffff,
      transparent: false,
      castShadow: states.some(state => state.castShadow),
      receiveShadow: states.some(state => state.receiveShadow),
    })
  }

  private syncInstanced(states: readonly CharacterRenderState[]) {
    if (!this.instanceBuffer) {
      return
    }
    if (this.renderObjects.length === 0) {
      return
    }

    if (this.instanceCount !== states.length) {
      throw new Error(
        'CharacterBatch instanced mode does not support dynamic instance count changes',
      )
    }

    const aggregateObject = this.renderObjects[0]
    if (aggregateObject) {
      aggregateObject.mainViewVisible = states.some(state => state.mainViewVisible)
      aggregateObject.castShadow = states.some(state => state.castShadow)
      aggregateObject.receiveShadow = states.some(state => state.receiveShadow)
      aggregateObject.material.doubleSided = states.some(state => state.doubleSided)
    }

    const bytes = this.buildInstanceBytes(states)
    const gl = this.backend.getContext()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, bytes)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  private buildInstanceBytes(states: readonly CharacterRenderState[]) {
    this.updateAggregateBounds(states)

    const bytes = new Uint8Array(states.length * CHARACTER_INSTANCE_STRIDE)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

    for (let stateIndex = 0; stateIndex < states.length; stateIndex += 1) {
      const state = states[stateIndex]
      const byteOffset = stateIndex * CHARACTER_INSTANCE_STRIDE
      for (let valueIndex = 0; valueIndex < 16; valueIndex += 1) {
        view.setFloat32(byteOffset + valueIndex * 4, state.transform[valueIndex], true)
      }
      for (let valueIndex = 0; valueIndex < 4; valueIndex += 1) {
        view.setFloat32(byteOffset + 64 + valueIndex * 4, state.animation[valueIndex], true)
      }
      view.setFloat32(byteOffset + 80, this.resolveSkinIndex(state.skinId), true)
      view.setFloat32(byteOffset + 84, 0, true)
      view.setFloat32(byteOffset + 88, 0, true)
      view.setFloat32(byteOffset + 92, 0, true)
    }

    return bytes
  }

  private resolveSkinIndex(skinId: string) {
    return this.skinAtlas.getSkinIndex(skinId) ?? 0
  }

  private updateAggregateBounds(states: readonly CharacterRenderState[]) {
    if (states.length === 0) {
      this.aggregateBoundsMin.fill(0)
      this.aggregateBoundsMax.fill(0)
      return
    }

    this.aggregateBoundsMin[0] = Infinity
    this.aggregateBoundsMin[1] = Infinity
    this.aggregateBoundsMin[2] = Infinity
    this.aggregateBoundsMax[0] = -Infinity
    this.aggregateBoundsMax[1] = -Infinity
    this.aggregateBoundsMax[2] = -Infinity

    for (const state of states) {
      this.aggregateBoundsMin[0] = Math.min(this.aggregateBoundsMin[0], state.bounds.min[0])
      this.aggregateBoundsMin[1] = Math.min(this.aggregateBoundsMin[1], state.bounds.min[1])
      this.aggregateBoundsMin[2] = Math.min(this.aggregateBoundsMin[2], state.bounds.min[2])
      this.aggregateBoundsMax[0] = Math.max(this.aggregateBoundsMax[0], state.bounds.max[0])
      this.aggregateBoundsMax[1] = Math.max(this.aggregateBoundsMax[1], state.bounds.max[1])
      this.aggregateBoundsMax[2] = Math.max(this.aggregateBoundsMax[2], state.bounds.max[2])
    }
  }
}
