import JSZip from 'jszip'
import { buildEpub, type BuildChapter, type BuildImage } from './epubBuilder'
import { decodeText } from './textFormats'
import { titleFromFileName, type ConvertResult } from './index'

const XLINK = 'http://www.w3.org/1999/xlink'

function href(el: Element) {
  return el.getAttributeNS(XLINK, 'href') ?? el.getAttribute('l:href') ?? el.getAttribute('xlink:href') ?? el.getAttribute('href') ?? ''
}


function decodeFb2(data: ArrayBuffer) {
  const head = new TextDecoder('latin1').decode(new Uint8Array(data, 0, Math.min(200, data.byteLength)))
  const enc = head.match(/encoding=["']([\w-]+)["']/i)?.[1]
  if (enc && !/utf-?8/i.test(enc)) {
    try {
      return new TextDecoder(enc.toLowerCase()).decode(data)
    } catch {
      
    }
  }
  return decodeText(data)
}

export async function unzipFb2(data: ArrayBuffer): Promise<ArrayBuffer | null> {
  const zip = await JSZip.loadAsync(data)
  const entry = Object.values(zip.files).find((f) => !f.dir && /\.fb2$/i.test(f.name))
  return entry ? entry.async('arraybuffer') : null
}

export async function convertFb2(data: ArrayBuffer, fileName: string): Promise<ConvertResult> {
  const bytes = new Uint8Array(data, 0, 4)
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const inner = await unzipFb2(data)
    if (!inner) throw new Error('No .fb2 file inside the archive')
    data = inner
  }
  const xml = new DOMParser().parseFromString(decodeFb2(data), 'application/xml')
  if (xml.querySelector('parsererror')) throw new Error('Invalid FB2 file')
  const q = (root: Element | Document, sel: string) => Array.from(root.getElementsByTagName(sel))

  const info = q(xml, 'title-info')[0]
  const title = info ? q(info, 'book-title')[0]?.textContent?.trim() : undefined
  const authors = info
    ? q(info, 'author')
        .map((a) => ['first-name', 'middle-name', 'last-name'].map((t) => q(a, t)[0]?.textContent?.trim()).filter(Boolean).join(' ') || q(a, 'nickname')[0]?.textContent?.trim())
        .filter(Boolean)
    : []
  const lang = info ? q(info, 'lang')[0]?.textContent?.trim() : undefined

  
  const images: BuildImage[] = []
  const imageById = new Map<string, string>()
  q(xml, 'binary').forEach((b, i) => {
    const id = b.getAttribute('id')
    const mime = b.getAttribute('content-type') || 'image/jpeg'
    if (!id || !mime.startsWith('image/')) return
    try {
      const bin = atob((b.textContent ?? '').replace(/\s+/g, ''))
      const ext = mime.split('/')[1].replace('jpeg', 'jpg')
      const name = `fb2-${i}.${ext}`
      images.push({ name, mime, data: Uint8Array.from(bin, (c) => c.charCodeAt(0)) })
      imageById.set(id, name)
    } catch {
      
    }
  })
  const coverRef = info ? q(info, 'coverpage')[0]?.getElementsByTagName('image')[0] : undefined
  const coverName = coverRef ? imageById.get(href(coverRef).replace(/^#/, '')) : undefined

  const doc = document.implementation.createHTMLDocument('')
  
  const bodies = q(xml, 'body')
  const mainBodies = bodies.filter((b) => !/notes|comments/i.test(b.getAttribute('name') ?? ''))
  const noteBodies = bodies.filter((b) => /notes|comments/i.test(b.getAttribute('name') ?? ''))
  const noteIds = new Set<string>()
  noteBodies.forEach((nb) => q(nb, 'section').forEach((s) => s.getAttribute('id') && noteIds.add(s.getAttribute('id')!)))

  let notesChapterFile = ''
  const convert = (node: Node, out: Node[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push(doc.createTextNode(node.textContent ?? ''))
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const e = node as Element
    const tag = e.localName
    const make = (t: string, cls?: string) => {
      const x = doc.createElement(t)
      if (cls) x.className = cls
      const id = e.getAttribute('id')
      if (id) x.id = id
      const tmp: Node[] = []
      e.childNodes.forEach((c) => convert(c, tmp))
      tmp.forEach((n) => x.appendChild(n))
      out.push(x)
      return x
    }
    switch (tag) {
      case 'p':
        make('p')
        break
      case 'emphasis':
        make('em')
        break
      case 'strong':
        make('strong')
        break
      case 'strikethrough':
        make('s')
        break
      case 'sub':
        make('sub')
        break
      case 'sup':
        make('sup')
        break
      case 'code':
        make('code')
        break
      case 'title': {
        
        const h = doc.createElement('h2')
        h.textContent = Array.from(e.children)
          .map((c) => c.textContent?.trim())
          .filter(Boolean)
          .join(' — ') || (e.textContent ?? '').trim()
        out.push(h)
        break
      }
      case 'subtitle':
        make('p', 'subtitle')
        break
      case 'epigraph':
        make('div', 'epigraph')
        break
      case 'cite':
        make('blockquote')
        break
      case 'poem':
        make('div', 'poem')
        break
      case 'stanza':
        make('div', 'stanza')
        break
      case 'v':
        make('p')
        break
      case 'text-author':
        make('p', 'text-author')
        break
      case 'empty-line':
        out.push(doc.createElement('br'))
        break
      case 'table':
        make('table')
        break
      case 'tr':
        make('tr')
        break
      case 'td':
        make('td')
        break
      case 'th':
        make('th')
        break
      case 'image': {
        const name = imageById.get(href(e).replace(/^#/, ''))
        if (name) {
          const img = doc.createElement('img')
          img.setAttribute('src', `images/${name}`)
          img.setAttribute('alt', e.getAttribute('alt') ?? '')
          out.push(img)
        }
        break
      }
      case 'a': {
        const target = href(e).replace(/^#/, '')
        const a = make('a')
        if (noteIds.has(target)) {
          a.setAttribute('href', `${notesChapterFile}#${target}`)
          a.setAttribute('epub:type', 'noteref')
        } else if (/^https?:/i.test(href(e))) a.setAttribute('href', href(e))
        break
      }
      case 'section':
        make('section')
        break
      default:
        e.childNodes.forEach((c) => convert(c, out))
    }
  }

  const chapters: BuildChapter[] = []
  const pushSection = (section: Element, fallback: string) => {
    const body: Node[] = []
    section.childNodes.forEach((c) => convert(c, body))
    const t = q(section, 'title')[0]?.textContent?.replace(/\s+/g, ' ').trim()
    chapters.push({ title: t?.slice(0, 120) || fallback, body })
  }
  
  
  const notesIndex = mainBodies.reduce((n, b) => n + Math.max(1, Array.from(b.children).filter((c) => c.localName === 'section').length), 0)
  notesChapterFile = `ch${String(notesIndex + 1).padStart(4, '0')}.xhtml`
  for (const b of mainBodies) {
    const sections = Array.from(b.children).filter((c) => c.localName === 'section')
    if (!sections.length) pushSection(b, title ?? 'Text')
    else sections.forEach((s, i) => pushSection(s, `Section ${chapters.length + i + 1}`))
  }
  if (noteBodies.length) {
    const body: Node[] = []
    noteBodies.forEach((nb) =>
      q(nb, 'section').forEach((s) => {
        const aside = doc.createElement('aside')
        aside.setAttribute('epub:type', 'footnote')
        if (s.getAttribute('id')) aside.id = s.getAttribute('id')!
        const tmp: Node[] = []
        s.childNodes.forEach((c) => convert(c, tmp))
        tmp.forEach((n) => aside.appendChild(n))
        body.push(aside)
      }),
    )
    chapters.push({ title: 'Notes', body })
  }

  const finalTitle = title || titleFromFileName(fileName)
  const blob = await buildEpub({
    title: finalTitle,
    author: authors.join(', ') || undefined,
    lang: lang || 'en',
    chapters,
    images,
    coverImage: coverName,
  })
  return { blob, meta: { title: finalTitle, author: authors.join(', ') || undefined } }
}
