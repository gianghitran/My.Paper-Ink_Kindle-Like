import type { ReadingSession } from '@/types'

export interface DocStats {
  totalMs: number
  sessions: number
  
  rate: number | null
  lastRead: number | null
}

export function docStats(sessions: ReadingSession[]): DocStats {
  let totalMs = 0
  let gained = 0
  let gainMs = 0
  let lastRead: number | null = null
  for (const s of sessions) {
    totalMs += s.ms
    const d = s.progressEnd - s.progressStart
    
    if (d > 0 && d < 0.5 && s.ms > 20_000) {
      gained += d
      gainMs += s.ms
    }
    lastRead = Math.max(lastRead ?? 0, s.end)
  }
  return { totalMs, sessions: sessions.length, rate: gainMs > 60_000 && gained > 0 ? gained / gainMs : null, lastRead }
}

export function formatDuration(ms: number) {
  const m = Math.round(ms / 60_000)
  if (m < 1) return '< 1 min'
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h} h ${m % 60} min`
}

export function estimateLeft(rate: number | null, remainingProgress: number) {
  if (!rate || remainingProgress <= 0) return null
  return remainingProgress / rate
}

export const dayKey = (ts: number) => {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function msByDay(sessions: ReadingSession[]) {
  const m = new Map<string, number>()
  for (const s of sessions) m.set(dayKey(s.start), (m.get(dayKey(s.start)) ?? 0) + s.ms)
  return m
}
