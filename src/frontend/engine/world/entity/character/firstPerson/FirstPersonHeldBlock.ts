import type { IRenderBackend } from '@/engine/render/backend/IRenderBackend'
import type { GeometryHandle } from '@/engine/render/backend/GeometryHandle'
import { TERRAIN_COMPACT_LAYOUT_ID } from '@/engine/render/layout/BuiltinLayouts'
import type { RenderObject } from '@/engine/render/queue/RenderObject'
import type { TextureManager } from '@/engine/render/texture/TextureManager'
import { mat4, quat, vec3 } from '@/engine/render/utils/math'
import type { Vec3Like } from '../../Entity'
import type { HeldBlockFaceTextures } from './FirstPersonHeldBlockCatalog'

const WORLD_UP = vec3.fromValues(0, 1, 0)
const QUAD_INDICES_CCW = [0, 2, 1, 0, 3, 2] as const
let nextHeldBlockRenderObjectId = 930001
let nextHeldBlockMaterialId = 930001

type HeldBlockOptions = {
  backend: IRenderBackend
  textureManager: TextureManager
  baseOffset: { x: number; y: number; z: number }
  baseRotation: { pitch: number; yaw: number; roll: number }
  scale: number
}

type FaceKey = keyof HeldBlockFaceTextures

type CubeFace = {
  texture: FaceKey
  normal: readonly [number, number, number]
  corners: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ]
}

const CUBE_FACES: readonly CubeFace[] = [
  {
    texture: 'up',
    normal: [0, 1, 0],
    corners: [
      [-0.5, 0.5, -0.5],
      [0.5, 0.5, -0.5],
      [0.5, 0.5, 0.5],
      [-0.5, 0.5, 0.5],
    ],
  },
  {
    texture: 'down',
    normal: [0, -1, 0],
    corners: [
      [-0.5, -0.5, 0.5],
      [0.5, -0.5, 0.5],
      [0.5, -0.5, -0.5],
      [-0.5, -0.5, -0.5],
    ],
  },
  {
    texture: 'north',
    normal: [0, 0, -1],
    corners: [
      [0.5, -0.5, -0.5],
      [-0.5, -0.5, -0.5],
      [-0.5, 0.5, -0.5],
      [0.5, 0.5, -0.5],
    ],
  },
  {
    texture: 'south',
    normal: [0, 0, 1],
    corners: [
      [-0.5, -0.5, 0.5],
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0.5],
      [-0.5, 0.5, 0.5],
    ],
  },
  {
    texture: 'west',
    normal: [-1, 0, 0],
    corners: [
      [-0.5, -0.5, -0.5],
      [-0.5, -0.5, 0.5],
      [-0.5, 0.5, 0.5],
      [-0.5, 0.5, -0.5],
    ],
  },
  {
    texture: 'east',
    normal: [1, 0, 0],
    corners: [
      [0.5, -0.5, 0.5],
      [0.5, -0.5, -0.5],
      [0.5, 0.5, -0.5],
      [0.5, 0.5, 0.5],
    ],
  },
] as const

function encodeSnorm8(value: number) {
  const clamped = Math.max(-1, Math.min(1, value))
  const scaled = Math.round(clamped * 127)
  return scaled < 0 ? 256 + scaled : scaled
}

function packNormal(normal: readonly [number, number, number]) {
  return (
    (encodeSnorm8(normal[0]) | (encodeSnorm8(normal[1]) << 8) | (encodeSnorm8(normal[2]) << 16)) >>>
    0
  )
}

function encodePositionComponent(value: number, bias: number) {
  return Math.round((value + bias) * 32) >>> 0
}

function packUv(u: number, v: number) {
  const encodedU = Math.max(0, Math.min(65535, Math.round(u * 65535)))
  const encodedV = Math.max(0, Math.min(65535, Math.round(v * 65535)))
  return (encodedU | (encodedV << 16)) >>> 0
}

