import JSZip from 'jszip'
import { buildEpub, chapterFile, type BuildChapter, type BuildImage } from './epubBuilder'
import { readMobi, type MobiBook } from './mobi'
import { sanitizeTree, splitByHeadings } from './sanitize'
import { titleFromFileName, type ConvertResult } from './index'

const latin1 = new TextDecoder('latin1')
const ascii = new TextEncoder()

function withFileposAnchors(markup: Uint8Array) {
  const raw = latin1.decode(markup)
  const targets = new Set<number>()
  for (const m of raw.matchAll(/filepos\s*=\s*["']?0*(\d+)/gi)) {
    const n = Number(m[1])
    if (n < markup.length) targets.add(n)
  }
  if (!targets.size) return { bytes: markup, targets }
  const at = new Map<number, number[]>()
  for (const n of targets) {
    let p = n
    for (let i = n - 1; i >= 0 && n - i < 4096; i--) {
      if (markup[i] === 0x3e) break
      if (markup[i] === 0x3c) {
        p = i
        break
      }
    }
    at.set(p, [...(at.get(p) ?? []), n])
  }
  const positions = [...at.keys()].sort((a, b) => a - b)
  const pieces: Uint8Array[] = []
  let last = 0
  let size = 0
  for (const p of positions) {
    pieces.push(markup.subarray(last, p))
    const anchor = ascii.encode(at.get(p)!.map((n) => `<a id="filepos${n}"></a>`).join(''))
    pieces.push(anchor)
    size += p - last + anchor.length
    last = p
  }
  pieces.push(markup.subarray(last))
  size += markup.length - last
  const bytes = new Uint8Array(size)
  let o = 0
  for (const piece of pieces) {
    bytes.set(piece, o)
    o += piece.length
  }
  return { bytes, targets }
}

function bodyOf(html: string) {
  const start = html.search(/<body\b[^>]*>/i)
  const from = start >= 0 ? html.indexOf('>', start) + 1 : 0
  const end = html.search(/<\/body\s*>/i)
  return html.slice(from, end > from ? end : html.length)
}

function chapterTitle(body: Element, fallback: string) {
  const h = body.querySelector('h1, h2, h3, h4')?.textContent?.replace(/\s+/g, ' ').trim()
  if (h && h.length <= 120) return h
  const first = Array.from(body.querySelectorAll('p, div, b, strong, font, span')).map((e) => e.textContent?.replace(/\s+/g, ' ').trim() ?? '').find(Boolean)
  return first && first.length <= 60 ? first : fallback
}

async function epubFromMobi(book: MobiBook, fileName: string): Promise<ConvertResult> {
  const { bytes } = withFileposAnchors(book.markup)
  let html = bodyOf(new TextDecoder(book.utf8 ? 'utf-8' : 'windows-1252').decode(bytes))
  const images = new Map<number, BuildImage>()
  const imageName = (recindex: number) => {
    const known = images.get(recindex)
    if (known) return known.name
    const img = book.image(recindex)
    if (!img) return null
    const name = `img${String(recindex).padStart(5, '0')}.${img.ext}`
    images.set(recindex, { name, mime: img.mime, data: img.data })
    return name
  }
  html = html
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const m = tag.match(/\brecindex\s*=\s*["']?0*(\d+)/i)
      const name = m && imageName(Number(m[1]))
      return name ? `<img src="images/${name}" alt=""/>` : ''
    })
    .replace(/\bfilepos\s*=\s*["']?0*(\d+)["']?/gi, 'href="#filepos$1"')
    .replace(/<\/?(guide|reference)\b[^>]*>/gi, '')

  const parser = new DOMParser()
  const chapters: BuildChapter[] = []
  const parts = html.split(/<mbp:pagebreak\b[^>]*>/i)
  for (const part of parts) {
    const cleaned = part.replace(/<\/?[a-z][\w-]*:[\w-]+\b[^>]*>/gi, '')
    const body = parser.parseFromString(`<body>${cleaned}</body>`, 'text/html').body
    sanitizeTree(body)
    const hasContent = (body.textContent ?? '').trim() || body.querySelector('img')
    if (!hasContent) continue
    const imageOnly = !(body.textContent ?? '').trim()
    const fallback = imageOnly ? (chapters.length ? 'Illustration' : 'Cover') : `Part ${chapters.length + 1}`
    if ((body.textContent ?? '').length > 150_000) {
      const split = splitByHeadings(body, fallback)
      if (split.length > 1) {
        chapters.push(...split)
        continue
      }
    }
    chapters.push({ title: chapterTitle(body, fallback), body: Array.from(body.childNodes) })
  }
  if (chapters.length === 1) chapters[0].title = chapters[0].title.startsWith('Part ') ? book.title : chapters[0].title

  const fileOf = new Map<string, string>()
  chapters.forEach((c, i) => {
    for (const n of c.body) {
      if (n.nodeType !== 1) continue
      const el = n as Element
      if (el.id?.startsWith('filepos')) fileOf.set(el.id, chapterFile(i))
      el.querySelectorAll('[id^="filepos"]').forEach((a) => fileOf.set(a.id, chapterFile(i)))
    }
  })
  for (const c of chapters) {
    for (const n of c.body) {
      if (n.nodeType !== 1) continue
      const el = n as Element
      const links = [...(el.matches('a[href^="#filepos"]') ? [el] : []), ...Array.from(el.querySelectorAll('a[href^="#filepos"]'))]
      for (const a of links) {
        const id = a.getAttribute('href')!.slice(1)
        const file = fileOf.get(id)
        if (file) a.setAttribute('href', `${file}#${id}`)
        else a.removeAttribute('href')
      }
    }
  }

  let coverImage: string | undefined
  if (book.coverIndex) {
    const name = imageName(book.coverIndex)
    if (name) coverImage = name
  }
  const title = book.title || titleFromFileName(fileName)
  const blob = await buildEpub({
    title,
    author: book.author,
    lang: book.language?.split(/[-_]/)[0] || 'en',
    chapters,
    images: [...images.values()],
    coverImage,
  })
  return { blob, meta: { title, author: book.author } }
}

async function comicFromMobi(book: MobiBook, fileName: string): Promise<ConvertResult | null> {
  const raw = latin1.decode(book.markup)
  const order: number[] = []
  for (const m of raw.matchAll(/<img\b[^>]*\brecindex\s*=\s*["']?0*(\d+)/gi)) {
    const n = Number(m[1])
    if (order[order.length - 1] !== n) order.push(n)
  }
  const pages = order.map((n) => book.image(n)).filter((p) => !!p)
  if (!pages.length) return null
  const zip = new JSZip()
  const digits = Math.max(4, String(pages.length).length)
  pages.forEach((p, i) => zip.file(`${String(i + 1).padStart(digits, '0')}.${p.ext}`, p.data, { compression: 'STORE' }))
  const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.comicbook+zip' })
  const { extractComicMetadata } = await import('./comic')
  const meta = await extractComicMetadata(await blob.arrayBuffer(), fileName)
  const title = book.title || meta.title || titleFromFileName(fileName)
  return { blob, meta: { ...meta, title, author: book.author ?? meta.author }, format: 'comic', mimeType: 'application/vnd.comicbook+zip', extension: '.cbz' }
}

export async function convertMobi(data: ArrayBuffer, fileName: string): Promise<ConvertResult> {
  const book = readMobi(data)
  if (book.fixedLayout) {
    const comic = await comicFromMobi(book, fileName)
    if (comic) return comic
  }
  return epubFromMobi(book, fileName)
}
