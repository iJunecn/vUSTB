import type { ChunkManager } from '@/engine/world/chunk'

/**
 * @file BlockInteractionController.ts
 * @brief 方块交互控制器
 *
 * 说明：
 *  - 负责从相机视线发起 DDA 射线检测
 *  - 结合方块状态桥判断可选中、可放置与可替换逻辑
 *  - 维护当前命中方块、触摸长按破坏和中键拾取等交互行为
 */
export type BlockStateBridge = {
  lookupBlockStateId(blockState: string): number
  canRaycastBlockStateId(blockStateId: number | null | undefined): boolean
  getAirBlockStateId(): number
  explainBlockStateID(blockStateId: number | null | undefined): string
  getBlockStateFlags(blockStateId: number): number
  isAirBlockStateId(blockStateId: number): boolean
  describeBlockStateFromRegistry(blockStateId: number): string
}

type BlockRaycastHit = {
  blockX: number
  blockY: number
  blockZ: number
  faceNormal: [number, number, number]
  distance: number
  blockStateId: number
  blockState: string
}

const MAX_RAYCAST_DISTANCE = 6
const MAX_RAYCAST_STEPS = 64
const MOBILE_BREAK_HOLD_MS = 300
const MOBILE_BREAK_CANCEL_DISTANCE_PX = 18
const REPLACEABLE_BLOCKS = new Set([
  'air',
  'cave_air',
  'void_air',
  'water',
  'lava',
  'short_grass',
  'tall_grass',
  'fern',
  'large_fern',
  'dead_bush',
  'vine',
  'seagrass',
  'tall_seagrass',
  'kelp',
  'kelp_plant',
  'glow_lichen',
  'hanging_roots',
  'nether_sprouts',
  'crimson_roots',
  'warped_roots',
  'fire',
  'soul_fire',
  'brown_mushroom',
  'red_mushroom',
  'dandelion',
  'poppy',
  'blue_orchid',
  'allium',
  'azure_bluet',
  'red_tulip',
  'orange_tulip',
  'white_tulip',
  'pink_tulip',
  'oxeye_daisy',
  'cornflower',
  'lily_of_the_valley',
  'torchflower',
  'wither_rose',
  'sunflower',
  'lilac',
  'rose_bush',
  'peony',
])

export class BlockInteractionController {
  private canvas: HTMLCanvasElement | null = null
  private currentHit: BlockRaycastHit | null = null
  private selectedBlockState = 'minecraft:air'
  private selectedBlockStateId = 0
  private lastCameraPosition: [number, number, number] = [0, 0, 0]
  private lastCameraTarget: [number, number, number] = [0, 0, 0]
  private pendingBlockNameKey: string | null = null
  private touchBreakIdentifier: number | null = null
  private touchBreakStartX = 0
  private touchBreakStartY = 0
  private touchBreakTimer: ReturnType<typeof setTimeout> | null = null
  private touchBreakTriggered = false

  constructor(
    private readonly chunkManager: ChunkManager,
    private readonly blockStateBridge: BlockStateBridge,
    private readonly options: {
      onAction?: (action: 'break' | 'place') => void
    } = {},
  ) {
    this.onMouseDown = this.onMouseDown.bind(this)
    this.onContextMenu = this.onContextMenu.bind(this)
    this.onTouchStart = this.onTouchStart.bind(this)
    this.onTouchMove = this.onTouchMove.bind(this)
    this.onTouchEnd = this.onTouchEnd.bind(this)
  }

  public syncSelectedBlockState(blockState: string) {
    const blockStateId = this.blockStateBridge.lookupBlockStateId(blockState)
    if (blockStateId < 0) {
      return false
    }

    this.chunkManager.ensureBlockStateRegistered(blockState)
    this.setSelectedBlockState(blockState, blockStateId)
    return true
  }

