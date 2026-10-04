export interface MobiImage {
  data: Uint8Array
  mime: string
  ext: string
}

export interface MobiBook {
  title: string
  author?: string
  publisher?: string
  description?: string
  language?: string
  fixedLayout: boolean
  rightToLeft: boolean
  markup: Uint8Array
  utf8: boolean
  coverIndex?: number
  image(recindex: number): MobiImage | null
}

export class MobiError extends Error {}

const latin1 = new TextDecoder('latin1')

export function isMobi(bytes: Uint8Array) {
  if (bytes.length < 68) return false
  const type = latin1.decode(bytes.subarray(60, 68))
  return type === 'BOOKMOBI' || type === 'TEXtREAd'
}

function records(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const count = view.getUint16(76)
  const offsets: number[] = []
  for (let i = 0; i < count; i++) offsets.push(view.getUint32(78 + i * 8))
  offsets.push(data.byteLength)
  return (i: number) => {
    if (i < 0 || i >= count) return null
    const start = offsets[i]
    const end = offsets[i + 1]
    if (start > end || end > data.byteLength) return null
    return data.subarray(start, end)
  }
}

export function palmDocDecompress(src: Uint8Array) {
  const out = new Uint8Array(src.length * 8 + 16)
  let o = 0
  let i = 0
  while (i < src.length) {
    const c = src[i++]
    if (c >= 1 && c <= 8) {
      for (let k = 0; k < c && i < src.length; k++) out[o++] = src[i++]
    } else if (c < 0x80) {
      out[o++] = c
    } else if (c >= 0xc0) {
      out[o++] = 0x20
      out[o++] = c ^ 0x80
    } else {
      if (i >= src.length) break
      const pair = ((c << 8) | src[i++]) & 0x3fff
      const dist = pair >> 3
      const len = (pair & 7) + 3
      if (dist === 0 || dist > o) break
      for (let k = 0; k < len; k++, o++) out[o] = out[o - dist]
    }
  }
  return out.subarray(0, o)
}

class HuffCdic {
  private dict1: { len: number; term: boolean; max: number }[] = []
  private mincode: number[] = []
  private maxcode: number[] = []
  private phrases: { data: Uint8Array; done: boolean }[] = []

  constructor(huff: Uint8Array, cdics: Uint8Array[]) {
    const hv = new DataView(huff.buffer, huff.byteOffset, huff.byteLength)
    if (latin1.decode(huff.subarray(0, 4)) !== 'HUFF') throw new MobiError('Invalid HUFF record')
    const off1 = hv.getUint32(8)
    const off2 = hv.getUint32(12)
    for (let i = 0; i < 256; i++) {
      const v = hv.getUint32(off1 + i * 4)
      const len = v & 0x1f
      const term = (v & 0x80) !== 0
      const max = ((v >>> 8) + 1) * 2 ** (32 - len) - 1
      this.dict1.push({ len, term, max })
    }
    for (let len = 1; len <= 32; len++) {
      const lo = hv.getUint32(off2 + (len - 1) * 8)
      const hi = hv.getUint32(off2 + (len - 1) * 8 + 4)
      this.mincode[len] = lo * 2 ** (32 - len)
      this.maxcode[len] = (hi + 1) * 2 ** (32 - len) - 1
    }
    for (const cdic of cdics) {
      const cv = new DataView(cdic.buffer, cdic.byteOffset, cdic.byteLength)
      if (latin1.decode(cdic.subarray(0, 4)) !== 'CDIC') throw new MobiError('Invalid CDIC record')
      const total = cv.getUint32(8)
      const bits = cv.getUint32(12)
      const n = Math.min(2 ** bits, total - this.phrases.length)
      for (let i = 0; i < n; i++) {
        const off = 16 + cv.getUint16(16 + i * 2)
        const blen = cv.getUint16(off)
        this.phrases.push({ data: cdic.subarray(off + 2, off + 2 + (blen & 0x7fff)), done: (blen & 0x8000) !== 0 })
      }
    }
  }

