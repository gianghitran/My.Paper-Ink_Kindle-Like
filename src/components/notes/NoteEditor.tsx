import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from '@/lib/cloud/useLiveQuery'
import { toast } from 'sonner'
import { Eye, PenLine, Pencil, Plus, Trash2 } from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input, Textarea } from '@/components/ui/input'
import { Segmented } from '@/components/ui/controls'
import { InkCanvas } from '@/components/ink/InkCanvas'
import { InkPreview } from '@/components/ink/InkPreview'
import { InkToolbar } from '@/components/ink/InkToolbar'
import { useInkHistory } from '@/components/ink/useInkHistory'
import { Markdown } from './Markdown'
import { db } from '@/lib/db'
import { deleteNote, saveNote } from '@/lib/annotations'
import { inkColorFor, wasPenSeen } from '@/lib/ink'
import { cn } from '@/lib/utils'
import { TagEditor, addTags, type ScopedTag } from './TagEditor'
import { useViewport } from '@/hooks/useViewport'
import { useSettings } from '@/store/settings'
import type { Anchor, InkStroke, Note } from '@/types'

export interface NoteDraft {
  note?: Note
  docId?: string
  highlightId?: string

  location?: Anchor
  quote?: string
  title?: string

  initialTab?: 'write' | 'draw'
}

type Tab = 'write' | 'draw' | 'preview'

const PAD_WIDTH = 1000
const PAD_MIN_HEIGHT = 760
const PAD_EXTEND = 400
const NO_STROKES: InkStroke[] = []

function HandwritingPad({
  strokes,
  height,
  onAdd,
  onErase,
}: {
  strokes: InkStroke[]
  height: number
  onAdd: (s: InkStroke) => void
  onErase: (ids: string[]) => void
}) {
  const ink = useSettings((s) => s.settings.ink)
  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-border" style={{ aspectRatio: `${PAD_WIDTH} / ${height}` }}>
      <div
        className="ink-surface absolute inset-0 bg-white"
        style={{
          backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 31px, rgb(0 0 0 / 0.07) 31px, rgb(0 0 0 / 0.07) 32px)',
        }}
      />
      <InkCanvas
        width={PAD_WIDTH}
        height={height}
        strokes={strokes}
        active
        tool={ink.tool}
        color={inkColorFor(ink.tool, ink.penColor, ink.highlighterColor)}
        size={ink.size}

        fingersDraw={ink.fingerDraws || !wasPenSeen()}
        onAdd={onAdd}
        onErase={onErase}
      />
    </div>
  )
}

