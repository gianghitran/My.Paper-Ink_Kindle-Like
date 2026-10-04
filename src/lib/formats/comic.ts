import JSZip from 'jszip'
import { makeThumbnail, titleFromFileName, type ExtractedMetadata } from './index'

const IMAGE_RE = /\.(jpe?g|png|gif|webp|avif|bmp)$/i

export interface ComicPage {
  name: string
  mime: string
  load: () => Promise<Uint8Array>
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
