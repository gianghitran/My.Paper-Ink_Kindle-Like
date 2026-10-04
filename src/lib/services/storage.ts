import { getCachedFile, putCachedFile, removeCachedFiles } from './deviceCache'
import { STORAGE_BUCKET, supabase } from '@/lib/supabase/client'

export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024

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

export async function uploadObject(path: string, blob: Blob, contentType: string) {
  if (!ALLOWED_TYPES.has(contentType)) throw new Error(`File type not allowed: ${contentType}`)
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('File is larger than 200 MB')
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

export async function downloadObject(path: string): Promise<Blob> {
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
      const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(path)
      if (error || !data) throw new Error(error?.message ?? 'Download failed')
      remember(path, data)
      void putCachedFile(path, data)
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
  const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(list)
  if (error) throw new Error(error.message)
}

export function clearFileCache() {
  fileCache.clear()
}
