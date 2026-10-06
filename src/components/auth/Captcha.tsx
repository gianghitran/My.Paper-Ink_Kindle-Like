import { useCallback, useEffect, useRef, useState } from 'react'

const SITE_KEY = ((import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) ?? '').trim()

export const captchaEnabled = !!SITE_KEY

interface Turnstile {
  render(el: HTMLElement, opts: Record<string, unknown>): string
  reset(id?: string): void
  remove(id: string): void
}

declare global {
  interface Window {
    turnstile?: Turnstile
  }
}

let loader: Promise<Turnstile> | null = null

function loadTurnstile() {
  loader ??= new Promise<Turnstile>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile)
    const s = document.createElement('script')
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    s.async = true
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('CAPTCHA failed to load')))
    s.onerror = () => {
      loader = null
      reject(new Error('CAPTCHA failed to load'))
    }
    document.head.append(s)
  })
  return loader
}

export function useCaptcha() {
  const [token, setToken] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const host = useRef<HTMLDivElement | null>(null)
  const widget = useRef<string | null>(null)

  useEffect(() => {
    if (!captchaEnabled) return
    let cancelled = false
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !host.current) return
        widget.current = ts.render(host.current, {
          sitekey: SITE_KEY,
          theme: 'auto',
          callback: (t: string) => setToken(t),
          'expired-callback': () => setToken(null),
          'error-callback': () => setToken(null),
        })
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
      if (widget.current) window.turnstile?.remove(widget.current)
      widget.current = null
    }
  }, [])

  const reset = useCallback(() => {
    setToken(null)
    if (widget.current) window.turnstile?.reset(widget.current)
  }, [])

  const element = captchaEnabled ? (
    <div className="flex min-h-[65px] flex-col items-center justify-center">
      <div ref={host} />
      {failed && <p className="text-[12px] text-destructive">The anti-bot check couldn’t load. Check your connection and reload the page.</p>}
    </div>
  ) : null

  return { element, token, reset, required: captchaEnabled }
}
