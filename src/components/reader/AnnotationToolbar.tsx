import { useLayoutEffect, useRef, useState } from 'react'
import { BookA, Contrast, Copy, Highlighter, Network, NotebookPen, Strikethrough, TextSelect, Trash2, Underline, X } from 'lucide-react'
import { HIGHLIGHT_COLORS, hlSolid } from '@/lib/annotations'
import { cn, isCoarsePointer } from '@/lib/utils'
import type { HighlightColor, HighlightDrawer } from '@/types'

export const DRAWERS: { id: HighlightDrawer; label: string; icon: typeof Highlighter }[] = [
  { id: 'lighten', label: 'Lighten', icon: Highlighter },
  { id: 'underscore', label: 'Underline', icon: Underline },
  { id: 'strikeout', label: 'Strikeout', icon: Strikethrough },
  { id: 'invert', label: 'Invert', icon: Contrast },
]

interface Props {
  rect: { left: number; top: number; width: number; height: number }

  activeColor?: HighlightColor
  onColor: (c: HighlightColor) => void

  drawer?: HighlightDrawer
  onDrawer?: (d: HighlightDrawer) => void

  onAdjust?: (side: 0 | 1, dir: -1 | 1, byChar: boolean) => void

  onExtend?: () => void

  onSelectMode?: () => void
  onNote: () => void
  onNode: () => void
  onCopy: () => void

  onLookup?: () => void
  onDelete?: () => void
  onClose: () => void
  noteLabel?: string
}

export function AnnotationToolbar({ rect, activeColor, onColor, drawer, onDrawer, onAdjust, onExtend, onSelectMode, onNote, onNode, onCopy, onLookup, onDelete, onClose, noteLabel = 'Note' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const coarse = isCoarsePointer()

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || coarse) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let top = rect.top - h - 10
    if (top < 64) top = rect.top + rect.height + 10
    top = Math.min(Math.max(8, top), vh - h - 8)
    const left = Math.min(Math.max(8, rect.left + rect.width / 2 - w / 2), vw - w - 8)
    setPos({ left, top })
  }, [rect, coarse])

  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault()
  const btn =
    'flex min-h-11 min-w-11 flex-col items-center justify-center gap-0.5 rounded-lg px-2 text-[11px] font-medium text-foreground hover:bg-muted [&_svg]:size-[18px]'

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Annotation actions"
      onPointerDown={keep}
      onMouseDown={keep}
      className={cn(
        'anim-fade-in fixed z-40 flex max-w-[min(calc(100vw-16px),760px)] flex-col items-center gap-1 rounded-2xl border border-border bg-popover p-1.5 shadow-2xl min-[500px]:flex-row min-[500px]:flex-wrap min-[500px]:justify-center',
        coarse && 'left-1/2 -translate-x-1/2',
      )}
      style={
        coarse
          ? { bottom: 'calc(var(--safe-bottom) + 84px)' }
          : pos
            ? { left: pos.left, top: pos.top }
            : { left: -9999, top: -9999 }
      }
    >
      {onDrawer && (
        <div className="flex items-center gap-0.5 px-1" role="radiogroup" aria-label="Highlight style">
          {DRAWERS.map((d) => (
            <button
              key={d.id}
              type="button"
              role="radio"
              aria-checked={(drawer ?? 'lighten') === d.id}
              aria-label={d.label}
              title={d.label}
              onClick={() => onDrawer(d.id)}
              className={cn(
                'flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted [&_svg]:size-[18px]',
                (drawer ?? 'lighten') === d.id && 'bg-foreground text-background hover:bg-foreground',
              )}
            >
              <d.icon />
            </button>
          ))}
        </div>
      )}
      {onDrawer && <div className="mx-0.5 hidden h-8 w-px bg-border min-[500px]:block" />}
      {onAdjust && <AdjustRow onAdjust={onAdjust} />}
      {onAdjust && <div className="mx-0.5 hidden h-8 w-px bg-border min-[500px]:block" />}
      <div className="flex items-center gap-0.5 px-1" role="group" aria-label="Highlight colour">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c.id}
            type="button"
            aria-label={`Highlight ${c.label}`}
            title={`Highlight ${c.label}`}
            onClick={() => onColor(c.id)}
            className="flex size-11 items-center justify-center rounded-full"
          >
            <span
              className={cn(
                'block size-6 rounded-full border border-black/10',
                activeColor === c.id && 'ring-2 ring-foreground ring-offset-2 ring-offset-[var(--popover)]',
              )}
              style={{ background: hlSolid(c.id) }}
            />
          </button>
        ))}
      </div>
      <div className="mx-0.5 hidden h-8 w-px bg-border min-[500px]:block" />
      <div className="flex items-center gap-1">
      <button type="button" className={btn} onClick={onNote}>
        <NotebookPen />
        <span className="hidden sm:block">{noteLabel}</span>
      </button>
      {onSelectMode && (
        <button type="button" className={btn} onClick={onSelectMode} title="Select: mark this as the start, then select the end (can be on another page)">
          <TextSelect />
          <span className="hidden sm:block">Select</span>
        </button>
      )}
      {onExtend && (
        <button type="button" className={btn} onClick={onExtend} title="Extend: select where the highlight should now end (can be on another page)">
          <TextSelect />
          <span className="hidden sm:block">Extend</span>
        </button>
      )}
      <button type="button" className={btn} onClick={onNode} title="Create graph node">
        <Network />
        <span className="hidden sm:block">Node</span>
      </button>
      {onLookup && (
        <button type="button" className={btn} onClick={onLookup} title="Look up in dictionary / Wikipedia">
          <BookA />
          <span className="hidden sm:block">Look up</span>
        </button>
      )}
      <button type="button" className={btn} onClick={onCopy}>
        <Copy />
        <span className="hidden sm:block">Copy</span>
      </button>
      {onDelete && (
        <button type="button" className={cn(btn, 'text-destructive')} onClick={onDelete}>
          <Trash2 />
          <span className="hidden sm:block">Delete</span>
        </button>
      )}
      <button type="button" className={cn(btn, 'text-muted-foreground')} onClick={onClose} aria-label="Close">
        <X />
      </button>
      </div>
    </div>
  )
}

