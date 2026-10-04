import type { Contents } from 'epubjs'
import { hlRgba } from '@/lib/annotations'
import type { Highlight, NoteMarker } from '@/types'

export interface VisibleBox {
  id: string
  left: number
  top: number
  width: number
  height: number
}

interface ViewLike {
  element?: HTMLElement
  iframe?: HTMLIFrameElement
  contents?: Contents
}

export interface PaintOptions {
  theme: string
  noteMarker: NoteMarker

  layout: { delta: number; gap: number } | null
}

const LAYER = 'pi-ann'
const NS = 'pi-ann-box'

function lineBoxes(rects: DOMRect[]) {
  const lines: { left: number; right: number; top: number; bottom: number }[] = []
  for (const r of rects) {
    if (r.width < 0.5 || r.height < 0.5) continue
    const mid = (r.top + r.bottom) / 2
    const line = lines.find((l) => mid > l.top && mid < l.bottom && r.left <= l.right + 4 && r.right >= l.left - 4)
    if (line) {
      line.left = Math.min(line.left, r.left)
      line.right = Math.max(line.right, r.right)
      line.top = Math.min(line.top, r.top)
      line.bottom = Math.max(line.bottom, r.bottom)
    } else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })
  }
  return lines
}

function box(layer: HTMLElement, css: Partial<CSSStyleDeclaration>, id = '', kind = 'hl') {
  const d = layer.ownerDocument.createElement('div')
  d.className = NS
  d.dataset.hl = id
  d.dataset.kind = kind
  Object.assign(d.style, { position: 'absolute', pointerEvents: 'none' }, css)
  layer.appendChild(d)
  return d
}

export function paintView(view: ViewLike, highlights: Highlight[], opts: PaintOptions): VisibleBox[] {
  const { element, iframe, contents } = view
  if (!element || !iframe || !contents?.document) return []
  let layer = element.querySelector<HTMLElement>(`:scope > .${LAYER}`)
  if (!layer) {
    if (getComputedStyle(element).position === 'static') element.style.position = 'relative'
    layer = element.ownerDocument.createElement('div')
    layer.className = LAYER
    Object.assign(layer.style, { position: 'absolute', pointerEvents: 'none', zIndex: '2', overflow: 'visible' })
    element.appendChild(layer)
  }

  Object.assign(layer.style, {
    left: `${iframe.offsetLeft}px`,
    top: `${iframe.offsetTop}px`,
    width: `${iframe.offsetWidth}px`,
    height: `${iframe.offsetHeight}px`,
  })
  layer.replaceChildren()

  const base = `epubcfi(${contents.cfiBase}!`
  const dark = opts.theme === 'dark'
  const out: VisibleBox[] = []

  for (const h of highlights) {
    if (h.anchor.type !== 'epub' || !h.anchor.cfi.startsWith(base)) continue
    let rects: DOMRect[]
    try {
      rects = Array.from(contents.range(h.anchor.cfi)?.getClientRects() ?? [])
    } catch {
      continue
    }
    const lines = lineBoxes(rects)
    if (!lines.length) continue
    const solid = hlRgba(h.color, opts.theme)
    const drawer = h.drawer ?? 'lighten'
    lines.forEach((l, i) => {

      const left = l.left
      const top = l.top
      const width = l.right - l.left
      const height = l.bottom - l.top
      out.push({ id: h.id, left, top, width, height })
      switch (drawer) {
        case 'lighten':
          box(layer!, {
            left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`,
            background: solid, opacity: opts.theme === 'eink' ? '0.18' : dark ? '0.32' : '0.38',
            mixBlendMode: dark ? 'screen' : 'multiply',
          }, h.id, 'lighten')
          break
        case 'underscore':
          box(layer!, { left: `${left}px`, top: `${top + height - 2}px`, width: `${width}px`, height: '2px', background: solid }, h.id, 'underscore')
          break
        case 'strikeout':
          box(layer!, { left: `${left}px`, top: `${top + height / 2 - 1}px`, width: `${width}px`, height: '2px', background: solid }, h.id, 'strikeout')
          break
        case 'invert':
          box(layer!, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px`, background: '#fff', mixBlendMode: 'difference' }, h.id, 'invert')
          break
      }
      if (!h.hasNote || opts.noteMarker === 'none') return
      const ink = dark ? '#d6d0c4' : '#2b2620'
      if (opts.noteMarker === 'underline') {

        box(layer!, { left: `${left}px`, top: `${top + height}px`, width: `${width}px`, height: '0', borderBottom: `2px dotted ${ink}` }, h.id, 'note-underline')
        return
      }

      if (opts.noteMarker === 'sidemark' && i > 0) return
      const margin = marginX(left, contents, opts)
      if (opts.noteMarker === 'sideline') {
        box(layer!, { left: `${margin - 1.5}px`, top: `${top}px`, width: '3px', height: `${height}px`, background: solid, opacity: '0.9' }, h.id, 'note-sideline')
      } else {
        const m = box(layer!, {
          left: `${margin - 7}px`, top: `${top + height / 2 - 7}px`, width: '14px', height: '14px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          font: '600 11px/1 system-ui, sans-serif', color: ink,
        }, h.id, 'note-sidemark')
        m.textContent = '✎'
      }
    })
  }
  return out
}

function marginX(x: number, contents: Contents, opts: PaintOptions) {
  if (opts.layout && opts.layout.delta > 0) {
    const col = Math.floor(x / opts.layout.delta) * opts.layout.delta
    return col + Math.max(6, opts.layout.gap / 4)
  }
  const body = contents.document.body
  const pad = parseFloat(getComputedStyle(body).paddingLeft) || 16
  return body.getBoundingClientRect().left + Math.max(6, pad / 2)
}

export function hitBoxes(boxes: VisibleBox[], x: number, y: number, slop = 3): string[] {
  const ids: string[] = []
  for (const b of boxes) {
    if (x >= b.left - slop && x <= b.left + b.width + slop && y >= b.top - slop && y <= b.top + b.height + slop && !ids.includes(b.id)) ids.push(b.id)
  }
  return ids
}
