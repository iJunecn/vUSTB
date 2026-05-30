import { GAME_CONFIG } from '@/engine/config'
import type { CharacterRenderState } from './Character'
import type { Vec3Like } from '../Entity'
import { pickRandomNpcSkin, resolveCharacterSkinById } from './CharacterSkinCatalog'
import { Npc } from './Npc'

export type NpcFormationUpdateState = {
  dtSeconds: number
  centerPosition: Vec3Like
  centerLookTarget: Vec3Like
}

const FORMATION_RADIUS = 3
const FORMATION_SPACING = 2.4
export const NPC_FORMATION_RENDER_ID = 920001

export class NpcFormation {
  private readonly npcs: Npc[] = []
  private readonly definition = (() => {
    const fallbackSkinId = GAME_CONFIG.WORLD.NPC.SKIN_IDS[0] ?? GAME_CONFIG.WORLD.PLAYER.SKIN_ID
    const skin = resolveCharacterSkinById(fallbackSkinId)
    return {
      id: NPC_FORMATION_RENDER_ID,
      skinId: skin.id,
      skinUrl: skin.url,
      modelType: skin.modelType,
    }
  })()

  constructor() {
    let instanceIndex = 0
    for (let gridZ = -FORMATION_RADIUS; gridZ <= FORMATION_RADIUS; gridZ += 1) {
      for (let gridX = -FORMATION_RADIUS; gridX <= FORMATION_RADIUS; gridX += 1) {
        if (gridX === 0 && gridZ === 0) {
          continue
        }
        const skin = pickRandomNpcSkin()
        this.npcs.push(
          new Npc(
            instanceIndex,
            gridX * FORMATION_SPACING,
            gridZ * FORMATION_SPACING,
            skin.id,
            skin.url,
            skin.modelType,
          ),
        )
        instanceIndex += 1
      }
    }
  }

  initialize(centerPosition: Vec3Like) {
    for (const npc of this.npcs) {
      npc.initializeFromCenter(centerPosition)
    }
  }

  public update(state: NpcFormationUpdateState) {
    for (const npc of this.npcs) {
      npc.update({
        dtSeconds: state.dtSeconds,
        centerPosition: state.centerPosition,
        centerLookTarget: state.centerLookTarget,
      })
    }
  }

  public getDefinition() {
    return this.definition
  }

  public getRenderStates(): readonly CharacterRenderState[] {
    return this.npcs.map(npc => npc.getRenderState())
  }

  public getInstanceCount() {
    return this.npcs.length
  }

  public dispose() {
    for (const npc of this.npcs) {
      npc.dispose()
    }
  }
}
