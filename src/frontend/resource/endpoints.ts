import type { ResourceDefinition } from '@/engine/config'

export type ResolvedResourceEndpoints = {
  cacheKey: string
  packRoot: string
  compiledBase: string
  assetsBase: string
  textureManifestUrl: string
  textureBinaryUrl: string
  resourceBinaryUrl: string
  variantLutUrl: string
  colormapBase: string
  getColormapUrl(name: 'grass' | 'foliage'): string
}

function joinUrl(base: string, suffix: string): string {
  return `${base.replace(/\/+$/, '')}/${suffix.replace(/^\/+/, '')}`
}

export function resolveResourceEndpoints(resource: ResourceDefinition): ResolvedResourceEndpoints {
  const packRoot = `/packs/${resource.DIRECTORY}`
  const compiledBase = joinUrl(packRoot, 'compiled')
  const assetsBase = joinUrl(packRoot, 'assets')
  const textureManifestUrl = joinUrl(compiledBase, 'textures.manifest.bin.deflate')
  const textureBinaryUrl = joinUrl(compiledBase, 'textures.bin.deflate')
  const resourceBinaryUrl = joinUrl(compiledBase, 'resources.bin.deflate')
  const variantLutUrl = joinUrl(assetsBase, 'variant_lut.png')

  return {
    cacheKey: resource.key,
    packRoot,
    compiledBase,
    assetsBase,
    textureManifestUrl,
    textureBinaryUrl,
    resourceBinaryUrl,
    variantLutUrl,
    colormapBase: assetsBase,
    getColormapUrl(name) {
      return joinUrl(assetsBase, `${name}.png`)
    },
  }
}

export function getResourceEndpointSignature(resource: ResourceDefinition): string {
  const endpoints = resolveResourceEndpoints(resource)
  return [
    endpoints.cacheKey,
    endpoints.packRoot,
    endpoints.compiledBase,
    endpoints.textureManifestUrl,
    endpoints.textureBinaryUrl,
    endpoints.resourceBinaryUrl,
    endpoints.variantLutUrl,
    endpoints.assetsBase,
    endpoints.colormapBase,
  ].join('|')
}
