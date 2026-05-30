import { GL } from '@render/utils/gl'

type NumericColor = ArrayLike<number> | null | undefined

type SurfaceTextureUniforms = {
  uTextureArray?: WebGLUniformLocation | null
  uHasTexture?: WebGLUniformLocation | null
  uNormalArray?: WebGLUniformLocation | null
  uHasNormalMap?: WebGLUniformLocation | null
  uSpecularArray?: WebGLUniformLocation | null
  uHasSpecularMap?: WebGLUniformLocation | null
  uVariantLUT?: WebGLUniformLocation | null
}

type SurfaceTextureUnits = {
  albedoArray: number
  normalArray?: number
  specularArray?: number
  variantLut?: number
}

export type GeometryMaterialUniforms = {
  uModel?: WebGLUniformLocation | null
  uBaseColor?: WebGLUniformLocation | null
  uRoughness?: WebGLUniformLocation | null
  uMetallic?: WebGLUniformLocation | null
  uDebugCutout?: WebGLUniformLocation | null
  uAlphaCutoff?: WebGLUniformLocation | null
}

export type ForwardMaterialUniforms = {
  uModel?: WebGLUniformLocation | null
  uColor?: WebGLUniformLocation | null
  uRoughness?: WebGLUniformLocation | null
  uMetallic?: WebGLUniformLocation | null
}

export type CharacterAnimationUniforms = {
  uCharacterAnimation?: WebGLUniformLocation | null
}

function readColor3(color: NumericColor, fallback: readonly [number, number, number]) {
  if (!color || color.length < 3) {
    return fallback
  }

  return [color[0], color[1], color[2]] as const
}

function readColor4(color: NumericColor, fallback: readonly [number, number, number, number]) {
  if (!color || color.length < 3) {
    return fallback
  }

  return [color[0], color[1], color[2], color.length >= 4 ? color[3] : fallback[3]] as const
}

export function applyCharacterAnimationUniforms(
  gl: WebGL2RenderingContext,
  uniforms: CharacterAnimationUniforms,
  animation: NumericColor,
) {
  if (!uniforms.uCharacterAnimation) {
    return
  }

  const value = readColor4(animation, [0, 0, 0, 0])
  gl.uniform4f(uniforms.uCharacterAnimation, value[0], value[1], value[2], value[3])
}

export function bindOptionalTextureFlagSampler(
  gl: WebGL2RenderingContext,
  samplerLocation: WebGLUniformLocation | null | undefined,
  enabledLocation: WebGLUniformLocation | null | undefined,
  unit: number,
  target: number,
  texture: WebGLTexture | null,
) {
  if (texture) {
    GL.bindTextureSampler(gl, samplerLocation ?? null, unit, target, texture)
    if (enabledLocation) {
      gl.uniform1i(enabledLocation, 1)
    }
    return
  }

  if (enabledLocation) {
    gl.uniform1i(enabledLocation, 0)
  }
}

export function bindSurfaceTextureSet(
  gl: WebGL2RenderingContext,
  uniforms: SurfaceTextureUniforms,
  units: SurfaceTextureUnits,
  textures: {
    albedoArray: WebGLTexture | null
    normalArray?: WebGLTexture | null
    specularArray?: WebGLTexture | null
    variantLut?: WebGLTexture | null
  },
) {
  bindOptionalTextureFlagSampler(
    gl,
    uniforms.uTextureArray,
    uniforms.uHasTexture,
    units.albedoArray,
    gl.TEXTURE_2D_ARRAY,
    textures.albedoArray,
  )

  if (units.normalArray !== undefined) {
    bindOptionalTextureFlagSampler(
      gl,
      uniforms.uNormalArray,
      uniforms.uHasNormalMap,
      units.normalArray,
      gl.TEXTURE_2D_ARRAY,
      textures.normalArray ?? null,
    )
  }

  if (units.specularArray !== undefined) {
    bindOptionalTextureFlagSampler(
      gl,
      uniforms.uSpecularArray,
      uniforms.uHasSpecularMap,
      units.specularArray,
      gl.TEXTURE_2D_ARRAY,
      textures.specularArray ?? null,
    )
  }

  if (units.variantLut !== undefined && textures.variantLut) {
    GL.bindTextureSampler(
      gl,
      uniforms.uVariantLUT ?? null,
      units.variantLut,
      gl.TEXTURE_2D,
      textures.variantLut,
    )
  }
}

