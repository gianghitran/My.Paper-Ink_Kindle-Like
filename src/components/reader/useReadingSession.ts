import { useEffect, useRef } from 'react'
import { useLiveQuery } from '@/lib/cloud/useLiveQuery'
import { db } from '@/lib/db'
import { docStats } from '@/lib/stats'
import { uid } from '@/lib/utils'
import type { ReadingSession } from '@/types'

const TICK = 10_000

const IDLE = 3 * 60_000

export function useReadingSession(docId: string, progress: number, ready: boolean) {
  const session = useRef<ReadingSession | null>(null)
  const lastActivity = useRef(Date.now())
  const lastProgress = useRef(progress)

  useEffect(() => {
    if (!ready) return
    const s = session.current
    lastActivity.current = Date.now()
    if (s && progress !== lastProgress.current) {
      s.turns++
      s.progressEnd = progress
    }
    lastProgress.current = progress
  }, [progress, ready])

  useEffect(() => {
    if (!ready) return
    const now = Date.now()
    session.current = { id: uid('s'), docId, start: now, end: now, ms: 0, progressStart: lastProgress.current, progressEnd: lastProgress.current, turns: 0 }
    const save = () => {
      const s = session.current
      if (s && s.ms >= 5_000) void db.sessions.put({ ...s })
    }
    const mark = () => {
      lastActivity.current = Date.now()
    }
    const tick = setInterval(() => {
      const s = session.current
      if (!s || document.visibilityState !== 'visible') return
      if (Date.now() - lastActivity.current > IDLE) return
      s.ms += TICK
      s.end = Date.now()
      if (s.ms % 60_000 === 0) save()
    }, TICK)
    const onHide = () => {
      if (document.visibilityState === 'hidden') save()
      else mark()
    }
    window.addEventListener('pointerdown', mark, true)
    window.addEventListener('keydown', mark, true)
    window.addEventListener('wheel', mark, { capture: true, passive: true })
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', save)
    return () => {
      clearInterval(tick)
      window.removeEventListener('pointerdown', mark, true)
      window.removeEventListener('keydown', mark, true)
      window.removeEventListener('wheel', mark, true)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', save)
      save()
    }
  }, [docId, ready])

  const sessions = useLiveQuery(() => db.sessions.where('docId').equals(docId).toArray(), [docId])
  return sessions ? docStats(sessions) : null
}
