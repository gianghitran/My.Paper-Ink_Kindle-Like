import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api'
import { openPdf, pdfjsLib } from '@/lib/pdf/pdfjs'
import { adjustRange } from '../rangeEdit'
import { openComic } from '@/lib/formats/comicDoc'
import { detectContentBox } from '@/lib/pdf/contentBox'
import { db } from '@/lib/db'
import { clamp } from '@/lib/utils'
import { useSettings, wantsTwoPages } from '@/store/settings'
import { playTurn, snapshotPages, type Snapshot, type TurnHandle } from '../pageTurn'
import type { Anchor, Highlight, NormBox, NormRect, PdfReadMode, PdfZoomMode } from '@/types'
import type { InkBinding, ReaderHandle, ReaderProps, SearchResult, SelectionInfo, TocItem } from '../types'
import { PdfPage, type PageHighlight } from './PdfPage'

export interface PdfView {
  mode: PdfReadMode
  zoomMode: PdfZoomMode
  zoom: number
}

export interface PdfReaderProps extends ReaderProps {
  view: PdfView
  onViewChange: (v: PdfView) => void
  onScaleChange: (scale: number) => void
  ink: InkBinding
}

interface Size {
  w: number
  h: number
}
interface LayoutItem {
  page: number
  top: number
  left: number
  w: number
  h: number
}


const OFFSCREEN_X = -50000
interface ScrollAnchor {
  page: number
  
  offset: number
  
  fx?: number
  
  vx?: number
  vy?: number
  
  offsetX?: number
}

export const MIN_SCALE = 0.3
export const MAX_SCALE = 6
const GAP = 12

function mostCommonSize(sizes: Size[]): Size {
  const counts = new Map<string, { s: Size; n: number }>()
  for (const s of sizes) {
    const k = `${Math.round(s.w)}x${Math.round(s.h)}`
    const e = counts.get(k)
    if (e) e.n++
    else counts.set(k, { s, n: 1 })
  }
  let best: { s: Size; n: number } | null = null
  for (const e of counts.values()) if (!best || e.n > best.n) best = e
  return best?.s ?? { w: 612, h: 792 }
}

function textFromContent(tc: TextContent) {
  let out = ''
  for (const it of tc.items as TextItem[]) {
    if (typeof it.str !== 'string') continue
    out += it.str
    if (it.hasEOL) out += ' '
  }
  return out.replace(/\s+/g, ' ')
}

function mergeRects(rects: NormRect[]): NormRect[] {
  const sorted = [...rects].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)
  const out: NormRect[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (
      last &&
      last.page === r.page &&
      Math.abs(last.y + last.h / 2 - (r.y + r.h / 2)) < Math.min(last.h, r.h) * 0.5 &&
      r.x <= last.x + last.w + 0.012
    ) {
      const x = Math.min(last.x, r.x)
      const y = Math.min(last.y, r.y)
      const right = Math.max(last.x + last.w, r.x + r.w)
      const bottom = Math.max(last.y + last.h, r.y + r.h)
      Object.assign(last, { x, y, w: right - x, h: bottom - y })
    } else {
      out.push({ ...r })
    }
  }
  return out
}