export function clearSurfaceTextureSet(
  gl: WebGL2RenderingContext,
  units: SurfaceTextureUnits,
  textures: {
    albedoArray: WebGLTexture | null
    normalArray?: WebGLTexture | null
    specularArray?: WebGLTexture | null
    variantLut?: WebGLTexture | null
  },
) {
  if (textures.albedoArray) {
    GL.clearTextureUnit(gl, units.albedoArray, gl.TEXTURE_2D_ARRAY)
  }
  if (units.normalArray !== undefined && textures.normalArray) {
    GL.clearTextureUnit(gl, units.normalArray, gl.TEXTURE_2D_ARRAY)
  }
  if (units.specularArray !== undefined && textures.specularArray) {
    GL.clearTextureUnit(gl, units.specularArray, gl.TEXTURE_2D_ARRAY)
  }
  if (units.variantLut !== undefined && textures.variantLut) {
    GL.clearTextureUnit(gl, units.variantLut, gl.TEXTURE_2D)
  }
}

export function applyGeometryMaterialUniforms(
  gl: WebGL2RenderingContext,
  uniforms: GeometryMaterialUniforms,
  material: {
    modelMatrix?: Float32Array
    color?: NumericColor
    roughness?: number
    metallic?: number
    debugCutout?: boolean
    alphaCutoff?: number
  },
  defaults: {
    color?: readonly [number, number, number]
    roughness?: number
    metallic?: number
  } = {},
) {
  const baseColor = readColor3(material.color, defaults.color ?? [1, 1, 1])
  const roughness = material.roughness ?? defaults.roughness ?? 0.8
  const metallic = material.metallic ?? defaults.metallic ?? 0.0

  if (uniforms.uModel && material.modelMatrix) {
    gl.uniformMatrix4fv(uniforms.uModel, false, material.modelMatrix)
  }
  if (uniforms.uDebugCutout) {
    gl.uniform1f(uniforms.uDebugCutout, material.debugCutout ? 1.0 : 0.0)
  }
  if (uniforms.uAlphaCutoff) {
    gl.uniform1f(uniforms.uAlphaCutoff, material.alphaCutoff ?? 0.0)
  }
  if (uniforms.uBaseColor) {
    gl.uniform3f(uniforms.uBaseColor, baseColor[0], baseColor[1], baseColor[2])
  }
  if (uniforms.uRoughness) {
    gl.uniform1f(uniforms.uRoughness, roughness)
  }
  if (uniforms.uMetallic) {
    gl.uniform1f(uniforms.uMetallic, metallic)
  }
}

export function applyForwardMaterialUniforms(
  gl: WebGL2RenderingContext,
  uniforms: ForwardMaterialUniforms,
  material: {
    modelMatrix?: Float32Array
    color?: NumericColor
    roughness?: number
    metallic?: number
  },
  defaults: {
    color?: readonly [number, number, number, number]
    roughness?: number
    metallic?: number
  } = {},
) {
  const baseColor = readColor4(material.color, defaults.color ?? [1, 1, 1, 1])
  const roughness = material.roughness ?? defaults.roughness ?? 0.7
  const metallic = material.metallic ?? defaults.metallic ?? 0.0

  if (uniforms.uModel && material.modelMatrix) {
    gl.uniformMatrix4fv(uniforms.uModel, false, material.modelMatrix)
  }
  if (uniforms.uColor) {
    gl.uniform4f(uniforms.uColor, baseColor[0], baseColor[1], baseColor[2], baseColor[3])
  }
  if (uniforms.uRoughness) {
    gl.uniform1f(uniforms.uRoughness, roughness)
  }
  if (uniforms.uMetallic) {
    gl.uniform1f(uniforms.uMetallic, metallic)
  }
}