function AdjustRow({ onAdjust }: { onAdjust: (side: 0 | 1, dir: -1 | 1, byChar: boolean) => void }) {
  const [byChar, setByChar] = useState(false)
  const held = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const buttons: { side: 0 | 1; dir: -1 | 1; text: string; label: string }[] = [
    { side: 0, dir: -1, text: '◁▒▒', label: 'Move start back' },
    { side: 0, dir: 1, text: '▷☓▒', label: 'Move start forward' },
    { side: 1, dir: -1, text: '▒☓◁', label: 'Move end back' },
    { side: 1, dir: 1, text: '▒▒▷', label: 'Move end forward' },
  ]
  return (
    <div className="flex items-center gap-0.5 px-1" role="group" aria-label={`Adjust highlight (${byChar ? 'by character' : 'by word'})`}>
      {buttons.map((b) => (
        <button
          key={b.text}
          type="button"
          aria-label={`${b.label} (${byChar ? 'character' : 'word'})`}
          title={`${b.label} — tap: ${byChar ? 'character' : 'word'}, long-press: switch word/character`}
          className="flex h-11 min-w-11 items-center justify-center rounded-lg px-1.5 font-mono text-[13px] tracking-[-0.12em] text-foreground hover:bg-muted"
          onPointerDown={() => {
            held.current = false
            timer.current = setTimeout(() => {
              held.current = true
              const next = !byChar
              setByChar(next)
              onAdjust(b.side, b.dir, true)
            }, 500)
          }}
          onPointerUp={() => timer.current && clearTimeout(timer.current)}
          onPointerLeave={() => timer.current && clearTimeout(timer.current)}
          onClick={(e) => {
            if (held.current) return
            onAdjust(b.side, b.dir, byChar || e.shiftKey)
          }}
        >
          {b.text}
        </button>
      ))}
      <span className={cn('px-1 text-[10px] uppercase tracking-wide', byChar ? 'text-foreground' : 'text-muted-foreground')}>{byChar ? 'char' : 'word'}</span>
    </div>
  )
}