export function NoteEditor({
  draft,
  onOpenChange,
  onSaved,
}: {
  draft: NoteDraft | null
  onOpenChange: (open: boolean) => void
  onSaved?: (n: Note) => void
}) {
  const { isPhone } = useViewport()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState<ScopedTag[]>([])
  const [pendingTag, setPendingTag] = useState('')
  const [hlTagsBefore, setHlTagsBefore] = useState<string[]>([])
  const [tab, setTab] = useState<Tab>('write')
  const [caret, setCaret] = useState(0)
  const [padHeight, setPadHeight] = useState(PAD_MIN_HEIGHT)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const concepts = useLiveQuery(() => db.nodes.where('type').equals('concept').toArray(), [])
  const ink = useInkHistory(new Map())
  const { reset: resetInk } = ink
  const strokes = ink.surfaces.get(0) ?? NO_STROKES

  useEffect(() => {
    if (!draft) return
    setTitle(draft.note?.title ?? draft.title ?? '')
    setContent(draft.note?.content ?? '')
    setPendingTag('')
    const noteTags: ScopedTag[] = (draft.note?.tags ?? []).map((tag) => ({ tag, scope: 'note' }))
    setTags(noteTags)
    setHlTagsBefore([])
    const hid = draft.note?.highlightId ?? draft.highlightId
    if (hid) {

      void db.highlights.get(hid).then((h) => {
        const hl = h?.tags ?? []
        setHlTagsBefore(hl)
        setTags([...noteTags, ...hl.filter((t) => !noteTags.some((n) => n.tag === t)).map((tag) => ({ tag, scope: 'highlight' as const }))])
      })
    }
    const existing = draft.note?.ink
    resetInk(new Map([[0, existing?.strokes ?? []]]))
    setPadHeight(Math.max(PAD_MIN_HEIGHT, existing?.height ?? 0))
    setTab(draft.initialTab ?? (existing?.strokes.length && !draft.note?.content.trim() ? 'draw' : 'write'))
  }, [draft, resetInk])

  const partial = useMemo(() => {
    const before = content.slice(0, caret)
    const m = before.match(/\[\[([^[\]\n]*)$/)
    return m ? m[1] : null
  }, [content, caret])
  const suggestions = useMemo(() => {
    if (partial === null || !concepts) return []
    const q = partial.toLowerCase()
    return concepts
      .filter((c) => c.label.toLowerCase().includes(q))
      .slice(0, 6)
      .map((c) => c.label)
  }, [partial, concepts])

  const insertConcept = (name: string) => {
    if (partial === null) return
    const start = caret - partial.length
    const after = content.slice(caret).replace(/^[^\]\n]*\]\]/, '')
    const next = `${content.slice(0, start)}${name}]]${after}`
    setContent(next)
    const pos = start + name.length + 2
    requestAnimationFrame(() => {
      taRef.current?.focus()
      taRef.current?.setSelectionRange(pos, pos)
      setCaret(pos)
    })
  }

  const save = async () => {
    const allTags = addTags(tags, pendingTag)
    const noteTags = allTags.filter((t) => t.scope === 'note').map((t) => t.tag)
    const hlTags = allTags.filter((t) => t.scope === 'highlight').map((t) => t.tag)
    const highlightId = draft?.note?.highlightId ?? draft?.highlightId
    const hlTagsChanged = !!highlightId && hlTags.join(',') !== hlTagsBefore.join(',')
    if (highlightId && hlTagsChanged) await db.highlights.update(highlightId, { tags: hlTags, updatedAt: Date.now() })
    if (!content.trim() && !title.trim() && !strokes.length) {

      if (hlTagsChanged && !draft?.note && !noteTags.length) {
        toast.success('Highlight tags saved')
        onOpenChange(false)
        return
      }
      toast.error('Write or draw something first')
      return
    }
    const n = await saveNote({
      id: draft?.note?.id,
      docId: draft?.note?.docId ?? draft?.docId,
      highlightId: draft?.note?.highlightId ?? draft?.highlightId,
      location: draft?.note?.location ?? draft?.location,
      ink: { width: PAD_WIDTH, height: padHeight, strokes },
      title: title.trim(),
      content,
      tags: noteTags,
    })
    toast.success('Note saved')
    onSaved?.(n)
    onOpenChange(false)
  }

  const quote = draft?.quote
  return (
    <Sheet open={!!draft} onOpenChange={onOpenChange}>
      <SheetContent
        side={isPhone ? 'bottom' : 'right'}
        title={draft?.note ? 'Edit note' : 'New note'}
        className={cn(isPhone ? 'h-[92dvh]' : tab === 'draw' ? 'w-[min(720px,96vw)]' : 'w-[min(520px,94vw)]')}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          if (tab === 'write') taRef.current?.focus()
        }}
      >
        <form
          className="flex min-h-full flex-col gap-3 px-4 pb-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          {quote && (
            <blockquote className="max-h-32 overflow-y-auto border-l-[3px] border-[var(--hl-yellow-solid)] pl-3 font-serif text-[14px] italic text-muted-foreground">
              {quote}
            </blockquote>
          )}
          {!quote && draft?.location?.type === 'epub' && draft.location.chapter && (
            <p className="text-[13px] text-muted-foreground">Written at: {draft.location.chapter}</p>
          )}
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" aria-label="Note title" />
          <Segmented
            label="Editor mode"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'write', label: (<><Pencil /> Write</>) },
              { value: 'draw', label: (<><PenLine /> Draw</>) },
              { value: 'preview', label: (<><Eye /> Preview</>) },
            ]}
          />
          {tab === 'write' && (
            <div className="relative flex min-h-0 flex-1 flex-col">
              <Textarea
                ref={taRef}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value)
                  setCaret(e.target.selectionStart)
                }}
                onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    void save()
                  }
                }}
                placeholder={'Write in Markdown…\nLink ideas with [[Concept]] — they appear in your graph.'}
                className="min-h-40 flex-1 resize-none font-[450]"
                aria-label="Note content (Markdown)"
              />
              {suggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2" aria-label="Concept suggestions">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onPointerDown={(e) => e.preventDefault()}
                      onClick={() => insertConcept(s)}
                      className="min-h-9 rounded-full border border-border bg-card px-3 text-[13px] pointer-coarse:min-h-10"
                    >
                      [[{s}]]
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {tab === 'draw' && (
            <div className="flex flex-col gap-2">
              <InkToolbar
                variant="inline"
                canUndo={ink.canUndo}
                canRedo={ink.canRedo}
                onUndo={ink.undo}
                onRedo={ink.redo}
                onClear={() => ink.clear(0)}
              />
              <HandwritingPad strokes={strokes} height={padHeight} onAdd={(s) => ink.add(0, s)} onErase={(ids) => ink.erase(0, ids)} />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[12px] text-muted-foreground">
                  Write with Apple Pencil — fingers scroll once the Pencil is used. Toggle the hand to draw with a finger.
                </p>
                <Button size="sm" variant="secondary" onClick={() => setPadHeight((h) => h + PAD_EXTEND)}>
                  <Plus /> More space
                </Button>
              </div>
            </div>
          )}
          {tab === 'preview' && (
            <div className="flex min-h-40 flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card p-3">
              {content.trim() && <Markdown text={content} />}
              {strokes.length > 0 && <InkPreview strokes={strokes} maxHeight={480} />}
              {!content.trim() && !strokes.length && <p className="text-sm text-muted-foreground">Nothing to preview.</p>}
            </div>
          )}
          {tab !== 'draw' && strokes.length > 0 && (
            <button type="button" className="rounded-lg border border-dashed border-border p-2 text-left" onClick={() => setTab('draw')}>
              <span className="mb-1 block text-[12px] text-muted-foreground">Handwriting · tap to edit</span>
              <InkPreview strokes={strokes} maxHeight={120} />
            </button>
          )}
          <TagEditor
            value={tags}
            onChange={setTags}
            pending={pendingTag}
            onPendingChange={setPendingTag}
            allowHighlight={!!(draft?.note?.highlightId ?? draft?.highlightId)}
          />
          <div className="flex items-center gap-2 pt-1">
            {draft?.note && (
              <Button
                variant="ghost"
                className="text-destructive"
                onClick={async () => {
                  await deleteNote(draft.note!.id)
                  toast.success('Note deleted')
                  onOpenChange(false)
                }}
              >
                <Trash2 /> Delete
              </Button>
            )}
            <div className="flex-1" />
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
