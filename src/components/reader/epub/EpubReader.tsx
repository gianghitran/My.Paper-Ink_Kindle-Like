import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import ePub, { EpubCFI, type Book, type Contents, type Location, type NavItem, type Rendition } from 'epubjs'
import type Section from 'epubjs/types/section'
import { getEpubLocations, saveEpubLocations } from '@/lib/services/readingState'
import { useSettings, wantsTwoPages } from '@/store/settings'
import type { Anchor, Highlight } from '@/types'
import type { ReaderHandle, ReaderProps, SearchResult, SelectionInfo, TocItem } from '../types'
import { buildEpubCss } from './epubStyles'
import { hardenEpubSection } from '@/lib/formats/sanitize'
import { hitBoxes, paintView, type VisibleBox } from './annotationLayer'
import { adjustRange } from '../rangeEdit'

const STYLE_ID = 'paperink-style'

interface FlatToc {
  label: string
  href: string
  spineIndex: number
  level: number
}

function spineItems(book: Book): Section[] {
  return ((book.spine as unknown as { spineItems?: Section[] }).spineItems ?? []).filter(Boolean)
}

function frameOffset(contents: Contents) {
  const frame = contents.window?.frameElement as HTMLElement | null
  const r = frame?.getBoundingClientRect()
  return { x: r?.left ?? 0, y: r?.top ?? 0 }
}

function rangeStart(cfi: string) {
  try {
    const c = new EpubCFI(cfi)
    if (!c.range) return cfi
    c.collapse(true)
    return c.toString()
  } catch {
    return cfi
  }
}

async function reveal(r: Rendition, cfi: string) {
  const target = rangeStart(cfi)
  await r.display(target)
  const cmp = new EpubCFI()
  for (let i = 0; i < 3; i++) {
    const loc = r.currentLocation() as unknown as Location
    if (!loc?.start?.cfi || !loc?.end?.cfi) return
    try {
      if (cmp.compare(target, loc.start.cfi) < 0) await r.prev()
      else if (cmp.compare(target, loc.end.cfi) > 0) await r.next()
      else return
    } catch {
      return
    }
  }
}

function refreshMarks(r: Rendition | null) {
  try {
    const views = (r as unknown as { views?: () => { forEach?: (fn: (v: { pane?: { render?: () => void } }) => void) => void } })?.views?.()
    views?.forEach?.((v) => v?.pane?.render?.())
  } catch {

  }
}

function linkNear(doc: Document, target: Element | null, x: number, y: number) {
  const direct = target?.closest?.('a[href]') as HTMLAnchorElement | null
  if (direct) return direct
  let best: HTMLAnchorElement | null = null
  let bestDist = 16
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    for (const r of Array.from(a.getClientRects())) {
      const dist = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))
      if (dist < bestDist) {
        bestDist = dist
        best = a
      }
    }
  }
  return best
}

