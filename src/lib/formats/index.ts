import type { DocFormat, DocKind, SourceFormat } from '@/types'

export interface ExtractedMetadata {
  title?: string
  author?: string
  pageCount?: number
  cover?: Blob
}

export interface ConvertResult {

  blob: Blob
  meta: ExtractedMetadata
}

export interface FormatHandler {
  format: DocFormat
  source: SourceFormat
  label: string
  extensions: string[]
  mimeTypes: string[]
  defaultKind: DocKind
  sniff: (bytes: Uint8Array) => boolean
  extract: (data: ArrayBuffer, fileName: string) => Promise<ExtractedMetadata>

  convert?: (data: ArrayBuffer, fileName: string) => Promise<ConvertResult>
}

const isZip = (bytes: Uint8Array) => bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04

const looksLikeText = (bytes: Uint8Array) => {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return true
  return !bytes.subarray(0, 1024).includes(0)
}
const headText = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).toLowerCase()
const epubFromConvert = async (fn: () => Promise<ConvertResult>) => {
  const r = await fn()
  const meta = await (await import('./epubMeta')).extractEpubMetadata(await r.blob.arrayBuffer(), '')
  return { blob: r.blob, meta: { ...meta, ...Object.fromEntries(Object.entries(r.meta).filter(([, v]) => v)) } }
}

const startsWith = (bytes: Uint8Array, sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b)

export const FORMAT_HANDLERS: FormatHandler[] = [
  {
    format: 'pdf',
    source: 'pdf',
    label: 'PDF',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    defaultKind: 'paper',

    sniff: (bytes) => {
      const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
      return head.includes('%PDF-')
    },
    extract: async (data, fileName) => (await import('./pdfMeta')).extractPdfMetadata(data, fileName),
  },
  {
    format: 'epub',
    source: 'epub',
    label: 'EPUB',
    extensions: ['.epub'],
    mimeTypes: ['application/epub+zip'],
    defaultKind: 'book',

    sniff: (bytes) => startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]),
    extract: async (data, fileName) => (await import('./epubMeta')).extractEpubMetadata(data, fileName),
  },
  {
    format: 'comic',
    source: 'cbz',
    label: 'CBZ comic',
    extensions: ['.cbz'],
    mimeTypes: ['application/vnd.comicbook+zip', 'application/x-cbz'],
    defaultKind: 'book',
    sniff: isZip,
    extract: async (data, fileName) => (await import('./comic')).extractComicMetadata(data, fileName),
  },
  {
    format: 'comic',
    source: 'cbt',
    label: 'CBT comic',
    extensions: ['.cbt'],
    mimeTypes: ['application/x-cbt'],
    defaultKind: 'book',
    sniff: (bytes) => new TextDecoder('latin1').decode(bytes.subarray(257, 262)) === 'ustar',
    extract: async (data, fileName) => (await import('./comic')).extractComicMetadata(data, fileName),
  },
  {
    format: 'epub',
    source: 'fb2',
    label: 'FB2',
    extensions: ['.fb2', '.fb2.zip', '.fbz'],
    mimeTypes: ['application/x-fictionbook+xml', 'text/fb2+xml'],
    defaultKind: 'book',
    sniff: (bytes) => isZip(bytes) || headText(bytes).includes('<fictionbook'),
    extract: async () => ({}),
    convert: (data, fileName) => epubFromConvert(async () => (await import('./fb2')).convertFb2(data, fileName)),
  },
  {
    format: 'epub',
    source: 'md',
    label: 'Markdown',
    extensions: ['.md', '.markdown', '.mdown'],
    mimeTypes: ['text/markdown', 'text/x-markdown'],
    defaultKind: 'document',
    sniff: looksLikeText,
    extract: async () => ({}),
    convert: (data, fileName) => epubFromConvert(async () => (await import('./textFormats')).convertMarkdown(data, fileName)),
  },
  {
    format: 'epub',
    source: 'html',
    label: 'HTML',
    extensions: ['.html', '.htm', '.xhtml'],
    mimeTypes: ['text/html', 'application/xhtml+xml'],
    defaultKind: 'document',
    sniff: (bytes) => looksLikeText(bytes) && /<(!doctype|html|body|head|p|div|h1)\b/.test(headText(bytes)),
    extract: async () => ({}),
    convert: (data, fileName) => epubFromConvert(async () => (await import('./textFormats')).convertHtml(data, fileName)),
  },
  {
    format: 'epub',
    source: 'txt',
    label: 'Text',
    extensions: ['.txt', '.text'],
    mimeTypes: ['text/plain'],
    defaultKind: 'book',
    sniff: looksLikeText,
    extract: async () => ({}),
    convert: (data, fileName) => epubFromConvert(async () => (await import('./textFormats')).convertTxt(data, fileName)),
  },
]

export function formatLabel(source: SourceFormat | undefined, format: DocFormat) {
  return (source ?? format).toUpperCase()
}

export const ACCEPT_ATTR = [
  ...FORMAT_HANDLERS.flatMap((h) => h.extensions),
  ...FORMAT_HANDLERS.flatMap((h) => h.mimeTypes),
].join(',')

export function detectFormat(file: File, bytes: Uint8Array): FormatHandler | null {
  const name = file.name.toLowerCase()

  const byExt = [...FORMAT_HANDLERS]
    .filter((h) => h.extensions.some((e) => name.endsWith(e)))
    .sort((a, b) => Math.max(...b.extensions.map((e) => (name.endsWith(e) ? e.length : 0))) - Math.max(...a.extensions.map((e) => (name.endsWith(e) ? e.length : 0))))[0]
  if (byExt && byExt.sniff(bytes)) return byExt
  const byMime = FORMAT_HANDLERS.find((h) => h.mimeTypes.includes(file.type))
  if (byMime && byMime.sniff(bytes)) return byMime

  if (FORMAT_HANDLERS[0].sniff(bytes)) return FORMAT_HANDLERS[0]
  return null
}

export function getHandler(source: SourceFormat) {
  return FORMAT_HANDLERS.find((h) => h.source === source)!
}

export function titleFromFileName(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function makeThumbnail(source: CanvasImageSource & { width: number; height: number }, maxW = 360) {
  const scale = Math.min(1, maxW / source.width)
  const w = Math.max(1, Math.round(source.width * scale))
  const h = Math.max(1, Math.round(source.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return undefined
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(source, 0, 0, w, h)
  return new Promise<Blob | undefined>((resolve) => canvas.toBlob((b) => resolve(b ?? undefined), 'image/jpeg', 0.82))
}
