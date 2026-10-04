import type { Session, User } from '@supabase/supabase-js'
import { create } from 'zustand'
import { appBaseUrl, supabase, supabaseConfigured } from '@/lib/supabase/client'

type AuthStatus = 'loading' | 'signedOut' | 'signedIn'

interface AuthState {
  status: AuthStatus
  session: Session | null
  user: User | null
}

export const useAuth = create<AuthState>(() => ({ status: 'loading', session: null, user: null }))

function apply(session: Session | null) {
  useAuth.setState({ session, user: session?.user ?? null, status: session ? 'signedIn' : 'signedOut' })
}

let started = false
export function startAuth() {
  if (started) return
  started = true
  if (!supabaseConfigured) {
    useAuth.setState({ status: 'signedOut' })
    return
  }
  supabase.auth.onAuthStateChange((_event, session) => apply(session))
  void supabase.auth.getSession().then(({ data }) => apply(data.session))
}

export const PASSWORD_MIN = 8

export function passwordProblem(pw: string) {
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use both letters and numbers.'
  if (pw.length > 72) return 'Use at most 72 characters.'
  return null
}

export const USERNAME_DOMAIN = 'users.paperink.invalid'

export const normalizeUsername = (v: string) => v.trim().toLowerCase()

export function usernameProblem(v: string) {
  const u = normalizeUsername(v)
  if (u.length < 3 || u.length > 30) return 'Username must be 3–30 characters.'
  if (!/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/.test(u)) return 'Use lowercase letters, numbers, dot, dash or underscore, starting and ending with a letter or number.'
  if (/[._-]{2}/.test(u)) return 'Don’t put two symbols in a row.'
  return null
}

function loginEmail(identifier: string) {
  const v = identifier.trim()
  return v.includes('@') ? v : `${normalizeUsername(v)}@${USERNAME_DOMAIN}`
}

const providers = (user: User) => (user.app_metadata?.providers as string[] | undefined) ?? [String(user.app_metadata?.provider ?? '')]
export const isUsernameAccount = (user: User | null | undefined) => !!user?.email?.endsWith(`@${USERNAME_DOMAIN}`)
export const isGoogleAccount = (user: User | null | undefined) => !!user && providers(user).includes('google')

export const hasPassword = (user: User | null | undefined) => !!user && providers(user).includes('email')

export function accountLabel(user: User | null | undefined) {
  if (!user) return ''
  if (isUsernameAccount(user)) return user.email!.split('@')[0]
  const meta = user.user_metadata ?? {}
  return String(user.email || meta.full_name || meta.name || 'Account')
}

const PLACEHOLDER = new RegExp(`@${USERNAME_DOMAIN.replace(/\./g, '\\.')}`, 'g')

export function authMessage(err: { message?: string; code?: string } | null | undefined) {
  const m = err?.message ?? ''
  if (/invalid login credentials/i.test(m)) return 'Username or password is incorrect.'
  if (/email not confirmed/i.test(m)) return 'This account isn’t active yet: “Confirm email” must be turned off in the Supabase project.'
  if (/rate limit|too many/i.test(m)) return 'Too many attempts. Please wait a minute and try again.'
  if (/already registered|already exists/i.test(m)) return 'That username is taken. Try another one.'
  if (/password should|weak password|password is known/i.test(m)) return m
  if (/same password|different from the old/i.test(m)) return 'Choose a password different from your current one.'
  if (/provider is not enabled|unsupported provider/i.test(m)) return 'Google sign-in isn’t enabled on the server yet.'
  if (/signups not allowed/i.test(m)) return 'New sign-ups are currently disabled.'
  if (/network|fetch/i.test(m)) return 'Can’t reach the server. Check your connection and try again.'
  return m.replace(PLACEHOLDER, '') || 'Something went wrong. Please try again.'
}

export async function signUpWithUsername(username: string, password: string) {
  const name = normalizeUsername(username)
  const { data, error } = await supabase.auth.signUp({
    email: loginEmail(name),
    password,
    options: { data: { username: name } },
  })
  if (error) throw error

  if (!data.session) throw new Error('Email not confirmed')
}

export async function signIn(identifier: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: loginEmail(identifier), password })
  if (error) throw error
}

export async function signInWithGoogle(next = '/') {
  const back = new URL(appBaseUrl())
  back.searchParams.set('auth', 'google')
  if (next !== '/') back.searchParams.set('next', next)
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: back.toString(), queryParams: { prompt: 'select_account' } },
  })
  if (error) throw error
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const email = useAuth.getState().user?.email
  if (!email) throw new Error('Not signed in')
  const check = await supabase.auth.signInWithPassword({ email, password: currentPassword })
  if (check.error) throw new Error(/invalid login/i.test(check.error.message) ? 'Current password is incorrect.' : check.error.message)
  const { error } = await supabase.auth.updateUser({ password: newPassword })
  if (error) throw error
}

const safePath = (p: string | null) => (p && p.startsWith('/') && !p.startsWith('//') ? p : '/')

export async function consumeAuthRedirect(): Promise<{ route: string | null; notice: string | null; error: string | null }> {
  const url = new URL(location.href)
  const q = url.searchParams
  const hashParams = new URLSearchParams(url.hash.startsWith('#') && !url.hash.startsWith('#/') ? url.hash.slice(1) : '')
  const errorDescription = q.get('error_description') ?? hashParams.get('error_description')
  if (!q.has('auth') && !q.has('code') && !errorDescription) return { route: null, notice: null, error: null }

  let route: string | null = null
  let error: string | null = null
  try {
    if (errorDescription) {
      error = authMessage({ message: errorDescription.replace(/\+/g, ' ') })
    } else {

      const { data } = await supabase.auth.getSession()
      if (!data.session) error = 'Sign-in didn’t complete. Please try again in this browser.'
    }
    route = error ? '/login' : safePath(q.get('next'))
  } finally {

    history.replaceState(null, '', `${url.pathname}#${route ?? '/'}`)
  }
  return { route, notice: null, error }
}
