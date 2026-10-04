import { create } from 'zustand'
import { supabase } from '@/lib/supabase/client'

export interface RemoteSpec {
  table: string

  keyColumns: string[]
}

type Row = Record<string, unknown>
type Op =
  | { kind: 'upsert'; spec: RemoteSpec; id: string; row: Row }
  | { kind: 'delete'; spec: RemoteSpec; id: string; match: Row }

interface SyncState {
  pending: number
  syncing: boolean

  lastError: string | null

  offline: boolean
}

export const useSyncStatus = create<SyncState>(() => ({ pending: 0, syncing: false, lastError: null, offline: false }))

const queue: Op[] = []
let running = false
let timer: ReturnType<typeof setTimeout> | null = null
let backoff = 0
let accepting = false
let waiters: (() => void)[] = []
let rejectListeners: ((message: string) => void)[] = []
const missingColumnListeners: ((table: string, column: string) => void)[] = []

export function onMissingColumn(fn: (table: string, column: string) => void) {
  missingColumnListeners.push(fn)
}

const DEBOUNCE_MS = 700
const BATCH = 200

const opKey = (op: Op) => `${op.spec.table}|${op.id}`

function publish() {
  useSyncStatus.setState({ pending: queue.length })
  if (!queue.length && !running) {
    const w = waiters
    waiters = []
    w.forEach((f) => f())
  }
}

function schedule(delay = DEBOUNCE_MS) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void run(), delay)
}

export function enqueue(op: Op) {

  if (!accepting) return
  const k = opKey(op)
  for (let i = queue.length - 1; i >= 0; i--) {
    if (opKey(queue[i]) === k) queue.splice(i, 1)
  }
  queue.push(op)
  publish()
  schedule()
}

export function onWriteRejected(fn: (message: string) => void) {
  rejectListeners.push(fn)
  return () => {
    rejectListeners = rejectListeners.filter((x) => x !== fn)
  }
}

function isNetworkError(err: { message?: string; code?: string; status?: number } | null) {
  if (!err) return false
  if (!navigator.onLine) return true
  const status = err.status ?? 0
  return status === 0 || status >= 500 || /fetch|network|timeout|abort|Load failed/i.test(err.message ?? '')
}

const REQUEST_TIMEOUT_MS = 20_000
const timeoutSignal = () => {
  const c = new AbortController()
  setTimeout(() => c.abort(), REQUEST_TIMEOUT_MS)
  return c.signal
}

const missingColumns = new Map<string, Set<string>>()
const withoutMissing = (table: string, row: Record<string, unknown>) => {
  const miss = missingColumns.get(table)
  if (!miss?.size) return row
  return Object.fromEntries(Object.entries(row).filter(([k]) => !miss.has(k)))
}
const upsertRows = (table: string, rows: Record<string, unknown>[], onConflict: string) =>
  supabase.from(table).upsert(rows.map((r) => withoutMissing(table, r)), { onConflict, defaultToNull: false }).abortSignal(timeoutSignal())

async function send(batch: Op[]) {
  const first = batch[0]
  if (first.kind === 'upsert') {
    const table = first.spec.table
    const onConflict = first.spec.keyColumns.join(',')
    const rows = batch.map((o) => (o as Extract<Op, { kind: 'upsert' }>).row)
    let { error, status } = await upsertRows(table, rows, onConflict)

    const col = error?.code === 'PGRST204' ? /'([a-z_]+)' column/i.exec(error.message ?? '')?.[1] : undefined
    if (col) {
      if (!missingColumns.has(table)) missingColumns.set(table, new Set())
      missingColumns.get(table)!.add(col)
      missingColumnListeners.forEach((f) => f(table, col))
      ;({ error, status } = await upsertRows(table, rows, onConflict))
    }

    if (error && !isNetworkError({ ...error, status }) && rows.length > 1) {
      let firstError: { message?: string; code?: string; status?: number } | null = null
      for (const row of rows) {
        const r = await upsertRows(table, [row], onConflict)
        if (r.error && isNetworkError({ ...r.error, status: r.status })) return { ...r.error, status: r.status }
        if (r.error && !firstError) firstError = { ...r.error, status: r.status }
      }
      return firstError
    }
    return error ? { ...error, status } : null
  }

  const spec = first.spec
  if (spec.keyColumns.length === 1) {
    const col = spec.keyColumns[0]
    const { error, status } = await supabase
      .from(spec.table)
      .delete()
      .in(col, batch.map((o) => (o as Extract<Op, { kind: 'delete' }>).match[col] as string))
      .abortSignal(timeoutSignal())
    return error ? { ...error, status } : null
  }
  for (const o of batch as Extract<Op, { kind: 'delete' }>[]) {
    let q = supabase.from(spec.table).delete()
    for (const [c, v] of Object.entries(o.match)) q = q.eq(c, v as string)
    const { error, status } = await q.abortSignal(timeoutSignal())
    if (error) return { ...error, status }
  }
  return null
}

async function run() {
  if (running) return
  running = true
  useSyncStatus.setState({ syncing: true })
  try {
    while (queue.length) {
      const head = queue[0]
      const batch = [head]
      for (let i = 1; i < queue.length && batch.length < BATCH; i++) {
        const o = queue[i]
        if (o.kind !== head.kind || o.spec.table !== head.spec.table) break
        batch.push(o)
      }
      const err = await send(batch)
      if (err && isNetworkError(err)) {

        useSyncStatus.setState({ offline: true })
        backoff = Math.min(30_000, backoff ? backoff * 2 : 1_000)
        running = false
        useSyncStatus.setState({ syncing: false })
        schedule(backoff)
        return
      }
      backoff = 0

      for (const o of batch) {
        const i = queue.indexOf(o)
        if (i >= 0) queue.splice(i, 1)
      }
      if (err) {

        const message = `${head.spec.table}: ${err.message ?? 'write rejected'}`
        useSyncStatus.setState({ lastError: message })
        console.warn('[sync] write rejected', head.spec.table, err.code ?? '', err.message ?? '')
        rejectListeners.forEach((f) => f(message))
      }
      useSyncStatus.setState({ offline: false })
      publish()
    }
  } finally {
    running = false
    useSyncStatus.setState({ syncing: false })
    publish()
  }
}

export function flush(): Promise<void> {
  if (!queue.length && !running) return Promise.resolve()
  const p = new Promise<void>((resolve) => waiters.push(resolve))
  if (timer) clearTimeout(timer)
  if (!running) void run()
  return p
}

export function pendingWrites() {
  return queue.length
}

export function acceptWrites() {
  accepting = true
}

export function clearQueue() {
  accepting = false
  queue.length = 0
  if (timer) clearTimeout(timer)
  publish()
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    backoff = 0
    if (queue.length) schedule(0)
  })
  const kick = () => {
    if (queue.length) void flush()
  }
  window.addEventListener('pagehide', kick)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') kick()
  })

  window.addEventListener('beforeunload', (e) => {
    if (queue.length) {
      e.preventDefault()
      e.returnValue = ''
    }
  })
}
