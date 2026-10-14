import JSZip from 'jszip'
import { makeThumbnail, titleFromFileName, type ExtractedMetadata } from './index'
import { byteSource, type ByteSource } from '@/lib/byteSource'

const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i

export interface ComicPage {
  name: string
  mime: string
  load: () => Promise<Uint8Array>
  loadHead?: (max: number) => Promise<Uint8Array>
}

const mimeFor = (name: string) => {
  const ext = name.toLowerCase().split('.').pop()
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
}

const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

export async function listComicPages(data: ArrayBuffer): Promise<ComicPage[]> {
  const head = new Uint8Array(data, 0, Math.min(data.byteLength, 512))
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const zip = await JSZip.loadAsync(data)
    return Object.values(zip.files)
      .filter((f) => !f.dir && IMAGE_RE.test(f.name) && !/(^|\/)(__MACOSX|\.)/.test(f.name))
      .sort((a, b) => naturalSort(a.name, b.name))
      .map((f) => ({ name: f.name, mime: mimeFor(f.name), load: () => f.async('uint8array') }))
  }
  return listTar(data)
}

const readBytes = (src: ByteSource, start: number, end: number) => src.read(start, end)

const pageFilter = (name: string) => IMAGE_RE.test(name) && !/(^|\/)(__MACOSX|\.)/.test(name)

async function inflateRaw(data: Uint8Array) {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function inflateRawHead(data: Uint8Array, max: number) {
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < max) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.length
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
  const out = new Uint8Array(Math.min(total, max))
  let o = 0
  for (const c of chunks) {
    if (o >= out.length) break
    const part = c.subarray(0, out.length - o)
    out.set(part, o)
    o += part.length
  }
  return out
}

async function listZipFromBlob(blob: ByteSource): Promise<ComicPage[] | null> {
  const tailStart = Math.max(0, blob.size - (65_535 + 22 + 20))
  const tail = await readBytes(blob, tailStart, blob.size)
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return null
  let count = tv.getUint16(eocd + 10, true)
  let cdSize = tv.getUint32(eocd + 12, true)
  let cdOffset = tv.getUint32(eocd + 16, true)
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20
    if (loc < 0 || tv.getUint32(loc, true) !== 0x07064b50) return null
    const z64Offset = Number(tv.getBigUint64(loc + 8, true))
    const z64 = await readBytes(blob, z64Offset, z64Offset + 56)
    const zv = new DataView(z64.buffer, z64.byteOffset, z64.byteLength)
    if (zv.getUint32(0, true) !== 0x06064b50) return null
    count = Number(zv.getBigUint64(32, true))
    cdSize = Number(zv.getBigUint64(40, true))
    cdOffset = Number(zv.getBigUint64(48, true))
  }
  const cd = await readBytes(blob, cdOffset, cdOffset + cdSize)
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength)
  const utf8 = new TextDecoder()
  const latin1 = new TextDecoder('latin1')
  const pages: ComicPage[] = []
  let p = 0
  for (let n = 0; n < count && p + 46 <= cd.length; n++) {
    if (cv.getUint32(p, true) !== 0x02014b50) return null
    const flags = cv.getUint16(p + 8, true)
    const method = cv.getUint16(p + 10, true)
    let compSize = cv.getUint32(p + 20, true)
    let size = cv.getUint32(p + 24, true)
    const nameLen = cv.getUint16(p + 28, true)
    const extraLen = cv.getUint16(p + 30, true)
    const commentLen = cv.getUint16(p + 32, true)
    let local = cv.getUint32(p + 42, true)
    const nameBytes = cd.subarray(p + 46, p + 46 + nameLen)
    const name = (flags & 0x800 ? utf8 : latin1).decode(nameBytes)
    let e = p + 46 + nameLen
    const extraEnd = e + extraLen
    while (e + 4 <= extraEnd) {
      const id = cv.getUint16(e, true)
      const len = cv.getUint16(e + 2, true)
      if (id === 0x0001) {
        let q = e + 4
        if (size === 0xffffffff) {
          size = Number(cv.getBigUint64(q, true))
          q += 8
        }
        if (compSize === 0xffffffff) {
          compSize = Number(cv.getBigUint64(q, true))
          q += 8
        }
        if (local === 0xffffffff) local = Number(cv.getBigUint64(q, true))
      }
      e += 4 + len
    }
    p = extraEnd + commentLen
    if (name.endsWith('/') || !pageFilter(name) || flags & 1) continue
    if (method !== 0 && method !== 8) continue
    const entry = { local, compSize, method }
    let dataStart: Promise<number> | null = null
    const start = () =>
      (dataStart ??= readBytes(blob, entry.local, entry.local + 30).then((head) => {
        const hv = new DataView(head.buffer, head.byteOffset, head.byteLength)
        if (hv.getUint32(0, true) !== 0x04034b50) throw new Error(`Damaged page: ${name}`)
        return entry.local + 30 + hv.getUint16(26, true) + hv.getUint16(28, true)
      }))
    pages.push({
      name,
      mime: mimeFor(name),
      load: async () => {
        const s = await start()
        const raw = await readBytes(blob, s, s + entry.compSize)
        return entry.method === 8 ? inflateRaw(raw) : raw
      },
      loadHead: async (max) => {
        const s = await start()
        if (entry.method === 0) return readBytes(blob, s, s + Math.min(entry.compSize, max))
        return inflateRawHead(await readBytes(blob, s, s + Math.min(entry.compSize, max)), max).catch(() => new Uint8Array(0))
      },
    })
  }
  return pages.sort((a, b) => naturalSort(a.name, b.name))
}

