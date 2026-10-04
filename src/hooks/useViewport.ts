import { useSyncExternalStore } from 'react'

function subscribe(cb: () => void) {
  window.addEventListener('resize', cb)
  window.addEventListener('orientationchange', cb)
  window.visualViewport?.addEventListener('resize', cb)
  return () => {
    window.removeEventListener('resize', cb)
    window.removeEventListener('orientationchange', cb)
    window.visualViewport?.removeEventListener('resize', cb)
  }
}

const getWidth = () => window.innerWidth
const getHeight = () => window.innerHeight

export function useViewport() {
  const width = useSyncExternalStore(subscribe, getWidth, () => 1024)
  const height = useSyncExternalStore(subscribe, getHeight, () => 768)
  const tier: 'phone' | 'tablet' | 'wide' = width < 768 ? 'phone' : width < 1100 ? 'tablet' : 'wide'
  return { width, height, tier, isPhone: tier === 'phone', isWide: tier === 'wide', landscape: width > height }
}

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (cb) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', cb)
      return () => mql.removeEventListener('change', cb)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
