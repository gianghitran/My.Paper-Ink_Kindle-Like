import { create } from 'zustand'
import { toast } from 'sonner'
import { db } from '@/lib/db'
import { clearFileCache } from '@/lib/services/storage'
import { bindDeviceCache, clearDeviceCache, pruneDeviceCache } from '@/lib/services/deviceCache'


async function pruneFiles() {
  const docs = await db.documents.toArray()
  await pruneDeviceCache(new Set(docs.flatMap((d) => [d.filePath, d.coverPath ?? '']).filter(Boolean)))
}
import { signOut, useAuth } from '@/lib/services/auth'
import { DEFAULT_SETTINGS, applyRemoteSettings, flushSettings, loadSettings, useSettings } from '@/store/settings'
import { acceptWrites, clearQueue, flush, onMissingColumn, onWriteRejected, pendingWrites } from './sync'

type CloudState = 'idle' | 'loading' | 'ready' | 'error'

export const useCloud = create<{ state: CloudState; userId: string | null; error: string | null }>(() => ({
  state: 'idle',
  userId: null,
  error: null,
}))

let lastSync = 0
export const OFFLINE = 'offline'
let rejectHooked = false


export async function openUserLibrary(userId: string) {
  const cur = useCloud.getState()
  if (cur.userId === userId && (cur.state === 'ready' || cur.state === 'loading')) return
  
  clearQueue()
  db.reset()
  clearFileCache()
  
  await bindDeviceCache(userId)
  
  
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    useCloud.setState({ state: 'error', userId, error: OFFLINE })
    return
  }
  useCloud.setState({ state: 'loading', userId, error: null })
  try {
    await db.hydrate()
    await loadSettings()
    acceptWrites()
    lastSync = Date.now()
    void pruneFiles()
    useCloud.setState({ state: 'ready' })
  } catch (err) {
    useCloud.setState({ state: 'error', error: (err as Error).message })
  }
  if (!rejectHooked) {
    rejectHooked = true
    onWriteRejected(() => toast.error('Some changes could not be saved to your account.', { id: 'sync-rejected' }))
    onMissingColumn((table, column) => {
      const what = table === 'highlights' && column === 'drawer' ? 'Highlight styles' : table === 'highlights' && column === 'tags' ? 'Highlight tags' : `${table}.${column}`
      toast.warning(`${what} aren’t saved to your account yet — the database needs sql/koreader-highlights.sql.`, { id: `missing-${table}-${column}`, duration: 8000 })
    })
  }
}


export async function refreshFromCloud(force = false) {
  const { state } = useCloud.getState()
  if (state !== 'ready' || pendingWrites() > 0) return
  if (!force && Date.now() - lastSync < 30_000) return
  try {
    await db.hydrate()
    lastSync = Date.now()
    void pruneFiles()
    applyRemoteSettings((await db.settings.get('app'))?.value)
  } catch (err) {
    console.warn('[sync] refresh failed', (err as Error).message)
  }
}

let lastSettingsSync = 0

export async function refreshSettings() {
  if (useCloud.getState().state !== 'ready' || pendingWrites() > 0 || Date.now() - lastSettingsSync < 2000) return
  lastSettingsSync = Date.now()
  try {
    await db.settings.hydrate()
    applyRemoteSettings((await db.settings.get('app'))?.value)
  } catch (err) {
    console.warn('[sync] settings refresh failed', (err as Error).message)
  }
}


export async function signOutEverywhere() {
  flushSettings()
  await Promise.race([flush(), new Promise((r) => setTimeout(r, 5000))])
  try {
    await signOut()
  } finally {
    wipeLocal()
    
    await clearDeviceCache()
  }
}


function wipeLocal() {
  clearQueue()
  db.reset()
  clearFileCache()
  useSettings.setState({ settings: DEFAULT_SETTINGS })
  useCloud.setState({ state: 'idle', userId: null, error: null })
}



useAuth.subscribe((s, prev) => {
  const was = prev.user?.id ?? null
  const now = s.user?.id ?? null
  if (was && was !== now && useCloud.getState().userId === was) wipeLocal()
})

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    void refreshSettings()
    void refreshFromCloud()
  })
  window.addEventListener('focus', () => void refreshSettings())
  window.addEventListener('online', () => void refreshFromCloud(true))
}
