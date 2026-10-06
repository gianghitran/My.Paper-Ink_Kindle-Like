import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'
import { App } from './App'
import { applyChromeColor, applyInkFilter, applyTheme, useSettings } from './store/settings'
import { consumeAuthRedirect, startAuth } from './lib/services/auth'
import { useAuthFlash } from './pages/AuthPages'
import { registerServiceWorker } from './lib/pwa'
import { framedByAnotherSite } from './lib/utils'

window.addEventListener('vite:preloadError', (event) => {
  if (sessionStorage.getItem('paperink:chunk-reload')) return
  sessionStorage.setItem('paperink:chunk-reload', '1')
  event.preventDefault()
  location.reload()
})
window.addEventListener('load', () => setTimeout(() => sessionStorage.removeItem('paperink:chunk-reload'), 10_000))

async function boot() {

  const redirect = await consumeAuthRedirect().catch(() => ({ route: null, notice: null, error: null }))
  if (redirect.notice || redirect.error) useAuthFlash.setState({ notice: redirect.notice, error: redirect.error })
  startAuth()

  applyTheme(useSettings.getState().settings.theme)
  applyInkFilter(useSettings.getState().settings.inkFilter)
  applyChromeColor(useSettings.getState().settings)
  useSettings.subscribe((s, prev) => {
    if (s.settings.theme !== prev.settings.theme) applyTheme(s.settings.theme)
    if (s.settings.inkFilter !== prev.settings.inkFilter) applyInkFilter(s.settings.inkFilter)
    if (s.settings.theme !== prev.settings.theme || s.settings.inkFilter !== prev.settings.inkFilter) applyChromeColor(s.settings)
  })

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
  registerServiceWorker()
}

if (framedByAnotherSite()) {
  const link = document.createElement('a')
  link.href = window.location.href
  link.target = '_top'
  link.rel = 'noopener'
  link.textContent = 'Open PaperInk in its own tab'
  document.getElementById('root')!.replaceChildren(link)
} else void boot()