  unpack(data: Uint8Array, depth = 0): Uint8Array {
    if (depth > 32) throw new MobiError('HUFF/CDIC recursion too deep')
    const padded = new Uint8Array(data.length + 8)
    padded.set(data)
    const peek32 = (bit: number) => {
      const i = bit >>> 3
      const sh = bit & 7
      const v = ((padded[i] << 24) | (padded[i + 1] << 16) | (padded[i + 2] << 8) | padded[i + 3]) >>> 0
      return sh ? ((v << sh) | (padded[i + 4] >>> (8 - sh))) >>> 0 : v
    }
    const parts: Uint8Array[] = []
    let total = 0
    let bit = 0
    let left = data.length * 8
    for (;;) {
      const code = peek32(bit)
      let { len, term, max } = this.dict1[code >>> 24]
      if (!term) {
        while (len < 32 && code < this.mincode[len]) len++
        max = this.maxcode[len]
      }
      if (!len) throw new MobiError('Invalid HUFF code')
      bit += len
      left -= len
      if (left < 0) break
      const r = Math.floor((max - code) / 2 ** (32 - len))
      const p = this.phrases[r]
      if (!p) throw new MobiError('Invalid HUFF phrase')
      if (!p.done) {
        p.data = this.unpack(p.data, depth + 1)
        p.done = true
      }
      parts.push(p.data)
      total += p.data.length
    }
    const out = new Uint8Array(total)
    let o = 0
    for (const p of parts) {
      out.set(p, o)
      o += p.length
    }
    return out
  }
}

function trailingSize(rec: Uint8Array, flags: number) {
  let num = 0
  const size = rec.length
  let f = flags >> 1
  while (f) {
    if (f & 1) {
      let shift = 0
      let value = 0
      let p = size - num
      for (;;) {
        if (p <= 0) break
        const v = rec[p - 1]
        value |= (v & 0x7f) << shift
        shift += 7
        p--
        if (v & 0x80 || shift >= 28) break
      }
      num += value
    }
    f >>= 1
  }
  if (flags & 1 && size - num - 1 >= 0) num += (rec[size - num - 1] & 3) + 1
  return Math.min(num, size)
}

function sniffImage(d: Uint8Array): Omit<MobiImage, 'data'> | null {
  if (d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47) return { mime: 'image/png', ext: 'png' }
  if (d[0] === 0x47 && d[1] === 0x49 && d[2] === 0x46 && d[3] === 0x38) return { mime: 'image/gif', ext: 'gif' }
  if (d[0] === 0x42 && d[1] === 0x4d) return { mime: 'image/bmp', ext: 'bmp' }
  return null
}

function readExth(rec0: Uint8Array, at: number) {
  const out = new Map<number, Uint8Array[]>()
  if (at + 12 > rec0.length || latin1.decode(rec0.subarray(at, at + 4)) !== 'EXTH') return out
  const v = new DataView(rec0.buffer, rec0.byteOffset, rec0.byteLength)
  const count = v.getUint32(at + 8)
  let p = at + 12
  for (let i = 0; i < count && p + 8 <= rec0.length; i++) {
    const type = v.getUint32(p)
    const len = v.getUint32(p + 4)
    if (len < 8 || p + len > rec0.length) break
    out.set(type, [...(out.get(type) ?? []), rec0.subarray(p + 8, p + len)])
    p += len
  }
  return out
}

