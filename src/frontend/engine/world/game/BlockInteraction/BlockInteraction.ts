import { ref, readonly, onUnmounted } from 'vue'
import type { ChunkManager } from '@/engine/world/chunk'
import type { SelectionOutline } from '@/engine/render/passes/SelectionOutlinePass'
import type {
  BlockInteractionController,
  BlockStateBridge,
} from '@/engine/world/game/BlockInteraction/BlockInteractionController'

export type BlockInteractionAction = 'break' | 'place'
export type BlockInteractionUiAction = BlockInteractionAction | 'pick'

let blockInteractionModulesPromise: Promise<{
  BlockInteractionController: typeof import('@/engine/world/game/BlockInteraction/BlockInteractionController').BlockInteractionController
  mainThreadBlockStateBridge: typeof import('@/engine/world/chunk/compute/MainThreadBlockStateBridge').mainThreadBlockStateBridge
}> | null = null

function loadBlockInteractionModules() {
  if (!blockInteractionModulesPromise) {
    blockInteractionModulesPromise = Promise.all([
      import('@/engine/world/game/BlockInteraction/BlockInteractionController'),
      import('@/engine/world/chunk/compute/MainThreadBlockStateBridge'),
    ]).then(([controllerModule, bridgeModule]) => ({
      BlockInteractionController: controllerModule.BlockInteractionController,
      mainThreadBlockStateBridge: bridgeModule.mainThreadBlockStateBridge,
    }))
  }

  return blockInteractionModulesPromise
}

export function useBlockInteraction(chunkManager: ChunkManager) {
  let controller: BlockInteractionController | null = null
  let blockStateBridge: BlockStateBridge | null = null
  let initializeToken = 0

  const selectedBlockState = ref('minecraft:air')
  const targetedBlockState = ref<string | null>(null)
  const targetedBlockPosition = ref<string | null>(null)
  const lastActionType = ref<BlockInteractionAction | null>(null)
  const lastActionSerial = ref(0)

  function clearControllerState() {
    controller?.detach()
    controller = null
    blockStateBridge = null
    targetedBlockState.value = null
    targetedBlockPosition.value = null
  }

  async function initialize(canvas: HTMLCanvasElement) {
    const token = ++initializeToken
    clearControllerState()
    const modules = await loadBlockInteractionModules()
    if (token !== initializeToken) {
      return
    }

    blockStateBridge = modules.mainThreadBlockStateBridge
    controller = new modules.BlockInteractionController(chunkManager, blockStateBridge, {
      onAction: action => {
        lastActionType.value = action
        lastActionSerial.value += 1
      },
    })
    controller.syncSelectedBlockState(selectedBlockState.value)
    controller.attach(canvas)
  }

  function update(
    cameraPosition: ArrayLike<number>,
    cameraTarget: ArrayLike<number>,
  ): SelectionOutline | null {
    if (!controller) {
      targetedBlockState.value = null
      targetedBlockPosition.value = null
      return null
    }

    const hit = controller.update(cameraPosition, cameraTarget)
    targetedBlockState.value = hit?.blockState ?? null
    targetedBlockPosition.value = hit ? `${hit.blockX}, ${hit.blockY}, ${hit.blockZ}` : null
    selectedBlockState.value = controller.getSelectedBlockState()

    return hit ? { x: hit.blockX, y: hit.blockY, z: hit.blockZ } : null
  }

  function dispose() {
    initializeToken += 1
    clearControllerState()
  }

  async function performAction(action: BlockInteractionUiAction) {
    if (!controller) {
      return false
    }

    if (action === 'break') {
      return controller.breakCurrentBlock()
    }

    if (action === 'place') {
      return controller.placeSelectedBlockFromCurrentHit()
    }

    const picked = await controller.pickCurrentTargetBlock()
    selectedBlockState.value = controller.getSelectedBlockState()
    return picked
  }

  onUnmounted(() => {
    dispose()
  })

  return {
    selectedBlockState: readonly(selectedBlockState),
    targetedBlockState: readonly(targetedBlockState),
    targetedBlockPosition: readonly(targetedBlockPosition),
    lastActionType: readonly(lastActionType),
    lastActionSerial: readonly(lastActionSerial),
    initialize,
    update,
    performAction,
    dispose,
  }
}
