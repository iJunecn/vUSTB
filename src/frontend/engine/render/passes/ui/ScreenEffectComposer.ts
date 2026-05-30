/**
 * @module ScreenComposition
 *
 * screen composition 是独立于 scene pipeline 的渲染子系统。
 *
 * 语义分层：
 *   ui3d（对外语义）→ Ui3dComponent → ScreenEffectInstance → Ui3dPass（内部编排）
 *
 * - Renderer 只保留 `setUi3dComponents()` 作为标准 UI3D 提交入口。
 * - ScreenEffectComposer 负责把 Ui3dComponentInstance 拆解成引擎侧
 *   ScreenEffectInstance，按 effectType+payload 扩展槽位分桶。
 * - Ui3dPass 按层级调度 LiquidGlass / Hologram / TextLabel 等 technique。
 * - 新增 screen effect 只需：  定义 effectType + payload → 注册 handler → 添加 technique。
 *   不需要修改 Renderer。
 *
 * RenderObject (scene pipeline) 与 ScreenEffectInstance 是完全独立的提交类型，
 * 不经过 RenderQueue，不共享 bucket 语义。
 */
import type { ScreenEffectInstance, ScreenEffectType } from '@render/queue/RenderObject'
import { isHologramComponent } from '@render/ui3d/HologramComponent'
import {
  createHologramEffectInstance,
  isHologramEffectInstance,
  sanitizeHologramPanels,
  type HologramEffectInstance,
} from '@render/ui3d/HologramPanel'
import {
  createDefaultLiquidGlassEffectSettings,
  type LiquidGlassEffectSettings,
} from '@render/ui3d/LiquidGlassEffectSettings'
import { isLiquidGlassComponent } from '@render/ui3d/LiquidGlassComponent'
import {
  createLiquidGlassEffectInstance,
  isLiquidGlassEffectInstance,
  LIQUID_GLASS_EFFECT_TYPE,
  sanitizeLiquidGlassPanels,
  type LiquidGlassPanel,
} from '@render/ui3d/LiquidGlassPanel'
import { isTextLabelComponent } from '@render/ui3d/TextLabelComponent'
import {
  createTextLabelEffectInstance,
  isTextLabelEffectInstance,
  sanitizeTextLabelEffects,
  TEXT_LABEL_EFFECT_TYPE,
  type TextLabelEffectInstance,
} from '@render/ui3d/TextLabel'
import type { Ui3dComponentInstance } from '@render/ui3d/Ui3dComponent'
import { Ui3dPass } from './Ui3dPass'

type ScreenEffectBuckets = {
  liquidGlassPanels: {
    section: LiquidGlassPanel[]
    article: LiquidGlassPanel[]
    headerbar: LiquidGlassPanel[]
    indicator: LiquidGlassPanel[]
  }
  hologramPanels: HologramEffectInstance[]
  textLabels: TextLabelEffectInstance[]
}

type ScreenEffectHandler = (effect: ScreenEffectInstance, buckets: ScreenEffectBuckets) => void

export class ScreenEffectComposer {
  // ui3d is the outer-facing semantics; composer stays at the engine's screen-effect layer.
  private readonly ui3dPass: Ui3dPass
  private readonly effectHandlers: Partial<Record<ScreenEffectType, ScreenEffectHandler>> = {}
  private screenEffectInstances: ScreenEffectInstance[] = []
  private liquidGlassSettings: {
    section: LiquidGlassEffectSettings
    article: LiquidGlassEffectSettings
    headerbar: LiquidGlassEffectSettings
    indicator: LiquidGlassEffectSettings
  } = {
    section: createDefaultLiquidGlassEffectSettings(),
    article: createDefaultLiquidGlassEffectSettings(),
    headerbar: createDefaultLiquidGlassEffectSettings(),
    indicator: createDefaultLiquidGlassEffectSettings(),
  }
  private transparentBackground = false

  private registerEffectHandler(effectType: ScreenEffectType, handler: ScreenEffectHandler) {
    this.effectHandlers[effectType] = handler
  }

