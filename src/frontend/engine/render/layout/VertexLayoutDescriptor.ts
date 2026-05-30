import type { VertexAttributeDescriptor } from './VertexAttributeDescriptor'

// 布局可服务的渲染域。
export type RenderDomain = 'terrain' | 'entity' | 'decal' | 'debug' | 'particle'

/**
 * @file VertexLayoutDescriptor.ts
 * @brief 顶点布局描述协议
 *
 * 说明：
 *  - 定义单个顶点的步长、属性列表和兼容渲染域
 *  - 约束顶点数据与着色器输入槽位之间的解析关系
 *  - 保持 WebGL2 与 WebGPU 间一致的核心布局语义
 */
export interface VertexLayoutDescriptor {
  id: string
  stride: number
  attributes: VertexAttributeDescriptor[]
  compatibleDomains: RenderDomain[]
  backendHints?: {
    webgl2?: {
      preferVAO: boolean
    }
    wgpu?: {
      stepMode?: 'vertex' | 'instance'
    }
  }
}
