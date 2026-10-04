import { memo, useEffect, useReducer, useRef } from 'react'
import { ERASER_RADIUS, hasPenPanConflict, inkSize, isIOS, markPenPanConflict, markPenSeen, strokeHit, strokeOutlinePath, strokePath } from '@/lib/ink'
import { cn, uid } from '@/lib/utils'
import type { InkSize, InkToolName } from '@/store/settings'
import type { InkStroke } from '@/types'

export interface InkCanvasProps {

  width: number
  height: number
  strokes: InkStroke[]

  active: boolean
  tool: InkToolName
  color: string
  size: InkSize

  fingersDraw: boolean
  onAdd: (stroke: InkStroke) => void
  onErase: (ids: string[]) => void

  onFingerPan?: (dx: number, dy: number) => void
  className?: string
}

function capture(el: Element, pointerId: number) {
  try {
    el.setPointerCapture(pointerId)
  } catch {

  }
}

interface Drawing {
  pointerId: number
  erasing: boolean
  tool: 'pen' | 'highlighter'
  color: string
  size: number
  points: number[]
}

export const InkCanvas = memo(function InkCanvas({
  width,
  height,
  strokes,
  active,
  tool,
  color,
  size,
  fingersDraw,
  onAdd,
  onErase,
  onFingerPan,
  className,
}: InkCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const liveRef = useRef<SVGPathElement>(null)
  const drawing = useRef<Drawing | null>(null)
  const strokesRef = useRef(strokes)
  strokesRef.current = strokes
  const erased = useRef(new Set<string>())
  const pan = useRef<{ id: number; x: number; y: number; t: number; vx: number; vy: number } | null>(null)
  const touches = useRef(new Set<number>())
  const momentum = useRef(0)
  const [, rerender] = useReducer((x: number) => x + 1, 0)

  const nativeFingerPan = active && !fingersDraw && isIOS() && !hasPenPanConflict()
  const touchAction = !active ? undefined : nativeFingerPan ? 'pan-x pan-y' : 'none'

  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !active) return
    const stopStylus = (e: TouchEvent) => {
      const list = Array.from(e.changedTouches) as (Touch & { touchType?: string })[]
      if (list.some((t) => t.touchType === 'stylus')) e.preventDefault()
    }
    svg.addEventListener('touchstart', stopStylus, { passive: false })
    svg.addEventListener('touchmove', stopStylus, { passive: false })
    return () => {
      svg.removeEventListener('touchstart', stopStylus)
      svg.removeEventListener('touchmove', stopStylus)
    }
  }, [active])

  useEffect(() => () => cancelAnimationFrame(momentum.current), [])

  const toLocal = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * width, y: ((e.clientY - r.top) / r.height) * height }
  }

  const renderLive = () => {
    const d = drawing.current
    const path = liveRef.current
    if (!d || !path || d.erasing) return
    path.setAttribute('d', strokeOutlinePath({ tool: d.tool, size: d.size, points: d.points }, false))
  }

  const eraseAt = (x: number, y: number) => {
    const r = ERASER_RADIUS * (width / 612)
    const hits = strokesRef.current.filter((s) => !erased.current.has(s.id) && strokeHit(s, x, y, r)).map((s) => s.id)
    if (hits.length) {
      hits.forEach((id) => erased.current.add(id))
      onErase(hits)
    }
  }

  const addPoints = (e: PointerEvent) => {
    const d = drawing.current
    if (!d) return
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : []
    for (const ev of events.length ? events : [e]) {
      const { x, y } = toLocal(ev)
      if (d.erasing) eraseAt(x, y)
      else {
        const pressure = ev.pointerType === 'pen' ? ev.pressure || 0.5 : 0.5
        d.points.push(Math.round(x * 10) / 10, Math.round(y * 10) / 10, Math.round(pressure * 100) / 100)
      }
    }
    renderLive()
  }

  const finish = () => {
    const d = drawing.current
    drawing.current = null
    erased.current.clear()
    liveRef.current?.setAttribute('d', '')
    if (!d || d.erasing || d.points.length < 3) return
    onAdd({ id: uid('s'), tool: d.tool, color: d.color, size: d.size, points: d.points })
  }

  const startMomentum = (vx: number, vy: number) => {
    cancelAnimationFrame(momentum.current)
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(48, now - last)
      last = now
      vx *= Math.pow(0.95, dt / 16)
      vy *= Math.pow(0.95, dt / 16)
      if (Math.hypot(vx, vy) < 0.02) return
      onFingerPan?.(vx * dt, vy * dt)
      momentum.current = requestAnimationFrame(step)
    }
    momentum.current = requestAnimationFrame(step)
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('ink-layer absolute inset-0 h-full w-full overflow-visible', active && 'ink-layer-active', className)}
      style={{ pointerEvents: active ? 'auto' : 'none', touchAction }}
      onPointerDown={(e) => {
        if (!active) return
        if (e.pointerType === 'touch') touches.current.add(e.pointerId)
        if (e.pointerType === 'pen') markPenSeen()
        const draws = e.pointerType !== 'touch' || fingersDraw
        cancelAnimationFrame(momentum.current)
        if (!draws) {

          if (!nativeFingerPan && onFingerPan && touches.current.size === 1) {
            pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), vx: 0, vy: 0 }
            capture(e.currentTarget, e.pointerId)
          } else pan.current = null
          return
        }
        if (drawing.current || (e.pointerType === 'mouse' && e.button !== 0)) return
        e.preventDefault()
        e.stopPropagation()
        capture(e.currentTarget, e.pointerId)
        const t = tool === 'highlighter' ? 'highlighter' : 'pen'
        drawing.current = {
          pointerId: e.pointerId,

          erasing: tool === 'eraser' || (e.buttons & 32) !== 0,
          tool: t,
          color,
          size: inkSize(t, size, width),
          points: [],
        }
        if (liveRef.current) {
          liveRef.current.setAttribute('fill', color)
          liveRef.current.setAttribute('opacity', t === 'highlighter' ? '0.38' : '1')
        }
        addPoints(e.nativeEvent)
      }}
      onPointerMove={(e) => {
        if (drawing.current?.pointerId === e.pointerId) {
          e.preventDefault()
          addPoints(e.nativeEvent)
          return
        }
        const p = pan.current
        if (p && p.id === e.pointerId) {
          if (touches.current.size > 1) {
            pan.current = null
            return
          }
          const now = performance.now()
          const dx = e.clientX - p.x
          const dy = e.clientY - p.y
          const dt = Math.max(1, now - p.t)
          p.vx = -dx / dt
          p.vy = -dy / dt
          p.x = e.clientX
          p.y = e.clientY
          p.t = now
          onFingerPan?.(-dx, -dy)
        }
      }}
      onPointerUp={(e) => {
        touches.current.delete(e.pointerId)
        if (drawing.current?.pointerId === e.pointerId) finish()
        const p = pan.current
        if (p && p.id === e.pointerId) {
          pan.current = null
          if (performance.now() - p.t < 80) startMomentum(p.vx, p.vy)
        }
      }}
      onPointerCancel={(e) => {
        touches.current.delete(e.pointerId)
        if (drawing.current?.pointerId === e.pointerId) {
          if (e.pointerType === 'pen' && nativeFingerPan) {

            markPenPanConflict()
            rerender()
          }
          finish()
        }
        if (pan.current?.id === e.pointerId) pan.current = null
      }}
      onClick={(e) => {

        if (active) e.stopPropagation()
      }}
    >
      {strokes.map((s) =>
        s.tool === 'highlighter' ? <path key={s.id} d={strokePath(s)} fill={s.color} opacity={0.38} /> : null,
      )}
      {strokes.map((s) => (s.tool === 'pen' ? <path key={s.id} d={strokePath(s)} fill={s.color} /> : null))}
      <path ref={liveRef} d="" />
    </svg>
  )
})
