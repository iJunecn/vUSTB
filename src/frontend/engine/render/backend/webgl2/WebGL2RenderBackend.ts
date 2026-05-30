import type {
  ExternalGeometryArtifact,
  FrameRenderContext,
  GeometryArtifact,
  IRenderBackend,
  ResidentGeometryBinding,
  RenderQueue,
} from '@render/backend/IRenderBackend'
import type { GeometryHandle } from '@render/backend/GeometryHandle'
import { assertPipelineCompatibility } from '@render/backend/PipelineContracts'
import type { VertexLayoutDescriptor } from '@render/layout/VertexLayoutDescriptor'
import { Mesh } from '@render/core/Mesh'
import { WebGL2GeometryResource } from './WebGL2GeometryResource'
import { WebGL2PipelineLibrary } from './WebGL2PipelineLibrary'
import { WebGL2VertexLayoutCache } from './WebGL2VertexLayoutCache'

export class WebGL2RenderBackend implements IRenderBackend {
  public readonly kind = 'webgl2' as const

  private readonly layoutCache = new WebGL2VertexLayoutCache()
  private readonly pipelineLibrary = new WebGL2PipelineLibrary()
  private readonly geometryResources = new Map<number, WebGL2GeometryResource>()
  private nextGeometryId = 1
  private lastFrameId = -1

  constructor(private readonly gl: WebGL2RenderingContext) {}

  /**
   * 读取并校验布局注册表。
   * 任何未注册 layoutId 都在这里尽早失败，避免后续 VAO 配置出现隐式错配。
   */
  private requireRegisteredLayout(layoutId: string) {
    const layout = this.layoutCache.get(layoutId)
    if (!layout) {
      throw new Error(`Layout '${layoutId}' is not registered in WebGL2RenderBackend`)
    }

    return layout
  }

  public getContext() {
    return this.gl
  }

  public registerLayout(layout: VertexLayoutDescriptor): void {
    this.layoutCache.register(layout)
  }

  /**
   * 从 CPU 字节流创建独立几何资源。
   * 适合 terrain section 或一次性生成的静态 mesh。
   */
  public createGeometry(artifact: GeometryArtifact): GeometryHandle {
    const id = this.nextGeometryId++
    const layout = this.requireRegisteredLayout(artifact.layoutId)
    const resource = WebGL2GeometryResource.create(this.gl, id, artifact, layout)
    this.geometryResources.set(id, resource)
    return {
      id,
      kind: 'procedural',
      topology: artifact.topology,
      layoutId: artifact.layoutId,
      resident: null,
      artifactVersion: 1,
      residentVersion: resource.isDrawable ? 1 : 0,
      submeshes: [],
    }
  }

  public createExternalGeometry(
    params: ExternalGeometryArtifact & { resource: Mesh },
  ): GeometryHandle {
    const id = this.nextGeometryId++
    this.requireRegisteredLayout(params.layoutId)
    const resource = WebGL2GeometryResource.createFromMesh(
      id,
      params.layoutId,
      params.topology,
      params.resource,
    )
    this.geometryResources.set(id, resource)

    return {
      id,
      kind: params.kind ?? 'static-model',
      topology: params.topology,
      layoutId: params.layoutId,
      resident: null,
      artifactVersion: 0,
      residentVersion: 1,
      submeshes: [],
    }
  }

  public createResidentGeometry(binding: ResidentGeometryBinding): GeometryHandle {
    const id = this.nextGeometryId++
    const layout = this.requireRegisteredLayout(binding.layoutId)
    const resource = WebGL2GeometryResource.createFromResidentBinding(this.gl, id, binding, layout)
    this.geometryResources.set(id, resource)

    return {
      id,
      kind: 'section',
      topology: binding.topology,
      layoutId: binding.layoutId,
      resident: null,
      artifactVersion: 0,
      residentVersion: 1,
      submeshes: [],
    }
  }

  /**
   * 用新 artifact 整体替换旧几何。
   * WebGL2 侧直接释放旧资源再重建，避免局部更新带来的布局分支。
   */
  public updateGeometry(handle: GeometryHandle, artifact: GeometryArtifact): void {
    this.releaseGeometry(handle)
    const layout = this.requireRegisteredLayout(artifact.layoutId)
    const resource = WebGL2GeometryResource.create(this.gl, handle.id, artifact, layout)
    this.geometryResources.set(handle.id, resource)
    handle.layoutId = artifact.layoutId
    handle.topology = artifact.topology
    handle.artifactVersion += 1
    handle.residentVersion = resource.isDrawable
      ? handle.residentVersion + 1
      : handle.residentVersion
  }

  /**
   * 更新常驻几何绑定。
   * Resident 路径默认复用现有 resource shell，只刷新 buffer/view 关联关系。
   */
  public updateResidentGeometry(handle: GeometryHandle, binding: ResidentGeometryBinding): void {
    const layout = this.requireRegisteredLayout(binding.layoutId)
    const resource = this.geometryResources.get(handle.id)
    if (!resource) {
      throw new Error(`Missing geometry resource for resident geometry ${handle.id}`)
    }

    resource.updateResidentBinding(this.gl, binding, layout)
    handle.layoutId = binding.layoutId
    handle.topology = binding.topology
    handle.residentVersion += 1
  }

  public releaseGeometry(handle: GeometryHandle): void {
    const resource = this.geometryResources.get(handle.id)
    if (!resource) return
    resource.dispose()
    this.geometryResources.delete(handle.id)
  }

  public beginFrame(): void {}

  /**
   * 执行单个 stage 的渲染队列。
   * 外层已经完成桶分组，这里只做 layout 校验、pipeline 注册与逐对象 draw。
   */
  public executeQueue(queue: RenderQueue, frame: FrameRenderContext): void {
    this.lastFrameId = frame.frameId

    for (const bucket of queue.buckets) {
      const layout = this.requireRegisteredLayout(bucket.key.layoutId)
      assertPipelineCompatibility(bucket.key, layout)
      this.pipelineLibrary.register(bucket.key)

      if (frame.beforeBucket?.(bucket) === false) {
        continue
      }

      for (const object of bucket.objects) {
        const resource = this.geometryResources.get(object.geometry.id)
        if (!resource || !resource.isDrawable) continue

        if (frame.beforeObject?.(object, bucket) === false) {
          continue
        }

        resource.draw(this.gl)
        frame.afterObject?.(object, bucket)
      }
    }
  }

  public endFrame(): void {}

  public getGeometryResource(id: number) {
    return this.geometryResources.get(id) ?? null
  }

  public getRegisteredPipelines() {
    return this.pipelineLibrary.list()
  }

  public getLastFrameId() {
    return this.lastFrameId
  }
}
