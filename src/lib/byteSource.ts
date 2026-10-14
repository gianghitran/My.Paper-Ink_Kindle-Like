export interface ByteSource {
  size: number
  read(start: number, end: number): Promise<Uint8Array>
}

const partsOf = new WeakMap<Blob, Blob[]>()
const remoteOf = new WeakMap<Blob, ByteSource>()

export function remoteBlob(source: ByteSource, type: string) {
  const handle = new Blob([], { type })
  remoteOf.set(handle, source)
  return handle
}

export const isRemote = (blob: Blob) => remoteOf.has(blob)

export function blockCachedSource(size: number, fetchRange: (start: number, end: number) => Promise<Uint8Array>, blockSize = 2 * 1024 * 1024, keep = 16): ByteSource & { seed(start: number, data: Uint8Array): void } {
  const blocks = new Map<number, Promise<Uint8Array>>()
  const touch = (i: number, p: Promise<Uint8Array>) => {
    blocks.delete(i)
    blocks.set(i, p)
    while (blocks.size > keep) blocks.delete(blocks.keys().next().value as number)
  }
  const block = (i: number) => {
    let p = blocks.get(i)
    if (!p) {
      p = fetchRange(i * blockSize, Math.min(size, (i + 1) * blockSize))
      p.catch(() => blocks.delete(i))
    }
    touch(i, p)
    return p
  }
  return {
    size,
    seed(start, data) {
      if (start % blockSize) return
      for (let off = 0; off < data.length; off += blockSize) {
        const slice = data.subarray(off, off + blockSize)
        if (slice.length < blockSize && start + off + slice.length < size) break
        touch((start + off) / blockSize, Promise.resolve(slice))
      }
    },
    read: async (s, e) => {
      const from = Math.max(0, s)
      const to = Math.min(size, e)
      const out = new Uint8Array(Math.max(0, to - from))
      for (let i = Math.floor(from / blockSize); i * blockSize < to; i++) {
        const data = await block(i)
        const bStart = i * blockSize
        const a = Math.max(from, bStart)
        const b = Math.min(to, bStart + data.length)
        out.set(data.subarray(a - bStart, b - bStart), a - from)
      }
      return out
    },
  }
}

export function joinParts(parts: Blob[], type: string) {
  const blob = new Blob(parts, { type })
  if (parts.length > 1) partsOf.set(blob, parts)
  return blob
}

export function byteSource(blob: Blob): ByteSource {
  const remote = remoteOf.get(blob)
  if (remote) return remote
  const parts = partsOf.get(blob)
  if (!parts) return { size: blob.size, read: async (s, e) => new Uint8Array(await blob.slice(s, e).arrayBuffer()) }
  const starts: number[] = []
  let total = 0
  for (const p of parts) {
    starts.push(total)
    total += p.size
  }
  return {
    size: total,
    read: async (s, e) => {
      const from = Math.max(0, s)
      const to = Math.min(total, e)
      const out = new Uint8Array(Math.max(0, to - from))
      let i = starts.findIndex((st, k) => from >= st && from < st + parts[k].size)
      let o = 0
      while (i >= 0 && i < parts.length && o < out.length) {
        const a = Math.max(0, from + o - starts[i])
        const b = Math.min(parts[i].size, to - starts[i])
        const chunk = new Uint8Array(await parts[i].slice(a, b).arrayBuffer())
        out.set(chunk, o)
        o += chunk.length
        i++
      }
      return out
    },
  }
}
