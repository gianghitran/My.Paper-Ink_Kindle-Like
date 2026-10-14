import { finishCachedParts, getCachedFile, putCachedFile, putCachedPart, removeCachedFiles, removeCachedParts } from './deviceCache'
import { FILES_URL, STORAGE_BUCKET, supabase } from '@/lib/supabase/client'
import { blockCachedSource, joinParts, remoteBlob } from '@/lib/byteSource'

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/epub+zip',
  'application/vnd.comicbook+zip',
  'application/x-cbz',
  'application/x-cbt',
  'application/x-tar',
  'image/jpeg',
])

export function safeObjectName(name: string, fallback = 'document') {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(-120)
  return cleaned || fallback
}

export async function objectPath(documentId: string, fileName: string) {
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) throw new Error('Not signed in')
  return `${userId}/${documentId}/${safeObjectName(fileName)}`
}

const SINGLE_PUT_MAX = 90 * 1024 * 1024

async function accessToken(refresh = false) {
  const { data } = refresh ? await supabase.auth.refreshSession() : await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not signed in')
  return token
}

async function files(route: string, params: Record<string, string>, init: RequestInit = {}) {
  const url = `${FILES_URL}${route}?${new URLSearchParams(params)}`
  const send = async (token: string) => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } })
  let res = await send(await accessToken())
  if (res.status === 401) res = await send(await accessToken(true))
  return res
}

async function filesError(res: Response) {
  const body = (await res.json().catch(() => null)) as { error?: string } | null
  return new Error(body?.error ?? `Storage request failed (${res.status})`)
}

async function r2Upload(path: string, blob: Blob, contentType: string) {
  if (blob.size <= SINGLE_PUT_MAX) {
    const res = await files('/object', { key: path, type: contentType }, { method: 'PUT', body: blob, headers: { 'Content-Type': contentType } })
    if (!res.ok) throw await filesError(res)
    return
  }
  const created = await files('/mpu/create', { key: path, type: contentType, size: String(blob.size) }, { method: 'POST' })
  if (!created.ok) throw await filesError(created)
  const { uploadId, partSize } = (await created.json()) as { uploadId: string; partSize: number }
  try {
    const parts: { partNumber: number; etag: string }[] = []
    for (let n = 1, off = 0; off < blob.size; n++, off += partSize) {
      const res = await files('/mpu/part', { key: path, uploadId, part: String(n) }, { method: 'PUT', body: blob.slice(off, off + partSize) })
      if (!res.ok) throw await filesError(res)
      parts.push((await res.json()) as { partNumber: number; etag: string })
    }
    const done = await files('/mpu/complete', { key: path, uploadId }, { method: 'POST', body: JSON.stringify({ parts }), headers: { 'Content-Type': 'application/json' } })
    if (!done.ok) throw await filesError(done)
  } catch (err) {
    await files('/mpu/abort', { key: path, uploadId }, { method: 'DELETE' }).catch(() => {})
    throw err
  }
}

const DOWNLOAD_CHUNK = 16 * 1024 * 1024
const REMOTE_MIN_BYTES = 96 * 1024 * 1024

async function rangeBytes(path: string, start: number, end: number) {
  const res = await files('/object', { key: path }, { headers: { Range: `bytes=${start}-${end - 1}` } })
  if (res.status !== 206 && res.status !== 200) throw await filesError(res)
  const data = new Uint8Array(await res.arrayBuffer())
  return res.status === 200 ? data.subarray(start, end) : data
}

