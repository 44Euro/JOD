import { useCallback, useSyncExternalStore } from 'react'

// A page whose tables need more room than the sidebar layout leaves (the sidebar takes 240px from 768px) asks for a
// wider minimum.
export function useIsDesktop(minWidth = 768): boolean {
  const query = `(min-width: ${minWidth}px)`
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof globalThis.matchMedia !== 'function') return () => {}
      const media = globalThis.matchMedia(query)
      media.addEventListener('change', onChange)
      return () => media.removeEventListener('change', onChange)
    },
    [query],
  )
  // jsdom has no matchMedia, so tests get the desktop layout unless they stub it.
  const snapshot = () => typeof globalThis.matchMedia !== 'function' || globalThis.matchMedia(query).matches
  return useSyncExternalStore(subscribe, snapshot)
}
