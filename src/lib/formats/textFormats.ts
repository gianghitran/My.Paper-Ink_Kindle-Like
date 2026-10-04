import { marked } from 'marked'
import { buildEpub, type BuildChapter } from './epubBuilder'
import { extractDataImages, sanitizeTree, splitByHeadings } from './sanitize'
import { titleFromFileName, type ConvertResult } from './index'


export function decodeText(data: ArrayBuffer): string {
  const b = new Uint8Array(data)
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b)
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b)
  } catch {
    return new TextDecoder('windows-1252').decode(b)
  }
}

function guessLang(text: string) {
  const sample = text.slice(0, 4000)
  if (/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(sample)) return 'vi'
  if (/[一-鿿]/.test(sample)) return 'zh'
  if (/[぀-ヿ]/.test(sample)) return 'ja'
  if (/[가-힯]/.test(sample)) return 'ko'
  if (/[Ѐ-ӿ]/.test(sample)) return 'ru'
  return 'en'
}

const HEADING_RE =
  /^\s*((chapter|chap\.|part|book|prologue|epilogue|preface|introduction|afterword|chương|chuong|hồi|phần|quyển|tập|mở đầu|lời mở đầu|lời tựa|vĩ thanh|kết thúc)\b.{0,70}|第[\d一二三四五六七八九十百千零〇]+[章回节卷部篇].{0,40}|[IVXLC]{1,7}\.?\s+\S.{0,60}|\d{1,3}\.\s+[^\s.].{0,60})$/i

function el(doc: Document, tag: string, text: string) {
  const e = doc.createElement(tag)
  e.textContent = text
  return e
}

export async function convertTxt(data: ArrayBuffer, fileName: string): Promise<ConvertResult> {
  const text = decodeText(data).replace(/\r\n?/g, '\n').replace(/\u0000/g, '')
  const title = titleFromFileName(fileName)
  const doc = document.implementation.createHTMLDocument('')
  const lines = text.split('\n')
  const blankRatio = lines.filter((l) => !l.trim()).length / Math.max(1, lines.length)

  
  const paragraphs: string[] = []
  if (blankRatio > 0.15) {
    let cur: string[] = []
    for (const l of lines) {
      if (!l.trim()) {
        if (cur.length) paragraphs.push(cur.join(' ').replace(/\s+/g, ' ').trim())
        cur = []
      } else if (HEADING_RE.test(l) && l.trim().length < 80) {
        if (cur.length) paragraphs.push(cur.join(' ').replace(/\s+/g, ' ').trim())
        paragraphs.push(l.trim())
        cur = []
      } else cur.push(l.trim())
    }
    if (cur.length) paragraphs.push(cur.join(' ').replace(/\s+/g, ' ').trim())
  } else {
    for (const l of lines) if (l.trim()) paragraphs.push(l.trim())
  }

  const isHeading = (p: string) => p.length < 80 && HEADING_RE.test(p)
  const headingCount = paragraphs.filter(isHeading).length
  
  const firstLine = paragraphs[0] ?? ''
  const titleLine = headingCount >= 2 && firstLine.length < 90 && !isHeading(firstLine) && isHeading(paragraphs[1] ?? '') ? firstLine : null
  if (titleLine) paragraphs.shift()
  const chapters: BuildChapter[] = []
  if (headingCount >= 2) {
    let cur: BuildChapter = { title, body: [] }
    for (const p of paragraphs) {
      if (isHeading(p)) {
        if (cur.body.length) chapters.push(cur)
        cur = { title: p, body: [el(doc, 'h2', p)] }
      } else cur.body.push(el(doc, 'p', p))
    }
    if (cur.body.length) chapters.push(cur)
  } else {
    
    let cur: BuildChapter = { title: chapters.length ? `Part 1` : title, body: [] }
    let size = 0
    for (const p of paragraphs) {
      cur.body.push(el(doc, 'p', p))
      size += p.length
      if (size > 40_000) {
        chapters.push(cur)
        cur = { title: `Part ${chapters.length + 1}`, body: [] }
        size = 0
      }
    }
    if (cur.body.length) chapters.push(cur)
    if (chapters.length > 1) chapters[0].title = 'Part 1'
  }
  const bookTitle = titleLine ?? title
  const blob = await buildEpub({ title: bookTitle, lang: guessLang(text), chapters })
  return { blob, meta: { title: bookTitle } }
}

export async function convertMarkdown(data: ArrayBuffer, fileName: string): Promise<ConvertResult> {
  const text = decodeText(data)
  const html = await marked.parse(text, { gfm: true, breaks: false })
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  sanitizeTree(doc.body)
  const images = extractDataImages(doc.body)
  const h1 = doc.body.querySelector('h1')?.textContent?.trim()
  const title = h1 && h1.length < 140 ? h1 : titleFromFileName(fileName)
  const chapters = splitByHeadings(doc.body, title)
  const blob = await buildEpub({ title, lang: guessLang(text), chapters, images })
  return { blob, meta: { title } }
}

export async function convertHtml(data: ArrayBuffer, fileName: string): Promise<ConvertResult> {
  const text = decodeText(data)
  const doc = new DOMParser().parseFromString(text, 'text/html')
  const docTitle = doc.querySelector('title')?.textContent?.trim()
  const author = doc.querySelector('meta[name="author"]')?.getAttribute('content')?.trim()
  const lang = doc.documentElement.getAttribute('lang') || guessLang(doc.body?.textContent ?? '')
  
  const main = doc.querySelector('article, main, [role="main"]') ?? doc.body
  const container = doc.createElement('div')
  Array.from(main?.childNodes ?? []).forEach((n) => container.appendChild(n))
  sanitizeTree(container)
  container.querySelectorAll('nav, header > nav, footer, aside[role="complementary"]').forEach((n) => n.remove())
  const images = extractDataImages(container)
  const title = docTitle || container.querySelector('h1')?.textContent?.trim() || titleFromFileName(fileName)
  let chapters = splitByHeadings(container, title)
  if (!chapters.length) chapters = [{ title, body: [el(doc, 'p', container.textContent ?? '')] }]
  const blob = await buildEpub({ title, author, lang, chapters, images })
  return { blob, meta: { title, author } }
}
