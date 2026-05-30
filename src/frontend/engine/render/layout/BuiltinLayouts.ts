import type { VertexLayoutDescriptor } from './VertexLayoutDescriptor'

export const TERRAIN_COMPACT_LAYOUT_ID = 'terrain.compact.v2'
export const MODEL_STANDARD_LAYOUT_ID = 'model.standard.v1'
export const MODEL_STANDARD_INSTANCED_LAYOUT_ID = 'model.standard.instanced.v1'

export const TERRAIN_COMPACT_LAYOUT: VertexLayoutDescriptor = {
  id: TERRAIN_COMPACT_LAYOUT_ID,
  stride: 32,
  compatibleDomains: ['terrain', 'decal'],
  backendHints: {
    webgl2: { preferVAO: true },
    wgpu: { stepMode: 'vertex' },
  },
  attributes: [
    { location: 0, semantic: 'position', format: 'u32x4', offset: 0, bufferSlot: 0, integer: true },
    { location: 1, semantic: 'custom0', format: 'u32x4', offset: 16, bufferSlot: 0, integer: true },
  ],
}

export const MODEL_STANDARD_LAYOUT: VertexLayoutDescriptor = {
  id: MODEL_STANDARD_LAYOUT_ID,
  stride: 36,
  compatibleDomains: ['entity', 'debug', 'particle'],
  backendHints: {
    webgl2: { preferVAO: true },
    wgpu: { stepMode: 'vertex' },
  },
  attributes: [
    { location: 0, semantic: 'position', format: 'vec3<f32>', offset: 0, bufferSlot: 0 },
    { location: 1, semantic: 'normal', format: 'vec3<f32>', offset: 12, bufferSlot: 0 },
    { location: 2, semantic: 'uv0', format: 'vec2<f32>', offset: 24, bufferSlot: 0 },
    {
      location: 3,
      semantic: 'color0',
      format: 'u8norm4',
      offset: 32,
      bufferSlot: 0,
      normalized: true,
    },
  ],
}

export const MODEL_STANDARD_INSTANCED_LAYOUT: VertexLayoutDescriptor = {
  id: MODEL_STANDARD_INSTANCED_LAYOUT_ID,
  stride: 36,
  compatibleDomains: ['entity', 'debug', 'particle'],
  backendHints: {
    webgl2: { preferVAO: true },
    wgpu: { stepMode: 'instance' },
  },
  attributes: [
    { location: 0, semantic: 'position', format: 'vec3<f32>', offset: 0, bufferSlot: 0 },
    { location: 1, semantic: 'normal', format: 'vec3<f32>', offset: 12, bufferSlot: 0 },
    { location: 2, semantic: 'uv0', format: 'vec2<f32>', offset: 24, bufferSlot: 0 },
    {
      location: 3,
      semantic: 'color0',
      format: 'u8norm4',
      offset: 32,
      bufferSlot: 0,
      normalized: true,
    },
    {
      location: 4,
      semantic: 'custom0',
      format: 'vec4<f32>',
      offset: 0,
      bufferSlot: 1,
      stepMode: 'instance',
    },
    {
      location: 5,
      semantic: 'custom1',
      format: 'vec4<f32>',
      offset: 16,
      bufferSlot: 1,
      stepMode: 'instance',
    },
    {
      location: 6,
      semantic: 'custom2',
      format: 'vec4<f32>',
      offset: 32,
      bufferSlot: 1,
      stepMode: 'instance',
    },
    {
      location: 7,
      semantic: 'custom3',
      format: 'vec4<f32>',
      offset: 48,
      bufferSlot: 1,
      stepMode: 'instance',
    },
    {
      location: 8,
      semantic: 'custom4',
      format: 'vec4<f32>',
      offset: 64,
      bufferSlot: 1,
      stepMode: 'instance',
    },
    {
      location: 9,
      semantic: 'custom5',
      format: 'vec4<f32>',
      offset: 80,
      bufferSlot: 1,
      stepMode: 'instance',
    },
  ],
}
