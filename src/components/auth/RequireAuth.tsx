import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { CloudOff } from 'lucide-react'
import { useAuth } from '@/lib/services/auth'
import { supabaseConfigured } from '@/lib/supabase/client'
import { OFFLINE, openUserLibrary, useCloud } from '@/lib/cloud/session'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh w-full flex-col items-center justify-center gap-3 bg-background p-6 text-center">{children}</div>
}

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const status = useAuth((s) => s.status)
  const user = useAuth((s) => s.user)
  const cloud = useCloud()
  const location = useLocation()

  useEffect(() => {
    if (status === 'signedIn' && user) void openUserLibrary(user.id)
  }, [status, user])

  useEffect(() => {
    if (cloud.state !== 'error' || !user) return
    const retry = () => {
      useCloud.setState({ state: 'idle', userId: null })
      void openUserLibrary(user.id)
    }
    window.addEventListener('online', retry)
    return () => window.removeEventListener('online', retry)
  }, [cloud.state, user])

  if (!supabaseConfigured) return <Navigate to="/login" replace />
  if (status === 'loading') {
    return (
      <FullScreen>
        <Spinner label="Checking your session" />
      </FullScreen>
    )
  }
  if (status === 'signedOut' || !user) {
    const next = `${location.pathname}${location.search}`
    return <Navigate to={next && next !== '/' ? `/login?next=${encodeURIComponent(next)}` : '/login'} replace />
  }
  if (cloud.state === 'error' && cloud.userId === user.id) {
    const offline = cloud.error === OFFLINE
    return (
      <FullScreen>
        <CloudOff className="size-10 text-muted-foreground" />
        <p className="text-[16px] font-semibold">{offline ? 'You’re offline' : 'Couldn’t load your library'}</p>
        <p className="max-w-sm text-[13px] text-muted-foreground">
          {offline
            ? 'Your library is stored in your account, so it needs a connection to open. It will load automatically when you’re back online.'
            : 'Check your internet connection. Your data is safe in your account.'}
        </p>
        <Button
          onClick={() => {
            useCloud.setState({ state: 'idle', userId: null })
            void openUserLibrary(user.id)
          }}
        >
          Try again
        </Button>
      </FullScreen>
    )
  }
  if (cloud.state !== 'ready' || cloud.userId !== user.id) {
    return (
      <FullScreen>
        <Spinner label="Syncing your library" />
        <p className="text-[13px] text-muted-foreground">Syncing your library…</p>
      </FullScreen>
    )
  }
  return <>{children}</>
}
