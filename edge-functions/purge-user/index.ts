export const BUCKET = 'documents'
const PAGE = 1000

export interface StorageLike {
  list(prefix: string, opts: { limit: number; offset: number }): Promise<{ data: { name: string; id: string | null }[] | null; error: { message: string } | null }>
  remove(paths: string[]): Promise<{ error: { message: string } | null }>
}

export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

export async function listAll(storage: StorageLike, prefix: string): Promise<string[]> {
  const out: string[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await storage.list(prefix, { limit: PAGE, offset })
    if (error) throw new Error(`list ${prefix}: ${error.message}`)
    for (const item of data ?? []) {
      const path = `${prefix}/${item.name}`
      if (item.id === null) out.push(...(await listAll(storage, path)))
      else out.push(path)
    }
    if (!data || data.length < PAGE) return out
  }
}

export async function purgeUserObjects(storage: StorageLike, userId: string) {
  if (!isUuid(userId)) throw new Error('invalid user id')
  const paths = await listAll(storage, userId)

  const own = paths.filter((p) => p.startsWith(`${userId}/`) && !p.includes('..'))
  for (let i = 0; i < own.length; i += PAGE) {
    const { error } = await storage.remove(own.slice(i, i + PAGE))
    if (error) throw new Error(`remove: ${error.message}`)
  }
  return own.length
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function sameSecret(a: string, b: string) {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function handle(req: Request, env: (k: string) => string | undefined): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method not allowed' })
  const secret = env('PURGE_WEBHOOK_SECRET')
  const auth = req.headers.get('authorization') ?? ''
  if (!secret || secret.length < 32 || !sameSecret(auth, `Bearer ${secret}`)) return json(401, { error: 'unauthorized' })
  const body = await req.json().catch(() => null)
  const userId = body?.user_id
  if (!isUuid(userId)) return json(400, { error: 'user_id must be a uuid' })

  const { createClient } = await import('npm:@supabase/supabase-js@2')
  const admin = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } })

  const { data: profile, error: profileError } = await admin.from('profiles').select('user_id').eq('user_id', userId).maybeSingle()
  if (profileError) return json(500, { error: 'profile check failed' })
  if (profile) return json(409, { error: 'profile still exists' })

  try {
    const removed = await purgeUserObjects(admin.storage.from(BUCKET) as unknown as StorageLike, userId)
    const { error: delError } = await admin.auth.admin.deleteUser(userId)

    const userDeleted = !delError || /not.?found/i.test(delError.message)
    if (!userDeleted) console.error('purge-user: auth delete failed', userId, delError?.message)
    console.log('purge-user', userId, 'objects removed:', removed)
    return json(userDeleted ? 200 : 500, { removed, userDeleted })
  } catch (err) {
    console.error('purge-user failed', userId, (err as Error).message)
    return json(500, { error: 'purge failed' })
  }
}

declare const Deno: { serve: (h: (r: Request) => Response | Promise<Response>) => void; env: { get: (k: string) => string | undefined } } | undefined
if (typeof Deno !== 'undefined') Deno.serve((req) => handle(req, (k) => Deno!.env.get(k)))
