import { GAME_CONFIG } from '@/engine/config'
import type { CharacterModelType } from '@/engine/render/entity/character/CharacterModelSpec'
import { normalizeCharacterModelType } from '@/utils/characterSkinModel'

export type CharacterSkinDefinition = {
  id: string
  url: string
  modelType?: CharacterModelType
}

function getCharacterSkinDefinitions(): readonly CharacterSkinDefinition[] {
  return (GAME_CONFIG.WORLD.CHARACTER.SKINS as ReadonlyArray<Record<string, unknown>>).map(
    entry => ({
      id: String(entry.id ?? ''),
      url: String(entry.url ?? ''),
      modelType: normalizeCharacterModelType(entry.modelType ?? entry.model ?? null) ?? undefined,
    }),
  )
}

export function resolveCharacterSkinById(skinId: string): CharacterSkinDefinition {
  const definitions = getCharacterSkinDefinitions()
  const match = definitions.find(entry => entry.id === skinId)
  if (match) {
    return match
  }

  const fallback =
    definitions.find(entry => entry.id === GAME_CONFIG.WORLD.PLAYER.SKIN_ID) ?? definitions[0]
  if (!fallback) {
    throw new Error('Character skin catalog is empty')
  }

  return fallback
}

export function pickRandomNpcSkin(): CharacterSkinDefinition {
  const npcSkinIds = GAME_CONFIG.WORLD.NPC.SKIN_IDS
  if (npcSkinIds.length === 0) {
    return resolveCharacterSkinById(GAME_CONFIG.WORLD.PLAYER.SKIN_ID)
  }

  const index = Math.floor(Math.random() * npcSkinIds.length)
  return resolveCharacterSkinById(npcSkinIds[index] ?? GAME_CONFIG.WORLD.PLAYER.SKIN_ID)
}
