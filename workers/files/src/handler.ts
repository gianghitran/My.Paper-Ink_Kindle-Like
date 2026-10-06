interface R2HTTPMetadata {
  contentType?: string
  cacheControl?: string
}
interface R2Object {
  key: string
  size: number
  etag: string
  httpEtag: string
  httpMetadata?: R2HTTPMetadata
  range?: { offset: number; length?: number }
  writeHttpMetadata(headers: Headers): void
}
interface R2ObjectBody extends R2Object {
  body: ReadableStream<Uint8Array>
}
interface R2UploadedPart {
  partNumber: number
  etag: string
}
interface R2MultipartUpload {
  uploadId: string
  uploadPart(partNumber: number, value: ReadableStream | ArrayBuffer): Promise<R2UploadedPart>
  complete(parts: R2UploadedPart[]): Promise<R2Object>
  abort(): Promise<void>
}
interface R2Bucket {
  head(key: string): Promise<R2Object | null>
  get(key: string, options?: { range?: Headers; onlyIf?: Headers }): Promise<R2ObjectBody | R2Object | null>
  put(key: string, value: ReadableStream | ArrayBuffer, options?: { httpMetadata?: R2HTTPMetadata }): Promise<R2Object | null>
  delete(keys: string | string[]): Promise<void>
  list(options: { prefix: string; cursor?: string; limit?: number }): Promise<{ objects: R2Object[]; truncated: boolean; cursor?: string }>
  createMultipartUpload(key: string, options?: { httpMetadata?: R2HTTPMetadata }): Promise<R2MultipartUpload>
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload
}

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export interface Env {
  BUCKET: R2Bucket
  IP_LIMITER?: RateLimit
  USER_LIMITER?: RateLimit
  SUPABASE_URL: string
  SUPABASE_PUBLISHABLE_KEY: string
  ALLOWED_ORIGINS: string
  FILES_PURGE_SECRET?: string
}

export const PART_BYTES = 50 * 1024 * 1024
export const SINGLE_PUT_MAX = 90 * 1024 * 1024
const MAX_PARTS = 10000

export const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/epub+zip',
  'application/vnd.comicbook+zip',
  'application/x-cbz',
  'application/x-cbt',
  'application/x-tar',
  'image/jpeg',
])

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const KEY_RE = new RegExp(`^(${UUID})/(${UUID})/([A-Za-z0-9_.\\- ]{1,120})$`)
export const isUuid = (v: unknown): v is string => typeof v === 'string' && new RegExp(`^${UUID}$`).test(v)

export function parseKey(key: unknown, userId: string) {
  if (typeof key !== 'string') return null
  const m = KEY_RE.exec(key)
  if (!m || m[1] !== userId || m[3].startsWith('.')) return null
  return { key, documentId: m[2] }
}

export function corsHeaders(req: Request, env: Env) {
  const origin = req.headers.get('origin') ?? ''
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  const h = new Headers({ Vary: 'Origin' })
  if (origin && allowed.includes(origin)) {
    h.set('Access-Control-Allow-Origin', origin)
    h.set('Access-Control-Allow-Methods', 'GET, HEAD, PUT, POST, DELETE, OPTIONS')
    h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Range, If-None-Match')
    h.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type, ETag, Accept-Ranges')
    h.set('Access-Control-Max-Age', '86400')
  }
  return h
}

export const json = (status: number, body: unknown, headers = new Headers()) => {
  headers.set('Content-Type', 'application/json')
  headers.set('Cache-Control', 'no-store')
  return new Response(JSON.stringify(body), { status, headers })
}

type AuthFetch = (input: string, init?: RequestInit) => Promise<Response>

const sessions = new Map<string, { userId: string; until: number }>()

async function digest(token: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function tokenExpiry(token: string) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0
  } catch {
    return 0
  }
}

