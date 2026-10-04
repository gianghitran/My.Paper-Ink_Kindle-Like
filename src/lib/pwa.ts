import { toast } from 'sonner'
import { create } from 'zustand'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export const useInstallPrompt = create<{ event: BeforeInstallPromptEvent | null; installed: boolean }>(() => ({
  event: null,
  installed: false,
}))

export function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export async function promptInstall() {
  const ev = useInstallPrompt.getState().event
  if (!ev) return false
  await ev.prompt()
  const choice = await ev.userChoice
  useInstallPrompt.setState({ event: null, installed: choice.outcome === 'accepted' })
  return choice.outcome === 'accepted'
}

export function registerServiceWorker() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    useInstallPrompt.setState({ event: e as BeforeInstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => useInstallPrompt.setState({ event: null, installed: true }))

  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  void import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({
      immediate: true,
      onRegisteredSW(_url, registration) {
        if (!registration) return
        const check = () => {
          if (navigator.onLine && registration.installing == null) void registration.update().catch(() => {})
        }
        document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
        window.addEventListener('pageshow', (e) => e.persisted && check())
        setInterval(check, 30 * 60 * 1000)
      },
      onOfflineReady() {
        toast.success('PaperInk is ready to work offline.')
      },
      onRegisterError(err) {
        console.warn('Service worker registration failed', err)
      },
    })
  })
}
