import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist'
import type { TextContent } from 'pdfjs-dist/types/src/display/api'
import { pdfjsLib } from '@/lib/pdf/pdfjs'
import { hlFill, hlSolid } from '@/lib/annotations'
import { isCoarsePointer } from '@/lib/utils'
import type { Highlight, InkStroke, NormBox, NormRect } from '@/types'
import { useSettings, type InkSize, type InkToolName } from '@/store/settings'
import { InkCanvas } from '@/components/ink/InkCanvas'

export interface PageHighlight {
  h: Highlight
  rects: NormRect[]
}

interface LinkInfo {
  id: string
  x: number
  y: number
  w: number
  h: number
  url?: string
  dest?: unknown
}

interface Props {
  
  offscreen?: boolean
  
  crop?: NormBox | null
  pageNumber: number
  scale: number
  left: number
  top: number
  width: number
  height: number
  render: boolean
  getPage: (n: number) => Promise<PDFPageProxy>
  getText: (n: number) => Promise<TextContent>
  highlights: PageHighlight[] | undefined
  searchTerm: string | null
  
  searchFocus: { seq: number; index: number } | null
  onInternalLink: (dest: unknown) => void
  
  baseWidth: number
  baseHeight: number
  inkActive: boolean
  inkTool: InkToolName
  inkColor: string
  inkSize: InkSize
  fingersDraw: boolean
  inkStrokes: InkStroke[] | undefined
  onInkAdd: (page: number, s: InkStroke) => void
  onInkErase: (page: number, ids: string[]) => void
  onFingerPan: (dx: number, dy: number) => void
}

const NO_STROKES: InkStroke[] = []

const SAFE_URL = /^(https?:|mailto:)/i

function releaseCanvas(c: HTMLCanvasElement) {
  
  c.width = 0
  c.height = 0
}

function applySearchMarks(container: HTMLElement, term: string | null) {
  container.querySelectorAll('mark.pdf-search-hit').forEach((m) => {
    const parent = m.parentNode
    if (!parent) return
    parent.replaceChild(document.createTextNode(m.textContent ?? ''), m)
    parent.normalize()
  })
  if (!term) return [] as HTMLElement[]
  const needle = term.toLowerCase()
  const marks: HTMLElement[] = []
  container.querySelectorAll<HTMLSpanElement>('span[role="presentation"], span:not([class])').forEach((span) => {
    if (span.children.length) return
    const text = span.textContent ?? ''
    const lower = text.toLowerCase()
    let idx = lower.indexOf(needle)
    if (idx === -1) return
    const frag = document.createDocumentFragment()
    let last = 0
    while (idx !== -1) {
      if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)))
      const mark = document.createElement('mark')
      mark.className = 'pdf-search-hit'
      mark.textContent = text.slice(idx, idx + needle.length)
      frag.appendChild(mark)
      marks.push(mark)
      last = idx + needle.length
      idx = lower.indexOf(needle, last)
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)))
    span.replaceChildren(frag)
  })
  return marks
}


function PdfHighlights({ highlights }: { highlights: PageHighlight[] }) {
  const noteMarker = useSettings((st) => st.settings.noteMarker)
  const pct = (v: number) => `${v * 100}%`
  return (
    <div className="pdf-hl-layer" aria-hidden>
      {highlights.flatMap(({ h, rects }) => {
        const drawer = h.drawer ?? 'lighten'
        const solid = hlSolid(h.color)
        const els = rects.map((r, i) => {
          const base = { left: pct(r.x), width: pct(r.w), pointerEvents: 'none' as const }
          const style: React.CSSProperties =
            drawer === 'underscore'
              ? { ...base, top: `calc(${pct(r.y + r.h)} - 2px)`, height: 2, background: solid }
              : drawer === 'strikeout'
                ? { ...base, top: `calc(${pct(r.y + r.h / 2)} - 1px)`, height: 2, background: solid }
                : drawer === 'invert'
                  ? { ...base, top: pct(r.y), height: pct(r.h), background: '#fff', mixBlendMode: 'difference' }
                  : { ...base, top: pct(r.y), height: pct(r.h), background: hlFill(h.color) }
          return <div key={`${h.id}-${i}`} className={drawer === 'lighten' ? 'pdf-hl' : 'pdf-hl-line'} data-hl={h.id} style={style} />
        })
        if (h.hasNote && noteMarker !== 'none') {
          rects.forEach((r, i) => {
            if (noteMarker === 'underline') {
              els.push(<div key={`${h.id}-n${i}`} className="pdf-note-marker" style={{ left: pct(r.x), width: pct(r.w), top: pct(r.y + r.h), borderBottom: '2px dotted currentColor' }} />)
            } else if (noteMarker === 'sideline') {
              els.push(<div key={`${h.id}-n${i}`} className="pdf-note-marker" style={{ left: '2.5%', width: 3, top: pct(r.y), height: pct(r.h), background: solid }} />)
            } else if (i === 0) {
              els.push(
                <div key={`${h.id}-n`} className="pdf-note-marker pdf-note-sign" style={{ left: '1.2%', top: `calc(${pct(r.y + r.h / 2)} - 0.6em)` }}>
                  ✎
                </div>,
              )
            }
          })
        }
        return els
      })}
    </div>
  )
}

