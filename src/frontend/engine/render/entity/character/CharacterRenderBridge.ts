import { WebGL2RenderBackend } from '@/engine/render/backend/webgl2/WebGL2RenderBackend'
import { GAME_CONFIG } from '@/engine/config'
import { EntityRenderBridge } from '../EntityRenderBridge'
import { CharacterSkinTextureArray } from './CharacterSkinTextureArray'
import { createCharacterModelTemplate, type CharacterModelTemplate } from './CharacterModelTemplate'
import { CharacterBatch } from './CharacterBatch'
import type {
  CharacterCalibrationDebugInfo,
  CharacterRenderGroupDescriptor,
  CharacterRenderState,
  CharacterTemplateVariant,
} from './types'

export class CharacterRenderBridge {
  private readonly skinAtlas: CharacterSkinTextureArray
  private readonly templates = new Map<string, CharacterModelTemplate>()
  private readonly bridge: EntityRenderBridge<
    CharacterRenderGroupDescriptor,
    CharacterRenderState,
    CharacterCalibrationDebugInfo,
    CharacterBatch
  >

  constructor(private readonly backend: WebGL2RenderBackend) {
    this.skinAtlas = new CharacterSkinTextureArray(backend.getContext())
    this.bridge = new EntityRenderBridge({
      beforeCreate: (descriptor, states) => this.preloadSkins(descriptor, states),
      beforeSync: (descriptor, states) => this.preloadSkins(descriptor, states),
      createGroup: (descriptor, states) => {
        const template = this.getOrCreateTemplate(
          descriptor.templateVariant ?? 'full-body',
          descriptor.modelType ?? 'normal',
        )
        const group = new CharacterBatch(
          this.backend,
          template,
          this.skinAtlas,
          descriptor.objectId,
          descriptor.mode,
        )
        group.initialize(states)
        return group
      },
      disposeResources: () => {
        const gl = this.backend.getContext()
        for (const template of this.templates.values()) {
          gl.deleteBuffer(template.vertexBuffer)
        }
        this.templates.clear()
        this.skinAtlas.dispose()
      },
    })
  }

  public async upsertGroup(
    descriptor: CharacterRenderGroupDescriptor,
    states: readonly CharacterRenderState[],
  ) {
    await this.bridge.upsertGroup(descriptor, states)
  }

  public syncGroup(groupId: string, states: readonly CharacterRenderState[]) {
    this.bridge.syncGroup(groupId, states)
  }

  public removeGroup(groupId: string) {
    this.bridge.removeGroup(groupId)
  }

  public getRenderObjects() {
    return this.bridge.getRenderObjects()
  }

  public getCalibrationDebugInfo(
    groupId: string,
    index: number = 0,
  ): CharacterCalibrationDebugInfo | null {
    return this.bridge.getCalibrationDebugInfo(groupId, index)
  }

  public dispose() {
    this.bridge.dispose()
  }

  private getOrCreateTemplate(
    variant: CharacterTemplateVariant,
    modelType: import('./CharacterModelSpec').CharacterModelType = 'normal',
  ) {
    const key = `${variant}:${modelType}`
    const existing = this.templates.get(key)
    if (existing) {
      return existing
    }

    const template = createCharacterModelTemplate(this.backend.getContext(), variant, modelType)
    this.templates.set(key, template)
    return template
  }

  private async preloadSkins(
    descriptor: CharacterRenderGroupDescriptor | undefined,
    states: readonly CharacterRenderState[],
  ) {
    const skinUrls = new Map<string, string>()
    if (descriptor?.definition.skinId) {
      skinUrls.set(descriptor.definition.skinId, descriptor.definition.skinUrl ?? '')
    }
    for (const state of states) {
      if (state.skinId) {
        skinUrls.set(state.skinId, skinUrls.get(state.skinId) ?? '')
      }
    }

    await Promise.all(
      [...skinUrls.keys()].map(async skinId => {
        const skinUrl = skinUrls.get(skinId) || this.resolveSkinUrl(skinId)
        await this.skinAtlas.ensureSkin(skinId, skinUrl)
      }),
    )
  }

  private resolveSkinUrl(skinId: string) {
    const entry = GAME_CONFIG.WORLD.CHARACTER.SKINS.find(candidate => candidate.id === skinId)
    if (entry) {
      return entry.url
    }

    const fallback = GAME_CONFIG.WORLD.CHARACTER.SKINS.find(
      candidate => candidate.id === GAME_CONFIG.WORLD.PLAYER.SKIN_ID,
    )
    if (!fallback) {
      throw new Error('Character skin catalog is empty')
    }

    return fallback.url
  }
}
