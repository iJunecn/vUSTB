import type { CharacterModelType } from './CharacterModelSpec'

const CHARACTER_BODY_GROUP_BASE_ID = 910100

export function getCharacterBodyGroupId(modelType: CharacterModelType = 'normal') {
  return `character-body:${modelType}`
}

export function getCharacterBodyGroupObjectId(modelType: CharacterModelType = 'normal') {
  return CHARACTER_BODY_GROUP_BASE_ID + (modelType === 'slim' ? 1 : 0)
}
