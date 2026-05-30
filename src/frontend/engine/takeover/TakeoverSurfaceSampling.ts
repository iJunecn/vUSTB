import { normalizeTakeoverSurfaceKind } from '@/constants/takeoverSurface'
import type { TakeoverSurfaceSnapshot } from '@/stores/takeoverSurfaces'

function parseRadius(value: string) {
  const numeric = Number.parseFloat(value)
  return Number.isFinite(numeric) ? numeric : 0
}

export function collectTakeoverSurfaceSnapshots(root: ParentNode = document) {
  const elements = Array.from(root.querySelectorAll<HTMLElement>('[data-engine-surface-key]'))

  return elements.flatMap<TakeoverSurfaceSnapshot>(element => {
    const key = element.dataset.engineSurfaceKey
    if (!key) {
      return []
    }

    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      return []
    }

    const style = window.getComputedStyle(element)
    return [
      {
        key,
        kind: normalizeTakeoverSurfaceKind(element.dataset.engineSurfaceKind),
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
        borderRadius: Math.max(
          parseRadius(style.borderTopLeftRadius),
          parseRadius(style.borderTopRightRadius),
          parseRadius(style.borderBottomRightRadius),
          parseRadius(style.borderBottomLeftRadius),
        ),
      },
    ]
  })
}
