import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Eye, EyeOff } from 'lucide-react'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Spinner } from '@/components/Spinner'
import {
  authMessage,
  changePassword,
  hasPassword,
  passwordProblem,
  signIn,
  signInWithGoogle,
  signUpWithUsername,
  useAuth,
  usernameProblem,
} from '@/lib/services/auth'
import { supabaseConfigured } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'


export const useAuthFlash = create<{ notice: string | null; error: string | null }>(() => ({ notice: null, error: null }))

function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="thin-scroll flex min-h-dvh w-full items-start justify-center overflow-y-auto bg-background px-4 pb-10 pt-[calc(var(--safe-top)+48px)] sm:items-center sm:pt-safe">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="./favicon.svg" alt="" className="mb-3 size-12 rounded-xl" />
          <h1 className="font-serif text-[26px] font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-[14px] text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="rounded-2xl border border-border bg-card p-5 shadow-[var(--shadow)]">
          {!supabaseConfigured ? (
            <p role="alert" className="text-[14px] text-destructive">
              The cloud backend is not configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> and rebuild.
            </p>
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  )
}

function Field({
  id,
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  invalid,
}: {
  id: string
  label: string
  type?: string
  value: string
  onChange: (v: string) => void
  autoComplete?: string
  invalid?: boolean
}) {
  const [show, setShow] = useState(false)
  const isPassword = type === 'password'
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={isPassword && show ? 'text' : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          aria-invalid={invalid || undefined}
          className={cn(isPassword && 'pr-12', invalid && 'border-destructive')}
          required
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute right-0 top-0 flex size-11 items-center justify-center text-muted-foreground"
          >
            {show ? <EyeOff className="size-[18px]" /> : <Eye className="size-[18px]" />}
          </button>
        )}
      </div>
    </div>
  )
}

function Alert({ kind, children }: { kind: 'error' | 'info'; children: React.ReactNode }) {
  return (
    <p role={kind === 'error' ? 'alert' : 'status'} className={cn('rounded-lg px-3 py-2 text-[13px]', kind === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-foreground')}>
      {children}
    </p>
  )
}

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="size-[18px]" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

function GoogleButton({ next, onError }: { next: string; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Button
      type="button"
      variant="secondary"
      size="lg"
      className="w-full gap-2"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await signInWithGoogle(next)
        } catch (err) {
          onError(authMessage(err as Error))
          setBusy(false)
        }
      }}
    >
      <GoogleLogo />
      {busy ? 'Opening Google…' : 'Continue with Google'}
    </Button>
  )
}

