import { LightManager } from './core/lighting/LightManager'
import { GBuffer } from './core/buffer/GBuffer'
import { Camera } from './core/scene/Camera'
import { FrameBuffer } from './core/buffer/FrameBuffer'
import { GeometryPass } from './passes/GeometryPass'
import { LightingPass, type LightingPassRenderParams } from './passes/LightingPass'
import { ShadowPass } from './passes/ShadowPass'
import { ForwardPass, type ForwardPassRenderParams } from './passes/ForwardPass'
import { PostProcessPass } from './passes/PostProcessPass'
import { ScreenEffectComposer } from './passes/ui/ScreenEffectComposer'
import { SSAOPass } from './passes/SSAOPass'
import { SelectionOutlinePass, type SelectionOutline } from './passes/SelectionOutlinePass'
import { DepthPrePass } from './passes/DepthPrePass'
import { PointShadowPass } from './passes/PointShadowPass'
import { GL } from './utils/gl'
import { GAME_CONFIG } from '@/engine/config'
import type { EngineRuntimeLightingConfig } from '@/config/runtime'
import { runtimeDebug } from '@/engine/debug/runtimeDebug'
import {
  drawCallStats,
  type DrawCallPassName,
  type DrawCallStatsSnapshot,
} from './debug/DrawCallStats'
import { UniformBuffer } from './core/buffer/UniformBuffer'
import { FrameUniforms } from './core/buffer/FrameUniforms'
import { mat4 } from './utils/math'
import { LightCuller } from './core/lighting/LightCuller'
import type { IRenderBackend, RenderQueue } from './backend/IRenderBackend'
import type { Ui3dComponentInstance } from './ui3d/Ui3dComponent'

type DepthPrePassStageParams = {
  textureArray: WebGLTexture | null
  terrainGeometryQueue: RenderQueue | null
  renderBackend: IRenderBackend | null
}

type GeometryStageParams = {
  textureArray: WebGLTexture | null
  normalArray: WebGLTexture | null
  specularArray: WebGLTexture | null
  variantLUT: WebGLTexture | null
  useZPrepass: boolean
  terrainGeometryQueue: RenderQueue | null
  renderBackend: IRenderBackend | null
}

type LightingStageParams = {
  usePointLights: boolean
  useSSAO: boolean
  useClustered: boolean
  usePointShadows: boolean
}

type ForwardStageParams = {
  terrainForwardQueue: RenderQueue | null
  renderBackend: IRenderBackend | null
  textureArray: WebGLTexture | null
  normalArray: WebGLTexture | null
  specularArray: WebGLTexture | null
  usePointLights: boolean
}

// 生成 Halton 序列。
function halton(index: number, base: number) {
  let result = 0
  let f = 1 / base
  let i = index
  while (i > 0) {
    result = result + f * (i % base)
    i = Math.floor(i / base)
    f = f / base
  }
  return result
}

/**
 * @file Renderer.ts
 * @brief 渲染器主控类
 *
 * 说明：
 *  - 管理完整渲染流水线的初始化、阶段调度与资源生命周期
 *  - 维护 G-Buffer、历史纹理、UBO 与各类离屏缓冲
 *  - 按顺序驱动深度、阴影、几何、光照、前向与后处理阶段
 */
export class Renderer {
  private gl: WebGL2RenderingContext
  public canvas: HTMLCanvasElement
  public lightManager: LightManager
  private lightingConfig: EngineRuntimeLightingConfig = {
    enablePointLights: GAME_CONFIG.RENDER.LIGHTING.ENABLE_POINT_LIGHTS,
    enableVertexLighting: GAME_CONFIG.RENDER.LIGHTING.ENABLE_VERTEX_LIGHTING,
    enableSmoothLighting: GAME_CONFIG.RENDER.LIGHTING.ENABLE_SMOOTH_LIGHTING,
  }

  // 调试读回缓存，使用小尺寸 RGBA8 目标。
  private debugReadbackFbo: WebGLFramebuffer | null = null
  private debugReadbackTex: WebGLTexture | null = null
  private debugReadbackW: number = 0
  private debugReadbackH: number = 0

  // 阴影资源覆写，供移动端或自定义管线使用。
  private shadowMapOverride: WebGLTexture | null = null
  private shadowColorOverride: WebGLTexture | null = null
  private shadowBiasScaleOverride: number | null = null

  // Uniform Buffer 资源。
  public cameraUBO: UniformBuffer
  public sceneUBO: UniformBuffer
  public frameUniforms: FrameUniforms

  // 渲染管线核心资源。
  public gBuffer: GBuffer
  private compositionFrameBuffer: FrameBuffer // 最终合成目标 FBO
  private lightingFrameBuffer: FrameBuffer // 光照结果输出 FBO
  private compositionTexture: WebGLTexture // 合成颜色纹理
  private postProcessFrameBuffer: FrameBuffer
  private postProcessTexture: WebGLTexture

  // WBOIT 资源。
  private wboitFrameBuffer: FrameBuffer
  private accumTexture: WebGLTexture
  private revealTexture: WebGLTexture

  // TAA 资源。
  private historyTexture: WebGLTexture
  private frameIndex: number = 0
  private prevViewProjMatrix: Float32Array = new Float32Array(16)
  private jitteredVP: Float32Array = new Float32Array(16) // 当前帧抖动后的 VP 矩阵
  private jitteredInverseVP: Float32Array = new Float32Array(16) // 当前帧抖动后的逆 VP 矩阵
  private hasHistory: boolean = false

  // 渲染阶段对象。
  private depthPrePass: DepthPrePass
  private geometryPass: GeometryPass
  private ssaoPass: SSAOPass
  private lightingPass: LightingPass
  public shadowPass: ShadowPass
  private pointShadowPass: PointShadowPass
  private lightCuller: LightCuller
  private forwardPass: ForwardPass
  private selectionOutlinePass: SelectionOutlinePass
  private postProcessPass: PostProcessPass
  private screenEffectComposer: ScreenEffectComposer

