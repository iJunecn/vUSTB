/**
 * Platform capability detection for the engine.
 */

export function isLikelyMobileDevice(): boolean {
  if (typeof window === 'undefined') return false
  const ua = navigator.userAgent.toLowerCase()
  return /android|iphone|ipad|ipod|mobile/i.test(ua)
}
