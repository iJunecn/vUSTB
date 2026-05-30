/**
 * render/entity 根层公开 API。
 *
 * 子域（character/、blockEntity/）通过各自的 RenderBridge 组合 EntityRenderBridge，
 * 外部通常只需从子域 bridge 导入；此 barrel 暴露共享的根层基建。
 */
export { EntityRenderBridge } from './EntityRenderBridge'
export { EntityTextureArray, loadEntityImage } from './EntityTextureArray'
export type { EntityRenderGroup, EntityRenderState } from './types'