  private collectEffectBuckets(): ScreenEffectBuckets {
    const buckets: ScreenEffectBuckets = {
      liquidGlassPanels: {
        section: [],
        article: [],
        headerbar: [],
        indicator: [],
      },
      hologramPanels: [],
      textLabels: [],
    }

    for (const effect of this.screenEffectInstances) {
      const handler = this.effectHandlers[effect.effectType]
      if (!handler) {
        continue
      }

      handler(effect, buckets)
    }

    buckets.liquidGlassPanels.section = sanitizeLiquidGlassPanels(buckets.liquidGlassPanels.section)
    buckets.liquidGlassPanels.article = sanitizeLiquidGlassPanels(buckets.liquidGlassPanels.article)
    buckets.liquidGlassPanels.headerbar = sanitizeLiquidGlassPanels(
      buckets.liquidGlassPanels.headerbar,
    )
    buckets.liquidGlassPanels.indicator = sanitizeLiquidGlassPanels(
      buckets.liquidGlassPanels.indicator,
    )
    buckets.hologramPanels = sanitizeHologramPanels(buckets.hologramPanels)
    buckets.textLabels = sanitizeTextLabelEffects(buckets.textLabels)
    return buckets
  }

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.ui3dPass = new Ui3dPass(gl, width, height)
    this.registerEffectHandler(LIQUID_GLASS_EFFECT_TYPE, (effect, buckets) => {
      if (!isLiquidGlassEffectInstance(effect) || effect.enabled === false) {
        return
      }

      const panel = effect.payload.panel
      const layer = panel.layer ?? 'section'
      if (layer === 'article') {
        buckets.liquidGlassPanels.article.push(panel)
      } else if (layer === 'headerbar') {
        buckets.liquidGlassPanels.headerbar.push(panel)
      } else if (layer === 'indicator') {
        buckets.liquidGlassPanels.indicator.push(panel)
      } else {
        buckets.liquidGlassPanels.section.push(panel)
      }
    })
    this.registerEffectHandler('hologram-panel', (effect, buckets) => {
      if (!isHologramEffectInstance(effect) || effect.enabled === false) {
        return
      }

      buckets.hologramPanels.push(effect)
    })
    this.registerEffectHandler(TEXT_LABEL_EFFECT_TYPE, (effect, buckets) => {
      if (!isTextLabelEffectInstance(effect) || effect.enabled === false) {
        return
      }

      buckets.textLabels.push(effect)
    })
  }

  private setEffectInstances(objects: readonly ScreenEffectInstance[]) {
    this.screenEffectInstances = objects.map(object => ({
      ...object,
      rect: {
        x: object.rect.x,
        y: object.rect.y,
        width: object.rect.width,
        height: object.rect.height,
      },
    }))
  }

  public setUi3dComponents(components: readonly Ui3dComponentInstance[]) {
    const nextEffects: ScreenEffectInstance[] = []
    const liquidGlassSettings = {
      section: createDefaultLiquidGlassEffectSettings(),
      article: createDefaultLiquidGlassEffectSettings(),
      headerbar: createDefaultLiquidGlassEffectSettings(),
      indicator: createDefaultLiquidGlassEffectSettings(),
    }

    for (const component of components) {
      if (component.enabled === false) {
        continue
      }

      if (!isLiquidGlassComponent(component)) {
        if (!isHologramComponent(component)) {
          if (!isTextLabelComponent(component)) {
            continue
          }

          nextEffects.push(
            createTextLabelEffectInstance(
              component.id,
              component.rect,
              component.props.style,
              component.sortKey ?? 0,
            ),
          )
          continue
        }

        nextEffects.push(
          createHologramEffectInstance(
            component.id,
            component.rect,
            component.props.settings,
            component.sortKey ?? 0,
          ),
        )
        continue
      }

      nextEffects.push(
        createLiquidGlassEffectInstance(
          component.id,
          {
            ...component.rect,
            layer: component.props.layer ?? 'composite',
            instanceSettings: component.props.instanceSettings,
          },
          component.sortKey ?? 0,
        ),
      )
      const layer = component.props.layer ?? 'section'
      if (layer === 'article') {
        liquidGlassSettings.article = component.props.settings
      } else if (layer === 'headerbar') {
        liquidGlassSettings.headerbar = component.props.settings
      } else if (layer === 'indicator') {
        liquidGlassSettings.indicator = component.props.settings
      } else {
        liquidGlassSettings.section = component.props.settings
      }
    }

    this.setEffectInstances(nextEffects)
    this.liquidGlassSettings = liquidGlassSettings
  }

  public resize(width: number, height: number) {
    this.ui3dPass.resize(width, height)
  }

  public setTransparentBackground(enabled: boolean) {
    this.transparentBackground = enabled
  }

  public render(sceneTexture: WebGLTexture, timeSeconds: number) {
    const buckets = this.collectEffectBuckets()
    this.ui3dPass.render(
      sceneTexture,
      {
        liquidGlass: {
          panels: buckets.liquidGlassPanels,
          settings: this.liquidGlassSettings,
        },
        hologram: {
          panels: buckets.hologramPanels,
        },
        text: {
          labels: buckets.textLabels,
        },
      },
      timeSeconds,
      {
        transparentBackground: this.transparentBackground,
      },
    )
  }

  public dispose() {
    this.ui3dPass.dispose()
  }
}