function createHeldBlockGeometry(textures: HeldBlockFaceTextures, textureManager: TextureManager) {
  const vertexData = new Uint32Array(CUBE_FACES.length * 4 * 8)
  const indexData = new Uint32Array(CUBE_FACES.length * 6)
  let vertexCursor = 0
  let indexCursor = 0
  let baseVertex = 0

  for (const face of CUBE_FACES) {
    const packedNormal = packNormal(face.normal)
    const textureIndex = textureManager.getTextureIndex(textures[face.texture]) & 0xffff
    const packedTexLight = (textureIndex | (255 << 16) | (255 << 24)) >>> 0
    const packedColor = 0xffffffff
    const packedSurface = 0
    const uvs: Array<readonly [number, number]> = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]

    for (let vertexIndex = 0; vertexIndex < 4; vertexIndex += 1) {
      const corner = face.corners[vertexIndex]
      const uv = uvs[vertexIndex]
      vertexData[vertexCursor++] = encodePositionComponent(corner[0], 4)
      vertexData[vertexCursor++] = encodePositionComponent(corner[1], 128)
      vertexData[vertexCursor++] = encodePositionComponent(corner[2], 4)
      vertexData[vertexCursor++] = packedNormal
      vertexData[vertexCursor++] = packUv(uv[0], uv[1])
      vertexData[vertexCursor++] = packedTexLight
      vertexData[vertexCursor++] = packedColor
      vertexData[vertexCursor++] = packedSurface
    }

    for (const index of QUAD_INDICES_CCW) {
      indexData[indexCursor++] = baseVertex + index
    }
    baseVertex += 4
  }

  return {
    layoutId: TERRAIN_COMPACT_LAYOUT_ID,
    topology: 'triangles' as const,
    vertexBytes: new Uint8Array(vertexData.buffer),
    indexBytes: new Uint8Array(indexData.buffer),
  }
}

export class FirstPersonHeldBlock {
  private readonly transform = mat4.create() as Float32Array
  private readonly boundsMin = new Float32Array(3)
  private readonly boundsMax = new Float32Array(3)
  private readonly position = new Float32Array(3)
  private readonly forward = vec3.create()
  private readonly right = vec3.create()
  private readonly up = vec3.create()
  private readonly baseOrientation = mat4.create() as Float32Array
  private readonly finalOrientation = mat4.create() as Float32Array
  private readonly relativeRotationQuat = quat.create()
  private readonly relativeRotation = mat4.create() as Float32Array
  private readonly baseOffset: { x: number; y: number; z: number }
  private readonly baseRotation: { pitch: number; yaw: number; roll: number }
  private readonly animationOffsetDelta = { x: 0, y: 0, z: 0 }
  private readonly animationRotationDelta = { pitch: 0, yaw: 0, roll: 0 }
  private readonly scale: number
  private geometry: GeometryHandle | null = null
  private renderObject: RenderObject | null = null

  constructor(private readonly options: HeldBlockOptions) {
    this.baseOffset = { ...options.baseOffset }
    this.baseRotation = { ...options.baseRotation }
    this.scale = options.scale
    this.rebuildRelativeRotation()
  }

  setDisplayedBlock(textures: HeldBlockFaceTextures | null) {
    this.releaseGeometry()
    this.renderObject = null

    if (!textures) {
      return
    }

    this.geometry = this.options.backend.createGeometry(
      createHeldBlockGeometry(textures, this.options.textureManager),
    )
    this.renderObject = {
      id: nextHeldBlockRenderObjectId++,
      domain: 'terrain',
      transform: this.transform,
      bounds: {
        min: this.boundsMin,
        max: this.boundsMax,
      },
      geometry: this.geometry,
      material: {
        id: nextHeldBlockMaterialId++,
        domain: 'terrain',
        blendMode: 'opaque',
        doubleSided: false,
        shaderTag: 'terrain.deferred',
        shaderFamily: 'opaque',
        resources: {
          albedoTextureArray2D: this.options.textureManager.getTextureArray(),
        },
        constants: {
          color: new Float32Array([1, 1, 1, 1]),
          roughness: 0.8,
          metallic: 0,
        },
        features: {
          receivesLighting: true,
        },
      },
      mainViewVisible: true,
      visibilityMask: 0xffffffff,
      transparent: false,
      castShadow: false,
      receiveShadow: false,
    }
  }

  setAnimationOffsetDelta(offset: { x: number; y: number; z: number }) {
    this.animationOffsetDelta.x = offset.x
    this.animationOffsetDelta.y = offset.y
    this.animationOffsetDelta.z = offset.z
  }