export async function userFromToken(token: string, env: Env, fetcher: AuthFetch = fetch) {
  if (!token || token.split('.').length !== 3) return null
  const exp = tokenExpiry(token)
  if (!exp || exp <= Date.now()) return null
  const id = await digest(token)
  const hit = sessions.get(id)
  if (hit && hit.until > Date.now()) return hit.userId
  const res = await fetcher(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_PUBLISHABLE_KEY },
  })
  if (!res.ok) return null
  const user = (await res.json().catch(() => null)) as { id?: unknown } | null
  if (!user || !isUuid(user.id)) return null
  if (sessions.size > 5000) sessions.clear()
  sessions.set(id, { userId: user.id, until: Math.min(exp, Date.now() + 60_000) })
  return user.id
}

async function ownsDocument(token: string, documentId: string, env: Env, fetcher: AuthFetch) {
  const res = await fetcher(`${env.SUPABASE_URL}/rest/v1/documents?id=eq.${documentId}&select=id`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.SUPABASE_PUBLISHABLE_KEY, Accept: 'application/json' },
  })
  if (!res.ok) return false
  const rows = (await res.json().catch(() => [])) as { id: string }[]
  return Array.isArray(rows) && rows.some((r) => r.id === documentId)
}

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function purgePrefix(bucket: R2Bucket, userId: string) {
  if (!isUuid(userId)) throw new Error('invalid user id')
  let removed = 0
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: `${userId}/`, cursor, limit: 1000 })
    const keys = page.objects.map((o) => o.key).filter((k) => k.startsWith(`${userId}/`))
    if (keys.length) await bucket.delete(keys)
    removed += keys.length
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return removed
}

function tooMany(cors: Headers) {
  const h = new Headers(cors)
  h.set('Retry-After', '60')
  return json(429, { error: 'too many requests' }, h)
}