  // 平台标记，仅用于相机与性能策略。
  public readonly isMobile: boolean
  public readonly shadowMapResolution: number

  // 场景级共享状态。
  public camera: Camera
  public sunDirection: Float32Array = new Float32Array(GAME_CONFIG.RENDER.LIGHTING.SUN_DIRECTION)
  public sunColor: Float32Array = new Float32Array(GAME_CONFIG.RENDER.LIGHTING.SUN_COLOR)
  public lights: Float32Array = new Float32Array(0)

  // 环境光参数。
  public ambientSkyColor: Float32Array = new Float32Array([0.2, 0.3, 0.5])
  public ambientGroundColor: Float32Array = new Float32Array([0.08, 0.07, 0.06])
  public ambientIntensity: number = 0.6
  public iblIntensity: number = 0.3
  private backendFrameId = 1

  /**
   * 随机云层覆盖率, 每次创建 Renderer 时随机生成。
   * 权重: 晴天薄云 0.30, 少云 0.30, 多云 0.30, 阴天 0.10。
   * 数值本身也刻意拉开，避免视觉上塌成只有“厚云/稍薄”两档。
   */
  public cloudCover: number

  public getLastFrameDrawCallStats(): DrawCallStatsSnapshot {
    return drawCallStats.getLastFrameStats()
  }

  public setUi3dComponents(components: readonly Ui3dComponentInstance[]) {
    this.screenEffectComposer.setUi3dComponents(components)
  }

  public setUi3dTransparentBackground(enabled: boolean) {
    this.screenEffectComposer.setTransparentBackground(enabled)
  }

  private executeTrackedPass(passName: DrawCallPassName, action: () => void) {
    drawCallStats.setCurrentPass(passName)
    try {
      action()
    } finally {
      drawCallStats.clearCurrentPass()
    }
  }

  /**
   * 设置阴影纹理覆盖，用于移动端或自定义阴影管线。
   * 传入 `null` 可恢复默认的 ShadowPass 输出。
   */
  public setShadowOverride(
    shadowMap: WebGLTexture | null,
    shadowColorMap: WebGLTexture | null = null,
  ) {
    this.shadowMapOverride = shadowMap
    this.shadowColorOverride = shadowColorMap
  }

  /**
   * 设置阴影 bias 缩放覆盖，主要用于移动端放大阴影偏移。
   * 传入 `null` 时恢复默认缩放 1.0。
   */
  public setShadowBiasScaleOverride(scale: number | null) {
    this.shadowBiasScaleOverride = scale
  }

  /** 清除阴影覆盖，恢复默认 ShadowPass 输出与 bias 缩放。 */
  public clearShadowOverride() {
    this.shadowMapOverride = null
    this.shadowColorOverride = null
    this.shadowBiasScaleOverride = null
  }