const PdfReader = forwardRef<ReaderHandle, PdfReaderProps>(function PdfReader(props, ref) {
  const { file, initialState, initialAnchor, highlights, view, onViewChange, tapZones, ink } = props
  const inkActiveRef = useRef(ink.active)
  inkActiveRef.current = ink.active
  const propsRef = useRef(props)
  propsRef.current = props
  const theme = useSettings((s) => s.settings.theme)
  const pageTurnSetting = useSettings((s) => s.settings.pageTurn)
  const inkFilterOn = useSettings((s) => s.settings.inkFilter.enabled)
  const twoPageSetting = useSettings((s) => s.settings.twoPage)
  const coverAlone = useSettings((s) => s.settings.pdfCoverAlone)
  const trimMargins = useSettings((s) => s.settings.trimMargins)
  const rtl = useSettings((s) => s.settings.comicRtl) && props.doc.format === 'comic'
  const [contentBox, setContentBox] = useState<NormBox | null | undefined>(props.doc.contentBox)
  const crop = trimMargins && contentBox ? contentBox : null
  const cropRef = useRef(crop)
  cropRef.current = crop
  
  const toItemOffset = useCallback((y: number) => (crop ? clamp((y - crop.y) / crop.h, 0, 1) : y), [crop])
  const overlayRef = useRef<HTMLDivElement>(null)
  const turnRef = useRef<{ dir: 1 | -1; oldSnap: Snapshot[]; style: 'flip' | 'slide' } | null>(null)
  const animRef = useRef<TurnHandle | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<Size[] | null>(null)
  const [box, setBox] = useState<Size>({ w: 0, h: 0 })
  const [current, setCurrent] = useState(initialState?.pdf?.page ?? 1)
  const [range, setRange] = useState<[number, number]>([1, 3])
  const [search, setSearch] = useState<{ term: string; page: number; index: number; seq: number } | null>(null)

  const pageCache = useRef(new Map<number, Promise<PDFPageProxy>>())
  const textCache = useRef(new Map<number, Promise<TextContent>>())
  const pageText = useRef(new Map<number, string>())
  const anchorRef = useRef<ScrollAnchor>({ page: initialState?.pdf?.page ?? 1, offset: initialState?.pdf?.offset ?? 0 })
  const pendingAnchor = useRef<ScrollAnchor | null>(null)
  const tocPages = useRef<{ label: string; page: number }[]>([])
  const visiblePages = useRef<number[]>([])
  const restored = useRef(false)
  const resetTransform = useRef(false)

  
  useEffect(() => {
    let cancelled = false
    let doc: PDFDocumentProxy | null = null
    ;(async () => {
      doc = propsRef.current.doc.format === 'comic' ? await openComic(file) : await openPdf(new Uint8Array(await file.arrayBuffer()))
      if (cancelled) {
        void doc.loadingTask.destroy()
        return
      }
      const n = doc.numPages
      const getPage = (i: number) => {
        let p = pageCache.current.get(i)
        if (!p) {
          p = doc!.getPage(i)
          pageCache.current.set(i, p)
        }
        return p
      }
      const first = (await getPage(1)).getViewport({ scale: 1 })
      let s: Size[] = Array.from({ length: n }, () => ({ w: first.width, h: first.height }))
      
      if (n <= 1500) {
        const all: Size[] = new Array(n)
        for (let i = 0; i < n; i += 50) {
          const batch = await Promise.all(
            Array.from({ length: Math.min(50, n - i) }, (_, k) =>
              getPage(i + k + 1).then((pg) => {
                const vp = pg.getViewport({ scale: 1 })
                return { w: vp.width, h: vp.height }
              }),
            ),
          )
          batch.forEach((b, k) => (all[i + k] = b))
          if (cancelled) return
        }
        s = all
      }
      if (cancelled) return
      setPdf(doc)
      setSizes(s)
      try {
        const outline = await doc.getOutline()
        let seq = 0
        const map = (items: typeof outline, level: number): TocItem[] =>
          (items ?? []).map((it) => ({
            id: `toc-${seq++}`,
            label: it.title || 'Untitled',
            level,
            target: it.dest ?? null,
            children: map(it.items, level + 1),
          }))
        propsRef.current.onToc(map(outline, 0))
        
        const flat: { label: string; page: number }[] = []
        const walk = async (items: typeof outline, level: number) => {
          for (const it of items ?? []) {
            try {
              const explicit = typeof it.dest === 'string' ? await doc!.getDestination(it.dest) : it.dest
              const ref0 = Array.isArray(explicit) ? explicit[0] : null
              const idx = ref0 && typeof ref0 === 'object' ? await doc!.getPageIndex(ref0 as { num: number; gen: number }) : Number.isInteger(ref0) ? (ref0 as number) : null
              if (idx != null) flat.push({ label: it.title || 'Untitled', page: idx + 1 })
            } catch {
              
            }
            if (level < 1) await walk(it.items, level + 1)
          }
        }
        await walk(outline, 0)
        tocPages.current = flat.sort((a, b) => a.page - b.page)
      } catch {
        propsRef.current.onToc([])
      }
    })().catch((err) => {
      console.error(err)
      if (!cancelled) propsRef.current.onError('This PDF could not be opened.')
    })
    return () => {
      cancelled = true
      pageCache.current.clear()
      textCache.current.clear()
      pageText.current.clear()
      if (doc) void doc.loadingTask.destroy()
    }
  }, [file])

  useEffect(() => {
    if (!trimMargins || contentBox !== undefined || !pdf) return
    let cancelled = false
    void detectContentBox(pdf).then((b) => {
      if (cancelled) return
      setContentBox(b)
      void db.documents.update(propsRef.current.doc.id, { contentBox: b ?? { x: 0, y: 0, w: 1, h: 1 } })
    })
    return () => {
      cancelled = true
    }
  }, [trimMargins, contentBox, pdf])

  const getPage = useCallback(
    (n: number) => {
      let p = pageCache.current.get(n)
      if (!p && pdf) {
        p = pdf.getPage(n)
        pageCache.current.set(n, p)
      }
      return p ?? Promise.reject(new Error('PDF not loaded'))
    },
    [pdf],
  )
  const getText = useCallback(
    (n: number) => {
      let t = textCache.current.get(n)
      if (!t) {
        t = getPage(n).then((p) => p.getTextContent())
        textCache.current.set(n, t)
        void t.then((tc) => pageText.current.set(n, textFromContent(tc))).catch(() => {})
      }
      return t
    },
    [getPage],
  )

  
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  
  const numPages = sizes?.length ?? 0
  const padX = box.w < 640 ? 6 : 24
  const padY = box.w < 640 ? 10 : 20
  const ref0 = useMemo(() => (sizes ? mostCommonSize(sizes) : { w: 612, h: 792 }), [sizes])
  const paginated = view.mode === 'paginated'
  
  const twoUp = paginated && numPages > 1 && wantsTwoPages(twoPageSetting, box.w, box.h)
  const spreadStart = useCallback(
    (page: number) => {
      const p = clamp(page, 1, Math.max(1, numPages))
      if (!twoUp) return p
      if (coverAlone) return p === 1 ? 1 : p % 2 === 0 ? p : p - 1
      return p % 2 === 1 ? p : p - 1
    },
    [twoUp, coverAlone, numPages],
  )
  const spreadPages = useCallback(
    (start: number) => {
      if (!twoUp || (coverAlone && start === 1) || start + 1 > numPages) return [start]
      return [start, start + 1]
    },
    [twoUp, coverAlone, numPages],
  )
  const spreadFirst = paginated ? spreadStart(current) : current
  const scale = useMemo(() => {
    if (!box.w) return 1
    const cw = crop ? crop.w : 1
    const ch = crop ? crop.h : 1
    const fitW = (box.w - padX * 2) / (ref0.w * cw * (twoUp ? 2 : 1))
    const fitP = Math.min(fitW, (box.h - padY * 2) / (ref0.h * ch))
    const s = view.zoomMode === 'fit-width' ? fitW : view.zoomMode === 'fit-page' ? fitP : view.zoom
    return clamp(s, MIN_SCALE, MAX_SCALE)
  }, [box, ref0, view.zoomMode, view.zoom, padX, padY, twoUp, crop])

  useEffect(() => {
    propsRef.current.onScaleChange(scale)
  }, [scale])

  const layout = useMemo(() => {
    if (!sizes) return null
    if (paginated) {
      const sz = (pg: number) => ({ w: sizes[pg - 1].w * scale * (crop ? crop.w : 1), h: sizes[pg - 1].h * scale * (crop ? crop.h : 1) })
      const pages = spreadPages(spreadFirst)
      const totalW = pages.reduce((a, pg) => a + sz(pg).w, 0)
      const maxH = Math.max(...pages.map((pg) => sz(pg).h))
      const contentW = Math.max(box.w, totalW + padX * 2)
      const contentH = Math.max(box.h, maxH + padY * 2)
      let x = (contentW - totalW) / 2
      
      const placed = rtl ? [...pages].reverse() : pages
      const items: LayoutItem[] = placed.map((pg) => {
        const { w, h } = sz(pg)
        const it = { page: pg, top: Math.max(padY, (contentH - h) / 2), left: x, w, h }
        x += w
        return it
      })
      const preload: LayoutItem[] = []
      const nextStart = spreadFirst + pages.length
      const prevStart = spreadFirst > 1 ? spreadStart(spreadFirst - 1) : 0
      for (const start of [nextStart, prevStart]) {
        if (start < 1 || start > sizes.length) continue
        for (const pg of spreadPages(start)) preload.push({ page: pg, top: 0, left: OFFSCREEN_X, ...sz(pg) })
      }
      const spine = items.length === 2 ? { x: items[1].left, top: Math.min(items[0].top, items[1].top), h: maxH } : null
      return { items, preload, spine, contentW, contentH }
    }
    const pages = sizes.map((_, i) => i + 1)
    const cw = crop ? crop.w : 1
    const ch = crop ? crop.h : 1
    const maxW = Math.max(...pages.map((p) => sizes[p - 1].w)) * scale * cw
    const contentW = Math.max(box.w, maxW + padX * 2)
    const items: LayoutItem[] = []
    let y = padY
    for (const p of pages) {
      const w = sizes[p - 1].w * scale * cw
      const h = sizes[p - 1].h * scale * ch
      items.push({ page: p, top: y, left: (contentW - w) / 2, w, h })
      y += h + GAP
    }
    const contentH = y - GAP + padY
    return { items, preload: [] as LayoutItem[], spine: null, contentW, contentH }
  }, [sizes, scale, box, paginated, paginated ? spreadFirst : 0, padX, padY, spreadPages, spreadStart, crop, rtl])

  const itemFor = useCallback((page: number) => layout?.items.find((i) => i.page === page), [layout])

  
  const itemIndexAt = useCallback(
    (y: number) => {
      if (!layout) return 0
      const items = layout.items
      let lo = 0
      let hi = items.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (items[mid].top <= y) lo = mid
        else hi = mid - 1
      }
      return lo
    },
    [layout],
  )

  const scrollToAnchor = useCallback(
    (a: ScrollAnchor) => {
      const el = scrollRef.current
      const item = itemFor(a.page)
      if (!el || !item) return
      el.scrollTop = item.top + a.offset * item.h - (a.vy ?? 0)
      if (a.fx !== undefined) el.scrollLeft = item.left + a.fx * item.w - (a.vx ?? 0)
      else if (a.offsetX !== undefined) el.scrollLeft = a.offsetX * Math.max(0, el.scrollWidth - el.clientWidth)
    },
    [itemFor],
  )

  
  const labelFor = useCallback((page: number) => {
    const n = numPagesRef.current
    const pct = n ? Math.round((page / n) * 100) : 0
    return { label: `Page ${page} of ${n}`, pct }
  }, [])
  const numPagesRef = useRef(0)
  numPagesRef.current = numPages

  const updateFromScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el || !layout || !layout.items.length) return
    const st = el.scrollTop
    const vh = el.clientHeight
    const items = layout.items
    const topIdx = itemIndexAt(st)
    const bottomIdx = itemIndexAt(st + vh)
    const centerIdx = itemIndexAt(st + vh / 2)
    const topItem = items[topIdx]
    const centerPage = items[centerIdx].page
    anchorRef.current = {
      page: topItem.page,
      offset: clamp((st - topItem.top) / topItem.h, 0, 1),
      offsetX: el.scrollWidth > el.clientWidth ? el.scrollLeft / (el.scrollWidth - el.clientWidth) : 0,
    }
    const first = items[Math.max(0, topIdx - 1)].page
    const last = items[Math.min(items.length - 1, bottomIdx + 1)].page
    setRange((r) => (r[0] === first && r[1] === last ? r : [first, last]))
    if (!paginated) setCurrent((c) => (c === centerPage ? c : centerPage))

    const shown = paginated ? spreadPages(spreadFirst) : [centerPage]
    const page = shown[shown.length - 1]
    const { pct } = labelFor(page)
    const n = numPagesRef.current
    const label = shown.length === 2 ? `Pages ${shown[0]}–${shown[1]} of ${n}` : `Page ${shown[0]} of ${n}`
    const progress = n ? page / n : 0
    visiblePages.current = shown
    let chapter: string | undefined
    let chapterEnd: number | undefined
    for (const t of tocPages.current) {
      if (t.page <= shown[0]) chapter = t.label
      else {
        chapterEnd = n ? (t.page - 1) / n : undefined
        break
      }
    }
    if (chapter && chapterEnd === undefined) chapterEnd = 1
    propsRef.current.onPosition({ label: `${label} • ${pct}%`, progress, page, total: numPagesRef.current, chapter, chapterEnd })
    if (restored.current) {
      propsRef.current.onSaveState(
        {
          progress,
          pdf: {
            page: anchorRef.current.page,
            offset: anchorRef.current.offset,
            offsetX: anchorRef.current.offsetX ?? 0,
            zoom: scale,
            zoomMode: viewRef.current.zoomMode,
            mode: viewRef.current.mode,
          },
        },
        label,
      )
    }
  }, [layout, itemIndexAt, paginated, spreadFirst, spreadPages, labelFor, scale])

  const viewRef = useRef(view)
  viewRef.current = view

  
  useLayoutEffect(() => {
    if (!layout || !box.w) return
    if (!restored.current) {
      let a: ScrollAnchor = { page: 1, offset: 0 }
      const hlAnchor = initialAnchor
      if (hlAnchor?.type === 'pdf') {
        const r = hlAnchor.rects[0]
        const item = itemFor(hlAnchor.page)
        a = { page: hlAnchor.page, offset: r ? toItemOffset(r.y) : 0, vy: item ? Math.min(box.h * 0.3, 160) : 0 }
      } else if (initialState?.pdf) {
        a = { page: clamp(initialState.pdf.page, 1, numPages), offset: initialState.pdf.offset, offsetX: initialState.pdf.offsetX }
      }
      if (paginated && spreadStart(a.page) !== spreadFirst) {
        setCurrent(a.page)
        return
      }
      scrollToAnchor(a)
      restored.current = true
      propsRef.current.onReady()
    } else {
      const a = pendingAnchor.current ?? anchorRef.current
      pendingAnchor.current = null
      scrollToAnchor(a)
    }
    if (resetTransform.current && contentRef.current) {
      contentRef.current.style.transform = ''
      resetTransform.current = false
    }
    updateFromScroll()
    
    const t = turnRef.current
    turnRef.current = null
    if (t && overlayRef.current && contentRef.current) {
      const els = Array.from(contentRef.current.querySelectorAll<HTMLElement>('.pdf-page:not([data-offscreen])'))
      animRef.current = playTurn({
        overlay: overlayRef.current,
        content: contentRef.current,
        oldSnap: t.oldSnap,
        newSnap: snapshotPages(els, overlayRef.current),
        dir: rtl ? (-t.dir as 1 | -1) : t.dir,
        style: t.style,
        onDone: () => {
          animRef.current = null
        },
      })
    }
  }, [layout]) 

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    
    
    let raf = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    let scheduled = false
    const run = () => {
      if (!scheduled) return
      scheduled = false
      cancelAnimationFrame(raf)
      if (timer) clearTimeout(timer)
      updateFromScroll()
    }
    const onScroll = () => {
      if (scheduled) return
      scheduled = true
      raf = requestAnimationFrame(run)
      timer = setTimeout(run, 120)
    }
    
    const onHide = () => {
      if (document.visibilityState === 'hidden') run()
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', run)
    return () => {
      el.removeEventListener('scroll', onScroll)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', run)
      cancelAnimationFrame(raf)
      if (timer) clearTimeout(timer)
    }
  }, [updateFromScroll])

  
  const smooth = theme === 'eink' || inkFilterOn ? 'instant' : 'smooth'

  const goToPage = useCallback(
    (page: number, offset = 0, topMargin = 0) => {
      const p = clamp(Math.round(page), 1, numPagesRef.current || 1)
      if (paginated) {
        pendingAnchor.current = { page: p, offset, vy: topMargin }
        if (spreadStart(p) === spreadFirst) scrollToAnchor(pendingAnchor.current)
        else setCurrent(p)
        return
      }
      scrollToAnchor({ page: p, offset, vy: topMargin })
    },
    [paginated, spreadFirst, spreadStart, scrollToAnchor],
  )

  const resolveDest = useCallback(
    async (dest: unknown): Promise<{ page: number; offset: number } | null> => {
      if (!pdf || dest == null) return null
      const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
      if (!Array.isArray(explicit)) return null
      const [refObj, kind, ...args] = explicit as [unknown, { name?: string } | undefined, ...Array<number | null>]
      let pageIndex: number | null = null
      if (refObj && typeof refObj === 'object') pageIndex = await pdf.getPageIndex(refObj as { num: number; gen: number })
      else if (Number.isInteger(refObj)) pageIndex = refObj as number
      if (pageIndex == null) return null
      const page = pageIndex + 1
      let top: number | null = null
      if (kind?.name === 'XYZ') top = (args[1] as number | null) ?? null
      else if (kind?.name === 'FitH' || kind?.name === 'FitBH') top = (args[0] as number | null) ?? null
      else if (kind?.name === 'FitR') top = (args[3] as number | null) ?? null
      let offset = 0
      if (top != null) {
        const vp = (await getPage(page)).getViewport({ scale: 1 })
        const [, y] = vp.convertToViewportPoint(0, top)
        offset = clamp(y / vp.height, 0, 1)
      }
      return { page, offset }
    },
    [pdf, getPage],
  )

  const goToDest = useCallback(
    async (dest: unknown) => {
      const r = await resolveDest(dest)
      if (r) goToPage(r.page, toItemOffset(r.offset), r.offset > 0 ? 12 : 0)
    },
    [resolveDest, goToPage, toItemOffset],
  )

  
  const turn = useCallback(
    (dir: 1 | -1) => {
      const target = dir > 0 ? spreadFirst + spreadPages(spreadFirst).length : spreadFirst > 1 ? spreadStart(spreadFirst - 1) : 0
      if (target < 1 || target > numPages) return
      animRef.current?.finish()
      const style = theme === 'eink' || inkFilterOn ? 'none' : pageTurnSetting
      if (style !== 'none' && overlayRef.current && contentRef.current) {
        const els = Array.from(contentRef.current.querySelectorAll<HTMLElement>('.pdf-page:not([data-offscreen])'))
        turnRef.current = { dir, oldSnap: snapshotPages(els, overlayRef.current), style }
      }
      pendingAnchor.current = { page: target, offset: dir < 0 ? 1 : 0 }
      setCurrent(target)
    },
    [spreadFirst, spreadPages, spreadStart, numPages, theme, pageTurnSetting, inkFilterOn],
  )

  const next = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const vh = el.clientHeight
    if (paginated) {
      if (el.scrollTop + vh < el.scrollHeight - 4) el.scrollBy({ top: vh * 0.9, behavior: smooth })
      else turn(1)
      return
    }
    el.scrollBy({ top: vh - 48, behavior: smooth })
  }, [paginated, turn, smooth])

  const prev = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const vh = el.clientHeight
    if (paginated) {
      if (el.scrollTop > 4) el.scrollBy({ top: -vh * 0.9, behavior: smooth })
      else turn(-1)
      return
    }
    el.scrollBy({ top: -(vh - 48), behavior: smooth })
  }, [paginated, turn, smooth])

  
  const gesture = useRef<{ ratio: number; anchor: ScrollAnchor; scale0: number } | null>(null)

  const beginZoom = useCallback(
    (vx: number, vy: number) => {
      const el = scrollRef.current
      if (!el || !layout) return
      const y = el.scrollTop + vy
      const item = layout.items[itemIndexAt(y)]
      gesture.current = {
        ratio: 1,
        scale0: scale,
        anchor: { page: item.page, offset: (y - item.top) / item.h, fx: (el.scrollLeft + vx - item.left) / item.w, vx, vy },
      }
      if (contentRef.current) contentRef.current.style.transformOrigin = `${el.scrollLeft + vx}px ${el.scrollTop + vy}px`
    },
    [layout, itemIndexAt, scale],
  )
  const updateZoom = useCallback((ratio: number) => {
    const g = gesture.current
    if (!g || !contentRef.current) return
    g.ratio = clamp(ratio, MIN_SCALE / g.scale0, MAX_SCALE / g.scale0)
    contentRef.current.style.transform = `scale(${g.ratio})`
  }, [])
  const endZoom = useCallback(() => {
    const g = gesture.current
    gesture.current = null
    if (!g) return
    if (Math.abs(g.ratio - 1) < 0.02) {
      if (contentRef.current) contentRef.current.style.transform = ''
      return
    }
    pendingAnchor.current = g.anchor
    resetTransform.current = true
    onViewChange({ ...viewRef.current, zoomMode: 'custom', zoom: clamp(g.scale0 * g.ratio, MIN_SCALE, MAX_SCALE) })
  }, [onViewChange])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let touchPinch: { d0: number } | null = null
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault()
        const r = el.getBoundingClientRect()
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2 - r.top
        touchPinch = { d0: dist(e.touches) }
        beginZoom(cx, cy)
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (!touchPinch || e.touches.length !== 2) return
      e.preventDefault()
      updateZoom(dist(e.touches) / touchPinch.d0)
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (touchPinch && e.touches.length < 2) {
        touchPinch = null
        endZoom()
      }
    }
    let wheelTimer: ReturnType<typeof setTimeout> | null = null
    let wheelRatio = 1
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      if (!gesture.current) {
        const r = el.getBoundingClientRect()
        beginZoom(e.clientX - r.left, e.clientY - r.top)
        wheelRatio = 1
      }
      wheelRatio *= Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025) * 4)
      updateZoom(wheelRatio)
      if (wheelTimer) clearTimeout(wheelTimer)
      wheelTimer = setTimeout(endZoom, 180)
    }
    
    type GestureEv = Event & { scale: number; clientX: number; clientY: number }
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      if (touchPinch) return
      const g = e as GestureEv
      const r = el.getBoundingClientRect()
      beginZoom(g.clientX - r.left, g.clientY - r.top)
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      if (touchPinch) return
      updateZoom((e as GestureEv).scale)
    }
    const onGestureEnd = (e: Event) => {
      e.preventDefault()
      if (touchPinch) return
      endZoom()
    }
    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd)
    el.addEventListener('touchcancel', onTouchEnd)
    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('gesturestart', onGestureStart)
    el.addEventListener('gesturechange', onGestureChange)
    el.addEventListener('gestureend', onGestureEnd)
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('gesturestart', onGestureStart)
      el.removeEventListener('gesturechange', onGestureChange)
      el.removeEventListener('gestureend', onGestureEnd)
      if (wheelTimer) clearTimeout(wheelTimer)
    }
  }, [beginZoom, updateZoom, endZoom])

  
  const lastView = useRef(view)
  if (lastView.current !== view) {
    const prevView = lastView.current
    lastView.current = view
    const el = scrollRef.current
    if (!pendingAnchor.current && el && layout && (prevView.zoom !== view.zoom || prevView.zoomMode !== view.zoomMode)) {
      const vy = el.clientHeight / 2
      const vx = el.clientWidth / 2
      const y = el.scrollTop + vy
      const item = layout.items[itemIndexAt(y)]
      pendingAnchor.current = { page: item.page, offset: (y - item.top) / item.h, fx: (el.scrollLeft + vx - item.left) / item.w, vx, vy }
    }
    if (prevView.mode !== view.mode && view.mode === 'paginated') {
      
      pendingAnchor.current = { page: current, offset: 0 }
    } else if (prevView.mode !== view.mode) {
      pendingAnchor.current = { page: current, offset: anchorRef.current.offset }
    }
  }

  
  const pointerDown = useRef(false)
  
  const suppressSel = useRef(0)
  
  const selectionFromRange = useCallback((range: Range): SelectionInfo | null => {
      const el = scrollRef.current
      if (!el) return null
      const text = range.toString().replace(/\s+/g, ' ').trim()
      if (!text) return null
      const pages = Array.from(el.querySelectorAll<HTMLElement>('.pdf-page[data-rendered]')).map((p) => ({
        page: Number(p.dataset.page),
        box: p.getBoundingClientRect(),
        r: (p.querySelector<HTMLElement>('.pdf-page-inner') ?? p).getBoundingClientRect(),
      }))
      const raw: NormRect[] = []
      for (const cr of Array.from(range.getClientRects())) {
        if (cr.width < 1 || cr.height < 1) continue
        const cx = cr.left + cr.width / 2
        const cy = cr.top + cr.height / 2
        const p = pages.find((pg) => cx >= pg.box.left && cx <= pg.box.right && cy >= pg.box.top && cy <= pg.box.bottom)
        if (!p) continue
        raw.push({
          page: p.page,
          x: (cr.left - p.r.left) / p.r.width,
          y: (cr.top - p.r.top) / p.r.height,
          w: cr.width / p.r.width,
          h: cr.height / p.r.height,
        })
      }
      if (!raw.length) return null
      const hs = raw.map((r) => r.h).sort((a, b) => a - b)
      const median = hs[Math.floor(hs.length / 2)]
      const rects = mergeRects(raw.filter((r) => r.h <= median * 2.5 && !(r.w > 0.9 && r.h > 0.08)))
      if (!rects.length) return null
      const b = range.getBoundingClientRect()
      const page = rects[0].page
      const pageStr = pageText.current.get(page)
      let prefix: string | undefined
      let suffix: string | undefined
      if (pageStr) {
        const idx = pageStr.indexOf(text)
        if (idx >= 0) {
          prefix = pageStr.slice(Math.max(0, idx - 80), idx)
          suffix = pageStr.slice(idx + text.length, idx + text.length + 80)
        }
      }
      return {
        text,
        anchor: { type: 'pdf', page, rects, quote: { exact: text, prefix, suffix } },
        order: page * 1e6 + Math.round(rects[0].y * 1e5),
        rect: { left: b.left, top: b.top, width: b.width, height: b.height },
      }
  }, [])
  useEffect(() => {
    const computeSelection = () => {
      if (inkActiveRef.current || Date.now() < suppressSel.current) return
      const el = scrollRef.current
      const sel = document.getSelection()
      if (!el || !sel || sel.isCollapsed || sel.rangeCount === 0) {
        propsRef.current.onSelection(null)
        return
      }
      const range = sel.getRangeAt(0)
      if (!el.contains(range.commonAncestorContainer)) return
      const info = selectionFromRange(range)
      if (info) propsRef.current.onSelection(info)
    }
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (!pointerDown.current) computeSelection()
      }, 280)
    }
    const onDown = () => {
      pointerDown.current = true
    }
    const onUp = () => {
      pointerDown.current = false
      schedule()
    }
    document.addEventListener('selectionchange', schedule)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('pointerup', onUp, true)
    window.addEventListener('pointercancel', onUp, true)
    return () => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('selectionchange', schedule)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerup', onUp, true)
      window.removeEventListener('pointercancel', onUp, true)
    }
  }, [])

  
  const tapStart = useRef<{ x: number; y: number; t: number; type: string } | null>(null)
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const swipe = useRef<{ x: number; y: number; t: number } | null>(null)

  const hlByPage = useMemo(() => {
    const m = new Map<number, PageHighlight[]>()
    for (const h of highlights) {
      if (h.anchor.type !== 'pdf') continue
      const byPage = new Map<number, NormRect[]>()
      for (const r of h.anchor.rects) {
        const arr = byPage.get(r.page) ?? []
        arr.push(r)
        byPage.set(r.page, arr)
      }
      for (const [p, rects] of byPage) {
        const list = m.get(p) ?? []
        list.push({ h, rects })
        m.set(p, list)
      }
    }
    return m
  }, [highlights])

  
  const hitHighlight = (clientX: number, clientY: number): { hits: Highlight[]; rect: DOMRect } | null => {
    const el = scrollRef.current
    if (!el) return null
    const pageEl = (document.elementFromPoint(clientX, clientY) as HTMLElement | null)?.closest<HTMLElement>('.pdf-page')
    if (!pageEl) return null
    const page = Number(pageEl.dataset.page)
    const r = (pageEl.querySelector<HTMLElement>('.pdf-page-inner') ?? pageEl).getBoundingClientRect()
    const x = (clientX - r.left) / r.width
    const y = (clientY - r.top) / r.height
    const hits: Highlight[] = []
    let firstRect: NormRect | null = null
    for (const { h, rects } of hlByPage.get(page) ?? []) {
      const hit = rects.find((q) => x >= q.x - 0.004 && x <= q.x + q.w + 0.004 && y >= q.y - 0.004 && y <= q.y + q.h + 0.004)
      if (hit && !hits.includes(h)) {
        hits.push(h)
        firstRect ??= rects[0]
      }
    }
    if (!hits.length || !firstRect) return null
    return { hits, rect: new DOMRect(r.left + firstRect.x * r.width, r.top + firstRect.y * r.height, firstRect.w * r.width, firstRect.h * r.height) }
  }

  const handleTap = (clientX: number, clientY: number) => {
    if (inkActiveRef.current) return
    const sel = document.getSelection()
    if (sel && !sel.isCollapsed) return
    const hit = hitHighlight(clientX, clientY)
    if (hit) {
      propsRef.current.onHighlightTap(hit.hits, hit.rect)
      return
    }
    const el = scrollRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const fx = (clientX - r.left) / r.width
    if (tapZones && fx < 0.22) (rtl ? next : prev)()
    else if (tapZones && fx > 0.78) (rtl ? prev : next)()
    else propsRef.current.onToggleChrome()
  }

  
  const onTouchStartSwipe = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) {
      swipe.current = null
      return
    }
    swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }
  }
  const onTouchEndSwipe = (e: React.TouchEvent) => {
    const s = swipe.current
    swipe.current = null
    const el = scrollRef.current
    if (!s || !el || !paginated || inkActiveRef.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    if (Date.now() - s.t > 600 || Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return
    const sel = document.getSelection()
    if (sel && !sel.isCollapsed) return
    const canScrollX = el.scrollWidth > el.clientWidth + 2
    if (canScrollX) {
      if (dx < 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 2) return
      if (dx > 0 && el.scrollLeft > 2) return
    }
    turn((dx < 0) !== rtl ? 1 : -1)
  }

  const goToAnchor = useCallback(
    (a: Anchor) => {
      if (a.type !== 'pdf') return
      const r = a.rects.find((x) => x.page === a.page) ?? a.rects[0]
      goToPage(a.page, r ? toItemOffset(r.y) : 0, r && r.y > 0 ? Math.min((scrollRef.current?.clientHeight ?? 400) * 0.3, 160) : 0)
    },
    [goToPage],
  )

  
  const onFingerPan = useCallback((dx: number, dy: number) => scrollRef.current?.scrollBy(dx, dy), [])
  const onInkAdd = ink.onAdd
  const onInkErase = ink.onErase

  const onInternalLink = useCallback(
    (dest: unknown) => {
      propsRef.current.onJump?.()
      void goToDest(dest)
    },
    [goToDest],
  )

  
  
  const pageItems = useCallback(
    async (page: number) => {
      const [pg, tc] = await Promise.all([getPage(page), getText(page)])
      const vp = pg.getViewport({ scale: 1 })
      return (tc.items as TextItem[])
        .filter((it) => typeof it.str === 'string')
        .map((it) => {
          const tx = pdfjsLib.Util.transform(vp.transform, it.transform)
          const fh = Math.hypot(tx[2], tx[3])
          return { str: it.str, eol: !!it.hasEOL, x: tx[4] / vp.width, y: (tx[5] - fh) / vp.height, w: (it.width * vp.scale) / vp.width, h: fh / vp.height }
        })
    },
    [getPage, getText],
  )

  



  const spanPoints = useCallback(
    async (a: { page: number; x: number; y: number }, b: { page: number; x: number; y: number }) => {
      const rects: NormRect[] = []
      let text = ''
      const sameLine = (it: { y: number; h: number }, pt: { y: number }) => pt.y >= it.y - it.h * 0.3 && pt.y <= it.y + it.h * 1.3
      for (let page = a.page; page <= b.page; page++) {
        const items = await pageItems(page)
        if (!items.length) continue
        let from = 0
        let to = items.length - 1
        let cutStart = 0
        let cutEnd = Infinity
        if (page === a.page) {
          const i = items.findIndex((it) => sameLine(it, a) && a.x < it.x + it.w)
          from = i >= 0 ? i : Math.max(0, items.findIndex((it) => it.y > a.y))
          const it = items[from]
          cutStart = it.w > 0 ? clamp(Math.round(((a.x - it.x) / it.w) * it.str.length), 0, it.str.length) : 0
        }
        if (page === b.page) {
          let j = -1
          items.forEach((it, k) => {
            if (sameLine(it, b) && b.x > it.x) j = k
          })
          if (j < 0) items.forEach((it, k) => { if (it.y + it.h < b.y) j = k })
          to = j
          const it = items[Math.max(0, to)]
          cutEnd = it && it.w > 0 ? clamp(Math.round(((b.x - it.x) / it.w) * it.str.length), 0, it.str.length) : Infinity
        }
        for (let k = from; k <= to; k++) {
          const it = items[k]
          const len = it.str.length || 1
          const s0 = page === a.page && k === from ? cutStart : 0
          const s1 = page === b.page && k === to ? Math.min(cutEnd, it.str.length) : it.str.length
          if (s1 <= s0) continue
          const part = it.str.slice(s0, s1)
          text += part + (it.eol ? ' ' : '')
          if (!part.trim() || it.w <= 0 || it.h <= 0) continue
          rects.push({ page, x: it.x + (s0 / len) * it.w, y: it.y, w: ((s1 - s0) / len) * it.w, h: it.h })
        }
        text += ' '
      }
      const clean = text.replace(/\s+/g, ' ').trim().slice(0, 20000)
      const merged = mergeRects(rects)
      if (!clean || !merged.length) return null
      return { text: clean, rects: merged }
    },
    [pageItems],
  )

  
  const edgePoints = (a: Extract<Anchor, { type: 'pdf' }>) => {
    const first = a.rects[0]
    const last = a.rects[a.rects.length - 1]
    return {
      start: { page: first.page, x: first.x + 0.0005, y: first.y + first.h / 2 },
      end: { page: last.page, x: last.x + last.w - 0.0005, y: last.y + last.h / 2 },
    }
  }
  const before = (p: { page: number; x: number; y: number }, q: { page: number; x: number; y: number }) =>
    p.page !== q.page ? p.page < q.page : Math.abs(p.y - q.y) > 0.004 ? p.y < q.y : p.x <= q.x

  
  const caretAt = (pt: { page: number; x: number; y: number }) => {
    const pageEl = scrollRef.current?.querySelector<HTMLElement>(`.pdf-page[data-page="${pt.page}"] .pdf-page-inner`)
    if (!pageEl) return null
    const r = pageEl.getBoundingClientRect()
    const x = r.left + pt.x * r.width
    const y = r.top + pt.y * r.height
    const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null; caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null }
    scrollRef.current?.classList.add('pi-caret') 
    try {
      if (doc.caretRangeFromPoint) {
        const c = doc.caretRangeFromPoint(x, y)
        return c && c.startContainer.parentElement?.closest('.textLayer') ? { node: c.startContainer, offset: c.startOffset } : null
      }
      const c = doc.caretPositionFromPoint?.(x, y)
      return c && c.offsetNode.parentElement?.closest('.textLayer') ? { node: c.offsetNode, offset: c.offset } : null
    } finally {
      scrollRef.current?.classList.remove('pi-caret')
    }
  }

  useImperativeHandle(
    ref,
    (): ReaderHandle => ({
      next,
      prev,
      goToToc: (item) => void goToDest(item.target),
      goToHighlight: (h) => goToAnchor(h.anchor),
      goToAnchor,
      adjustAnchor: async (a, side, dir, byChar) => {
        if (a.type !== 'pdf' || !a.rects.length) return null
        const { start, end } = edgePoints(a)
        const singlePage = start.page === end.page
        
        const s = caretAt(singlePage || side === 0 ? start : { ...start })
        const e = caretAt(singlePage || side === 1 ? end : { ...end })
        const pageEl = (pg: number) => scrollRef.current?.querySelector<HTMLElement>(`.pdf-page[data-page="${pg}"] .textLayer`)
        const range = document.createRange()
        if (singlePage) {
          if (!s || !e) return null
          range.setStart(s.node, s.offset)
          range.setEnd(e.node, e.offset)
        } else {
          
          const layer = pageEl(side === 0 ? start.page : end.page)
          if (!layer || !(side === 0 ? s : e)) return null
          if (side === 0) {
            range.setStart(s!.node, s!.offset)
            range.setEnd(layer, layer.childNodes.length)
          } else {
            range.setStart(layer, 0)
            range.setEnd(e!.node, e!.offset)
          }
        }
        suppressSel.current = Date.now() + 900
        const moved = adjustRange(window, range, side, dir, byChar)
        suppressSel.current = Date.now() + 500
        if (!moved) return null
        if (singlePage) {
          const info = selectionFromRange(moved)
          return info ? { anchor: info.anchor, text: info.text } : null
        }
        const rects = Array.from(moved.getClientRects()).filter((r) => r.width > 0.5)
        const edge = side === 0 ? rects[0] : rects[rects.length - 1]
        const inner = scrollRef.current?.querySelector<HTMLElement>(`.pdf-page[data-page="${side === 0 ? start.page : end.page}"] .pdf-page-inner`)
        if (!edge || !inner) return null
        const ir = inner.getBoundingClientRect()
        const pt = { page: side === 0 ? start.page : end.page, x: ((side === 0 ? edge.left + 0.5 : edge.right - 0.5) - ir.left) / ir.width, y: (edge.top + edge.height / 2 - ir.top) / ir.height }
        const span = await spanPoints(side === 0 ? pt : start, side === 0 ? end : pt)
        return span ? { anchor: { type: 'pdf', page: span.rects[0].page, rects: span.rects, quote: { exact: span.text.slice(0, 2000), prefix: a.quote.prefix, suffix: a.quote.suffix } }, text: span.text } : null
      },
      spanAnchors: async (a, b) => {
        if (a.type !== 'pdf' || b.type !== 'pdf' || !a.rects.length || !b.rects.length) return null
        const ea = edgePoints(a)
        const eb = edgePoints(b)
        const startFirst = before(ea.start, eb.start)
        const from = startFirst ? ea.start : eb.start
        const to = before(ea.end, eb.end) ? eb.end : ea.end
        const span = await spanPoints(from, to)
        if (!span) return null
        const first = span.rects[0]
        return {
          anchor: {
            type: 'pdf',
            page: first.page,
            rects: span.rects,
            quote: { exact: span.text.slice(0, 2000), prefix: (startFirst ? a : b).quote.prefix, suffix: (before(ea.end, eb.end) ? b : a).quote.suffix },
          },
          text: span.text,
          order: first.page * 1e6 + Math.round(first.y * 1e5),
        }
      },
      getLocation: () => {
        const a = anchorRef.current
        return { type: 'pdf', page: a.page, rects: [{ page: a.page, x: 0, y: a.offset, w: 0, h: 0 }], quote: { exact: '' } }
      },
      goToProgress: (p) => goToPage(Math.max(1, Math.round(p * numPages))),
      search: async (query, onResults, signal) => {
        const q = query.trim().toLowerCase().replace(/\s+/g, ' ')
        if (!q || !pdf) return onResults([])
        const results: SearchResult[] = []
        for (let p = 1; p <= pdf.numPages; p++) {
          if (signal.aborted) return
          await getText(p)
          const text = pageText.current.get(p) ?? ''
          const lower = text.toLowerCase()
          let idx = lower.indexOf(q)
          let k = 0
          while (idx !== -1 && k < 50) {
            const start = Math.max(0, idx - 50)
            results.push({
              id: `${p}-${idx}`,
              where: `p. ${p}`,
              excerpt: `${start > 0 ? '…' : ''}${text.slice(start, idx + q.length + 70)}…`,
              target: { page: p, index: k },
            })
            k++
            idx = lower.indexOf(q, idx + q.length)
          }
          if (results.length >= 1000) break
          if (p % 8 === 0) onResults([...results])
        }
        if (!signal.aborted) onResults([...results])
      },
      goToSearchResult: (r, query) => {
        const t = r.target as { page: number; index: number }
        goToPage(t.page, 0)
        setSearch((s) => ({ term: query.trim(), page: t.page, index: t.index, seq: (s?.seq ?? 0) + 1 }))
      },
      clearSearch: () => setSearch(null),
      clearSelection: () => document.getSelection()?.removeAllRanges(),
      isAnchorVisible: (a) => a.type === 'pdf' && visiblePages.current.includes(a.page),
      progressOf: (a) => (a.type === 'pdf' && numPages ? a.page / numPages : null),
      getVisibleText: async () => {
        const texts = await Promise.all(visiblePages.current.map(async (pg) => (await getText(pg), pageText.current.get(pg) ?? '')))
        return texts.join('\n\n')
      },
      getLanguage: () => null,
      pageCount: () => numPages,
      goToPage: (pg) => goToPage(pg, 0),
      renderThumbnail: async (pg, canvas, width) => {
        const page = await getPage(pg)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: width / base.width })
        canvas.width = Math.round(viewport.width)
        canvas.height = Math.round(viewport.height)
        await page.render({ canvas, viewport, intent: 'print' }).promise
      },
    }),
    [next, prev, goToDest, goToPage, goToAnchor, numPages, pdf, getText, getPage],
  )

  const renderLo = paginated ? 1 : Math.max(1, range[0] - 1)
  const renderHi = paginated ? numPages : Math.min(numPages, range[1] + 1)

  return (
    <div className="absolute inset-0">
    <div
      ref={scrollRef}
      className="thin-scroll absolute inset-0 overflow-auto overscroll-contain bg-background"
      style={{ touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
      onPointerDown={(e) => {
        tapStart.current = { x: e.clientX, y: e.clientY, t: Date.now(), type: e.pointerType }
      }}
      onClick={(e) => {
        const s = tapStart.current
        if (!s || Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10 || Date.now() - s.t > 500) return
        if ((e.target as HTMLElement).closest('a,button,input,textarea')) return
        const { clientX, clientY } = e
        if (s.type === 'mouse') {
          
          if (clickTimer.current) clearTimeout(clickTimer.current)
          clickTimer.current = setTimeout(() => handleTap(clientX, clientY), 230)
        } else {
          handleTap(clientX, clientY)
        }
      }}
      onDoubleClick={() => {
        if (clickTimer.current) clearTimeout(clickTimer.current)
      }}
      onTouchStart={onTouchStartSwipe}
      onTouchEnd={onTouchEndSwipe}
    >
      {layout && pdf && (
        <div
          ref={contentRef}
          className="relative"
          style={{ width: layout.contentW, height: layout.contentH, willChange: 'transform' }}
        >
          {[...layout.items, ...layout.preload].map((it) => (
            <PdfPage
              key={it.page}
              offscreen={it.left === OFFSCREEN_X}
              pageNumber={it.page}
              scale={scale}
              left={it.left}
              top={it.top}
              width={it.w}
              height={it.h}
              render={it.page >= renderLo && it.page <= renderHi}
              getPage={getPage}
              getText={getText}
              highlights={hlByPage.get(it.page)}
              searchTerm={search?.term ?? null}
              searchFocus={search && search.page === it.page ? { seq: search.seq, index: search.index } : null}
              onInternalLink={onInternalLink}
              crop={crop}
              baseWidth={sizes![it.page - 1].w}
              baseHeight={sizes![it.page - 1].h}
              inkActive={ink.active}
              inkTool={ink.tool}
              inkColor={ink.color}
              inkSize={ink.size}
              fingersDraw={ink.fingersDraw}
              inkStrokes={ink.pages.get(it.page)}
              onInkAdd={onInkAdd}
              onInkErase={onInkErase}
              onFingerPan={onFingerPan}
            />
          ))}
          {layout.spine && (
            <div
              className="pdf-spine"
              aria-hidden
              style={{ left: layout.spine.x - 28, top: layout.spine.top, height: layout.spine.h }}
            />
          )}
        </div>
      )}
    </div>
    {}
    <div ref={overlayRef} className="turn-overlay" aria-hidden />
    </div>
  )
})

export default PdfReader