export function readMobi(buffer: ArrayBuffer): MobiBook {
  const data = new Uint8Array(buffer)
  if (!isMobi(data)) throw new MobiError('Not a MOBI/PRC file')
  const rec = records(data)
  const rec0 = rec(0)
  if (!rec0 || rec0.length < 16) throw new MobiError('The MOBI header is missing')
  const v = new DataView(rec0.buffer, rec0.byteOffset, rec0.byteLength)
  const compression = v.getUint16(0)
  const textLength = v.getUint32(4)
  const textRecords = v.getUint16(8)
  const encryption = v.getUint16(12)
  if (encryption !== 0) throw new MobiError('This MOBI is DRM-protected. Only DRM-free MOBI files can be opened.')

  const hasMobi = rec0.length >= 24 && latin1.decode(rec0.subarray(16, 20)) === 'MOBI'
  const headerLength = hasMobi ? v.getUint32(20) : 0
  const u32 = (o: number) => (hasMobi && o + 4 <= 16 + headerLength && o + 4 <= rec0.length ? v.getUint32(o) : 0xffffffff)
  const codepage = u32(28)
  const version = u32(36)
  const firstImage = u32(108)
  const huffOffset = u32(112)
  const huffCount = u32(116)
  const exthFlags = u32(128)
  const extraFlags = hasMobi && headerLength >= 0xe4 && rec0.length >= 244 ? v.getUint16(242) : 0
  const exth = hasMobi && exthFlags !== 0xffffffff && exthFlags & 0x40 ? readExth(rec0, 16 + headerLength) : new Map<number, Uint8Array[]>()
  if (version === 8 && !exth.has(121)) throw new MobiError('This is a KF8 (AZW3) book. KOReader’s MOBI engine reads MOBI 6 only; convert it to EPUB first.')

  const utf8 = codepage === 65001
  const decodeStr = (b: Uint8Array) => new TextDecoder(utf8 ? 'utf-8' : 'windows-1252').decode(b).replace(/\0+$/, '').trim()
  const exthStr = (t: number) => {
    const list = exth.get(t)
    return list?.length ? list.map(decodeStr).filter(Boolean).join(', ') || undefined : undefined
  }
  const exthNum = (t: number) => {
    const b = exth.get(t)?.[0]
    if (!b || b.length < 1 || b.length > 4) return undefined
    let n = 0
    for (const x of b) n = n * 256 + x
    return n
  }

  let title = exthStr(503)
  if (!title && hasMobi) {
    const off = u32(84)
    const len = u32(88)
    if (off !== 0xffffffff && len !== 0xffffffff && off + len <= rec0.length) title = decodeStr(rec0.subarray(off, off + len))
  }
  if (!title) title = latin1.decode(data.subarray(0, 32)).replace(/\0.*$/s, '').replace(/_/g, ' ').trim()

  let huff: HuffCdic | null = null
  if (compression === 17480) {
    const h = rec(huffOffset)
    if (!h) throw new MobiError('HUFF/CDIC dictionary missing')
    const cdics: Uint8Array[] = []
    for (let i = 1; i < huffCount; i++) {
      const c = rec(huffOffset + i)
      if (c) cdics.push(c)
    }
    huff = new HuffCdic(h, cdics)
  } else if (compression !== 1 && compression !== 2) throw new MobiError(`Unsupported MOBI compression (${compression})`)

  const chunks: Uint8Array[] = []
  let total = 0
  for (let i = 1; i <= textRecords; i++) {
    const r = rec(i)
    if (!r) break
    const body = r.subarray(0, r.length - trailingSize(r, extraFlags))
    const text = compression === 1 ? body : compression === 2 ? palmDocDecompress(body) : huff!.unpack(body)
    chunks.push(text)
    total += text.length
  }
  const markup = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    markup.set(c, o)
    o += c.length
  }

  const fixed = (exthStr(122) ?? '').toLowerCase() === 'true'
  const kind = (exthStr(123) ?? '').toLowerCase()
  const cover = exthNum(201)
  return {
    title,
    author: exthStr(100),
    publisher: exthStr(101),
    description: exthStr(103),
    language: exthStr(524),
    fixedLayout: fixed || kind === 'comic' || kind === 'manga',
    rightToLeft: (exthStr(525) ?? '').toLowerCase().endsWith('-rl') || kind === 'manga',
    markup: markup.subarray(0, textLength && textLength < markup.length ? textLength : markup.length),
    utf8,
    coverIndex: cover !== undefined && cover !== 0xffffffff ? cover + 1 : undefined,
    image: (recindex) => {
      if (firstImage === 0xffffffff || !Number.isInteger(recindex) || recindex < 1) return null
      const d = rec(firstImage + recindex - 1)
      const kind = d && sniffImage(d)
      return d && kind ? { data: d, ...kind } : null
    },
  }
}
