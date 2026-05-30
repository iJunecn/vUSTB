/**
 * Environment configuration for the vUSTB frontend.
 *
 * Reads from Next.js NEXT_PUBLIC_ env vars at build time.
 * The campus 3D engine is disabled by default; set
 * NEXT_PUBLIC_CAMPUS_ENABLED=true to activate it.
 */

export type EnvConfig = {
  /** Whether the campus 3D engine is enabled. */
  campusEngineEnabled: boolean
  /** Base URL for MCA region files. */
  mcaBaseUrl: string
  /** Base URL for character skin textures. */
  skinBaseUrl: string
  /** Base URL for compiled resource packs. */
  packsBaseUrl: string
}

let _envConfig: EnvConfig | null = null

export function getEnvConfig(): EnvConfig {
  if (_envConfig) return _envConfig

  _envConfig = {
    campusEngineEnabled:
      (typeof process !== 'undefined' &&
        process.env?.NEXT_PUBLIC_CAMPUS_ENABLED === 'true') ||
      false,
    mcaBaseUrl:
      (typeof process !== 'undefined' &&
        process.env?.NEXT_PUBLIC_MCA_BASE_URL) ||
      '/resource/mca/ustb',
    skinBaseUrl:
      (typeof process !== 'undefined' &&
        process.env?.NEXT_PUBLIC_SKIN_BASE_URL) ||
      '/static/skins',
    packsBaseUrl:
      (typeof process !== 'undefined' &&
        process.env?.NEXT_PUBLIC_RESOURCE_PACK_BASE_URL) ||
      '/packs',
  }

  return _envConfig
}
