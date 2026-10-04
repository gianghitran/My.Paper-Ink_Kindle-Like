import type { TextItem } from 'pdfjs-dist/types/src/display/api'
import { openPdf } from '@/lib/pdf/pdfjs'
import { makeThumbnail, titleFromFileName, type ExtractedMetadata } from './index'

const JUNK_TITLE = /^(untitled|microsoft word|document\d*|title|unknown|\s*)$|\.(docx?|tex|dvi|pdf|indd|ps)$|^microsoft word -/i

export async function extractPdfMetadata(data: ArrayBuffer, fileName: string): Promise<ExtractedMetadata> {

  const pdf = await openPdf(new Uint8Array(data.slice(0)))
  try {
    let title: string | undefined
    let author: string | undefined
    try {
      const meta = await pdf.getMetadata()
      const info = (meta.info ?? {}) as Record<string, unknown>
      const md = meta.metadata
      title = (md?.get('dc:title') as string | undefined) || (info.Title as string | undefined)
      author = (md?.get('dc:creator') as string | undefined) || (info.Author as string | undefined)
      if (Array.isArray(author)) author = author.join(', ')
    } catch {

    }
    title = typeof title === 'string' ? title.trim() : undefined
    author = typeof author === 'string' ? author.trim() : undefined

    const page = await pdf.getPage(1)
    if (!title || JUNK_TITLE.test(title)) {
      title = (await guessTitleFromFirstPage(page)) || titleFromFileName(fileName)
    }

    let cover: Blob | undefined
    try {
      const base = page.getViewport({ scale: 1 })
      const scale = 360 / base.width
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)

      await page.render({ canvas, viewport, intent: 'print' }).promise
      cover = await makeThumbnail(canvas)
    } catch (err) {
      console.warn('PDF thumbnail failed', err)
    }

    return { title, author: author || undefined, pageCount: pdf.numPages, cover }
  } finally {
    void pdf.loadingTask.destroy()
  }
}

async function guessTitleFromFirstPage(page: Awaited<ReturnType<Awaited<ReturnType<typeof openPdf>>['getPage']>>) {
  try {
    const vp = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()
    const items = (content.items as TextItem[]).filter((i) => typeof i.str === 'string' && i.str.trim())
    const topHalf = items.filter((i) => i.transform[5] > vp.height * 0.4)
    if (!topHalf.length) return undefined
    const size = (i: TextItem) => Math.hypot(i.transform[2], i.transform[3])
    const maxSize = Math.max(...topHalf.map(size))
    const big = topHalf.filter((i) => size(i) >= maxSize * 0.92)
    const text = big
      .map((i) => i.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length < 4 || text.length > 220) return undefined
    return text
  } catch {
    return undefined
  }
}
