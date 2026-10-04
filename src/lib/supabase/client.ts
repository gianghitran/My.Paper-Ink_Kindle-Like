import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

export const supabaseConfigured = !!url && !!anonKey && /^https?:\/\//.test(url)

export const supabase: SupabaseClient = createClient(supabaseConfigured ? url! : 'https://not-configured.invalid', anonKey || 'missing-anon-key', {
  auth: {

    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

export const STORAGE_BUCKET = 'documents'

export const FILES_URL = ((import.meta.env.VITE_FILES_URL as string | undefined)?.trim() ?? '').replace(/\/+$/, '')

export function appBaseUrl() {
  const path = location.pathname.replace(/index\.html$/, '')
  return `${location.origin}${path}`
}