function contentLength(req: Request) {
  const n = Number(req.headers.get('content-length'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

export async function handle(req: Request, env: Env, fetcher: AuthFetch = fetch): Promise<Response> {
  const cors = corsHeaders(req, env)
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const url = new URL(req.url)

  if (url.pathname === '/purge' && req.method === 'POST') {
    const secret = env.FILES_PURGE_SECRET ?? ''
    if (secret.length < 32 || !sameSecret(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) return json(401, { error: 'unauthorized' })
    const body = (await req.json().catch(() => null)) as { user_id?: unknown } | null
    if (!isUuid(body?.user_id)) return json(400, { error: 'user_id must be a uuid' })
    return json(200, { removed: await purgePrefix(env.BUCKET, body.user_id) })
  }

  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown'
  if (env.IP_LIMITER && !(await env.IP_LIMITER.limit({ key: ip })).success) return tooMany(cors)
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const userId = await userFromToken(token, env, fetcher)
  if (!userId) return json(401, { error: 'unauthorized' }, cors)
  if (env.USER_LIMITER && !(await env.USER_LIMITER.limit({ key: userId })).success) return tooMany(cors)

  if (url.pathname === '/delete' && req.method === 'POST') {
    const body = (await req.json().catch(() => null)) as { keys?: unknown } | null
    const keys = Array.isArray(body?.keys) ? body.keys : null
    if (!keys || keys.length > 1000) return json(400, { error: 'keys must be an array of at most 1000 keys' }, cors)
    const own = keys.map((k) => parseKey(k, userId))
    if (own.some((k) => !k)) return json(403, { error: 'forbidden key' }, cors)
    if (own.length) await env.BUCKET.delete(own.map((k) => k!.key))
    return json(200, { removed: own.length }, cors)
  }

  const target = parseKey(url.searchParams.get('key'), userId)
  if (!target) return json(403, { error: 'forbidden key' }, cors)

  if (url.pathname === '/object' && (req.method === 'GET' || req.method === 'HEAD')) {
    const obj = req.method === 'HEAD' ? await env.BUCKET.head(target.key) : await env.BUCKET.get(target.key, { range: req.headers, onlyIf: req.headers })
    if (!obj) return json(404, { error: 'not found' }, cors)
    const headers = new Headers(cors)
    obj.writeHttpMetadata(headers)
    headers.set('ETag', obj.httpEtag)
    headers.set('Accept-Ranges', 'bytes')
    headers.set('Cache-Control', 'private, no-store')
    headers.set('X-Content-Type-Options', 'nosniff')
    headers.set('Content-Disposition', 'attachment')
    const body = 'body' in obj ? (obj as R2ObjectBody).body : null
    if (!body) {
      headers.set('Content-Length', String(obj.size))
      return new Response(null, { status: req.method === 'HEAD' ? 200 : 304, headers })
    }
    if (obj.range && req.headers.has('range')) {
      const start = obj.range.offset
      const length = obj.range.length ?? obj.size - start
      headers.set('Content-Range', `bytes ${start}-${start + length - 1}/${obj.size}`)
      headers.set('Content-Length', String(length))
      return new Response(body, { status: 206, headers })
    }
    headers.set('Content-Length', String(obj.size))
    return new Response(body, { status: 200, headers })
  }

  const contentType = url.searchParams.get('type') ?? req.headers.get('content-type') ?? ''
  const writes = ['/object', '/mpu/create', '/mpu/part', '/mpu/complete', '/mpu/abort']
  if (!writes.includes(url.pathname)) return json(404, { error: 'not found' }, cors)
  if (!(await ownsDocument(token, target.documentId, env, fetcher))) return json(403, { error: 'document not found' }, cors)

  if (url.pathname === '/object' && req.method === 'PUT') {
    if (!ALLOWED_TYPES.has(contentType)) return json(415, { error: `file type not allowed: ${contentType}` }, cors)
    const size = contentLength(req)
    if (!size || !req.body) return json(411, { error: 'content-length required' }, cors)
    if (size > SINGLE_PUT_MAX) return json(413, { error: 'use a multipart upload for files this large' }, cors)
    if (await env.BUCKET.head(target.key)) return json(409, { error: 'object already exists' }, cors)
    await env.BUCKET.put(target.key, req.body, { httpMetadata: { contentType, cacheControl: 'private, no-store' } })
    return json(201, { key: target.key }, cors)
  }

  if (url.pathname === '/mpu/create' && req.method === 'POST') {
    if (!ALLOWED_TYPES.has(contentType)) return json(415, { error: `file type not allowed: ${contentType}` }, cors)
    const size = Number(url.searchParams.get('size'))
    if (!Number.isFinite(size) || size <= 0) return json(400, { error: 'size required' }, cors)
    if (size > PART_BYTES * MAX_PARTS) return json(413, { error: 'file is too large for a multipart upload' }, cors)
    if (await env.BUCKET.head(target.key)) return json(409, { error: 'object already exists' }, cors)
    const mpu = await env.BUCKET.createMultipartUpload(target.key, { httpMetadata: { contentType, cacheControl: 'private, no-store' } })
    return json(200, { uploadId: mpu.uploadId, partSize: PART_BYTES }, cors)
  }

  const uploadId = url.searchParams.get('uploadId') ?? ''
  if (!uploadId || uploadId.length > 1024) return json(400, { error: 'uploadId required' }, cors)
  const mpu = env.BUCKET.resumeMultipartUpload(target.key, uploadId)

  if (url.pathname === '/mpu/part' && req.method === 'PUT') {
    const part = Number(url.searchParams.get('part'))
    const size = contentLength(req)
    if (!Number.isInteger(part) || part < 1 || part > MAX_PARTS) return json(400, { error: 'invalid part number' }, cors)
    if (!size || size > PART_BYTES || !req.body) return json(413, { error: 'invalid part size' }, cors)
    const uploaded = await mpu.uploadPart(part, req.body)
    return json(200, uploaded, cors)
  }

  if (url.pathname === '/mpu/complete' && req.method === 'POST') {
    const body = (await req.json().catch(() => null)) as { parts?: R2UploadedPart[] } | null
    const parts = Array.isArray(body?.parts) ? body.parts.filter((p) => Number.isInteger(p?.partNumber) && typeof p?.etag === 'string') : []
    if (!parts.length || parts.length > MAX_PARTS) return json(400, { error: 'invalid parts' }, cors)
    const obj = await mpu.complete(parts)
    return json(201, { key: obj.key }, cors)
  }

  if (url.pathname === '/mpu/abort' && req.method === 'DELETE') {
    await mpu.abort().catch(() => {})
    return json(200, { aborted: true }, cors)
  }

  return json(405, { error: 'method not allowed' }, cors)
}
