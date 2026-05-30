import type { ResourceDefinition } from '@/engine/config'
import { resolveResourceEndpoints } from '@/resource/endpoints'

const resourceBinaryCache = new Map<string, Promise<Uint8Array>>()

export function getResourceBinaryCacheKey(resource: ResourceDefinition) {
  return resolveResourceEndpoints(resource).resourceBinaryUrl
}

export async function loadResourceBinary(resource: ResourceDefinition) {
  const endpoints = resolveResourceEndpoints(resource)
  const cacheKey = endpoints.resourceBinaryUrl
  const cached = resourceBinaryCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const request = (async () => {
    const response = await fetch(endpoints.resourceBinaryUrl)
    if (!response.ok) {
      throw new Error(`Binary resource not found: ${endpoints.resourceBinaryUrl}`)
    }

    return new Uint8Array(await response.arrayBuffer())
  })()

  resourceBinaryCache.set(cacheKey, request)
  return request
}

export function clearResourceBinaryCache(cacheKey?: string) {
  if (cacheKey) {
    resourceBinaryCache.delete(cacheKey)
    return
  }

  resourceBinaryCache.clear()
}