function Divider() {
  return (
    <div className="flex items-center gap-3 text-[12px] text-muted-foreground" aria-hidden="true">
      <span className="h-px flex-1 bg-border" />
      or
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

const safeNext = (next: string | null) => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/')

export function LoginPage() {
  const [params] = useSearchParams()
  const status = useAuth((s) => s.status)
  const flash = useAuthFlash()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(flash.error)
  const notice = flash.notice
  const next = safeNext(params.get('next'))
  useEffect(() => {
    useAuthFlash.setState({ notice: null, error: null })
  }, [])

  if (status === 'signedIn') return <Navigate to={next} replace />

  return (
    <AuthLayout title="Sign in" subtitle="Your private library, on every device.">
      <div className="flex flex-col gap-4">
        {notice && <Alert kind="info">{notice}</Alert>}
        {error && <Alert kind="error">{error}</Alert>}
        <GoogleButton next={next} onError={setError} />
        <Divider />
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault()
            setError(null)
            if (!username.trim()) return setError('Enter your username.')
            if (!password) return setError('Enter your password.')
            setBusy(true)
            try {
              await signIn(username, password)
            } catch (err) {
              setError(authMessage(err as Error))
            } finally {
              setBusy(false)
            }
          }}
        >
          <Field id="username" label="Username" value={username} onChange={setUsername} autoComplete="username" />
          <Field id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="text-center text-[14px]">
          New here?{' '}
          <Link to={`/signup${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} className="inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </AuthLayout>
  )
}

export function SignupPage() {
  const [params] = useSearchParams()
  const status = useAuth((s) => s.status)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const next = safeNext(params.get('next'))

  if (status === 'signedIn') return <Navigate to={next} replace />

  const nameProblem = username ? usernameProblem(username) : null
  const pwProblem = password ? passwordProblem(password) : null
  return (
    <AuthLayout title="Create account" subtitle="Free and private — only you can see your books and notes.">
      <div className="flex flex-col gap-4">
        {error && <Alert kind="error">{error}</Alert>}
        <GoogleButton next={next} onError={setError} />
        <Divider />
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault()
            setError(null)
            const problem = usernameProblem(username) ?? passwordProblem(password)
            if (problem) return setError(problem)
            if (password !== confirm) return setError('Passwords don’t match.')
            setBusy(true)
            try {
              await signUpWithUsername(username, password)
              toast.success('Welcome to PaperInk!')
            } catch (err) {
              setError(authMessage(err as Error))
            } finally {
              setBusy(false)
            }
          }}
        >
          <Field id="username" label="Username" value={username} onChange={setUsername} autoComplete="username" invalid={!!nameProblem} />
          <p className={cn('-mt-2 text-[12px]', nameProblem ? 'text-destructive' : 'text-muted-foreground')}>
            {nameProblem ?? '3–30 characters: letters, numbers, dot, dash or underscore.'}
          </p>
          <Field id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="new-password" invalid={!!pwProblem} />
          <p className={cn('-mt-2 text-[12px]', pwProblem ? 'text-destructive' : 'text-muted-foreground')}>{pwProblem ?? 'At least 8 characters, with letters and numbers.'}</p>
          <Field id="confirm" label="Confirm password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={!!confirm && confirm !== password} />
          <Alert kind="info">No email needed — but that also means a forgotten password can’t be recovered. Keep it somewhere safe (a password manager is ideal).</Alert>
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
        <p className="text-center text-[14px]">
          Already have an account?{' '}
          <Link to="/login" className="inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </AuthLayout>
  )
}


export function ChangePasswordPage() {
  const navigate = useNavigate()
  const { status, user } = useAuth()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (status === 'loading') {
    return (
      <AuthLayout title="Change password">
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      </AuthLayout>
    )
  }
  if (status === 'signedOut') return <Navigate to="/login?next=%2Fchange-password" replace />
  if (!hasPassword(user)) {
    return (
      <AuthLayout title="Change password">
        <div className="flex flex-col gap-4 text-center">
          <p className="text-[14px]">You sign in with Google, so there’s no PaperInk password to change. Manage your password in your Google account.</p>
          <Button onClick={() => navigate('/', { replace: true })}>Back to library</Button>
        </div>
      </AuthLayout>
    )
  }
  const pwProblem = password ? passwordProblem(password) : null
  return (
    <AuthLayout title="Change password">
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={async (e) => {
          e.preventDefault()
          setError(null)
          if (!current) return setError('Enter your current password.')
          const problem = passwordProblem(password)
          if (problem) return setError(problem)
          if (password !== confirm) return setError('Passwords don’t match.')
          setBusy(true)
          try {
            await changePassword(current, password)
            toast.success('Password updated')
            navigate('/settings', { replace: true })
          } catch (err) {
            setError(authMessage(err as Error))
          } finally {
            setBusy(false)
          }
        }}
      >
        {error && <Alert kind="error">{error}</Alert>}
        <Field id="current-password" label="Current password" type="password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <Field id="new-password" label="New password" type="password" value={password} onChange={setPassword} autoComplete="new-password" invalid={!!pwProblem} />
        <p className={cn('-mt-2 text-[12px]', pwProblem ? 'text-destructive' : 'text-muted-foreground')}>{pwProblem ?? 'At least 8 characters, with letters and numbers.'}</p>
        <Field id="confirm-password" label="Confirm new password" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" invalid={!!confirm && confirm !== password} />
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </Button>
        <Button type="button" variant="ghost" onClick={() => navigate(-1)}>
          Cancel
        </Button>
      </form>
    </AuthLayout>
  )
}
