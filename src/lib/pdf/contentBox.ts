import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { NormBox } from '@/types'

const SAMPLE_WIDTH = 220
const MAX_SAMPLES = 10

const INK_THRESHOLD = 225

function samplePages(n: number) {
  if (n <= MAX_SAMPLES) return Array.from({ length: n }, (_, i) => i + 1)

  const out = new Set<number>()
  for (let i = 0; i < MAX_SAMPLES; i++) out.add(2 + Math.round((i * (n - 2)) / (MAX_SAMPLES - 1)))
  return [...out].filter((p) => p >= 1 && p <= n)
}

export async function detectContentBox(doc: PDFDocumentProxy): Promise<NormBox | null> {
  const boxes: NormBox[] = []
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  for (const n of samplePages(doc.numPages)) {
    try {
      const page = await doc.getPage(n)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: SAMPLE_WIDTH / base.width })
      canvas.width = Math.max(1, Math.round(viewport.width))
      canvas.height = Math.max(1, Math.round(viewport.height))
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      await page.render({ canvas, viewport, intent: 'print' }).promise
      const { data, width: w, height: h } = ctx.getImageData(0, 0, canvas.width, canvas.height)
      let minX = w
      let minY = h
      let maxX = -1
      let maxY = -1
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = (y * w + x) * 4
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
          if (lum < INK_THRESHOLD && data[i + 3] > 0) {
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      if (maxX >= 0) boxes.push({ x: minX / w, y: minY / h, w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h })
    } catch {

    }
  }
  if (!boxes.length) return null
  const pad = 0.018
  const x1 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad)
  const y1 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad)
  const x2 = Math.min(1, Math.max(...boxes.map((b) => b.x + b.w)) + pad)
  const y2 = Math.min(1, Math.max(...boxes.map((b) => b.y + b.h)) + pad)
  const box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }

  if (box.w * box.h > 0.93 || box.w < 0.2 || box.h < 0.2) return null
  return box
}