  public attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    canvas.addEventListener('mousedown', this.onMouseDown)
    canvas.addEventListener('contextmenu', this.onContextMenu)
    canvas.addEventListener('touchstart', this.onTouchStart, { passive: false })
    canvas.addEventListener('touchmove', this.onTouchMove, { passive: false })
    canvas.addEventListener('touchend', this.onTouchEnd, { passive: false })
    canvas.addEventListener('touchcancel', this.onTouchEnd, { passive: false })
  }

  public detach() {
    if (!this.canvas) {
      return
    }

    this.canvas.removeEventListener('mousedown', this.onMouseDown)
    this.canvas.removeEventListener('contextmenu', this.onContextMenu)
    this.canvas.removeEventListener('touchstart', this.onTouchStart)
    this.canvas.removeEventListener('touchmove', this.onTouchMove)
    this.canvas.removeEventListener('touchend', this.onTouchEnd)
    this.canvas.removeEventListener('touchcancel', this.onTouchEnd)
    this.cancelTrackedTouchBreak()
    this.canvas = null
  }

  public breakCurrentBlock() {
    if (!this.currentHit) {
      return false
    }

    this.chunkManager.setBlockStateId({
      worldX: this.currentHit.blockX,
      worldY: this.currentHit.blockY,
      worldZ: this.currentHit.blockZ,
      blockStateId: this.blockStateBridge.getAirBlockStateId(),
    })
    this.options.onAction?.('break')
    return true
  }

  public placeSelectedBlockFromCurrentHit() {
    return this.placeSelectedBlock()
  }

  public pickCurrentTargetBlock() {
    if (!this.currentHit) {
      return Promise.resolve(false)
    }

    return this.pickCurrentBlock(this.currentHit)
  }

  public update(cameraPosition: ArrayLike<number>, cameraTarget: ArrayLike<number>) {
    const originX = cameraPosition[0]
    const originY = cameraPosition[1]
    const originZ = cameraPosition[2]
    this.lastCameraPosition = [originX, originY, originZ]
    this.lastCameraTarget = [cameraTarget[0], cameraTarget[1], cameraTarget[2]]
    let dirX = cameraTarget[0] - originX
    let dirY = cameraTarget[1] - originY
    let dirZ = cameraTarget[2] - originZ
    const length = Math.hypot(dirX, dirY, dirZ)
    if (length <= 1e-5) {
      this.currentHit = null
      return null
    }

    dirX /= length
    dirY /= length
    dirZ /= length

    let blockX = Math.floor(originX)
    let blockY = Math.floor(originY)
    let blockZ = Math.floor(originZ)
    const stepX = dirX > 0 ? 1 : dirX < 0 ? -1 : 0
    const stepY = dirY > 0 ? 1 : dirY < 0 ? -1 : 0
    const stepZ = dirZ > 0 ? 1 : dirZ < 0 ? -1 : 0

    const tDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dirX)
    const tDeltaY = stepY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dirY)
    const tDeltaZ = stepZ === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dirZ)

    let tMaxX =
      stepX === 0
        ? Number.POSITIVE_INFINITY
        : ((stepX > 0 ? blockX + 1 - originX : originX - blockX) || 0) * tDeltaX
    let tMaxY =
      stepY === 0
        ? Number.POSITIVE_INFINITY
        : ((stepY > 0 ? blockY + 1 - originY : originY - blockY) || 0) * tDeltaY
    let tMaxZ =
      stepZ === 0
        ? Number.POSITIVE_INFINITY
        : ((stepZ > 0 ? blockZ + 1 - originZ : originZ - blockZ) || 0) * tDeltaZ

    let distance = 0
    let faceNormal: [number, number, number] = [0, 0, 0]
    for (let steps = 0; steps < MAX_RAYCAST_STEPS && distance <= MAX_RAYCAST_DISTANCE; steps++) {
      const blockStateId = this.chunkManager.getBlockStateId(blockX, blockY, blockZ)
      if (this.blockStateBridge.canRaycastBlockStateId(blockStateId)) {
        this.currentHit = this.createRaycastHit(
          blockX,
          blockY,
          blockZ,
          faceNormal,
          distance,
          blockStateId!,
        )
        this.resolveCurrentHitBlockName()
        return this.currentHit
      }

      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
        blockX += stepX
        distance = tMaxX
        tMaxX += tDeltaX
        faceNormal = [-stepX, 0, 0]
      } else if (tMaxY <= tMaxZ) {
        blockY += stepY
        distance = tMaxY
        tMaxY += tDeltaY
        faceNormal = [0, -stepY, 0]
      } else {
        blockZ += stepZ
        distance = tMaxZ
        tMaxZ += tDeltaZ
        faceNormal = [0, 0, -stepZ]
      }
    }

    this.currentHit = null
    this.pendingBlockNameKey = null
    return null
  }

  public getCurrentHit() {
    return this.currentHit
  }

  public getCurrentBlockState() {
    return this.currentHit?.blockState ?? null
  }

  public getSelectedBlockState() {
    return this.selectedBlockState
  }

  private resolveCurrentHitBlockName() {
    const hit = this.currentHit
    if (!hit || !hit.blockState.startsWith('#')) {
      this.pendingBlockNameKey = null
      return
    }

    const requestKey = `${hit.blockX},${hit.blockY},${hit.blockZ},${hit.blockStateId}`
    if (this.pendingBlockNameKey === requestKey) {
      return
    }

    this.pendingBlockNameKey = requestKey
    void this.chunkManager
      .describeBlockStateAt(hit.blockX, hit.blockY, hit.blockZ)
      .then(blockState => {
        if (!blockState) {
          return
        }

        if (
          this.currentHit &&
          this.currentHit.blockX === hit.blockX &&
          this.currentHit.blockY === hit.blockY &&
          this.currentHit.blockZ === hit.blockZ &&
          this.currentHit.blockStateId === hit.blockStateId
        ) {
          this.currentHit.blockState = blockState
        }
      })
      .finally(() => {
        if (this.pendingBlockNameKey === requestKey) {
          this.pendingBlockNameKey = null
        }
      })
  }

  private onMouseDown(event: MouseEvent) {
    if (!this.canvas || document.pointerLockElement !== this.canvas) {
      return
    }

    if (!this.currentHit) {
      return
    }

    if (event.button === 0) {
      if (event.ctrlKey) {
        // 调试模式下输出射线追踪日志。
        this.debugLastRaycast()
        return
      }

      event.preventDefault()
      this.breakCurrentBlock()
      return
    }

    if (event.button === 1) {
      event.preventDefault()
      void this.pickCurrentTargetBlock()
      return
    }

    if (event.button === 2) {
      event.preventDefault()
      void this.placeSelectedBlockFromCurrentHit()
    }
  }

  private onContextMenu(event: MouseEvent) {
    if (this.canvas && event.target === this.canvas) {
      event.preventDefault()
    }
  }

  private onTouchStart(event: TouchEvent) {
    if (this.touchBreakIdentifier !== null) {
      return
    }

    const halfWidth = window.innerWidth / 2
    for (let index = 0; index < event.changedTouches.length; index++) {
      const touch = event.changedTouches[index]
      if (touch.clientX < halfWidth) {
        continue
      }

      this.touchBreakIdentifier = touch.identifier
      this.touchBreakStartX = touch.clientX
      this.touchBreakStartY = touch.clientY
      this.touchBreakTriggered = false
      this.touchBreakTimer = setTimeout(() => {
        this.touchBreakTimer = null
        if (this.touchBreakIdentifier !== touch.identifier) {
          return
        }

        this.touchBreakTriggered = this.breakCurrentBlock()
      }, MOBILE_BREAK_HOLD_MS)
      return
    }
  }

  private onTouchMove(event: TouchEvent) {
    if (this.touchBreakIdentifier === null) {
      return
    }

    for (let index = 0; index < event.changedTouches.length; index++) {
      const touch = event.changedTouches[index]
      if (touch.identifier !== this.touchBreakIdentifier) {
        continue
      }

      const movedDistance = Math.hypot(
        touch.clientX - this.touchBreakStartX,
        touch.clientY - this.touchBreakStartY,
      )
      if (movedDistance > MOBILE_BREAK_CANCEL_DISTANCE_PX) {
        this.cancelTrackedTouchBreak()
      }
      return
    }
  }

  private onTouchEnd(event: TouchEvent) {
    if (this.touchBreakIdentifier === null) {
      return
    }

    for (let index = 0; index < event.changedTouches.length; index++) {
      const touch = event.changedTouches[index]
      if (touch.identifier !== this.touchBreakIdentifier) {
        continue
      }

      const breakTriggered = this.touchBreakTriggered
      this.cancelTrackedTouchBreak()
      if (!breakTriggered) {
        void this.placeSelectedBlockFromCurrentHit()
      }
      return
    }
  }

  public debugLastRaycast() {
    const originX = this.lastCameraPosition[0]
    const originY = this.lastCameraPosition[1]
    const originZ = this.lastCameraPosition[2]
    let dirX = this.lastCameraTarget[0] - originX
    let dirY = this.lastCameraTarget[1] - originY
    let dirZ = this.lastCameraTarget[2] - originZ
    const length = Math.hypot(dirX, dirY, dirZ)

    console.groupCollapsed('Raycast Trace')
    console.log(`Origin: ${originX.toFixed(3)}, ${originY.toFixed(3)}, ${originZ.toFixed(3)}`)
    console.log(`Direction (raw): ${dirX.toFixed(3)}, ${dirY.toFixed(3)}, ${dirZ.toFixed(3)}`)

    if (length <= 1e-5) {
      console.warn('Ray length too small')
      console.groupEnd()
      return
    }

    dirX /= length
    dirY /= length
    dirZ /= length
    console.log(`Direction (norm): ${dirX.toFixed(3)}, ${dirY.toFixed(3)}, ${dirZ.toFixed(3)}`)

    let blockX = Math.floor(originX)
    let blockY = Math.floor(originY)
    let blockZ = Math.floor(originZ)
    const stepX = dirX > 0 ? 1 : dirX < 0 ? -1 : 0
    const stepY = dirY > 0 ? 1 : dirY < 0 ? -1 : 0
    const stepZ = dirZ > 0 ? 1 : dirZ < 0 ? -1 : 0

    const tDeltaX = stepX === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dirX)
    const tDeltaY = stepY === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dirY)
    const tDeltaZ = stepZ === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dirZ)

    let tMaxX =
      stepX === 0
        ? Number.POSITIVE_INFINITY
        : ((stepX > 0 ? blockX + 1 - originX : originX - blockX) || 0) * tDeltaX
    let tMaxY =
      stepY === 0
        ? Number.POSITIVE_INFINITY
        : ((stepY > 0 ? blockY + 1 - originY : originY - blockY) || 0) * tDeltaY
    let tMaxZ =
      stepZ === 0
        ? Number.POSITIVE_INFINITY
        : ((stepZ > 0 ? blockZ + 1 - originZ : originZ - blockZ) || 0) * tDeltaZ

    let distance = 0
    let steps = 0
    for (; steps < MAX_RAYCAST_STEPS && distance <= MAX_RAYCAST_DISTANCE; steps++) {
      const blockStateId = this.chunkManager.getBlockStateId(blockX, blockY, blockZ)
      const debugInfo = this.blockStateBridge.explainBlockStateID(blockStateId)

      console.log(`Step ${steps}: (${blockX}, ${blockY}, ${blockZ}) => ${debugInfo}`)

      if (this.blockStateBridge.canRaycastBlockStateId(blockStateId)) {
        console.log(`%c HIT!`, 'color: #0f0; font-weight: bold')
        console.groupEnd()
        return
      }

      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
        blockX += stepX
        distance = tMaxX
        tMaxX += tDeltaX
      } else if (tMaxY <= tMaxZ) {
        blockY += stepY
        distance = tMaxY
        tMaxY += tDeltaY
      } else {
        blockZ += stepZ
        distance = tMaxZ
        tMaxZ += tDeltaZ
      }
    }
    console.log(`%c MISS (Steps=${steps}, Dist=${distance.toFixed(2)})`, 'color: orange;')
    console.groupEnd()
  }

  private async pickCurrentBlock(hit: BlockRaycastHit) {
    if (!hit.blockState.startsWith('#')) {
      this.chunkManager.ensureBlockStateRegistered(hit.blockState)
      this.setSelectedBlockState(hit.blockState, hit.blockStateId)
      return true
    }

    const resolvedBlockState = await this.chunkManager.describeBlockStateAt(
      hit.blockX,
      hit.blockY,
      hit.blockZ,
    )
    if (!resolvedBlockState) {
      console.error(
        `[BlockInteraction] Failed to resolve picked fallback blockstate ${hit.blockState} at ${hit.blockX},${hit.blockY},${hit.blockZ}`,
      )
      return false
    }

    if (!this.syncSelectedBlockState(resolvedBlockState)) {
      console.error(
        `[BlockInteraction] Failed to sync resolved blockstate ${resolvedBlockState} from picked fallback ${hit.blockState}`,
      )
      return false
    }

    // 如果拾取结果映射到异常注册项，则回退到安全选择状态。
    const flags = this.blockStateBridge.getBlockStateFlags(this.selectedBlockStateId)
    if (flags === 0 && !this.blockStateBridge.isAirBlockStateId(this.selectedBlockStateId)) {
      console.warn(
        `[BlockInteraction] Picked block '${resolvedBlockState}' (ID=${this.selectedBlockStateId}) has 0 flags. Reverting selection to air.`,
      )
      this.syncSelectedBlockState('minecraft:air')
      return false
    }

    if (
      this.currentHit &&
      this.currentHit.blockX === hit.blockX &&
      this.currentHit.blockY === hit.blockY &&
      this.currentHit.blockZ === hit.blockZ &&
      this.currentHit.blockStateId === hit.blockStateId
    ) {
      this.currentHit.blockState = resolvedBlockState
    }

    return true
  }

  private async placeSelectedBlock() {
    if (!this.currentHit || this.selectedBlockStateId < 0) {
      return false
    }

    const hit = this.currentHit

    if (this.selectedBlockState.startsWith('#')) {
      console.warn(
        `[BlockInteraction] Refusing to place unresolved fallback blockstate ${this.selectedBlockState}`,
      )
      return false
    }

    this.chunkManager.ensureBlockStateRegistered(this.selectedBlockState)

    const hitBlockState = await this.resolveStableBlockStateLabel(
      hit.blockX,
      hit.blockY,
      hit.blockZ,
      hit.blockStateId,
      hit.blockState,
    )
    if (
      this.currentHit &&
      this.currentHit.blockX === hit.blockX &&
      this.currentHit.blockY === hit.blockY &&
      this.currentHit.blockZ === hit.blockZ &&
      this.currentHit.blockStateId === hit.blockStateId &&
      hitBlockState &&
      this.isResolvedBlockStateLabel(hitBlockState)
    ) {
      this.currentHit.blockState = hitBlockState
    }

    const target = this.resolvePlacementTarget(hit, hitBlockState ?? hit.blockState)

    const targetStateId = this.chunkManager.getBlockStateId(target.x, target.y, target.z)
    if (targetStateId !== null) {
      const targetBlockState = await this.resolveStableBlockStateLabel(
        target.x,
        target.y,
        target.z,
        targetStateId,
      )
      if (!this.isReplaceable(targetStateId, targetBlockState ?? undefined)) {
        return false
      }
    }

    this.chunkManager.setBlockStateId({
      worldX: target.x,
      worldY: target.y,
      worldZ: target.z,
      blockStateId: this.selectedBlockStateId,
    })
    this.options.onAction?.('place')
    return true
  }

  private clearTouchBreakTimer() {
    if (this.touchBreakTimer !== null) {
      clearTimeout(this.touchBreakTimer)
      this.touchBreakTimer = null
    }
  }

  private cancelTrackedTouchBreak() {
    this.clearTouchBreakTimer()
    this.touchBreakIdentifier = null
    this.touchBreakTriggered = false
  }

  private resolvePlacementTarget(hit: BlockRaycastHit, hitBlockState?: string) {
    if (this.isReplaceable(hit.blockStateId, hitBlockState ?? hit.blockState)) {
      return {
        x: hit.blockX,
        y: hit.blockY,
        z: hit.blockZ,
      }
    }

    const placementFace =
      this.normalizePlacementFace(hit.faceNormal) ??
      this.resolvePlacementFace(hit.blockX, hit.blockY, hit.blockZ)

    return {
      x: hit.blockX + placementFace[0],
      y: hit.blockY + placementFace[1],
      z: hit.blockZ + placementFace[2],
    }
  }

  private isReplaceable(blockStateId: number | null | undefined, blockState?: string) {
    if (blockStateId == null) {
      return true
    }

    if (this.blockStateBridge.isAirBlockStateId(blockStateId)) {
      return true
    }

    const label = blockState?.trim() ?? ''
    if (!this.isResolvedBlockStateLabel(label)) {
      return false
    }

    const blockName = this.extractBlockName(label)
    if (REPLACEABLE_BLOCKS.has(blockName)) {
      return true
    }

    if (blockName === 'snow') {
      return this.isThinSnowLayer(label)
    }

    return false
  }

  private isResolvedBlockStateLabel(blockState: string | null | undefined) {
    if (!blockState) {
      return false
    }

    const normalized = blockState.trim()
    if (!normalized || normalized.startsWith('#')) {
      return false
    }

    return normalized !== 'minecraft:unknown' && normalized !== 'unknown'
  }

  private async resolveStableBlockStateLabel(
    worldX: number,
    worldY: number,
    worldZ: number,
    blockStateId: number | null | undefined,
    preferredLabel?: string | null,
  ) {
    if (blockStateId == null || blockStateId < 0) {
      return null
    }

    if (this.isResolvedBlockStateLabel(preferredLabel)) {
      return preferredLabel!.trim()
    }

    const registryLabel = this.blockStateBridge.describeBlockStateFromRegistry(blockStateId)
    if (this.isResolvedBlockStateLabel(registryLabel)) {
      return registryLabel.trim()
    }

    const described = await this.chunkManager.describeBlockStateAt(worldX, worldY, worldZ)
    if (described && this.isResolvedBlockStateLabel(described)) {
      return described.trim()
    }

    return null
  }

  private normalizePlacementFace(faceNormal: [number, number, number]) {
    const [x, y, z] = faceNormal
    if (x === 0 && y === 0 && z === 0) {
      return null
    }

    if (x !== 0) {
      return [x > 0 ? 1 : -1, 0, 0] as [number, number, number]
    }
    if (y !== 0) {
      return [0, y > 0 ? 1 : -1, 0] as [number, number, number]
    }
    if (z !== 0) {
      return [0, 0, z > 0 ? 1 : -1] as [number, number, number]
    }

    return null
  }

  private extractBlockName(blockState: string) {
    const normalized = blockState.startsWith('minecraft:')
      ? blockState.slice('minecraft:'.length)
      : blockState
    const bracketIndex = normalized.indexOf('[')
    return bracketIndex >= 0 ? normalized.slice(0, bracketIndex) : normalized
  }

  private isThinSnowLayer(blockState: string) {
    const match = /\blayers=(\d+)\b/.exec(blockState)
    if (!match) {
      return true
    }

    return Number(match[1]) < 8
  }

  private resolvePlacementFace(
    blockX: number,
    blockY: number,
    blockZ: number,
  ): [number, number, number] {
    const centerX = blockX + 0.5
    const centerY = blockY + 0.5
    const centerZ = blockZ + 0.5
    const deltaX = this.lastCameraPosition[0] - centerX
    const deltaY = this.lastCameraPosition[1] - centerY
    const deltaZ = this.lastCameraPosition[2] - centerZ
    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)
    const absZ = Math.abs(deltaZ)

    if (absY >= absX && absY >= absZ) {
      return [0, deltaY >= 0 ? 1 : -1, 0]
    }
    if (absX >= absZ) {
      return [deltaX >= 0 ? 1 : -1, 0, 0]
    }
    return [0, 0, deltaZ >= 0 ? 1 : -1]
  }

  private setSelectedBlockState(blockState: string, blockStateId: number) {
    this.selectedBlockState = blockState
    this.selectedBlockStateId = blockStateId
  }

  private createRaycastHit(
    blockX: number,
    blockY: number,
    blockZ: number,
    faceNormal: [number, number, number],
    distance: number,
    blockStateId: number,
  ): BlockRaycastHit {
    return {
      blockX,
      blockY,
      blockZ,
      faceNormal,
      distance,
      blockStateId,
      blockState: `#${blockStateId}`,
    }
  }
}
