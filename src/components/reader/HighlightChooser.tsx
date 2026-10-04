import { Combine, Highlighter, NotebookPen, X } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/button'
import { hlSolid } from '@/lib/annotations'
import { truncate } from '@/lib/utils'
import type { Highlight } from '@/types'

export function HighlightChooser({
  hits,
  hasNote,
  onPick,
  onMerge,
  onClose,
}: {
  hits: Highlight[]
  hasNote: (id: string) => boolean
  onPick: (h: Highlight) => void
  onMerge: () => void
  onClose: () => void
}) {
  return (
    <div
      role="dialog"
      aria-label="Choose highlight"
      className="fixed inset-x-3 bottom-[calc(var(--safe-bottom)+76px)] z-40 mx-auto flex max-h-[50dvh] max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-border py-1 pl-3 pr-1">
        <p className="min-w-0 flex-1 text-[14px] font-semibold">{hits.length} overlapping highlights</p>
        <IconButton label="Close" size="icon-sm" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <ul className="thin-scroll overflow-y-auto p-1">
        {hits.map((h) => (
          <li key={h.id}>
            <button
              type="button"
              onClick={() => onPick(h)}
              className="flex min-h-11 w-full items-start gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted"
            >
              {hasNote(h.id) ? <NotebookPen className="mt-0.5 size-4 shrink-0" /> : <Highlighter className="mt-0.5 size-4 shrink-0" style={{ color: hlSolid(h.color) }} />}
              <span className="font-serif text-[14px] leading-snug">{truncate(h.text, 160)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-border p-2">
        <Button variant="secondary" className="w-full" onClick={onMerge}>
          <Combine /> Merge highlights
        </Button>
      </div>
    </div>
  )
}