  setAnimationRotationDelta(rotation: { pitch: number; yaw: number; roll: number }) {
    this.animationRotationDelta.pitch = rotation.pitch
    this.animationRotationDelta.yaw = rotation.yaw
    this.animationRotationDelta.roll = rotation.roll
    this.rebuildRelativeRotation()
  }

  updateFromCamera(cameraPosition: Vec3Like, cameraLookTarget: Vec3Like) {
    if (!this.renderObject) {
      return
    }

    vec3.subtract(this.forward, cameraLookTarget as vec3, cameraPosition as vec3)
    if (vec3.squaredLength(this.forward) <= 1e-8) {
      vec3.set(this.forward, 0, 0, -1)
    } else {
      vec3.normalize(this.forward, this.forward)
    }

    vec3.cross(this.right, this.forward, WORLD_UP)
    if (vec3.squaredLength(this.right) <= 1e-8) {
      vec3.set(this.right, 1, 0, 0)
    } else {
      vec3.normalize(this.right, this.right)
    }

    vec3.cross(this.up, this.right, this.forward)

    this.baseOrientation[0] = this.right[0]
    this.baseOrientation[1] = this.right[1]
    this.baseOrientation[2] = this.right[2]
    this.baseOrientation[3] = 0
    this.baseOrientation[4] = this.up[0]
    this.baseOrientation[5] = this.up[1]
    this.baseOrientation[6] = this.up[2]
    this.baseOrientation[7] = 0
    this.baseOrientation[8] = -this.forward[0]
    this.baseOrientation[9] = -this.forward[1]
    this.baseOrientation[10] = -this.forward[2]
    this.baseOrientation[11] = 0
    this.baseOrientation[12] = 0
    this.baseOrientation[13] = 0
    this.baseOrientation[14] = 0
    this.baseOrientation[15] = 1

    mat4.multiply(this.finalOrientation, this.baseOrientation, this.relativeRotation)

    const offsetX = this.baseOffset.x + this.animationOffsetDelta.x
    const offsetY = this.baseOffset.y + this.animationOffsetDelta.y
    const offsetZ = this.baseOffset.z + this.animationOffsetDelta.z
    const cx = cameraPosition[0] ?? 0
    const cy = cameraPosition[1] ?? 0
    const cz = cameraPosition[2] ?? 0

    this.position[0] =
      cx + this.right[0] * offsetX + this.up[0] * offsetY + this.forward[0] * offsetZ
    this.position[1] =
      cy + this.right[1] * offsetX + this.up[1] * offsetY + this.forward[1] * offsetZ
    this.position[2] =
      cz + this.right[2] * offsetX + this.up[2] * offsetY + this.forward[2] * offsetZ

    mat4.fromTranslation(this.transform, [this.position[0], this.position[1], this.position[2]])
    mat4.multiply(this.transform, this.transform, this.finalOrientation)
    mat4.scale(this.transform, this.transform, [this.scale, this.scale, this.scale])

    const radius = this.scale * 0.9
    this.boundsMin[0] = this.position[0] - radius
    this.boundsMin[1] = this.position[1] - radius
    this.boundsMin[2] = this.position[2] - radius
    this.boundsMax[0] = this.position[0] + radius
    this.boundsMax[1] = this.position[1] + radius
    this.boundsMax[2] = this.position[2] + radius
  }

  getRenderObject() {
    return this.renderObject
  }

  hasRenderable() {
    return this.renderObject !== null
  }

  dispose() {
    this.releaseGeometry()
    this.renderObject = null
  }

  private rebuildRelativeRotation() {
    quat.fromEuler(
      this.relativeRotationQuat,
      this.baseRotation.pitch + this.animationRotationDelta.pitch,
      this.baseRotation.yaw + this.animationRotationDelta.yaw,
      this.baseRotation.roll + this.animationRotationDelta.roll,
    )
    mat4.fromQuat(this.relativeRotation, this.relativeRotationQuat)
  }

  private releaseGeometry() {
    if (!this.geometry) {
      return
    }

    this.options.backend.releaseGeometry(this.geometry)
    this.geometry = null
  }
}
