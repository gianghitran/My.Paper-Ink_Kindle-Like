import type { PDFDocumentProxy } from 'pdfjs-dist'
import { imageSize, listComicPagesFromBlob } from './comic'
import { isRemote } from '@/lib/byteSource'

const UNIT_WIDTH = 900
const BITMAP_CACHE = 6
const BYTES_CACHE = 8
const HEAD_BYTES = 128 * 1024

class RenderingCancelled extends Error {
  name = 'RenderingCancelledException'
}

export async function openComic(file: Blob): Promise<PDFDocumentProxy> {
  const pages = await listComicPagesFromBlob(file)
  const uniformSizes = isRemote(file)
  if (!pages.length) throw new Error('No images in comic')
  const bytes = new Map<number, Promise<Uint8Array>>()
  const loadBytes = (i: number) => {
    let p = bytes.get(i)
    if (p) {
      bytes.delete(i)
      bytes.set(i, p)
      return p
    }
    p = pages[i].load()
    bytes.set(i, p)
    if (bytes.size > BYTES_CACHE) bytes.delete(bytes.keys().next().value as number)
    return p
  }
  const bitmaps = new Map<number, Promise<ImageBitmap>>()
  const bitmap = (i: number) => {
    let p = bitmaps.get(i)
    if (!p) {
      p = loadBytes(i).then((b) => createImageBitmap(new Blob([b as BlobPart], { type: pages[i].mime })))
      bitmaps.set(i, p)
      if (bitmaps.size > BITMAP_CACHE) {
        const oldest = bitmaps.keys().next().value as number
        void bitmaps.get(oldest)?.then((bm) => bm.close()).catch(() => {})
        bitmaps.delete(oldest)
      }
    }
    return p
  }
  const sizes = new Map<number, Promise<{ w: number; h: number }>>()
  const sizeOf = (i: number): Promise<{ w: number; h: number }> => {
    if (uniformSizes && i > 0) return sizeOf(0)
    let p = sizes.get(i)
    if (!p) {
      const head = pages[i].loadHead ? pages[i].loadHead!(HEAD_BYTES) : loadBytes(i)
      p = head.then(async (h) => {
        let s = imageSize(h)
        if ((!s || !s.w || !s.h) && pages[i].loadHead) s = imageSize(await loadBytes(i))
        if (!s || !s.w || !s.h) {
          const bm = await bitmap(i)
          s = { w: bm.width, h: bm.height }
        }
        return { w: UNIT_WIDTH, h: (s.h / s.w) * UNIT_WIDTH }
      })
      sizes.set(i, p)
    }
    return p
  }

  const makePage = async (n: number) => {
    const i = n - 1
    const { w, h } = await sizeOf(i)
    const viewport = (scale: number) => ({
      width: w * scale,
      height: h * scale,
      scale,
      rotation: 0,
      rawDims: { pageWidth: w, pageHeight: h, pageX: 0, pageY: 0 },
      convertToViewportPoint: (x: number, y: number) => [x * scale, (h - y) * scale],
    })
    return {
      pageNumber: n,
      getViewport: ({ scale }: { scale: number }) => viewport(scale),
      render: ({ canvas, viewport: vp, transform }: { canvas: HTMLCanvasElement; viewport: { width: number; height: number }; transform?: number[] }) => {
        let cancelled = false
        const promise = (async () => {
          const bm = await bitmap(i)
          if (cancelled) throw new RenderingCancelled()
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          const s = transform ? transform[0] : 1
          ctx.setTransform(s, 0, 0, s, 0, 0)
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          ctx.fillStyle = '#fff'
          ctx.fillRect(0, 0, vp.width, vp.height)
          const fit = Math.min(vp.width / bm.width, vp.height / bm.height)
          const dw = bm.width * fit
          const dh = bm.height * fit
          ctx.drawImage(bm, (vp.width - dw) / 2, (vp.height - dh) / 2, dw, dh)
        })()
        return {
          promise,
          cancel: () => {
            cancelled = true
          },
        }
      },
      getTextContent: async () => ({ items: [], styles: {}, lang: null }),
      getAnnotations: async () => [],
      cleanup: () => true,
    }
  }

  const pageCache = new Map<number, ReturnType<typeof makePage>>()
  const doc = {
    numPages: pages.length,
    isComic: true,
    getPage: (n: number) => {
      let p = pageCache.get(n)
      if (!p) {
        p = makePage(n)
        pageCache.set(n, p)
      }
      return p
    },
    getOutline: async () => null,
    getMetadata: async () => ({ info: {}, metadata: null }),
    getDestination: async () => null,
    getPageIndex: async () => 0,
    loadingTask: {
      destroy: async () => {
        for (const p of bitmaps.values()) void p.then((bm) => bm.close()).catch(() => {})
        bitmaps.clear()
        bytes.clear()
      },
    },
  }
  return doc as unknown as PDFDocumentProxy
}
