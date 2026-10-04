import { getStroke } from 'perfect-freehand'
import { db } from './db'
import type { InkSize, InkToolName } from '@/store/settings'
import type { InkPage, InkStroke } from '@/types'

export const INK_REFERENCE_WIDTH = 612

export const PEN_COLORS = ['#1f1f1f', '#1d4ed8', '#dc2626', '#15803d', '#c2410c']
export const HIGHLIGHTER_COLORS = ['#facc15', '#4ade80', '#60a5fa', '#f472b6']

const SIZES: Record<'pen' | 'highlighter', Record<InkSize, number>> = {
  pen: { fine: 1.2, medium: 2, bold: 3.4 },
  highlighter: { fine: 8, medium: 12, bold: 18 },
}

export function inkSize(tool: 'pen' | 'highlighter', size: InkSize, surfaceWidth: number) {
  return SIZES[tool][size] * (surfaceWidth / INK_REFERENCE_WIDTH)
}

export const ERASER_RADIUS = 6

export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

let penSeen = false
export const markPenSeen = () => {
  penSeen = true
}
export const wasPenSeen = () => penSeen

let penPanConflict = false
export const markPenPanConflict = () => {
  penPanConflict = true
}
export const hasPenPanConflict = () => penPanConflict

const pathCache = new WeakMap<InkStroke, string>()

function svgPathFromOutline(outline: number[][]) {
  if (!outline.length) return ''
  const d = outline.reduce<(string | number)[]>(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]
      acc.push(x0.toFixed(2), y0.toFixed(2), ((x0 + x1) / 2).toFixed(2), ((y0 + y1) / 2).toFixed(2))
      return acc
    },
    ['M', outline[0][0].toFixed(2), outline[0][1].toFixed(2), 'Q'],
  )
  d.push('Z')
  return d.join(' ')
}

function toTriples(points: number[]) {
  const out: [number, number, number][] = []
  for (let i = 0; i + 2 < points.length; i += 3) out.push([points[i], points[i + 1], points[i + 2]])
  return out
}

function hasPressure(points: number[]) {
  for (let i = 2; i < points.length; i += 3) if (points[i] !== 0.5) return true
  return false
}

export function strokeOutlinePath(stroke: Pick<InkStroke, 'tool' | 'size' | 'points'>, last = true) {
  const pts = toTriples(stroke.points)
  if (stroke.tool === 'highlighter') {
    return svgPathFromOutline(
      getStroke(pts, { size: stroke.size, thinning: 0, smoothing: 0.6, streamline: 0.5, simulatePressure: false, last, start: { cap: false }, end: { cap: false } }),
    )
  }
  return svgPathFromOutline(
    getStroke(pts, {
      size: stroke.size * 1.6,
      thinning: 0.6,
      smoothing: 0.55,
      streamline: 0.45,
      simulatePressure: !hasPressure(stroke.points),
      last,
    }),
  )
}

export function strokePath(stroke: InkStroke) {
  let d = pathCache.get(stroke)
  if (d === undefined) {
    d = strokeOutlinePath(stroke)
    pathCache.set(stroke, d)
  }
  return d
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

export function strokeHit(stroke: InkStroke, x: number, y: number, radius: number) {
  const p = stroke.points
  const r = radius + stroke.size / 2
  if (p.length < 6) return p.length >= 2 && Math.hypot(p[0] - x, p[1] - y) <= r
  for (let i = 0; i + 5 < p.length; i += 3) {
    if (distToSegment(x, y, p[i], p[i + 1], p[i + 3], p[i + 4]) <= r) return true
  }
  return false
}

export function strokesBBox(strokes: InkStroke[]) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const s of strokes) {
    const pad = s.size
    for (let i = 0; i + 1 < s.points.length; i += 3) {
      minX = Math.min(minX, s.points[i] - pad)
      maxX = Math.max(maxX, s.points[i] + pad)
      minY = Math.min(minY, s.points[i + 1] - pad)
      maxY = Math.max(maxY, s.points[i + 1] + pad)
    }
  }
  if (!Number.isFinite(minX)) return null
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
}

export function inkColorFor(tool: InkToolName, penColor: string, highlighterColor: string) {
  return tool === 'highlighter' ? highlighterColor : penColor
}

export const inkPageId = (docId: string, page: number) => `${docId}|${page}`

export async function loadDocInk(docId: string) {
  const pages = await db.inks.where('docId').equals(docId).toArray()
  return new Map(pages.map((p) => [p.page, p.strokes]))
}

export async function writePageInk(docId: string, page: number, strokes: InkStroke[]) {
  const id = inkPageId(docId, page)
  if (!strokes.length) {
    await db.inks.delete(id)
    return
  }
  const rec: InkPage = { id, docId, page, strokes, updatedAt: Date.now() }
  await db.inks.put(rec)
}
