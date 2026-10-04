import { Highlighter, NotebookPen, Pencil, X } from 'lucide-react'
import { Button, IconButton } from '@/components/ui/button'
import { Badge } from '@/components/ui/controls'
import { Markdown } from '@/components/notes/Markdown'
import { InkPreview } from '@/components/ink/InkPreview'
import type { Note } from '@/types'

export function NotePeek({
  note,
  quote,
  onEdit,
  onHighlightMenu,
  onClose,
}: {
  note: Note
  quote?: string
  onEdit: () => void
  onHighlightMenu?: () => void
  onClose: () => void
}) {
  return (
    <div
      role="dialog"
      aria-label="Note"
      className="fixed inset-x-3 bottom-[calc(var(--safe-bottom)+76px)] z-40 mx-auto flex max-h-[45dvh] max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-[var(--shadow-lg,0_10px_30px_rgb(0_0_0/0.18))]"
    >
      <div className="flex items-center gap-2 border-b border-border py-1 pl-3 pr-1">
        <NotebookPen className="size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{note.title || 'Note'}</p>
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Pencil /> Edit
        </Button>
        {onHighlightMenu && (
          <Button size="sm" variant="ghost" onClick={onHighlightMenu} title="Style, colour, copy, delete…">
            <Highlighter /> Highlight
          </Button>
        )}
        <IconButton label="Close note" size="icon-sm" onClick={onClose}>
          <X />
        </IconButton>
      </div>
      <div className="thin-scroll overflow-y-auto px-3 py-2">
        {quote && <p className="mb-2 line-clamp-3 border-l-[3px] border-border pl-2 font-serif text-[13px] italic text-muted-foreground">{quote}</p>}
        {note.content.trim() ? <Markdown text={note.content} /> : !note.ink?.strokes.length && <p className="text-[13px] text-muted-foreground">Empty note.</p>}
        {note.ink && note.ink.strokes.length > 0 && <InkPreview strokes={note.ink.strokes} maxHeight={200} className="mt-2" />}
        {note.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {note.tags.map((t) => (
              <Badge key={t}>#{t}</Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
