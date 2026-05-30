/**
 * 运行时资源包目录。
 *
 * 应用启动时从 /packs/index.json 加载，替代编译期生成的常量。
 */

export interface PackIndexEntry {
  key: string
  label: string
  description: string
  directory: string
  maxTextureSize: number
  labPbr: boolean
  sourcePacks: string[]
}

interface PackIndex {
  defaultKey: string
  packs: PackIndexEntry[]
}

let loaded: PackIndex | null = null
let loadingPromise: Promise<PackIndex> | null = null

async function requestResourcePackCatalog(): Promise<PackIndex> {
  const response = await fetch('/packs/index.json')
  if (!response.ok) {
    throw new Error(`Failed to load resource pack index: ${response.status}`)
  }
  const data: PackIndex = await response.json()
  if (!data.packs?.length) {
    throw new Error('Resource pack index contains no packs')
  }
  return data
}

/**
 * 从 /packs/index.json 加载资源包目录。
 * 该调用是幂等的，可用于后台预取，也可在引擎真正启动前等待完成。
 */
export async function loadResourcePackCatalog(): Promise<void> {
  if (loaded) {
    return
  }

  if (!loadingPromise) {
    loadingPromise = requestResourcePackCatalog()
      .then(data => {
        loaded = data
        return data
      })
      .catch(error => {
        loadingPromise = null
        throw error
      })
  }

  await loadingPromise
}

export function preloadResourcePackCatalog() {
  void loadResourcePackCatalog().catch(error => {
    console.warn('[App] Resource pack catalog preload failed', error)
  })
}

export function getResourcePackCatalog(): PackIndex {
  if (!loaded) {
    throw new Error('Resource pack catalog not loaded. Call loadResourcePackCatalog() first.')
  }
  return loaded
}
