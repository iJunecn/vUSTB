import type { CharacterModelType } from './CharacterModelSpec'
import { getCharacterParts, type PartSpec } from './CharacterModelSpec'
import type { CharacterTemplateVariant } from './types'

type VertexSpec = {
  partId: number
  position: readonly [number, number, number]
  normal: readonly [number, number, number]
  uv: readonly [number, number]
}

export type CharacterModelTemplate = {
  textureWidth: number
  textureHeight: number
  partCount: number
  vertexCount: number
  vertexBuffer: WebGLBuffer
  boundsMin: Float32Array
  boundsMax: Float32Array
}

export const ENTITY_MODEL_VERTEX_STRIDE = 36

function appendVec3Bounds(
  boundsMin: Float32Array,
  boundsMax: Float32Array,
  position: readonly [number, number, number],
) {
  boundsMin[0] = Math.min(boundsMin[0], position[0])
  boundsMin[1] = Math.min(boundsMin[1], position[1])
  boundsMin[2] = Math.min(boundsMin[2], position[2])
  boundsMax[0] = Math.max(boundsMax[0], position[0])
  boundsMax[1] = Math.max(boundsMax[1], position[1])
  boundsMax[2] = Math.max(boundsMax[2], position[2])
}

function pushFace(
  vertices: VertexSpec[],
  boundsMin: Float32Array,
  boundsMax: Float32Array,
  partId: number,
  corners: {
    topLeft: readonly [number, number, number]
    topRight: readonly [number, number, number]
    bottomLeft: readonly [number, number, number]
    bottomRight: readonly [number, number, number]
  },
  normal: readonly [number, number, number],
  uvRect: readonly [number, number, number, number],
  textureWidth: number,
  textureHeight: number,
) {
  const [u1, v1, u2, v2] = uvRect
  const insetU1 = (u1 + 0.5) / textureWidth
  const insetU2 = (u2 - 0.5) / textureWidth
  const insetV1 = 1 - (v1 + 0.5) / textureHeight
  const insetV2 = 1 - (v2 - 0.5) / textureHeight

  const uvTopLeft: readonly [number, number] = [insetU1, insetV1]
  const uvTopRight: readonly [number, number] = [insetU2, insetV1]
  const uvBottomLeft: readonly [number, number] = [insetU1, insetV2]
  const uvBottomRight: readonly [number, number] = [insetU2, insetV2]

  const { topLeft, topRight, bottomLeft, bottomRight } = corners

  vertices.push({ partId, position: topLeft, normal, uv: uvTopLeft })
  vertices.push({ partId, position: bottomLeft, normal, uv: uvBottomLeft })
  vertices.push({ partId, position: topRight, normal, uv: uvTopRight })
  vertices.push({ partId, position: bottomLeft, normal, uv: uvBottomLeft })
  vertices.push({ partId, position: bottomRight, normal, uv: uvBottomRight })
  vertices.push({ partId, position: topRight, normal, uv: uvTopRight })

  appendVec3Bounds(boundsMin, boundsMax, topLeft)
  appendVec3Bounds(boundsMin, boundsMax, topRight)
  appendVec3Bounds(boundsMin, boundsMax, bottomLeft)
  appendVec3Bounds(boundsMin, boundsMax, bottomRight)
}

function appendBox(
  vertices: VertexSpec[],
  boundsMin: Float32Array,
  boundsMax: Float32Array,
  part: PartSpec,
  textureWidth: number,
  textureHeight: number,
) {
  const [sx, sy, sz] = part.size
  const [cx, cy, cz] = part.center
  const x0 = cx - sx * 0.5
  const x1 = cx + sx * 0.5
  const y0 = cy - sy * 0.5
  const y1 = cy + sy * 0.5
  const z0 = cz - sz * 0.5
  const z1 = cz + sz * 0.5

  pushFace(
    vertices,
    boundsMin,
    boundsMax,
    part.partId,
    {
      topLeft: [x1, y1, z1],
      topRight: [x1, y1, z0],
      bottomLeft: [x1, y0, z1],
      bottomRight: [x1, y0, z0],
    },
    [1, 0, 0],
    part.uv.right,
    textureWidth,
    textureHeight,
  )

  pushFace(
    vertices,
    boundsMin,
    boundsMax,
    part.partId,
    {
      topLeft: [x0, y1, z0],
      topRight: [x0, y1, z1],
      bottomLeft: [x0, y0, z0],
      bottomRight: [x0, y0, z1],
    },
    [-1, 0, 0],
    part.uv.left,
    textureWidth,
    textureHeight,
  )

  pushFace(
    vertices,
    boundsMin,
    boundsMax,
    part.partId,
    {
      topLeft: [x0, y1, z0],
      topRight: [x1, y1, z0],
      bottomLeft: [x0, y1, z1],
      bottomRight: [x1, y1, z1],
    },
    [0, 1, 0],
    part.uv.top,
    textureWidth,
    textureHeight,
  )

  pushFace(
    vertices,
    boundsMin,
    boundsMax,
    part.partId,
    {
      topLeft: [x0, y0, z1],
      topRight: [x1, y0, z1],
      bottomLeft: [x0, y0, z0],
      bottomRight: [x1, y0, z0],
    },
    [0, -1, 0],
    part.uv.bottom,
    textureWidth,
    textureHeight,
  )

  pushFace(
    vertices,
    boundsMin,
    boundsMax,
    part.partId,
    {
      topLeft: [x0, y1, z1],
      topRight: [x1, y1, z1],
      bottomLeft: [x0, y0, z1],
      bottomRight: [x1, y0, z1],
    },
    [0, 0, 1],
    part.uv.front,
    textureWidth,
    textureHeight,
  )

  pushFace(
    vertices,
    boundsMin,
    boundsMax,
    part.partId,
    {
      topLeft: [x1, y1, z0],
      topRight: [x0, y1, z0],
      bottomLeft: [x1, y0, z0],
      bottomRight: [x0, y0, z0],
    },
    [0, 0, -1],
    part.uv.back,
    textureWidth,
    textureHeight,
  )
}

