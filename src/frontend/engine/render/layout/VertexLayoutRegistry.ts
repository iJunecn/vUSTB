import type { VertexLayoutDescriptor } from './VertexLayoutDescriptor'
import {
  MODEL_STANDARD_LAYOUT,
  MODEL_STANDARD_LAYOUT_ID,
  TERRAIN_COMPACT_LAYOUT,
  TERRAIN_COMPACT_LAYOUT_ID,
} from './BuiltinLayouts'

const TERRAIN_COMPACT_LAYOUT_ALIAS = 'terrain-compact'

export class VertexLayoutRegistry {
  private readonly layouts = new Map<string, VertexLayoutDescriptor>()

  constructor() {
    // 先注册内建布局，再补充旧别名映射。
    this.register(TERRAIN_COMPACT_LAYOUT)
    this.register(MODEL_STANDARD_LAYOUT)
    this.layouts.set(TERRAIN_COMPACT_LAYOUT_ALIAS, TERRAIN_COMPACT_LAYOUT)
  }

  public register(layout: VertexLayoutDescriptor) {
    this.layouts.set(layout.id, layout)
  }

  public get(id: string) {
    return this.layouts.get(id) ?? null
  }

  public has(id: string) {
    return this.layouts.has(id)
  }

  public list() {
    return [...this.layouts.values()]
  }

  public get terrainCompact() {
    return this.get(TERRAIN_COMPACT_LAYOUT_ID)
  }

  public get modelStandard() {
    return this.get(MODEL_STANDARD_LAYOUT_ID)
  }
}