async function listTarFromBlob(blob: ByteSource): Promise<ComicPage[]> {
  const dec = new TextDecoder('latin1')
  const out: ComicPage[] = []
  let off = 0
  let longName: string | null = null
  while (off + 512 <= blob.size) {
    const header = await readBytes(blob, off, off + 512)
    if (header.every((b) => b === 0)) break
    let name = dec.decode(header.subarray(0, 100)).replace(/\0.*$/s, '')
    const prefix = dec.decode(header.subarray(345, 500)).replace(/\0.*$/s, '')
    if (prefix) name = `${prefix}/${name}`
    const size = parseInt(dec.decode(header.subarray(124, 136)).replace(/\0.*$/s, '').trim() || '0', 8)
    const type = String.fromCharCode(header[156])
    const start = off + 512
    if (type === 'L') longName = dec.decode(await readBytes(blob, start, start + size)).replace(/\0.*$/s, '')
    else if ((type === '0' || type === '\0') && IMAGE_RE.test(longName ?? name)) {
      const n = longName ?? name
      out.push({ name: n, mime: mimeFor(n), load: () => readBytes(blob, start, start + size), loadHead: (max) => readBytes(blob, start, start + Math.min(size, max)) })
      longName = null
    } else longName = null
    off = start + Math.ceil(size / 512) * 512
  }
  return out.sort((a, b) => naturalSort(a.name, b.name))
}

export async function listComicPagesFromBlob(blob: Blob): Promise<ComicPage[]> {
  const src = byteSource(blob)
  const head = await readBytes(src, 0, Math.min(src.size, 512))
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const pages = typeof DecompressionStream === 'undefined' ? null : await listZipFromBlob(src).catch(() => null)
    return pages ?? listComicPages(await blob.arrayBuffer())
  }
  return listTarFromBlob(src)
}

function listTar(data: ArrayBuffer): ComicPage[] {
  const bytes = new Uint8Array(data)
  const dec = new TextDecoder('latin1')
  const out: ComicPage[] = []
  let off = 0
  let longName: string | null = null
  while (off + 512 <= bytes.length) {
    const header = bytes.subarray(off, off + 512)
    if (header.every((b) => b === 0)) break
    let name = dec.decode(header.subarray(0, 100)).replace(/\0.*$/s, '')
    const prefix = dec.decode(header.subarray(345, 500)).replace(/\0.*$/s, '')
    if (prefix) name = `${prefix}/${name}`
    const size = parseInt(dec.decode(header.subarray(124, 136)).replace(/\0.*$/s, '').trim() || '0', 8)
    const type = String.fromCharCode(header[156])
    const start = off + 512
    if (type === 'L') longName = dec.decode(bytes.subarray(start, start + size)).replace(/\0.*$/s, '')
    else if ((type === '0' || type === '\0') && IMAGE_RE.test(longName ?? name)) {
      const n = longName ?? name
      const slice = bytes.slice(start, start + size)
      out.push({ name: n, mime: mimeFor(n), load: async () => slice })
      longName = null
    } else longName = null
    off = start + Math.ceil(size / 512) * 512
  }
  return out.sort((a, b) => naturalSort(a.name, b.name))
}

export function imageSize(b: Uint8Array): { w: number; h: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50) return { w: dv.getUint32(16), h: dv.getUint32(20) }
  if (b.length > 10 && b[0] === 0x47 && b[1] === 0x49) return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) }
  if (b.length > 26 && b[0] === 0x42 && b[1] === 0x4d) return { w: dv.getInt32(18, true), h: Math.abs(dv.getInt32(22, true)) }
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) {
    const chunk = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (chunk === 'VP8 ') return { w: dv.getUint16(26, true) & 0x3fff, h: dv.getUint16(28, true) & 0x3fff }
    if (chunk === 'VP8L') {
      const v = dv.getUint32(21, true)
      return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++
        continue
      }
      const marker = b[i + 1]
      const len = dv.getUint16(i + 2)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) }
      }
      i += 2 + len
    }
  }
  return null
}

export async function extractComicMetadata(data: ArrayBuffer, fileName: string): Promise<ExtractedMetadata> {
  const pages = await listComicPages(data)
  if (!pages.length) throw new Error('No images found in this comic archive')
  let cover: Blob | undefined
  try {
    const bmp = await createImageBitmap(new Blob([(await pages[0].load()) as BlobPart], { type: pages[0].mime }))
    cover = await makeThumbnail(bmp)
    bmp.close()
  } catch {

  }
  return { title: titleFromFileName(fileName), pageCount: pages.length, cover }
}