async function r2Download(path: string, allowRemote: boolean): Promise<{ blob: Blob; cached: boolean } | null> {
  const range = (start: number, end: number) => files('/object', { key: path }, { headers: { Range: `bytes=${start}-${end - 1}` } })
  const first = await range(0, DOWNLOAD_CHUNK)
  if (first.status === 404) return null
  if (!first.ok) throw await filesError(first)
  const total = Number(first.headers.get('content-range')?.split('/')[1])
  const type = first.headers.get('content-type') ?? ''
  if (first.status !== 206 || !Number.isFinite(total) || total <= DOWNLOAD_CHUNK) return { blob: await first.blob(), cached: false }
  const parts: Blob[] = []
  let persisted = true
  try {
    for (let start = 0; start < total; start += DOWNLOAD_CHUNK) {
      const res = start === 0 ? first : await range(start, Math.min(total, start + DOWNLOAD_CHUNK))
      if (res.status !== 206) throw await filesError(res)
      const chunk = await res.blob()
      const stored = persisted ? await putCachedPart(path, parts.length, chunk) : null
      if (!stored && start === 0 && allowRemote && total >= REMOTE_MIN_BYTES) {
        const source = blockCachedSource(total, (s, e) => rangeBytes(path, s, e))
        source.seed(0, new Uint8Array(await chunk.arrayBuffer()))
        return { blob: remoteBlob(source, type), cached: true }
      }
      if (!stored) persisted = false
      parts.push(stored ?? chunk)
    }
  } catch (err) {
    await removeCachedParts(path, parts.length)
    throw err
  }
  if (persisted) await finishCachedParts(path, parts.length, type, total)
  return { blob: joinParts(parts, type), cached: persisted }
}

async function legacyDownload(path: string) {
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path)
  if (error || !data) throw new Error(error?.message ?? 'Download failed')
  return data
}

async function migrateToR2(path: string, blob: Blob) {
  try {
    const type = blob.type || (path.endsWith('cover.jpg') ? 'image/jpeg' : '')
    await r2Upload(path, type === blob.type ? blob : new Blob([blob], { type }), type)
    await supabase.storage.from(STORAGE_BUCKET).remove([path])
  } catch (err) {
    console.warn('Moving file to R2 failed; it stays in Supabase Storage for now', (err as Error).message)
  }
}

export async function uploadObject(path: string, blob: Blob, contentType: string) {
  if (!ALLOWED_TYPES.has(contentType)) throw new Error(`File type not allowed: ${contentType}`)
  if (FILES_URL) return r2Upload(path, blob, contentType)
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, blob, { contentType, upsert: false, cacheControl: '3600' })
  if (error) throw new Error(error.message)
}

const MAX_CACHE_BYTES = 400 * 1024 * 1024
const fileCache = new Map<string, Blob>()
const inflight = new Map<string, Promise<Blob>>()

function remember(path: string, blob: Blob) {
  fileCache.delete(path)
  fileCache.set(path, blob)
  let total = 0
  for (const b of fileCache.values()) total += b.size
  for (const [k, b] of fileCache) {
    if (total <= MAX_CACHE_BYTES || fileCache.size <= 1) break
    fileCache.delete(k)
    total -= b.size
  }
}

export async function downloadObject(path: string, opts: { allowRemote?: boolean } = {}): Promise<Blob> {
  const hit = fileCache.get(path)
  if (hit) return hit
  let p = inflight.get(path)
  if (!p) {
    p = (async () => {

      const cached = await getCachedFile(path)
      if (cached) {
        remember(path, cached)
        return cached
      }
      const fromR2 = FILES_URL ? await r2Download(path, !!opts.allowRemote) : null
      const data = fromR2?.blob ?? (await legacyDownload(path))
      if (!fromR2 && FILES_URL) void migrateToR2(path, data)
      remember(path, data)
      if (!fromR2?.cached) void putCachedFile(path, data)
      return data
    })().finally(() => inflight.delete(path))
    inflight.set(path, p)
  }
  return p
}

export function cacheObject(path: string, blob: Blob) {
  remember(path, blob)
  void putCachedFile(path, blob)
}

export async function removeObjects(paths: string[]) {
  const list = paths.filter(Boolean)
  if (!list.length) return
  list.forEach((p) => fileCache.delete(p))
  await removeCachedFiles(list)
  if (FILES_URL) {
    const res = await files('/delete', {}, { method: 'POST', body: JSON.stringify({ keys: list }), headers: { 'Content-Type': 'application/json' } })
    if (!res.ok) throw await filesError(res)
  }
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(list)
  if (error && !FILES_URL) throw new Error(error.message)
}

export function clearFileCache() {
  fileCache.clear()
}