function writeVertex(view: DataView, byteOffset: number, vertex: VertexSpec) {
  view.setFloat32(byteOffset + 0, vertex.position[0], true)
  view.setFloat32(byteOffset + 4, vertex.position[1], true)
  view.setFloat32(byteOffset + 8, vertex.position[2], true)
  view.setFloat32(byteOffset + 12, vertex.normal[0], true)
  view.setFloat32(byteOffset + 16, vertex.normal[1], true)
  view.setFloat32(byteOffset + 20, vertex.normal[2], true)
  view.setFloat32(byteOffset + 24, vertex.uv[0], true)
  view.setFloat32(byteOffset + 28, vertex.uv[1], true)
  view.setUint8(byteOffset + 32, vertex.partId)
  view.setUint8(byteOffset + 33, 255)
  view.setUint8(byteOffset + 34, 255)
  view.setUint8(byteOffset + 35, 255)
}

function getTemplateVariantPartNames(variant: CharacterTemplateVariant) {
  if (variant === 'right-arm') {
    return new Set(['rightArm', 'rightArmLayer'])
  }

  return null
}

export function buildCharacterGeometry(
  textureWidth: number,
  textureHeight: number,
  variant: CharacterTemplateVariant = 'full-body',
  modelType: CharacterModelType = 'normal',
) {
  const isLegacySkin = textureHeight <= 32
  const allParts = getCharacterParts(modelType, isLegacySkin)

  const includedPartNames = getTemplateVariantPartNames(variant)
  const filteredParts = includedPartNames
    ? allParts.filter(part => includedPartNames.has(part.name))
    : allParts

  const vertices: VertexSpec[] = []
  const boundsMin = new Float32Array([Infinity, Infinity, Infinity])
  const boundsMax = new Float32Array([-Infinity, -Infinity, -Infinity])

  for (let index = 0; index < filteredParts.length; index += 1) {
    appendBox(vertices, boundsMin, boundsMax, filteredParts[index], textureWidth, textureHeight)
  }

  const buffer = new ArrayBuffer(vertices.length * ENTITY_MODEL_VERTEX_STRIDE)
  const view = new DataView(buffer)
  vertices.forEach((vertex, index) => writeVertex(view, index * ENTITY_MODEL_VERTEX_STRIDE, vertex))

  return {
    vertexBytes: new Uint8Array(buffer),
    boundsMin,
    boundsMax,
    parts: filteredParts,
  }
}

export function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Failed to load entity skin: ${url}`))
    image.src = url
  })
}

export function createCharacterModelTemplate(
  gl: WebGL2RenderingContext,
  variant: CharacterTemplateVariant = 'full-body',
  modelType: CharacterModelType = 'normal',
): CharacterModelTemplate {
  const { vertexBytes, boundsMin, boundsMax, parts } = buildCharacterGeometry(
    64,
    64,
    variant,
    modelType,
  )
  const vertexBuffer = gl.createBuffer()
  if (!vertexBuffer) {
    throw new Error('Failed to create entity vertex buffer')
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer)
  gl.bufferData(gl.ARRAY_BUFFER, vertexBytes, gl.STATIC_DRAW)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)

  return {
    textureWidth: 64,
    textureHeight: 64,
    partCount: parts.length,
    vertexCount: vertexBytes.byteLength / ENTITY_MODEL_VERTEX_STRIDE,
    vertexBuffer,
    boundsMin,
    boundsMax,
  }
}