export const PdfPage = memo(function PdfPage({
  offscreen,
  crop,
  pageNumber,
  scale,
  left,
  top,
  width,
  height,
  render,
  getPage,
  getText,
  highlights,
  searchTerm,
  searchFocus,
  onInternalLink,
  baseWidth,
  baseHeight,
  inkActive,
  inkTool,
  inkColor,
  inkSize,
  fingersDraw,
  inkStrokes,
  onInkAdd,
  onInkErase,
  onFingerPan,
}: Props) {
  const addInk = useCallback((st: InkStroke) => onInkAdd(pageNumber, st), [onInkAdd, pageNumber])
  const eraseInk = useCallback((ids: string[]) => onInkErase(pageNumber, ids), [onInkErase, pageNumber])
  const canvasHost = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [textVersion, setTextVersion] = useState(0)
  const [links, setLinks] = useState<LinkInfo[]>([])

  
  useEffect(() => {
    const host = canvasHost.current
    if (!render || !host) return
    let cancelled = false
    let task: RenderTask | null = null
    let canvas: HTMLCanvasElement | null = null
    ;(async () => {
      const page = await getPage(pageNumber)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const dpr = window.devicePixelRatio || 1
      const maxPixels = isCoarsePointer() ? 9_000_000 : 16_000_000
      const area = viewport.width * viewport.height
      const outputScale = Math.min(dpr, Math.sqrt(maxPixels / Math.max(1, area)))
      canvas = document.createElement('canvas')
      canvas.className = 'pdf-canvas'
      canvas.width = Math.max(1, Math.floor(viewport.width * outputScale))
      canvas.height = Math.max(1, Math.floor(viewport.height * outputScale))
      task = page.render({
        canvas,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      })
      await task.promise
      if (cancelled) return
      host.querySelectorAll('canvas').forEach(releaseCanvas)
      host.replaceChildren(canvas)
      canvas = null
    })().catch((err: unknown) => {
      if ((err as { name?: string })?.name !== 'RenderingCancelledException') console.warn('PDF page render failed', err)
    })
    return () => {
      cancelled = true
      task?.cancel()
      if (canvas) releaseCanvas(canvas)
    }
  }, [render, scale, pageNumber, getPage])

  
  useEffect(() => {
    if (render) return
    const host = canvasHost.current
    host?.querySelectorAll('canvas').forEach(releaseCanvas)
    host?.replaceChildren()
    textRef.current?.replaceChildren()
  }, [render])

  
  useEffect(() => {
    const container = textRef.current
    if (!render || !container) return
    let cancelled = false
    let layer: InstanceType<typeof pdfjsLib.TextLayer> | null = null
    ;(async () => {
      const [page, text] = await Promise.all([getPage(pageNumber), getText(pageNumber)])
      if (cancelled) return
      container.replaceChildren()
      
      if (!text.items.length) return
      const viewport = page.getViewport({ scale })
      layer = new pdfjsLib.TextLayer({ textContentSource: text, container, viewport })
      await layer.render()
      if (cancelled) return
      const end = document.createElement('div')
      end.className = 'endOfContent'
      container.appendChild(end)
      setTextVersion((v) => v + 1)
    })().catch((err) => {
      if (!cancelled) console.warn('Text layer failed', err)
    })
    return () => {
      cancelled = true
      layer?.cancel()
    }
  }, [render, scale, pageNumber, getPage, getText])

  
  useEffect(() => {
    const container = textRef.current
    if (!container) return
    const down = () => container.classList.add('selecting')
    const up = () => container.classList.remove('selecting')
    container.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      container.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [])

  
  const focusedSeq = useRef(-1)
  useEffect(() => {
    const container = textRef.current
    if (!container || !render || textVersion === 0) return
    const marks = applySearchMarks(container, searchTerm)
    if (searchFocus && focusedSeq.current !== searchFocus.seq && marks.length) {
      focusedSeq.current = searchFocus.seq
      const target = marks[Math.min(searchFocus.index, marks.length - 1)]
      target.scrollIntoView({ block: 'center', inline: 'nearest' })
    }
  }, [searchTerm, searchFocus, textVersion, render])

  
  useEffect(() => {
    if (!render) return
    let cancelled = false
    ;(async () => {
      const page = await getPage(pageNumber)
      const annots = await page.getAnnotations({ intent: 'display' })
      if (cancelled) return
      const vp = page.getViewport({ scale: 1 })
      const out: LinkInfo[] = []
      for (const a of annots as Array<Record<string, unknown>>) {
        if (a.subtype !== 'Link' || !Array.isArray(a.rect)) continue
        const url = typeof a.url === 'string' && SAFE_URL.test(a.url) ? a.url : undefined
        const dest = a.dest
        if (!url && !dest) continue
        const [rx1, ry1, rx2, ry2] = a.rect as number[]
        const [x1, y1] = vp.convertToViewportPoint(rx1, ry1) as number[]
        const [x2, y2] = vp.convertToViewportPoint(rx2, ry2) as number[]
        out.push({
          id: String(a.id ?? out.length),
          x: Math.min(x1, x2) / vp.width,
          y: Math.min(y1, y2) / vp.height,
          w: Math.abs(x2 - x1) / vp.width,
          h: Math.abs(y2 - y1) / vp.height,
          url,
          dest,
        })
      }
      setLinks(out)
    })().catch(() => setLinks([]))
    return () => {
      cancelled = true
    }
  }, [render, pageNumber, getPage])

  return (
    <div
      className="pdf-page"
      data-page={pageNumber}
      data-rendered={render && !offscreen ? '' : undefined}
      data-offscreen={offscreen ? '' : undefined}
      aria-hidden={offscreen || undefined}
      style={
        {
          position: 'absolute',
          visibility: offscreen ? 'hidden' : undefined,
          left,
          top,
          width,
          height,
          '--total-scale-factor': scale,
          overflow: crop ? 'hidden' : undefined,
        } as React.CSSProperties
      }
    >
      {}
      <div
        className="pdf-page-inner absolute"
        style={
          crop
            ? { left: (-crop.x * width) / crop.w, top: (-crop.y * height) / crop.h, width: width / crop.w, height: height / crop.h }
            : { inset: 0 }
        }
      >
      <div ref={canvasHost} className="absolute inset-0" />
      <div className="pdf-tint" />
      {highlights && highlights.length > 0 && <PdfHighlights highlights={highlights} />}
      <div ref={textRef} className="textLayer" />
      {render && (inkActive || (inkStrokes && inkStrokes.length > 0)) && (
        <InkCanvas
          width={baseWidth}
          height={baseHeight}
          strokes={inkStrokes ?? NO_STROKES}
          active={inkActive}
          tool={inkTool}
          color={inkColor}
          size={inkSize}
          fingersDraw={fingersDraw}
          onAdd={addInk}
          onErase={eraseInk}
          onFingerPan={onFingerPan}
        />
      )}
      {render && links.length > 0 && (
        <div className="pdf-link-layer">
          {links.map((l) =>
            l.url ? (
              <a
                key={l.id}
                href={l.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                title={l.url}
                style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%`, height: `${l.h * 100}%` }}
              />
            ) : (
              <a
                key={l.id}
                role="link"
                tabIndex={0}
                aria-label="Go to linked location"
                data-internal-link=""
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onInternalLink(l.dest)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onInternalLink(l.dest)
                }}
                style={{
                  left: `${l.x * 100}%`,
                  top: `${l.y * 100}%`,
                  width: `${l.w * 100}%`,
                  height: `${l.h * 100}%`,
                  cursor: 'pointer',
                }}
              />
            ),
          )}
        </div>
      )}
      </div>
    </div>
  )
})
