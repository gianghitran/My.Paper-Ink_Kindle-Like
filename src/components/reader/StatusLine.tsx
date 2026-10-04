import { useEffect, useState } from 'react'
import { useSettings } from '@/store/settings'
import { estimateLeft, formatDuration, type DocStats } from '@/lib/stats'
import type { ReaderPosition } from './types'

function useClock(enabled: boolean) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => setNow(new Date()), 20_000)
    return () => clearInterval(t)
  }, [enabled])
  return now
}

function useBattery(enabled: boolean) {
  const [level, setLevel] = useState<number | null>(null)
  useEffect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void }> }
    if (!enabled || !nav.getBattery) return
    let bat: Awaited<ReturnType<NonNullable<typeof nav.getBattery>>> | null = null
    const update = () => bat && setLevel(bat.level)
    void nav.getBattery().then((b) => {
      bat = b
      update()
      b.addEventListener('levelchange', update)
    })
    return () => bat?.removeEventListener('levelchange', update)
  }, [enabled])
  return level
}

export function useStatusItems(position: ReaderPosition, stats: DocStats | null) {
  const sb = useSettings((s) => s.settings.statusBar)
  const now = useClock(sb.clock)
  const battery = useBattery(sb.battery)
  const items: string[] = []
  if (sb.timeLeftChapter && position.chapterEnd !== undefined) {
    const t = estimateLeft(stats?.rate ?? null, position.chapterEnd - position.progress)
    if (t !== null) items.push(`${formatDuration(t)} left in chapter`)
  }
  if (sb.timeLeftBook) {
    const t = estimateLeft(stats?.rate ?? null, 1 - position.progress)
    if (t !== null) items.push(`${formatDuration(t)} left in book`)
  }
  if (sb.clock) items.push(now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))
  if (sb.battery && battery !== null) items.push(`${Math.round(battery * 100)}% battery`)
  return items
}
