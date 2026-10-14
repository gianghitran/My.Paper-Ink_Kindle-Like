import { joinParts } from '@/lib/byteSource'

const DB_NAME = 'paperink-file-cache'
const FILES = 'files' 
const INDEX = 'index' 
const META = 'meta'
const MAX_BYTES = 2 * 1024 ** 3 

interface FileEntry {
  path: string
  blob?: Blob
  bytes?: ArrayBuffer
  parts?: number
  type: string
}

const partKey = (path: string, i: number) => `${path}\u0000${i}`
interface IndexEntry {
  path: string
  size: number
  lastUsed: number
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'path' })
        if (!db.objectStoreNames.contains(INDEX)) db.createObjectStore(INDEX, { keyPath: 'path' })
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined)
        try {
          const tx = db.transaction(store, mode)
          const req = fn(tx.objectStore(store))
          tx.oncomplete = () => resolve(req ? (req.result as T) : undefined)
          tx.onerror = tx.onabort = () => resolve(undefined)
        } catch {
          resolve(undefined)
        }
      }),
  )
}

export async function getCachedFile(path: string): Promise<Blob | null> {
  const e = await run<FileEntry>(FILES, 'readonly', (s) => s.get(path))
  if (!e) return null
  let blob: Blob | null = null
  if (e.parts) {
    const parts: Blob[] = []
    for (let i = 0; i < e.parts; i++) {
      const part = await run<FileEntry>(FILES, 'readonly', (s) => s.get(partKey(path, i)))
      if (!part?.blob) return null
      parts.push(part.blob)
    }
    blob = joinParts(parts, e.type)
  } else if (e.blob) blob = e.blob
  else if (e.bytes) blob = new Blob([e.bytes], { type: e.type })
  if (!blob) return null
  void run(INDEX, 'readwrite', (s) => s.put({ path, size: blob.size, lastUsed: Date.now() } satisfies IndexEntry))
  return blob
}

export async function putCachedFile(path: string, blob: Blob) {
  if (blob.size > MAX_BYTES / 2) return
  try {
    await run(FILES, 'readwrite', (s) => s.put({ path, blob, type: blob.type } satisfies FileEntry))
    await run(INDEX, 'readwrite', (s) => s.put({ path, size: blob.size, lastUsed: Date.now() } satisfies IndexEntry))
    await evict()
  } catch {

  }
}

export async function putCachedPart(path: string, index: number, blob: Blob): Promise<Blob | null> {
  const key = partKey(path, index)
  const ok = await run(FILES, 'readwrite', (s) => s.put({ path: key, blob, type: blob.type } satisfies FileEntry))
  if (ok === undefined) return null
  const stored = await run<FileEntry>(FILES, 'readonly', (s) => s.get(key))
  return stored?.blob ?? null
}

export async function finishCachedParts(path: string, parts: number, type: string, size: number) {
  await run(FILES, 'readwrite', (s) => s.put({ path, parts, type } satisfies FileEntry))
  await run(INDEX, 'readwrite', (s) => s.put({ path, size, lastUsed: Date.now() } satisfies IndexEntry))
  await evict(path)
}

async function partCount(path: string) {
  const e = await run<FileEntry>(FILES, 'readonly', (s) => s.get(path))
  return e?.parts ?? 0
}

export async function removeCachedFiles(paths: string[]) {
  const keys: string[] = []
  for (const p of paths.filter(Boolean)) {
    keys.push(p)
    const n = await partCount(p)
    for (let i = 0; i < n; i++) keys.push(partKey(p, i))
  }
  await run(FILES, 'readwrite', (s) => {
    keys.forEach((k) => s.delete(k))
  })
  await run(INDEX, 'readwrite', (s) => {
    paths.forEach((p) => p && s.delete(p))
  })
}

export async function removeCachedParts(path: string, count: number) {
  await run(FILES, 'readwrite', (s) => {
    for (let i = 0; i < count; i++) s.delete(partKey(path, i))
  })
}

export async function clearDeviceCache() {
  await run(FILES, 'readwrite', (s) => s.clear())
  await run(INDEX, 'readwrite', (s) => s.clear())
}

export async function bindDeviceCache(userId: string) {
  const owner = await run<string>(META, 'readonly', (s) => s.get('owner'))
  if (owner === userId) return
  await clearDeviceCache()
  await run(META, 'readwrite', (s) => s.put(userId, 'owner'))
}

export async function deviceCacheUsage(): Promise<{ files: number; bytes: number }> {
  const all = (await run<IndexEntry[]>(INDEX, 'readonly', (s) => s.getAll())) ?? []
  return { files: all.length, bytes: all.reduce((a, e) => a + e.size, 0) }
}

async function evict(keep?: string) {
  let limit = MAX_BYTES
  try {
    const est = await navigator.storage?.estimate?.()
    if (est?.quota) limit = Math.min(limit, est.quota * 0.6)
  } catch {

  }
  const all = (await run<IndexEntry[]>(INDEX, 'readonly', (s) => s.getAll())) ?? []
  let total = all.reduce((a, e) => a + e.size, 0)
  if (total <= limit) return
  const old = all.sort((a, b) => a.lastUsed - b.lastUsed)
  const drop: string[] = []
  for (const e of old) {
    if (total <= limit) break
    if (e.path === keep) continue
    drop.push(e.path)
    total -= e.size
  }
  await removeCachedFiles(drop)
}

export async function pruneDeviceCache(keep: Set<string>) {
  const all = (await run<IndexEntry[]>(INDEX, 'readonly', (s) => s.getAll())) ?? []
  const stale = all.map((e) => e.path).filter((p) => !keep.has(p))
  if (stale.length) await removeCachedFiles(stale)
  const indexed = new Set(all.map((e) => e.path))
  const keys = ((await run<IDBValidKey[]>(FILES, 'readonly', (s) => s.getAllKeys())) ?? []).map(String)
  const orphans = keys.filter((k) => k.includes('\u0000') && !indexed.has(k.slice(0, k.indexOf('\u0000'))))
  if (orphans.length) await run(FILES, 'readwrite', (s) => orphans.forEach((k) => s.delete(k)))
}