  private ensureDebugReadbackTarget(width: number, height: number) {
    const gl = this.gl
    if (
      this.debugReadbackFbo &&
      this.debugReadbackTex &&
      this.debugReadbackW === width &&
      this.debugReadbackH === height
    ) {
      return
    }

    if (!this.debugReadbackFbo) this.debugReadbackFbo = gl.createFramebuffer()
    if (!this.debugReadbackTex) this.debugReadbackTex = gl.createTexture()
    if (!this.debugReadbackFbo || !this.debugReadbackTex) {
      throw new Error('[Renderer] Failed to create debug readback target')
    }

    this.debugReadbackW = width
    this.debugReadbackH = height

    gl.bindTexture(gl.TEXTURE_2D, this.debugReadbackTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.debugReadbackFbo)
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      this.debugReadbackTex,
      0,
    )
    gl.drawBuffers([gl.COLOR_ATTACHMENT0])
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindTexture(gl.TEXTURE_2D, null)
  }

  private debugBlitAndReadRGBA8(
    srcFbo: WebGLFramebuffer,
    srcW: number,
    srcH: number,
    readAttachment: number,
    outW: number,
    outH: number,
  ) {
    const gl = this.gl
    this.ensureDebugReadbackTarget(outW, outH)
    if (!this.debugReadbackFbo) throw new Error('[Renderer] Debug readback FBO missing')

    const prevReadFb = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
    const prevDrawFb = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
    const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array

    try {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, srcFbo)
      gl.readBuffer(readAttachment)

      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.debugReadbackFbo)
      gl.drawBuffers([gl.COLOR_ATTACHMENT0])
      gl.blitFramebuffer(0, 0, srcW, srcH, 0, 0, outW, outH, gl.COLOR_BUFFER_BIT, gl.NEAREST)

      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.debugReadbackFbo)
      gl.readBuffer(gl.COLOR_ATTACHMENT0)
      const pixels = new Uint8Array(outW * outH * 4)
      gl.readPixels(0, 0, outW, outH, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
      return pixels
    } finally {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, prevReadFb)
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevDrawFb)
      gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3])
    }
  }

  /**
   * Debug: read one GBuffer color attachment (downsampled to outW/outH).
   */
  public debugReadGBufferRGBA8(attachmentIndex: 0 | 1 | 2, outW: number, outH: number) {
    const gl = this.gl
    const attachment = (gl.COLOR_ATTACHMENT0 + attachmentIndex) as number
    return this.debugBlitAndReadRGBA8(
      this.gBuffer.frameBuffer.fbo,
      this.gBuffer.width,
      this.gBuffer.height,
      attachment,
      outW,
      outH,
    )
  }

  /**
   * Debug: read the current lighting output (compositionTexture) from lightingFrameBuffer.
   */
  public debugReadFinalRGBA8(outW: number, outH: number) {
    const gl = this.gl
    return this.debugBlitAndReadRGBA8(
      this.lightingFrameBuffer.fbo,
      this.canvas.width,
      this.canvas.height,
      gl.COLOR_ATTACHMENT0,
      outW,
      outH,
    )
  }

  /**
   * 构造渲染器并初始化全部核心渲染资源。
   * @param canvas 目标画布
   * @throws Error 当浏览器不支持 WebGL2 时抛出
   */
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
    })
    if (!gl) throw new Error('WebGL2 not supported')
    this.gl = gl

    this.ensureExtensions()

    const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : ''
    this.isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua)

    // Core setup
    this.shadowMapResolution = GAME_CONFIG.RENDER.SHADOW.MAP_SIZE
    this.lightManager = new LightManager(gl)

    const width = canvas.width
    const height = canvas.height

    // Initialize GBuffer
    this.gBuffer = new GBuffer(gl, width, height, this.isMobile)

    const near = GAME_CONFIG.RENDER.NEAR_PLANE
    const far = GAME_CONFIG.RENDER.FAR_PLANE
    this.camera = new Camera(
      GAME_CONFIG.RENDER.FOV,
      width / height,
      near,
      far,
      GAME_CONFIG.RENDER.REVERSE_Z,
    )
    this.camera.update() // Ensure matrices are initialized

    // Initialize UBOs
    // Camera: view(64) + proj(64) + viewProj(64) + invViewProj(64) + viewPos(16) = 272 bytes
    this.cameraUBO = new UniformBuffer(gl, 272, 0)
    // Scene: sunDir(16) + sunColor(16) + ambSky(16) + ambGnd(16) + params(16) + lightMatrices(256) + splits(16) = 352 bytes
    this.sceneUBO = new UniformBuffer(gl, 352, 1)
    this.frameUniforms = new FrameUniforms(gl)

    // 随机云层覆盖率: 晴天薄云 30%, 少云 30%, 多云 30%, 阴天 10%
    // 这里不再等概率抽档，否则厚云会明显过多。
    const cloudRoll = Math.random()
    if (cloudRoll < 0.3) {
      this.cloudCover = 0.08
    } else if (cloudRoll < 0.6) {
      this.cloudCover = 0.2
    } else if (cloudRoll < 0.9) {
      this.cloudCover = 0.42
    } else {
      this.cloudCover = 0.65
    }

    // 初始化合成 FBO，用于存储最终渲染结果，并与 G-Buffer 共享深度缓冲。
    this.compositionFrameBuffer = new FrameBuffer(gl, width, height)
    this.compositionTexture = GL.createTexture(gl, width, height, {
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
    })

    this.compositionFrameBuffer.attachTexture(this.compositionTexture, gl.COLOR_ATTACHMENT0)
    this.compositionFrameBuffer.attachTexture(this.gBuffer.depth, gl.DEPTH_ATTACHMENT)
    this.compositionFrameBuffer.setDrawBuffers([gl.COLOR_ATTACHMENT0])
    this.compositionFrameBuffer.checkStatus()
    this.compositionFrameBuffer.unbind()

    // 初始化光照 FBO，仅包含颜色附件，避免读取 G-Buffer 深度时产生反馈回路。
    this.lightingFrameBuffer = new FrameBuffer(gl, width, height)
    this.lightingFrameBuffer.attachTexture(this.compositionTexture, gl.COLOR_ATTACHMENT0)
    this.lightingFrameBuffer.setDrawBuffers([gl.COLOR_ATTACHMENT0])
    this.lightingFrameBuffer.checkStatus()
    this.lightingFrameBuffer.unbind()

    this.postProcessFrameBuffer = new FrameBuffer(gl, width, height)
    this.postProcessTexture = GL.createTexture(gl, width, height, {
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
    })
    this.postProcessFrameBuffer.attachTexture(this.postProcessTexture, gl.COLOR_ATTACHMENT0)
    this.postProcessFrameBuffer.setDrawBuffers([gl.COLOR_ATTACHMENT0])
    this.postProcessFrameBuffer.checkStatus()
    this.postProcessFrameBuffer.unbind()

    // 初始化 WBOIT FBO。
    this.wboitFrameBuffer = new FrameBuffer(gl, width, height)

    // Accumulation Buffer: RGBA16F，用于存储加权颜色与权重和。
    this.accumTexture = GL.createTexture(gl, width, height, {
      internalFormat: gl.RGBA16F,
      format: gl.RGBA,
      type: gl.HALF_FLOAT,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
    })

    // Revealage Buffer: R8，用于存储透射率。
    this.revealTexture = GL.createTexture(gl, width, height, {
      internalFormat: gl.R8,
      format: gl.RED,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
    })

    // Init TAA History Texture (Linear/RGB8/RGBA8)
    // 可选优化：可改用 GL.R11F_G11F_B10F 进一步降低带宽占用。
    // 当前仍使用 RGBA8 以保证兼容性。
    this.historyTexture = GL.createTexture(gl, width, height, {
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      minFilter: gl.LINEAR,
      magFilter: gl.LINEAR,
      wrapS: gl.CLAMP_TO_EDGE,
      wrapT: gl.CLAMP_TO_EDGE,
    })

    this.wboitFrameBuffer.attachTexture(this.accumTexture, gl.COLOR_ATTACHMENT0)
    this.wboitFrameBuffer.attachTexture(this.revealTexture, gl.COLOR_ATTACHMENT1)
    this.wboitFrameBuffer.attachTexture(this.gBuffer.depth, gl.DEPTH_ATTACHMENT) // 共享深度附件
    this.wboitFrameBuffer.setDrawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    this.wboitFrameBuffer.checkStatus()
    this.wboitFrameBuffer.unbind()

    this.depthPrePass = new DepthPrePass(gl)
    this.geometryPass = new GeometryPass(gl)
    this.ssaoPass = new SSAOPass(gl, width, height)
    this.lightingPass = new LightingPass(gl)
    const cascadeCount = GAME_CONFIG.RENDER.SHADOW.CASCADE_SPLITS.length
    this.shadowPass = new ShadowPass(gl, this.shadowMapResolution, cascadeCount)
    const lightingCfg = GAME_CONFIG.RENDER.LIGHTING
    this.pointShadowPass = new PointShadowPass(
      gl,
      lightingCfg.POINT_SHADOW_MAP_SIZE,
      lightingCfg.POINT_SHADOW_MAX_LIGHTS,
    )
    this.lightCuller = new LightCuller(gl, width, height, {
      dimX: lightingCfg.CLUSTER_DIM_X,
      dimY: lightingCfg.CLUSTER_DIM_Y,
      dimZ: lightingCfg.CLUSTER_DIM_Z,
      maxLights: lightingCfg.CLUSTER_MAX_LIGHTS,
    })
    this.forwardPass = new ForwardPass(gl)
    this.selectionOutlinePass = new SelectionOutlinePass(gl)
    this.postProcessPass = new PostProcessPass(gl)
    this.screenEffectComposer = new ScreenEffectComposer(gl, width, height)
  }

  /**
   * 启用渲染管线依赖的 WebGL 扩展。
   */
  private ensureExtensions() {
    this.gl.getExtension('EXT_color_buffer_float')
    this.gl.getExtension('OES_texture_float_linear')
    this.gl.getExtension('OES_draw_buffers_indexed')
  }

  /**
   * 验证深度缓冲资源是否可用。
   */
  private validateDepthBuffer(stage: string) {
    if (!this.gBuffer.depth) {
      console.error(`[Renderer] Critical: G-Buffer depth texture is missing at ${stage}!`)
      return false
    }
    return true
  }

  /**
   * 响应窗口尺寸变化，同步更新所有 FBO 与纹理资源。
   * @param width 新宽度
   * @param height 新高度
   */
  resize(width: number, height: number) {
    this.canvas.width = width
    this.canvas.height = height
    this.gBuffer.resize(this.gl, width, height)
    this.compositionFrameBuffer.resize(width, height)
    this.lightingFrameBuffer.resize(width, height)
    this.postProcessFrameBuffer.resize(width, height)
    this.wboitFrameBuffer.resize(width, height)
    this.ssaoPass.resize(width, height)
    this.lightCuller.resize(width, height)
    this.screenEffectComposer.resize(width, height)

    GL.resizeTexture(
      this.gl,
      this.compositionTexture,
      width,
      height,
      this.gl.RGBA8,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
    )
    GL.resizeTexture(
      this.gl,
      this.accumTexture,
      width,
      height,
      this.gl.RGBA16F,
      this.gl.RGBA,
      this.gl.HALF_FLOAT,
    )
    GL.resizeTexture(
      this.gl,
      this.revealTexture,
      width,
      height,
      this.gl.R8,
      this.gl.RED,
      this.gl.UNSIGNED_BYTE,
    )
    GL.resizeTexture(
      this.gl,
      this.postProcessTexture,
      width,
      height,
      this.gl.RGBA8,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
    )

    // TAA History Texture Resize
    // IMPORTANT: When resizing, the history content becomes invalid for the new size.
    // We must recreate/resize it and explicitly clear the history flag to prevent reading garbage/overflow.
    GL.resizeTexture(
      this.gl,
      this.historyTexture,
      width,
      height,
      this.gl.RGBA8,
      this.gl.RGBA,
      this.gl.UNSIGNED_BYTE,
    )
    this.hasHistory = false // Force TAA to discard next frame's history read
  }

  /**
   * 调试工具：导出当前帧的 G-Buffer 与最终光照结果。
   */
  public captureDebugSnapshots() {
    const gl = this.gl
    const width = this.canvas.width
    const height = this.canvas.height

    // Helper to download data
    const download = (data: Uint8Array, filename: string) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const imageData = ctx.createImageData(width, height)

      // Flip Y (WebGL to Canvas)
      const stride = width * 4
      for (let y = 0; y < height; y++) {
        const srcRow = (height - 1 - y) * stride
        const dstRow = y * stride
        for (let i = 0; i < stride; i++) {
          imageData.data[dstRow + i] = data[srcRow + i]
        }
      }

      ctx.putImageData(imageData, 0, 0)
      const link = document.createElement('a')
      link.download = filename
      link.href = canvas.toDataURL('image/png')
      link.click()
    }

    const pixels = new Uint8Array(width * height * 4)

    // 1. Capture RT0 (Albedo)
    this.gBuffer.frameBuffer.bind()
    gl.readBuffer(gl.COLOR_ATTACHMENT0)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    download(pixels, `debug_frame_rt0_albedo.png`)

    // 2. Capture RT1 (Normal)
    gl.readBuffer(gl.COLOR_ATTACHMENT1)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    download(pixels, `debug_frame_rt1_normal.png`)

    // 3. Capture RT2 (Data)
    gl.readBuffer(gl.COLOR_ATTACHMENT2)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    download(pixels, `debug_frame_rt2_pbr.png`)

    // 4. Capture Final Composition
    this.lightingFrameBuffer.bind() // Composition texture is here
    gl.readBuffer(gl.COLOR_ATTACHMENT0)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    download(pixels, `debug_frame_final.png`)

    // Restore
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    console.log('[Renderer] Debug snapshots captured (Check Downloads)')
  }

  /**
   * 执行完整渲染流水线。
   *
   * 流程概览：
   * 1. Shadow Pass：生成级联阴影贴图
   * 2. Depth Pre-Pass：预写深度
   * 3. Geometry Pass：填充 G-Buffer
   * 4. Lighting Pass：执行延迟光照
   * 5. Forward Pass：渲染半透明与前向内容
   * 6. Post-Process Pass：执行 TAA、Tone Mapping 与屏幕合成
   *
   * @param textureArray 纹理数组 (Texture2DArray)
   * @param normalArray 法线纹理数组
   * @param specularArray 高光/PBR 纹理数组
   * @param lightSpaceMatrices 光空间矩阵数组 (CSM)
   * @param cascadeSplits 级联分割距离数组
   * @param fogStart 雾效起始距离
   * @param fogEnd 雾效结束距离
   * @param fogColor 雾效颜色
   */
  render(
    textureArray: WebGLTexture | null = null,
    normalArray: WebGLTexture | null = null,
    specularArray: WebGLTexture | null = null,
    variantLUT: WebGLTexture | null = null,
    lightSpaceMatrices: Float32Array[] | null = null,
    cascadeSplits: Float32Array | null = null,
    fogStart: number = GAME_CONFIG.RENDER.FOG.START,
    fogEnd: number = GAME_CONFIG.RENDER.FOG.END,
    fogColor: Float32Array = new Float32Array(GAME_CONFIG.RENDER.FOG.COLOR),
    terrainQueues: RenderQueue[] | null = null,
    renderBackend: IRenderBackend | null = null,
    selectionOutline: SelectionOutline | null = null,
  ) {
    drawCallStats.beginFrame()
    const terrainGeometryQueue = terrainQueues?.find(queue => queue.stage === 'geometry') ?? null
    const terrainForwardQueue = terrainQueues?.find(queue => queue.stage === 'forward') ?? null

    if (renderBackend) {
      renderBackend.beginFrame()
    }

    const width = this.canvas.width
    const height = this.canvas.height

    // Read graphics settings
    const useShadows = GAME_CONFIG.RENDER.SHADOW.ENABLED
    const usePBR = GAME_CONFIG.RENDER.LIGHTING.ENABLE_PBR
    const lightingCfg = {
      ...GAME_CONFIG.RENDER.LIGHTING,
      ENABLE_POINT_LIGHTS: this.lightingConfig.enablePointLights,
      ENABLE_VERTEX_LIGHTING: this.lightingConfig.enableVertexLighting,
      ENABLE_SMOOTH_LIGHTING:
        this.lightingConfig.enableVertexLighting && this.lightingConfig.enableSmoothLighting,
    }
    const usePointLights = lightingCfg.ENABLE_POINT_LIGHTS
    const useVertexLighting = lightingCfg.ENABLE_VERTEX_LIGHTING
    const useSSAO = lightingCfg.ENABLE_SSAO
    const useClustered = lightingCfg.ENABLE_CLUSTERED_LIGHTS
    const usePointShadows = lightingCfg.ENABLE_POINT_SHADOWS
    // Prepare lighting matrices
    const finalLightSpaceMatrices =
      lightSpaceMatrices || GAME_CONFIG.RENDER.SHADOW.DEFAULT_LIGHT_MATRICES
    const finalCascadeSplits =
      cascadeSplits || new Float32Array(GAME_CONFIG.RENDER.SHADOW.CASCADE_SPLITS)

    const shadowBiasScale = this.shadowBiasScaleOverride ?? 1.0

    // =========================================================================
    // Update Uniform Buffers (Scene & Camera)
    // =========================================================================
    this.updateSceneUniforms(finalLightSpaceMatrices, finalCascadeSplits)
    this.updateCameraUniforms(width, height)
    this.updateFrameUniforms(
      width,
      height,
      fogStart,
      fogEnd,
      fogColor,
      usePBR,
      useShadows,
      usePointLights,
      useVertexLighting,
      shadowBiasScale,
      this.isMobile ? 1 : 0,
      this.isMobile && !!this.gBuffer.linearDepth,
      lightingCfg.POINT_SHADOW_BIAS,
      this.cloudCover,
    )

    // =========================================================================
    // PASS 1: Shadow Pass - 生成级联阴影贴图 (CSM)
    // =========================================================================
    if (useShadows && !this.shadowMapOverride) {
      this.executeTrackedPass('shadow', () => {
        this.shadowPass.render(
          finalLightSpaceMatrices,
          textureArray,
          terrainGeometryQueue,
          terrainForwardQueue,
          renderBackend,
          this.backendFrameId,
        )
      })
    }

    // =========================================================================
    // PASS 1.5: Depth Pre-Pass (Z-Prepass)
    // =========================================================================
    const useZPrepass = true
    if (useZPrepass) {
      this.executeTrackedPass('depth-prepass', () => {
        this.renderDepthPrePass({
          textureArray,
          terrainGeometryQueue,
          renderBackend,
        })
      })
    }

    // =========================================================================
    // PASS 2: Geometry Pass - 执行几何阶段并填充 G-Buffer
    // =========================================================================
    this.executeTrackedPass('geometry', () => {
      this.renderGeometryPass({
        textureArray,
        normalArray,
        specularArray,
        variantLUT,
        useZPrepass,
        terrainGeometryQueue,
        renderBackend,
      })
    })

    // =========================================================================
    // PASS 2.5: SSAO Pass
    // =========================================================================
    if (useSSAO) {
      this.executeTrackedPass('ssao', () => {
        this.ssaoPass.render(
          this.gBuffer.RT1,
          this.gBuffer.depth,
          this.camera.projectionMatrix,
          this.camera.getNear(),
          this.camera.getFar(),
          this.camera.inverseProjectionMatrix,
          this.camera.viewMatrix,
        )
      })
    }

    const selectedLights = this.lightManager.getSelectedLights()
    const hasPointLights = usePointLights && this.lightManager.numLights > 0

    if (useClustered && hasPointLights) {
      this.lightCuller.updateConfig({
        dimX: lightingCfg.CLUSTER_DIM_X,
        dimY: lightingCfg.CLUSTER_DIM_Y,
        dimZ: lightingCfg.CLUSTER_DIM_Z,
        maxLights: lightingCfg.CLUSTER_MAX_LIGHTS,
      })
      this.lightCuller.build(
        selectedLights,
        this.lightManager.numLights,
        this.camera.viewMatrix,
        this.camera.projectionMatrix,
        this.camera.getNear(),
        this.camera.getFar(),
      )
    }

    if (usePointShadows && hasPointLights) {
      this.pointShadowPass.updateConfig(
        lightingCfg.POINT_SHADOW_MAP_SIZE,
        lightingCfg.POINT_SHADOW_MAX_LIGHTS,
      )
      this.executeTrackedPass('point-shadow', () => {
        this.pointShadowPass.render(
          textureArray,
          selectedLights,
          this.lightManager.numLights,
          this.camera.positionArray,
          terrainGeometryQueue,
          renderBackend,
          this.backendFrameId,
        )
      })
    }

    // =========================================================================
    // PASS 3: Lighting Pass - 执行 PBR 延迟光照计算
    // =========================================================================
    this.executeTrackedPass('lighting', () => {
      this.renderLightingPass({
        usePointLights,
        useSSAO,
        useClustered: useClustered && hasPointLights,
        usePointShadows: usePointShadows && hasPointLights,
      })
    })

    // =========================================================================
    // PASS 4: Forward Pass - 处理 WBOIT 半透明渲染
    // =========================================================================
    this.executeTrackedPass('forward', () => {
      this.renderForwardPass({
        terrainForwardQueue,
        renderBackend,
        textureArray,
        normalArray,
        specularArray,
        usePointLights,
      })
    })

    if (selectionOutline) {
      this.executeTrackedPass('forward', () => {
        this.renderSelectionOutline(selectionOutline)
      })
    }

    // =========================================================================
    // PASS 5: Post-Process Pass - TAA + Tone Mapping
    // =========================================================================
    this.executeTrackedPass('postprocess', () => {
      this.renderPostProcessPass(width, height)
    })

    // Update frame state
    this.updateFrameState()
    if (renderBackend) {
      renderBackend.endFrame()
      this.backendFrameId += 1
    }
    drawCallStats.endFrame()
  }

  public setLightingConfig(config: EngineRuntimeLightingConfig) {
    this.lightingConfig = {
      enablePointLights: config.enablePointLights,
      enableVertexLighting: config.enableVertexLighting,
      enableSmoothLighting: config.enableVertexLighting && config.enableSmoothLighting,
    }
  }

  /**
   * 更新场景 Uniform Buffer，包括光照、环境光与阴影矩阵。
   */
  private updateSceneUniforms(lightSpaceMatrices: Float32Array[], cascadeSplits: Float32Array) {
    // Update lighting parameters
    this.sceneUBO.writeVec4(0, [
      this.sunDirection[0],
      this.sunDirection[1],
      this.sunDirection[2],
      0,
    ])
    this.sceneUBO.writeVec4(16, [this.sunColor[0], this.sunColor[1], this.sunColor[2], 0])
    this.sceneUBO.writeVec4(32, [
      this.ambientSkyColor[0],
      this.ambientSkyColor[1],
      this.ambientSkyColor[2],
      0,
    ])
    this.sceneUBO.writeVec4(48, [
      this.ambientGroundColor[0],
      this.ambientGroundColor[1],
      this.ambientGroundColor[2],
      0,
    ])
    const timeSeconds = performance.now() / 1000.0
    this.sceneUBO.writeVec4(64, [this.ambientIntensity, this.iblIntensity, timeSeconds, 0])

    // Update shadow matrices (CSM)
    if (lightSpaceMatrices) {
      for (let i = 0; i < Math.min(lightSpaceMatrices.length, 4); i++) {
        this.sceneUBO.writeMat4(80 + i * 64, lightSpaceMatrices[i])
      }
    }
    if (cascadeSplits) {
      this.sceneUBO.writeVec4(336, cascadeSplits)
    }
    this.sceneUBO.flush()
  }

  /**
   * 更新相机 Uniform Buffer，并在启用 TAA 时写入抖动投影。
   */
  private updateCameraUniforms(width: number, height: number) {
    const taaEnabled = GAME_CONFIG.RENDER.TAA.ENABLED
    if (!taaEnabled) {
      this.jitteredVP.set(this.camera.viewProjectionMatrix)
      this.jitteredInverseVP.set(this.camera.inverseViewProjMatrix)

      this.cameraUBO.writeMat4(0, this.camera.viewMatrix)
      this.cameraUBO.writeMat4(64, this.camera.projectionMatrix)
      this.cameraUBO.writeMat4(128, this.camera.viewProjectionMatrix)
      this.cameraUBO.writeMat4(192, this.camera.inverseViewProjMatrix)
      this.cameraUBO.writeVec4(256, [
        this.camera.positionArray[0],
        this.camera.positionArray[1],
        this.camera.positionArray[2],
        1.0,
      ])
      this.cameraUBO.flush()
      return
    }

    // Calculate Halton sequence jitter for TAA with resolution/framerate adaptive scaling
    const jitterIndex = this.frameIndex % 16

    // 根据分辨率自适应调整 jitter 幅度，低分辨率下略微减小采样抖动。
    const jitterScale = Math.max(1.0, 480.0 / height) * Math.min(1.0, 60.0 / 60.0) // 以 60 FPS 为参考
    const baseJitter = 0.5 * jitterScale // 典型范围约为 0.5~1.0

    const jX = ((halton(jitterIndex + 1, 2) - 0.5) * baseJitter) / width
    const jY = ((halton(jitterIndex + 1, 3) - 0.5) * baseJitter) / height

    // Apply jitter to projection matrix (Column-major: indices 8,9 correspond to [2][0],[2][1])
    const jitteredProj = new Float32Array(this.camera.projectionMatrix)
    jitteredProj[8] += jX
    jitteredProj[9] += jY

    // Calculate jittered VP matrix and its inverse for correct TAA reprojection
    mat4.multiply(this.jitteredVP as mat4, jitteredProj as mat4, this.camera.viewMatrix as mat4)
    mat4.invert(this.jitteredInverseVP as mat4, this.jitteredVP as mat4)

    // Update camera UBO
    this.cameraUBO.writeMat4(0, this.camera.viewMatrix)
    this.cameraUBO.writeMat4(64, jitteredProj)
    this.cameraUBO.writeMat4(128, this.camera.viewProjectionMatrix)
    this.cameraUBO.writeMat4(192, this.jitteredInverseVP) // 使用抖动后的逆 VP 矩阵
    this.cameraUBO.writeVec4(256, [
      this.camera.positionArray[0],
      this.camera.positionArray[1],
      this.camera.positionArray[2],
      1.0,
    ])
    this.cameraUBO.flush()
  }

  private updateFrameUniforms(
    width: number,
    height: number,
    fogStart: number,
    fogEnd: number,
    fogColor: Float32Array,
    usePBR: boolean,
    useShadows: boolean,
    usePointLights: boolean,
    useVertexLighting: boolean,
    shadowBiasScale: number,
    depthFilterMode: number,
    useLinearDepth: boolean,
    pointShadowBias: number,
    cloudCover: number,
  ) {
    this.frameUniforms.update({
      fogStart,
      fogEnd,
      fogColor,
      cameraNear: this.camera.getNear(),
      cameraFar: this.camera.getFar(),
      inverseWidth: width > 0 ? 1 / width : 0,
      inverseHeight: height > 0 ? 1 / height : 0,
      useReverseZ: this.camera.getReverseZ(),
      useLinearDepth,
      depthFilterMode,
      shadowBiasScale,
      usePBR,
      useShadows,
      usePointLights,
      useVertexLighting,
      pointShadowBias,
      useWboit: this.forwardPass.isWBOITSupported,
      cloudCover,
    })
  }

  /**
   * PASS 1: 深度预写阶段 (Z-Prepass)
   */
  private renderDepthPrePass(params: DepthPrePassStageParams) {
    const { textureArray, terrainGeometryQueue, renderBackend } = params
    const gl = this.gl

    this.gBuffer.frameBuffer.bind()
    gl.viewport(0, 0, this.gBuffer.width, this.gBuffer.height)

    gl.clearDepth(this.camera.getReverseZ() ? 0.0 : 1.0)
    gl.depthMask(true)

    gl.clear(gl.DEPTH_BUFFER_BIT)
    for (const program of this.depthPrePass.programs) {
      this.cameraUBO.bindToProgram(program, 'CameraUniforms')
    }

    this.depthPrePass.render(
      this.gBuffer.frameBuffer,
      textureArray,
      this.camera.getReverseZ(),
      terrainGeometryQueue,
      renderBackend,
      this.backendFrameId,
    )
  }

  /**
   * PASS 2: 几何阶段，将不透明内容写入 G-Buffer。
   */
  private renderGeometryPass(params: GeometryStageParams) {
    const {
      textureArray,
      normalArray,
      specularArray,
      variantLUT,
      useZPrepass,
      terrainGeometryQueue,
      renderBackend,
    } = params
    for (const program of this.geometryPass.programs) {
      this.cameraUBO.bindToProgram(program, 'CameraUniforms')
    }
    this.geometryPass.render(
      this.gBuffer,
      textureArray,
      normalArray,
      specularArray,
      GAME_CONFIG.RENDER.NORMAL_SCALE,
      0.0,
      this.camera.getFar(),
      runtimeDebug,
      variantLUT,
      this.camera.getReverseZ(),
      useZPrepass,
      terrainGeometryQueue,
      renderBackend,
      this.backendFrameId,
    )
  }

  /**
   * PASS 3: 光照阶段，执行 PBR 延迟光照计算。
   */
  private renderLightingPass(params: LightingStageParams) {
    const { usePointLights, useSSAO, useClustered, usePointShadows } = params
    this.cameraUBO.bindToProgram(this.lightingPass.program, 'CameraUniforms')
    this.sceneUBO.bindToProgram(this.lightingPass.program, 'SceneUniforms')
    this.frameUniforms.bindToProgram(this.lightingPass.program)

    this.lightingFrameBuffer.bind()
    this.gl.drawBuffers([this.gl.COLOR_ATTACHMENT0])
    this.validateDepthBuffer('LightingPass')
    this.gl.clearColor(0.0, 0.0, 0.0, 1.0)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT)
    const lightingParams: LightingPassRenderParams = {
      gBuffer: this.gBuffer,
      shadowMap: this.shadowMapOverride || this.shadowPass.shadowMap,
      shadowColorMap: this.shadowColorOverride || this.shadowPass.shadowColorMap,
      lightManager: this.lightManager,
      lightCount: usePointLights ? this.lightManager.numLights : 0,
      cameraNear: this.camera.getNear(),
      cameraFar: this.camera.getFar(),
      useLinearDepth: this.isMobile && !!this.gBuffer.linearDepth,
      ssaoTexture: useSSAO ? this.ssaoPass.ssaoTexture : null,
      lightCuller: useClustered ? this.lightCuller : null,
      pointShadowMap: usePointShadows ? this.pointShadowPass.shadowMap : null,
      shadowedLightIndices: usePointShadows ? this.pointShadowPass.shadowedLightIndices : null,
      shadowedLightCount: usePointShadows ? this.pointShadowPass.shadowedLightCount : 0,
    }

    this.lightingPass.render(lightingParams)
  }

  /**
   * PASS 4: 前向阶段，渲染半透明对象并处理 WBOIT 合成。
   * Weighted Blended Order-Independent Transparency
   */
  private renderForwardPass(params: ForwardStageParams) {
    const {
      terrainForwardQueue,
      renderBackend,
      textureArray,
      normalArray,
      specularArray,
      usePointLights,
    } = params
    this.cameraUBO.bindToProgram(this.forwardPass.program, 'CameraUniforms')
    this.sceneUBO.bindToProgram(this.forwardPass.program, 'SceneUniforms')
    this.frameUniforms.bindToProgram(this.forwardPass.program)

    if (this.forwardPass.isWBOITSupported) {
      this.validateDepthBuffer('ForwardPass (WBOIT)')
      this.wboitFrameBuffer.bind()
      this.gl.clearBufferfv(this.gl.COLOR, 0, [0.0, 0.0, 0.0, 0.0])
      this.gl.clearBufferfv(this.gl.COLOR, 1, [1.0, 0.0, 0.0, 0.0])

      const forwardParams: ForwardPassRenderParams = {
        textureArray,
        normalArray,
        specularArray,
        shadowMap: this.shadowMapOverride || this.shadowPass.shadowMap,
        shadowColorMap: this.shadowColorOverride || this.shadowPass.shadowColorMap,
        normalScale: GAME_CONFIG.RENDER.NORMAL_SCALE,
        lightManager: this.lightManager,
        usePointLights,
        lightCount: usePointLights ? this.lightManager.numLights : 0,
        useReverseZ: this.camera.getReverseZ(),
        terrainForwardQueue,
        backend: renderBackend,
        backendFrameId: this.backendFrameId,
      }

      this.forwardPass.render(forwardParams)

      this.compositionFrameBuffer.bind()
      this.executeTrackedPass('forward-composite', () => {
        this.forwardPass.composite(this.accumTexture, this.revealTexture)
      })
    } else {
      this.compositionFrameBuffer.bind()

      const forwardParams: ForwardPassRenderParams = {
        textureArray,
        normalArray,
        specularArray,
        shadowMap: this.shadowMapOverride || this.shadowPass.shadowMap,
        shadowColorMap: this.shadowColorOverride || this.shadowPass.shadowColorMap,
        normalScale: GAME_CONFIG.RENDER.NORMAL_SCALE,
        lightManager: this.lightManager,
        usePointLights,
        lightCount: usePointLights ? this.lightManager.numLights : 0,
        useReverseZ: this.camera.getReverseZ(),
        terrainForwardQueue,
        backend: renderBackend,
        backendFrameId: this.backendFrameId,
      }

      this.forwardPass.render(forwardParams)
    }
    this.gl.depthMask(true)
    this.gl.disable(this.gl.BLEND)
  }

  private renderSelectionOutline(selectionOutline: SelectionOutline) {
    this.compositionFrameBuffer.bind()
    this.selectionOutlinePass.render(this.cameraUBO, selectionOutline, this.camera.getReverseZ())
  }

  /**
   * PASS 5: 后处理阶段，执行 TAA、Tone Mapping 与屏幕特效合成。
   */
  private renderPostProcessPass(width: number, height: number) {
    const taaEnabled = GAME_CONFIG.RENDER.TAA.ENABLED

    this.postProcessFrameBuffer.bind()
    this.gl.viewport(0, 0, width, height)
    this.gl.clearColor(0.0, 0.0, 0.0, 1.0)
    this.postProcessPass.render(
      this.gl,
      this.compositionTexture,
      taaEnabled && this.hasHistory ? this.historyTexture : this.compositionTexture,
      this.gBuffer.depth,
      this.camera.inverseViewProjMatrix,
      taaEnabled ? this.prevViewProjMatrix : this.camera.viewProjectionMatrix,
    )

    if (taaEnabled) {
      GL.bindTextureUnit(this.gl, 0, this.gl.TEXTURE_2D, this.historyTexture)
      this.gl.copyTexSubImage2D(this.gl.TEXTURE_2D, 0, 0, 0, 0, 0, width, height)
    }

    this.executeTrackedPass('ui', () => {
      this.screenEffectComposer.render(this.postProcessTexture, performance.now() / 1000)
    })
  }

  /**
   * 更新逐帧状态，主要维护 TAA 历史数据。
   */
  private updateFrameState() {
    const taaEnabled = GAME_CONFIG.RENDER.TAA.ENABLED
    this.hasHistory = taaEnabled
    if (taaEnabled) {
      this.prevViewProjMatrix.set(this.jitteredVP) // 保存当前帧抖动后的 VP，供下一帧重投影使用
      this.frameIndex = (this.frameIndex + 1) % 16
    } else {
      this.prevViewProjMatrix.set(this.camera.viewProjectionMatrix)
    }
  }

  /**
   * 释放全部 GPU 侧资源。
   */
  dispose() {
    this.gBuffer.dispose(this.gl)
    this.compositionFrameBuffer.dispose()
    this.lightingFrameBuffer.dispose()
    this.postProcessFrameBuffer.dispose()
    this.gl.deleteTexture(this.compositionTexture)
    this.gl.deleteTexture(this.postProcessTexture)

    this.lightManager.dispose()
    this.shadowPass.shadowManager.dispose()

    this.postProcessPass.dispose(this.gl)
    this.screenEffectComposer.dispose()

    this.cameraUBO.dispose()
    this.sceneUBO.dispose()
    this.frameUniforms.dispose()

    this.geometryPass.dispose()
    this.lightingPass.dispose()
    this.forwardPass.dispose()
    this.selectionOutlinePass.dispose()
    this.pointShadowPass.dispose()
    this.lightCuller.dispose()
  }
}
