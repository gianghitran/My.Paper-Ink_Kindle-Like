import { lazy, useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { Toaster } from 'sonner'
import { AppShell } from '@/components/layout/AppShell'
import { LibraryPage } from '@/pages/LibraryPage'
import { useSettings } from '@/store/settings'
import { useImport } from '@/hooks/useImport'
import { RequireAuth } from '@/components/auth/RequireAuth'
import { ChangePasswordPage, LoginPage, SignupPage } from '@/pages/AuthPages'


const ReaderPage = lazy(() => import('@/components/reader/ReaderPage'))
const GraphPage = lazy(() => import('@/pages/GraphPage'))
const NotesPage = lazy(() => import('@/pages/NotesPage'))
const SettingsPage = lazy(() => import('@/pages/SettingsPage'))
const StatsPage = lazy(() => import('@/pages/StatsPage'))
const VocabularyPage = lazy(() => import('@/pages/VocabularyPage'))

interface LaunchParams {
  files: { getFile(): Promise<File> }[]
}


function LaunchQueueHandler() {
  const { importFiles } = useImport()
  const navigate = useNavigate()
  useEffect(() => {
    const lq = (window as unknown as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } }).launchQueue
    if (!lq) return
    lq.setConsumer(async (params) => {
      if (!params.files?.length) return
      const files = await Promise.all(params.files.map((h) => h.getFile()))
      navigate('/')
      await importFiles(files, { openSingle: true })
    })
  }, [importFiles, navigate])
  return null
}

export function App() {
  const theme = useSettings((s) => s.settings.theme)
  return (
    <HashRouter>
      <Routes>
        {}
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignupPage />} />
        <Route path="change-password" element={<ChangePasswordPage />} />
        {}
        <Route
          element={
            <RequireAuth>
              <LaunchQueueHandler />
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<LibraryPage />} />
          <Route path="notes" element={<NotesPage />} />
          <Route path="graph" element={<GraphPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="stats" element={<StatsPage />} />
          <Route path="vocabulary" element={<VocabularyPage />} />
          <Route path="read/:docId" element={<ReaderPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster
        position="top-center"
        theme={theme === 'dark' ? 'dark' : 'light'}
        closeButton
        toastOptions={{
          className: 'paperink-toast',
          style: { background: 'var(--popover)', color: 'var(--foreground)', border: '1px solid var(--border)' },
        }}
        offset={{ top: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}
        mobileOffset={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
      />
    </HashRouter>
  )
}
