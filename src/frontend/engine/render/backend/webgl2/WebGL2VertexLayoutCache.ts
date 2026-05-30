import type { VertexLayoutDescriptor } from '@render/layout/VertexLayoutDescriptor'

export class WebGL2VertexLayoutCache {
  private readonly layouts = new Map<string, VertexLayoutDescriptor>()

  public register(layout: VertexLayoutDescriptor) {
    this.layouts.set(layout.id, layout)
  }

  public get(id: string) {
    return this.layouts.get(id) ?? null
  }

  public has(id: string) {
    return this.layouts.has(id)
  }
}