const EpubReader = forwardRef<ReaderHandle, ReaderProps>(function EpubReader(props, ref) {
  const { file, doc, initialState, initialAnchor, highlights } = props
  const propsRef = useRef(props)
  propsRef.current = props
  const epub = useSettings((s) => s.settings.epub)
  const theme = useSettings((s) => s.settings.theme)
  const pageTurn = useSettings((s) => s.settings.pageTurn)
  const twoPageSetting = useSettings((s) => s.settings.twoPage)
  const styleRef = useRef({ epub, theme, pageTurn })
  styleRef.current = { epub, theme, pageTurn }

  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 })
  const twoUp = epub.flow === 'paginated' && wantsTwoPages(twoPageSetting, frameSize.w, frameSize.h)

  const frameRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const [book, setBook] = useState<Book | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const [renditionVersion, setRenditionVersion] = useState(0)
  const tocRef = useRef<FlatToc[]>([])
  const locationRef = useRef<{ cfi: string; href: string; chapter: string } | null>(null)
  const lastLocation = useRef<Location | null>(null)
  const locationsReady = useRef(false)
  const readySent = useRef(false)

  const holdSaveUntil = useRef(Number.POSITIVE_INFINITY)
  const resizeCleanup = useRef<(() => void) | null>(null)

  const visibleBoxes = useRef(new Map<string, VisibleBox[]>())
  const searchMark = useRef<string | null>(null)
  const suppressClick = useRef(0)

  const suppressSel = useRef(0)
  const touch = useRef<{ x: number; y: number; t: number } | null>(null)
  const highlightsRef = useRef<Highlight[]>(highlights)
  highlightsRef.current = highlights

  useEffect(() => {
    let cancelled = false
    let b: Book | null = null
    ;(async () => {
      const data = await file.arrayBuffer()
      b = ePub(data)

      b.spine.hooks.content.register((doc: Document) => hardenEpubSection(doc))
      await b.ready
      if (cancelled) return
      const nav = await b.loaded.navigation
      const flat: FlatToc[] = []
      let seq = 0
      const walk = (items: NavItem[], level: number): TocItem[] =>
        items.map((it) => {
          const base = it.href.split('#')[0]
          const section = b!.spine.get(base) as Section | null
          flat.push({ label: it.label.trim(), href: it.href, spineIndex: section?.index ?? -1, level })
          return { id: `toc-${seq++}`, label: it.label.trim() || 'Untitled', level, target: it.href, children: walk(it.subitems ?? [], level + 1) }
        })
      const toc = walk(nav.toc ?? [], 0)
      tocRef.current = flat.filter((f) => f.spineIndex >= 0)
      propsRef.current.onToc(toc)
      const cached = await getEpubLocations(doc.id)
      if (cached) {
        try {
          b.locations.load(cached)
          locationsReady.current = b.locations.length() > 0
        } catch {
          locationsReady.current = false
        }
      }
      if (!cancelled) setBook(b)
    })().catch((err) => {
      console.error(err)
      if (!cancelled) propsRef.current.onError('This EPUB could not be opened.')
    })
    return () => {
      cancelled = true

      if (b) void b.opened.catch(() => {}).finally(() => b!.destroy())
    }
  }, [file, doc.id])

  const chapterFor = useCallback((spineIndex: number) => {
    let best: FlatToc | null = null
    for (const t of tocRef.current) {

      if (t.spineIndex <= spineIndex && (!best || t.spineIndex > best.spineIndex)) {
        best = t
      }
    }
    return best?.label || `Section ${spineIndex + 1}`
  }, [])

  const anchorFromRange = (contents: Contents, range: Range, cfi?: string): Omit<SelectionInfo, 'rect'> | null => {
    if (!book) return null
    const text = range.toString().replace(/\s+/g, ' ').trim()
    if (!text) return null
    const d = contents.document
    const pre = d.createRange()
    pre.setStart(d.body, 0)
    pre.setEnd(range.startContainer, range.startOffset)
    const preText = pre.toString()
    const post = d.createRange()
    post.setStart(range.endContainer, range.endOffset)
    post.setEnd(d.body, d.body.childNodes.length)
    const postText = post.toString()
    const cfiRange = cfi ?? contents.cfiFromRange(range)
    const section = book.spine.get(cfiRange) as Section | null
    const spineIndex = contents.sectionIndex ?? section?.index ?? 0
    return {
      text,
      anchor: {
        type: 'epub',
        cfi: cfiRange,
        href: section?.href,
        chapter: chapterFor(spineIndex),
        quote: { exact: text, prefix: preText.slice(-80), suffix: postText.slice(0, 80) },
      },
      order: spineIndex * 1e7 + Math.min(preText.length, 9_999_999),
    }
  }

  const contentsFor = (cfi: string): Contents | null => {
    let found: Contents | null = null
    try {
      ;(renditionRef.current as unknown as { views: () => { forEach: (fn: (v: { contents?: Contents }) => void) => void } } | null)?.views().forEach((v) => {
        if (v.contents && cfi.startsWith(`epubcfi(${v.contents.cfiBase}!`)) found = v.contents
      })
    } catch {

    }
    return found
  }

  const repaint = useCallback(() => {
    const r = renditionRef.current
    if (!r) return
    const { theme: th, epub: e } = styleRef.current
    const layout = e.flow === 'paginated' ? ((r as unknown as { manager?: { layout?: { delta: number; gap: number } } }).manager?.layout ?? null) : null
    const opts = { theme: th, noteMarker: useSettings.getState().settings.noteMarker, layout: layout ? { delta: layout.delta, gap: layout.gap } : null }
    const boxes = new Map<string, VisibleBox[]>()
    try {
      const views = (r as unknown as { views?: () => { forEach?: (fn: (v: { contents?: Contents; element?: HTMLElement; iframe?: HTMLIFrameElement }) => void) => void } }).views?.()
      views?.forEach?.((v) => {
        if (!v?.contents) return
        boxes.set(v.contents.cfiBase, paintView(v, highlightsRef.current, opts))
      })
    } catch {

    }
    visibleBoxes.current = boxes
  }, [])
  const redrawHighlights = repaint

  const locSpine = useRef<number[] | null>(null)
  const chapterEndFor = (index: number) => {
    if (!book) return undefined
    const next = tocRef.current.map((t) => t.spineIndex).filter((i) => i > index).sort((a, b) => a - b)[0]
    const total = spineItems(book).length || 1
    if (next === undefined) return 1
    if (locationsReady.current) {
      if (!locSpine.current) {
        const all = (book.locations as unknown as { _locations?: string[] })._locations ?? []
        locSpine.current = all.map((c) => {
          try {
            return new EpubCFI(c).spinePos
          } catch {
            return 0
          }
        })
      }
      const arr = locSpine.current
      const i = arr.findIndex((sp) => sp >= next)
      if (i >= 0 && arr.length) return i / arr.length
    }
    return next / total
  }

  const report = useCallback(
    (loc: Location) => {
      if (!book || !loc?.start) return
      lastLocation.current = loc
      const start = loc.start
      const chapter = chapterFor(start.index)
      const total = spineItems(book).length || 1
      let progress: number
      if (locationsReady.current) progress = book.locations.percentageFromCfi(start.cfi) ?? 0
      else {
        const within = start.displayed?.total ? (start.displayed.page - 1) / start.displayed.total : 0
        progress = (start.index + within) / total
      }
      if (loc.atEnd) progress = 1
      progress = Math.min(1, Math.max(0, progress))
      const pct = Math.round(progress * 100)
      locationRef.current = { cfi: start.cfi, href: start.href, chapter }
      const paged = styleRef.current.epub.flow === 'paginated'
      const left = start.displayed ? start.displayed.total - start.displayed.page : 0

      let page: number | undefined
      let totalPages: number | undefined
      let pageLabel: string | null = null
      if (locationsReady.current && book.locations.length() > 0) {
        totalPages = book.locations.length()
        const index = book.locations.locationFromCfi(start.cfi) as unknown as number
        page = loc.atEnd ? totalPages : Math.min(totalPages, Math.max(1, (Number.isFinite(index) ? index : 0) + 1))
        pageLabel = `Page ${page} of ${totalPages}`
      } else if (paged && start.displayed?.total) {
        pageLabel = `Page ${start.displayed.page} of ${start.displayed.total} in chapter`
      }
      const chapterDetail = paged && start.displayed?.total ? (left > 0 ? `${left} page${left === 1 ? '' : 's'} left in chapter` : 'Last page in chapter') : undefined
      propsRef.current.onPosition({
        chapter,
        chapterEnd: chapterEndFor(start.index),
        label: pageLabel ? `${pageLabel} • ${pct}%` : `${chapter} • ${pct}%`,
        detail: pageLabel ? [chapter, chapterDetail].filter(Boolean).join(' · ') : chapterDetail,
        progress,
        page,
        total: totalPages,
      })
      if (Date.now() > holdSaveUntil.current) {
        propsRef.current.onSaveState({ progress, epub: { cfi: start.cfi, href: start.href, chapter } }, page && totalPages ? `Page ${page} of ${totalPages}` : chapter)
      }
    },
    [book, chapterFor], 
  )

  const resolveHref = (contents: Contents, href: string) => {
    if (!book) return href
    const section = book.spine.get(contents.sectionIndex) as Section | null
    if (href.startsWith('#')) return `${section?.href ?? ''}${href}`
    try {
      const u = new URL(href, `http://book/${section?.href ?? ''}`)
      return `${decodeURIComponent(u.pathname.slice(1))}${u.hash}`
    } catch {
      return href
    }
  }
  const resolveNote = async (contents: Contents, href: string) => {
    if (!book) return null
    const full = resolveHref(contents, href)
    const [path, id] = [full.split('#')[0], decodeURIComponent(full.split('#')[1] ?? '')]
    if (!id) return null
    let doc: Document | null = null
    const current = book.spine.get(contents.sectionIndex) as Section | null
    if (!path || path === current?.href) doc = contents.document
    else {
      const section = book.spine.get(path) as Section | null
      if (!section) return null
      await section.load(book.load.bind(book))
      doc = (section as unknown as { document?: Document }).document ?? null
    }
    const target = doc?.getElementById(id)
    if (!target) return null
    const block = (target.closest('aside, li, dd, p, div, section, blockquote') ?? target).cloneNode(true) as Element

    block.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => h.remove())
    const text = (block.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!text) return null
    return { text: text.length > 2400 ? `${text.slice(0, 2400)}…` : text, href: full }
  }

  useEffect(() => {
    const host = hostRef.current
    if (!book || !host || !frameSize.w) return
    const scrolled = epub.flow === 'scrolled'
    const r = book.renderTo(host, {
      width: '100%',
      height: '100%',
      flow: scrolled ? 'scrolled' : 'paginated',
      manager: scrolled ? 'continuous' : 'default',
      spread: twoUp ? 'auto' : 'none',
      minSpreadWidth: twoUp ? 0 : 100000,

      allowScriptedContent: true,
    })
    renditionRef.current = r
    visibleBoxes.current = new Map()
    searchMark.current = null

    r.hooks.content.register((contents: Contents) => {
      const d = contents.document
      const style = d.createElement('style')
      style.id = STYLE_ID
      style.textContent = buildEpubCss(styleRef.current.epub, styleRef.current.theme)
      d.head?.appendChild(style)

      d.addEventListener(
        'click',
        (e) => {
          const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
          if (!a) return
          e.preventDefault()
          e.stopPropagation()
          activateLink(contents, a)
        },
        true,
      )

      let tap: { x: number; y: number; t: number } | null = null
      d.addEventListener(
        'touchstart',
        (e) => {
          tap = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null
        },
        { passive: true },
      )
      d.addEventListener(
        'touchend',
        (e) => {
          const s = tap
          tap = null
          const t = e.changedTouches[0]
          if (!s || !t || e.touches.length) return
          if (Date.now() - s.t > 500 || Math.hypot(t.clientX - s.x, t.clientY - s.y) > 10) return
          const sel = contents.window.getSelection()
          if (sel && !sel.isCollapsed) return
          e.preventDefault()
          const a = linkNear(d, e.target as Element | null, t.clientX, t.clientY)
          if (a) activateLink(contents, a)
          else tapAt(contents, t.clientX, t.clientY)
        },
        { passive: false },
      )
      let selTimer: ReturnType<typeof setTimeout> | null = null
      d.addEventListener('selectionchange', () => {
        if (Date.now() < suppressSel.current) return
        if (selTimer) clearTimeout(selTimer)
        selTimer = setTimeout(() => {
          const sel = contents.window.getSelection()
          if (!sel || sel.isCollapsed) propsRef.current.onSelection(null)
        }, 200)
      })
    })

    r.on('rendered', () => requestAnimationFrame(repaint))
    r.on('relocated', (loc: Location) => {
      report(loc)
      if (!animating.current)
        requestAnimationFrame(() => {
          refreshMarks(r)
          repaint()
        })
    })

    r.on('resized', () => setTimeout(redrawHighlights, 60))

    let resizeTimer: ReturnType<typeof setTimeout> | null = null
    const onWindowResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        refreshMarks(r)
        repaint()
      }, 250)
    }
    window.addEventListener('resize', onWindowResize)
    window.visualViewport?.addEventListener('resize', onWindowResize)
    resizeCleanup.current = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      window.removeEventListener('resize', onWindowResize)
      window.visualViewport?.removeEventListener('resize', onWindowResize)
    }

    r.on('selected', (cfiRange: string, contents: Contents) => {
      if (Date.now() < suppressSel.current) return
      try {
        const sel = contents.window.getSelection()
        if (!sel || sel.rangeCount === 0) return
        const range = sel.getRangeAt(0)
        const info = anchorFromRange(contents, range, cfiRange)
        if (!info) return
        const off = frameOffset(contents)
        const b = range.getBoundingClientRect()
        propsRef.current.onSelection({ ...info, rect: { left: off.x + b.left, top: off.y + b.top, width: b.width, height: b.height } })
      } catch (err) {
        console.warn('Selection handling failed', err)
      }
    })

    const hitHighlight = (contents: Contents, x: number, y: number) => {
      const boxes = visibleBoxes.current.get(contents.cfiBase) ?? []
      const ids = hitBoxes(boxes, x, y)
      const hits = ids.map((id) => highlightsRef.current.find((h) => h.id === id)).filter((h): h is Highlight => !!h)
      if (!hits.length) return null
      const first = boxes.find((b) => b.id === hits[0].id)!
      const off = frameOffset(contents)
      return { hits, rect: { left: off.x + first.left, top: off.y + first.top, width: first.width, height: first.height } }
    }

    const tapAt = (contents: Contents, x: number, y: number) => {
      const hit = hitHighlight(contents, x, y)
      if (hit) {
        propsRef.current.onHighlightTap(hit.hits, hit.rect)
        return
      }
      const frame = frameRef.current?.getBoundingClientRect()
      if (!frame) return
      const off = frameOffset(contents)
      const fx = (off.x + x - frame.left) / frame.width
      if (propsRef.current.tapZones && fx < 0.22) void turnRef.current(-1)
      else if (propsRef.current.tapZones && fx > 0.78) void turnRef.current(1)
      else propsRef.current.onToggleChrome()
    }

    const activateLink = (contents: Contents, a: HTMLAnchorElement) => {
      const href = (a.getAttribute('href') ?? '').trim()
      if (!href) return
      if (/^(https?:|mailto:)/i.test(href)) {
        window.open(href, '_blank', 'noopener,noreferrer')
        return
      }
      if (/^[a-z][a-z\d+.-]*:/i.test(href)) return 

      const type = `${a.getAttribute('epub:type') ?? ''} ${a.getAttributeNS('http://www.idpf.org/2007/ops', 'type') ?? ''} ${a.getAttribute('role') ?? ''}`
      const label = (a.textContent ?? '').trim()
      const looksLikeNote =
        /noteref/.test(type) || (!!a.closest('sup') && label.length <= 6) || /^\[?(\d{1,3}|[*†‡§¶]+|[ivx]{1,4})\]?$/i.test(label)
      const jump = () => {
        propsRef.current.onJump?.()
        void renditionRef.current?.display(resolveHref(contents, href))
      }
      if (looksLikeNote && href.includes('#') && propsRef.current.onFootnote) {
        void resolveNote(contents, href).then((note) => (note ? propsRef.current.onFootnote?.(note) : jump()))
        return
      }
      jump()
    }

    r.on('click', (e: MouseEvent, contents: Contents) => {
      if (Date.now() - suppressClick.current < 450) return
      const sel = contents.window.getSelection()
      if (sel && !sel.isCollapsed) return
      if ((e.target as Element | null)?.closest?.('a[href]')) return
      tapAt(contents, e.clientX, e.clientY)
    })

    r.on('touchstart', (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        touch.current = null
        return
      }
      touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() }
    })
    r.on('touchend', (e: TouchEvent, contents: Contents) => {
      const s = touch.current
      touch.current = null
      if (!s || styleRef.current.epub.flow !== 'paginated') return
      const t = e.changedTouches[0]
      const dx = t.clientX - s.x
      const dy = t.clientY - s.y
      if (Date.now() - s.t > 600 || Math.abs(dx) < 50 || Math.abs(dy) > Math.abs(dx) * 0.6) return
      const sel = contents.window.getSelection()
      if (sel && !sel.isCollapsed) return
      suppressClick.current = Date.now()
      void turnRef.current(dx < 0 ? 1 : -1)
    })

    r.on('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') void turnRef.current(1)
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') void turnRef.current(-1)
      else if (e.key === ' ' && styleRef.current.epub.flow === 'paginated') {
        e.preventDefault()
        void turnRef.current(e.shiftKey ? -1 : 1)
      }
    })

    const hlAnchor = initialAnchor?.type === 'epub' ? rangeStart(initialAnchor.cfi) : null
    const target = locationRef.current?.cfi ?? hlAnchor ?? initialState?.epub?.cfi

    const opening = !locationRef.current?.cfi && hlAnchor ? reveal(r, hlAnchor) : r.display(target || undefined)
    opening
      .catch(() => r.display())
      .then(() => {
        if (!readySent.current) {
          readySent.current = true
          holdSaveUntil.current = Date.now() + 700
          propsRef.current.onReady()
        }
        setRenditionVersion((v) => v + 1)
      })

    let cancelledGen = false
    if (!locationsReady.current) {
      const run = () => {
        if (cancelledGen) return
        book.locations
          .generate(1200)
          .then(() => {
            if (cancelledGen) return
            locationsReady.current = true
            void saveEpubLocations(propsRef.current.doc.id, book.locations.save())
            if (lastLocation.current) report(lastLocation.current)
          })
          .catch(() => {})
      }
      const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }
      if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 2500 })
      else setTimeout(run, 1200)
    }

    return () => {
      cancelledGen = true
      resizeCleanup.current?.()
      resizeCleanup.current = null
      renditionRef.current = null
      r.destroy()
    }
  }, [book, epub.flow, twoUp, frameSize.w > 0]) 

  const firstStyle = useRef(true)
  useEffect(() => {
    if (firstStyle.current) {
      firstStyle.current = false
      return
    }
    const r = renditionRef.current
    if (!r) return
    const css = buildEpubCss(epub, theme)
    const contentsList = r.getContents() as unknown as Contents[]
    for (const c of contentsList) {
      const el = c.document?.getElementById(STYLE_ID)
      if (el) el.textContent = css
    }

    const cfi = locationRef.current?.cfi
    const t = setTimeout(() => {
      if (cfi && renditionRef.current === r) void r.display(cfi).then(redrawHighlights)
      else redrawHighlights()
    }, 120)
    return () => clearTimeout(t)
  }, [epub.font, epub.fontSize, epub.lineHeight, epub.paragraphSpacing, epub.justify, epub.boldness, epub.wordSpacing, theme]) 

  const animating = useRef(false)
  const turn = useCallback(async (dir: 1 | -1) => {
    const r = renditionRef.current
    if (!r) return
    const go = () => (dir > 0 ? r.next() : r.prev())
    const host = hostRef.current
    const { epub: e, theme: th, pageTurn: style } = styleRef.current
    const loc = lastLocation.current
    if ((dir > 0 && loc?.atEnd) || (dir < 0 && loc?.atStart)) return
    if (e.flow !== 'paginated' || style === 'none' || th === 'eink' || useSettings.getState().settings.inkFilter.enabled || !host?.animate || animating.current) {
      await go()
      refreshMarks(r)
      repaintRef.current()
      return
    }
    animating.current = true

    const settle = (a: Animation, ms: number) => Promise.race([a.finished, new Promise((res) => setTimeout(res, ms))])
    try {
      const flip = style === 'flip'
      host.style.transformOrigin = dir > 0 ? 'left center' : 'right center'
      const out = host.animate(
        flip
          ? [
              { transform: 'rotateY(0deg)', opacity: 1, filter: 'brightness(1)' },
              { transform: `rotateY(${dir > 0 ? -32 : 32}deg) translateX(${-dir * 4}%)`, opacity: 0, filter: 'brightness(0.8)' },
            ]
          : [
              { transform: 'translateX(0)', opacity: 1 },
              { transform: `translateX(${-dir * 8}%)`, opacity: 0 },
            ],
        { duration: flip ? 230 : 170, easing: 'cubic-bezier(0.55, 0, 0.75, 0.3)', fill: 'forwards' },
      )
      await settle(out, 400)

      host.style.opacity = '0'
      out.cancel()
      await go()
      host.style.transformOrigin = dir > 0 ? 'right center' : 'left center'
      const inn = host.animate(
        flip
          ? [
              { transform: `rotateY(${dir > 0 ? 24 : -24}deg) translateX(${dir * 4}%)`, opacity: 0 },
              { transform: 'rotateY(0deg) translateX(0)', opacity: 1 },
            ]
          : [
              { transform: `translateX(${dir * 8}%)`, opacity: 0 },
              { transform: 'translateX(0)', opacity: 1 },
            ],
        { duration: flip ? 280 : 210, easing: 'cubic-bezier(0.22, 0.75, 0.25, 1)' },
      )
      host.style.opacity = ''
      await settle(inn, 500)
      refreshMarks(r)
      repaintRef.current()
      const settled = r.currentLocation() as unknown as Location
      if (settled?.start) reportRef.current(settled)
    } catch {

    } finally {
      host.style.opacity = ''
      animating.current = false
    }
  }, [])
  const turnRef = useRef(turn)
  const repaintRef = useRef(repaint)
  repaintRef.current = repaint
  const reportRef = useRef(report)
  reportRef.current = report
  turnRef.current = turn

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    setFrameSize({ w: host.clientWidth, h: host.clientHeight })
    let timer: ReturnType<typeof setTimeout> | null = null
    let last = { w: host.clientWidth, h: host.clientHeight }
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const w = host.clientWidth
        const h = host.clientHeight
        if (!w || !h || (w === last.w && h === last.h)) return
        last = { w, h }
        setFrameSize({ w, h })
        const r = renditionRef.current
        if (r) r.resize(w, h)
      }, 120)
    })
    ro.observe(host)
    return () => {
      ro.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [])

  const noteMarker = useSettings((st) => st.settings.noteMarker)
  useEffect(() => {
    repaint()
  }, [highlights, renditionVersion, theme, noteMarker, repaint])

  useImperativeHandle(
    ref,
    (): ReaderHandle => ({
      next: () => void turnRef.current(1),
      prev: () => void turnRef.current(-1),
      goToToc: (item) => void renditionRef.current?.display(String(item.target)),
      goToHighlight: (h) => {
        if (h.anchor.type === 'epub' && renditionRef.current) void reveal(renditionRef.current, h.anchor.cfi)
      },
      goToAnchor: (a) => {
        if (a.type === 'epub' && renditionRef.current) void reveal(renditionRef.current, a.cfi)
      },
      adjustAnchor: async (a, side, dir, byChar) => {
        if (a.type !== 'epub') return null
        const c = contentsFor(a.cfi)
        if (!c) return null
        try {
          suppressSel.current = Date.now() + 800
          const moved = adjustRange(c.window, c.range(a.cfi), side, dir, byChar)
          suppressSel.current = Date.now() + 400
          if (!moved) return null
          const info = anchorFromRange(c, moved)
          return info ? { anchor: info.anchor, text: info.text } : null
        } catch {
          return null
        }
      },
      spanAnchors: async (a, b) => {

        if (a.type !== 'epub' || b.type !== 'epub') return null
        const c = contentsFor(b.cfi)
        if (!c || !a.cfi.startsWith(`epubcfi(${c.cfiBase}!`)) return null
        try {
          const ra = c.range(a.cfi)
          const rb = c.range(b.cfi)
          const first = ra.compareBoundaryPoints(Range.START_TO_START, rb) <= 0 ? ra : rb
          const last = ra.compareBoundaryPoints(Range.END_TO_END, rb) >= 0 ? ra : rb
          const u = c.document.createRange()
          u.setStart(first.startContainer, first.startOffset)
          u.setEnd(last.endContainer, last.endOffset)
          const info = anchorFromRange(c, u)
          return info ? { anchor: info.anchor, text: info.text, order: info.order } : null
        } catch {
          return null
        }
      },
      unionAnchor: (anchors) => {
        const list = anchors.filter((a): a is Extract<Anchor, { type: 'epub' }> => a.type === 'epub')
        const r = renditionRef.current
        if (list.length < 2 || !r) return null
        let contents: Contents | null = null
        try {
          ;(r as unknown as { views: () => { forEach: (fn: (v: { contents?: Contents }) => void) => void } }).views().forEach((v) => {
            if (v.contents && list[0].cfi.startsWith(`epubcfi(${v.contents.cfiBase}!`)) contents = v.contents
          })
        } catch {
          return null
        }
        const c = contents as Contents | null
        if (!c) return null
        try {
          const ranges = list.map((a) => c.range(a.cfi)).filter(Boolean)
          if (ranges.length < 2) return null
          const first = ranges.reduce((m, x) => (x.compareBoundaryPoints(Range.START_TO_START, m) < 0 ? x : m))
          const last = ranges.reduce((m, x) => (x.compareBoundaryPoints(Range.END_TO_END, m) > 0 ? x : m))
          const u = c.document.createRange()
          u.setStart(first.startContainer, first.startOffset)
          u.setEnd(last.endContainer, last.endOffset)
          const text = u.toString().replace(/\s+/g, ' ').trim()
          const startA = list[ranges.indexOf(first)] ?? list[0]
          const endA = list[ranges.indexOf(last)] ?? list[list.length - 1]
          return { anchor: { ...startA, cfi: c.cfiFromRange(u), quote: { exact: text, prefix: startA.quote.prefix, suffix: endA.quote.suffix } }, text }
        } catch {
          return null
        }
      },
      getLocation: () => {
        const l = locationRef.current
        return l ? { type: 'epub', cfi: l.cfi, href: l.href, chapter: l.chapter, quote: { exact: '' } } : null
      },
      goToProgress: (p) => {
        const r = renditionRef.current
        if (!r || !book) return
        if (locationsReady.current) {
          const cfi = book.locations.cfiFromPercentage(Math.min(0.9999, Math.max(0, p)))
          if (cfi) return void r.display(cfi)
        }
        const items = spineItems(book)
        const idx = Math.min(items.length - 1, Math.max(0, Math.floor(p * items.length)))
        if (items[idx]) void r.display(items[idx].href)
      },
      search: async (query, onResults, signal) => {
        const q = query.trim()
        if (!q || !book) return onResults([])
        const results: SearchResult[] = []
        for (const item of spineItems(book)) {
          if (signal.aborted) return
          if ((item as unknown as { linear?: boolean }).linear === false) continue
          try {
            await item.load(book.load.bind(book))
            const found = item.find(q) as unknown as { cfi: string; excerpt: string }[]
            const chapter = chapterFor(item.index)
            for (const f of found.slice(0, 100)) {
              results.push({ id: f.cfi, where: chapter, excerpt: f.excerpt, target: f.cfi })
            }
          } catch {

          } finally {
            item.unload()
          }
          if (results.length >= 1000) break
          onResults([...results])
        }
        if (!signal.aborted) onResults([...results])
      },
      goToSearchResult: (res) => {
        const r = renditionRef.current
        if (!r) return
        const cfi = String(res.target)
        if (searchMark.current) r.annotations.remove(searchMark.current, 'highlight')
        searchMark.current = cfi
        void reveal(r, cfi).then(() => {
          try {
            r.annotations.highlight(cfi, {}, undefined, 'pi-search', { fill: '#ea580c', 'fill-opacity': '0.35', 'mix-blend-mode': 'multiply' })
          } catch {

          }
        })
      },
      isAnchorVisible: (a) => {
        const loc = lastLocation.current
        if (a.type !== 'epub' || !loc?.start || !loc.end) return false
        try {
          const c = new EpubCFI()
          return c.compare(loc.start.cfi, a.cfi) <= 0 && c.compare(a.cfi, loc.end.cfi) <= 0
        } catch {
          return false
        }
      },
      progressOf: (a) => {
        if (a.type !== 'epub' || !book) return null
        try {
          if (locationsReady.current) return book.locations.percentageFromCfi(a.cfi)
          const spinePos = new EpubCFI(a.cfi).spinePos
          return spinePos / (spineItems(book).length || 1)
        } catch {
          return null
        }
      },
      getVisibleText: async () => {
        const r = renditionRef.current
        const frame = hostRef.current?.getBoundingClientRect()
        if (!r || !frame) return ''
        const parts: string[] = []
        for (const c of r.getContents() as unknown as Contents[]) {
          const iframe = c.window?.frameElement as HTMLElement | null
          const off = iframe?.getBoundingClientRect()
          if (!off || !c.document?.body) continue
          const walker = c.document.createTreeWalker(c.document.body, NodeFilter.SHOW_TEXT)
          const range = c.document.createRange()
          let node: Node | null
          while ((node = walker.nextNode())) {
            if (!node.textContent?.trim()) continue
            range.selectNodeContents(node)
            const rects = Array.from(range.getClientRects())
            const visible = rects.some((q) => {
              const x = off.left + q.left + q.width / 2
              const y = off.top + q.top + q.height / 2
              return x >= frame.left && x <= frame.right && y >= frame.top && y <= frame.bottom
            })
            if (visible) parts.push(node.textContent)
          }
        }
        return parts.join(' ').replace(/\s+/g, ' ').trim()
      },
      getLanguage: () => {
        const md = (book as unknown as { packaging?: { metadata?: { language?: string } } } | null)?.packaging?.metadata
        return md?.language || null
      },
      goToHref: (href) => void renditionRef.current?.display(href),
      clearSearch: () => {
        const r = renditionRef.current
        if (r && searchMark.current) r.annotations.remove(searchMark.current, 'highlight')
        searchMark.current = null
      },
      clearSelection: () => {
        const r = renditionRef.current
        if (!r) return
        for (const c of r.getContents() as unknown as Contents[]) c.window?.getSelection()?.removeAllRanges()
      },
    }),
    [book, chapterFor],
  )

  const scrolled = epub.flow === 'scrolled'
  return (
    <div
      ref={frameRef}
      className="epub-turn-frame absolute inset-0 flex flex-col bg-page"
      style={{
        paddingLeft: `max(var(--safe-left), min(${epub.margin}px, 7vw))`,
        paddingRight: `max(var(--safe-right), min(${epub.margin}px, 7vw))`,
        paddingTop: scrolled ? 'var(--safe-top)' : 'calc(var(--safe-top) + 36px)',
        paddingBottom: scrolled ? 0 : 'calc(var(--safe-bottom) + 40px)',
      }}
    >
      <div ref={hostRef} className="relative min-h-0 flex-1" />
    </div>
  )
})

export default EpubReader
