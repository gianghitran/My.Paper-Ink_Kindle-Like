import { Check, Eraser, Hand, Highlighter, PenLine, Redo2, Trash2, Undo2 } from 'lucide-react'
import { HIGHLIGHTER_COLORS, PEN_COLORS } from '@/lib/ink'
import { cn } from '@/lib/utils'
import { useSettings, type InkSize, type InkToolName } from '@/store/settings'

const SIZE_DOT: Record<InkSize, number> = { fine: 5, medium: 9, bold: 14 }





export function InkToolbar({
  variant = 'floating',
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onDone,
}: {
  variant?: 'floating' | 'inline'
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onClear?: () => void
  onDone?: () => void
}) {
  const ink = useSettings((s) => s.settings.ink)
  const updateInk = useSettings((s) => s.updateInk)
  const colors = ink.tool === 'highlighter' ? HIGHLIGHTER_COLORS : PEN_COLORS
  const activeColor = ink.tool === 'highlighter' ? ink.highlighterColor : ink.penColor

  const btn = 'flex size-11 shrink-0 items-center justify-center rounded-xl text-foreground hover:bg-muted [&_svg]:size-5 disabled:opacity-35'
  const tools: { id: InkToolName; label: string; icon: React.ReactNode }[] = [
    { id: 'pen', label: 'Pen', icon: <PenLine /> },
    { id: 'highlighter', label: 'Highlighter', icon: <Highlighter /> },
    { id: 'eraser', label: 'Eraser', icon: <Eraser /> },
  ]
  const sep = <div className="mx-1 h-7 w-px shrink-0 bg-border" />

  return (
    <div
      role="toolbar"
      aria-label="Handwriting tools"
      className={cn(
        'no-scrollbar flex items-center gap-0.5 overflow-x-auto',
        variant === 'floating'
          ? 'anim-fade-in fixed left-1/2 top-[calc(var(--safe-top)+8px)] z-40 max-w-[calc(100vw-16px)] -translate-x-1/2 rounded-2xl border border-border bg-popover p-1 shadow-2xl'
          : 'rounded-xl bg-muted p-1',
      )}
    >
      {tools.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-label={t.label}
          aria-pressed={ink.tool === t.id}
          title={t.label}
          onClick={() => updateInk({ tool: t.id })}
          className={cn(btn, ink.tool === t.id && 'bg-foreground text-background hover:bg-foreground')}
        >
          {t.icon}
        </button>
      ))}
      {ink.tool !== 'eraser' && (
        <>
          {sep}
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={activeColor === c}
              onClick={() => updateInk(ink.tool === 'highlighter' ? { highlighterColor: c } : { penColor: c })}
              className={btn}
            >
              <span
                className={cn('block size-6 rounded-full border border-black/15', activeColor === c && 'ring-2 ring-foreground ring-offset-2 ring-offset-[var(--popover)]')}
                style={{ background: c }}
              />
            </button>
          ))}
          {sep}
          {(['fine', 'medium', 'bold'] as InkSize[]).map((sz) => (
            <button
              key={sz}
              type="button"
              aria-label={`${sz} stroke`}
              aria-pressed={ink.size === sz}
              onClick={() => updateInk({ size: sz })}
              className={cn(btn, ink.size === sz && 'bg-muted')}
            >
              <span className="block rounded-full bg-foreground" style={{ width: SIZE_DOT[sz], height: SIZE_DOT[sz] }} />
            </button>
          ))}
        </>
      )}
      {sep}
      <button type="button" aria-label="Undo" title="Undo" disabled={!canUndo} onClick={onUndo} className={btn}>
        <Undo2 />
      </button>
      <button type="button" aria-label="Redo" title="Redo" disabled={!canRedo} onClick={onRedo} className={btn}>
        <Redo2 />
      </button>
      {onClear && (
        <button type="button" aria-label="Clear handwriting" title="Clear" onClick={onClear} className={btn}>
          <Trash2 />
        </button>
      )}
      <button
        type="button"
        aria-label="Draw with finger"
        aria-pressed={ink.fingerDraws}
        title={ink.fingerDraws ? 'Fingers draw (tap to scroll with fingers)' : 'Fingers scroll — only Apple Pencil draws'}
        onClick={() => updateInk({ fingerDraws: !ink.fingerDraws })}
        className={cn(btn, ink.fingerDraws && 'bg-foreground text-background hover:bg-foreground')}
      >
        <Hand />
      </button>
      {onDone && (
        <>
          {sep}
          <button
            type="button"
            onClick={onDone}
            className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-sm font-medium text-primary-foreground [&_svg]:size-4"
          >
            <Check /> Done
          </button>
        </>
      )}
    </div>
  )
}
