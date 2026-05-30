import { pipelineKeyToString, type PipelineKey } from '@render/backend/PipelineKey'

type WebGL2UniformMap = Record<string, WebGLUniformLocation | null>
export type WebGL2PipelineStateContext = Record<string, unknown>

export interface WebGL2PipelineVariant<TUniforms extends WebGL2UniformMap = WebGL2UniformMap> {
  id: string
  program: WebGLProgram
  uniforms: TUniforms
  matches: (key: PipelineKey) => boolean
  applyState?: (gl: WebGL2RenderingContext, context?: WebGL2PipelineStateContext) => void
}

export class WebGL2PipelineLibrary {
  private readonly keys = new Map<string, PipelineKey>()
  private readonly variants = new Map<string, WebGL2PipelineVariant>()

  public register(key: PipelineKey) {
    this.keys.set(pipelineKeyToString(key), { ...key })
  }

  public has(key: PipelineKey) {
    return this.keys.has(pipelineKeyToString(key))
  }

  public get(key: PipelineKey) {
    return this.keys.get(pipelineKeyToString(key)) ?? null
  }

  public list() {
    return [...this.keys.values()]
  }

  public registerVariant<TUniforms extends WebGL2UniformMap>(
    variant: WebGL2PipelineVariant<TUniforms>,
  ) {
    if (this.variants.has(variant.id)) {
      throw new Error(`WebGL2 pipeline variant '${variant.id}' is already registered`)
    }

    this.variants.set(variant.id, variant)
  }

  public getVariant<TUniforms extends WebGL2UniformMap>(id: string) {
    return (this.variants.get(id) as WebGL2PipelineVariant<TUniforms> | undefined) ?? null
  }

  public requireVariant<TUniforms extends WebGL2UniformMap>(id: string) {
    const variant = this.getVariant<TUniforms>(id)
    if (!variant) {
      throw new Error(`Missing WebGL2 pipeline variant '${id}'`)
    }

    return variant
  }

  public resolveVariant<TUniforms extends WebGL2UniformMap = WebGL2UniformMap>(key: PipelineKey) {
    let resolved: WebGL2PipelineVariant<TUniforms> | null = null

    for (const variant of this.variants.values()) {
      if (!variant.matches(key)) {
        continue
      }

      if (resolved) {
        throw new Error(
          `Ambiguous WebGL2 pipeline variant resolution for '${pipelineKeyToString(key)}'`,
        )
      }

      resolved = variant as WebGL2PipelineVariant<TUniforms>
    }

    return resolved
  }

  public matchesVariant(key: PipelineKey, id: string) {
    return this.resolveVariant(key)?.id === id
  }

  public useVariant<TUniforms extends WebGL2UniformMap>(
    gl: WebGL2RenderingContext,
    id: string,
    context?: WebGL2PipelineStateContext,
  ) {
    const variant = this.requireVariant<TUniforms>(id)
    gl.useProgram(variant.program)
    variant.applyState?.(gl, context)
    return variant
  }

  public listVariantPrograms() {
    return [...new Set([...this.variants.values()].map(variant => variant.program))]
  }
}
