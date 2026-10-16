import { useSyncExternalStore } from 'react'

const QUERY = '(min-width: 768px)'

function subscribe(onChange: () => void) {
  if (typeof globalThis.matchMedia !== 'function') return () => {}
  const media = globalThis.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

// jsdom has no matchMedia, so tests get the desktop layout unless they stub it.
function snapshot() {
  return typeof globalThis.matchMedia !== 'function' || globalThis.matchMedia(QUERY).matches
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, snapshot)
}
