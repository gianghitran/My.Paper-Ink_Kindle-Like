import { useCallback, useEffect, useRef, useState } from 'react'
import { Pause, Play, Square } from 'lucide-react'
import { toast } from 'sonner'
import { useSettings } from '@/store/settings'
import { cn } from '@/lib/utils'
import type { ReaderHandle } from './types'

type Status = 'idle' | 'playing' | 'paused'

function guessLang(text: string) {
  if (/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(text)) return 'vi'
  if (/[一-鿿]/.test(text)) return 'zh'
  if (/[぀-ヿ]/.test(text)) return 'ja'
  if (/[Ѐ-ӿ]/.test(text)) return 'ru'
  return 'en'
}

function chunks(text: string) {
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]*["”’)\]]*\s*/g) ?? [text]
  const out: string[] = []
  let cur = ''
  for (const s of sentences) {
    if ((cur + s).length > 220 && cur) {
      out.push(cur.trim())
      cur = ''
    }
    cur += s
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

export const readAloudSupported = () => typeof window !== 'undefined' && 'speechSynthesis' in window





export function useReadAloud(handle: React.RefObject<ReaderHandle | null>, currentPage: () => number | undefined) {
  const [status, setStatus] = useState<Status>('idle')
  const statusRef = useRef<Status>('idle')
  const settings = useSettings((s) => s.settings.readAloud)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const runId = useRef(0)

  const set = (s: Status) => {
    statusRef.current = s
    setStatus(s)
  }

  const speakPage = useCallback(
    async (id: number, emptyPagesInARow = 0): Promise<void> => {
      const h = handle.current
      if (!h || id !== runId.current) return
      let text = (await h.getVisibleText()).trim()
      
      for (let tries = 0; !text && tries < 6 && id === runId.current; tries++) {
        await new Promise((r) => setTimeout(r, 500))
        text = (await h.getVisibleText()).trim()
      }
      if (id !== runId.current) return
      const lang = h.getLanguage() ?? guessLang(text)
      const voices = speechSynthesis.getVoices()
      const voice =
        voices.find((v) => v.voiceURI === settingsRef.current.voiceURI && v.lang.toLowerCase().startsWith(lang.slice(0, 2))) ??
        voices.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2)) && v.localService) ??
        voices.find((v) => v.lang.toLowerCase().startsWith(lang.slice(0, 2)))
      const parts = chunks(text)
      for (const part of parts) {
        await new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(part)
          u.lang = voice?.lang ?? lang
          if (voice) u.voice = voice
          u.rate = settingsRef.current.rate
          let done = false
          const finish = () => {
            if (done) return
            done = true
            clearInterval(guard)
            resolve()
          }
          u.onend = finish
          u.onerror = finish
          
          
          const deadline = Date.now() + Math.max(5000, (part.length * 120) / u.rate)
          const guard = setInterval(() => {
            if (statusRef.current === 'paused') return
            if (Date.now() > deadline && !speechSynthesis.speaking) finish()
          }, 1000)
          speechSynthesis.speak(u)
        })
        if (id !== runId.current) return
      }
      
      if (!parts.length && emptyPagesInARow > 3) {
        set('idle')
        return
      }
      const page = currentPage()
      if (h.goToPage && page) h.goToPage(page + 1)
      else h.next()
      await new Promise((r) => setTimeout(r, 700))
      return speakPage(id, parts.length ? 0 : emptyPagesInARow + 1)
    },
    [handle, currentPage],
  )

  const start = useCallback(() => {
    if (!readAloudSupported()) {
      toast.error('Read aloud is not supported in this browser')
      return
    }
    speechSynthesis.cancel()
    const id = ++runId.current
    set('playing')
    void speakPage(id).finally(() => {
      if (id === runId.current && statusRef.current === 'playing') set('idle')
    })
  }, [speakPage])

  const stop = useCallback(() => {
    runId.current++
    if (readAloudSupported()) speechSynthesis.cancel()
    set('idle')
  }, [])

  const togglePause = useCallback(() => {
    if (statusRef.current === 'playing') {
      speechSynthesis.pause()
      set('paused')
    } else if (statusRef.current === 'paused') {
      speechSynthesis.resume()
      set('playing')
    }
  }, [])

  useEffect(() => () => stop(), [stop])

  return { status, start, stop, togglePause }
}

export function ReadAloudBar({ status, onToggle, onStop }: { status: Status; onToggle: () => void; onStop: () => void }) {
  const settings = useSettings((s) => s.settings.readAloud)
  const update = useSettings((s) => s.update)
  if (status === 'idle') return null
  return (
    <div className="anim-fade-in fixed bottom-[calc(var(--safe-bottom)+96px)] left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-popover p-1 shadow-xl">
      <button type="button" aria-label={status === 'playing' ? 'Pause reading' : 'Resume reading'} onClick={onToggle} className="flex size-11 items-center justify-center rounded-full hover:bg-muted">
        {status === 'playing' ? <Pause className="size-5" /> : <Play className="size-5" />}
      </button>
      <button type="button" aria-label="Stop reading" onClick={onStop} className="flex size-11 items-center justify-center rounded-full hover:bg-muted">
        <Square className="size-4" />
      </button>
      <select
        aria-label="Reading speed"
        value={settings.rate}
        onChange={(e) => update({ readAloud: { ...settings, rate: Number(e.target.value) } })}
        className={cn('min-h-11 rounded-full bg-transparent px-2 text-[13px]')}
      >
        {[0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2].map((r) => (
          <option key={r} value={r}>
            {r}×
          </option>
        ))}
      </select>
    </div>
  )
}
