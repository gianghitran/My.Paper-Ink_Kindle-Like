import { supabase } from '@/lib/supabase/client'
import { enqueue, flush, type RemoteSpec } from './sync'

type Row = Record<string, unknown>
type Key = string


let version = 0
const listeners = new Set<() => void>()
export const storeVersion = () => version
export function subscribeStore(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
let notifyScheduled = false
function notify() {
  version++
  if (notifyScheduled) return
  notifyScheduled = true
  queueMicrotask(() => {
    notifyScheduled = false
    listeners.forEach((f) => f())
  })
}

export interface TableDef<T> {
  
  key: keyof T & string
  
  remote: (RemoteSpec & { toRow: (rec: T) => Row; fromRow: (row: Row) => T; match: (key: Key) => Row }) | null
}

const clone = <T,>(v: T): T => (v && typeof v === 'object' ? ({ ...(v as object) } as T) : v)

function compare(a: unknown, b: unknown) {
  if (a === b) return 0
  if (a === undefined || a === null) return -1
  if (b === undefined || b === null) return 1
  return (a as number | string) < (b as number | string) ? -1 : 1
}


export class Collection<T> {
  constructor(
    private readonly table: CloudTable<T>,
    private readonly rows: () => T[],
  ) {}
  filter(fn: (rec: T) => boolean) {
    return new Collection(this.table, () => this.rows().filter(fn))
  }
  reverse() {
    return new Collection(this.table, () => [...this.rows()].reverse())
  }
  async toArray() {
    return this.rows().map(clone)
  }
  async first() {
    const r = this.rows()[0]
    return r === undefined ? undefined : clone(r)
  }
  async count() {
    return this.rows().length
  }
  async primaryKeys() {
    return this.rows().map((r) => r[this.table.def.key] as unknown as Key)
  }
  
  async keys() {
    return this.rows().map((r) => (this.orderField ? r[this.orderField] : r[this.table.def.key]))
  }
  async sortBy(field: keyof T & string) {
    return [...this.rows()].sort((a, b) => compare(a[field], b[field])).map(clone)
  }
  async delete() {
    const keys = this.rows().map((r) => r[this.table.def.key] as unknown as Key)
    await this.table.bulkDelete(keys)
    return keys.length
  }
  orderField?: keyof T & string
}

export class CloudTable<T> {
  private readonly rows = new Map<Key, T>()

  constructor(
    readonly name: string,
    readonly def: TableDef<T>,
  ) {}

  private keyOf(rec: T): Key {
    return String(rec[this.def.key])
  }

  private all() {
    return [...this.rows.values()]
  }

  
  async get(key: Key) {
    const r = this.rows.get(String(key))
    return r === undefined ? undefined : clone(r)
  }
  async toArray() {
    return this.all().map(clone)
  }
  async count() {
    return this.rows.size
  }
  filter(fn: (rec: T) => boolean) {
    return new Collection(this, () => this.all().filter(fn))
  }
  toCollection() {
    return new Collection(this, () => this.all())
  }
  where(field: keyof T & string) {
    return {
      equals: (value: unknown) => new Collection(this, () => this.all().filter((r) => r[field] === value)),
      anyOf: (values: unknown[]) => {
        const set = new Set(values)
        return new Collection(this, () => this.all().filter((r) => set.has(r[field])))
      },
    }
  }
  orderBy(field: keyof T & string) {
    const c = new Collection(this, () => [...this.all()].sort((a, b) => compare(a[field], b[field])))
    c.orderField = field
    return c
  }

  
  private write(rec: T) {
    const key = this.keyOf(rec)
    this.rows.set(key, clone(rec))
    if (this.def.remote) enqueue({ kind: 'upsert', spec: this.def.remote, id: key, row: this.def.remote.toRow(rec) })
    notify()
    return key
  }
  async put(rec: T) {
    return this.write(rec)
  }
  async add(rec: T) {
    return this.write(rec)
  }
  async bulkPut(recs: T[]) {
    for (const r of recs) this.write(r)
  }
  async update(key: Key, patch: Partial<T>) {
    const cur = this.rows.get(String(key))
    if (!cur) return 0
    this.write({ ...cur, ...patch })
    return 1
  }
  async delete(key: Key) {
    const k = String(key)
    if (!this.rows.delete(k) && !this.def.remote) return
    if (this.def.remote) enqueue({ kind: 'delete', spec: this.def.remote, id: k, match: this.def.remote.match(k) })
    notify()
  }
  async bulkDelete(keys: Key[]) {
    for (const k of keys) await this.delete(k)
  }

  




  async putNow(rec: T) {
    if (!this.def.remote) return this.write(rec)
    await flush()
    const { error } = await supabase.from(this.def.remote.table).upsert(this.def.remote.toRow(rec), { onConflict: this.def.remote.keyColumns.join(',') })
    if (error) throw new Error(error.message)
    this.rows.set(this.keyOf(rec), clone(rec))
    notify()
    return this.keyOf(rec)
  }
  async deleteNow(key: Key) {
    this.rows.delete(String(key))
    notify()
    if (!this.def.remote) return
    await flush()
    let q = supabase.from(this.def.remote.table).delete()
    for (const [c, v] of Object.entries(this.def.remote.match(String(key)))) q = q.eq(c, v as string)
    const { error } = await q
    if (error) throw new Error(error.message)
  }

  
  forget(match: (rec: T) => boolean) {
    let changed = false
    for (const [k, r] of this.rows) {
      if (match(r)) {
        this.rows.delete(k)
        changed = true
      }
    }
    if (changed) notify()
  }
  
  patchLocal(match: (rec: T) => boolean, patch: Partial<T>) {
    let changed = false
    for (const [k, r] of this.rows) {
      if (match(r)) {
        this.rows.set(k, { ...r, ...patch })
        changed = true
      }
    }
    if (changed) notify()
  }

  
  
  async hydrate() {
    if (!this.def.remote) return
    
    const next = new Map<Key, T>()
    const pageSize = 1000
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase.from(this.def.remote.table).select('*').range(from, from + pageSize - 1)
      if (error) throw new Error(`${this.def.remote.table}: ${error.message}`)
      for (const row of data ?? []) {
        const rec = this.def.remote.fromRow(row as Row)
        
        const prev = this.rows.get(this.keyOf(rec))
        next.set(this.keyOf(rec), prev ? { ...prev, ...rec } : rec)
      }
      if (!data || data.length < pageSize) break
    }
    this.rows.clear()
    for (const [k, v] of next) this.rows.set(k, v)
    notify()
  }
  
  reset() {
    this.rows.clear()
    notify()
  }
}
