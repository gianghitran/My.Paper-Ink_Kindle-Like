import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from '@/lib/cloud/useLiveQuery'
import { toast } from 'sonner'
import { ArrowUpRight, Download, Languages, Highlighter, Network, NotebookPen, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { db } from '@/lib/db'
import { deleteHighlight, highlightHref, hlSolid, noteHref } from '@/lib/annotations'
import { InkPreview } from '@/components/ink/InkPreview'
import { ensureHighlightNode, ensureNoteNode } from '@/lib/graph'
import { exportAllMarkdown } from '@/lib/backup'
import { cn, formatRelative, truncate } from '@/lib/utils'
import { Button, IconButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge, EmptyState, Segmented } from '@/components/ui/controls'
import { Markdown } from '@/components/notes/Markdown'
import { NoteEditor, type NoteDraft } from '@/components/notes/NoteEditor'
import { Spinner } from '@/components/Spinner'
import type { Anchor, DocumentRecord, Highlight, Note } from '@/types'

type Filter = 'all' | 'highlights' | 'notes'
type TagScope = 'note' | 'highlight'

const anchorLabel = (a: Anchor) => (a.type === 'pdf' ? `p. ${a.page}` : (a.chapter ?? ''))

interface Item {
  key: string
  ts: number
  highlight?: Highlight
  notes: Note[]
  doc?: DocumentRecord
  standalone?: Note
}

export default function NotesPage() {
  const navigate = useNavigate()
  const highlights = useLiveQuery(() => db.highlights.orderBy('createdAt').reverse().toArray(), [])
  const notes = useLiveQuery(() => db.notes.toArray(), [])
  const docs = useLiveQuery(() => db.documents.toArray(), [])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [tag, setTag] = useState<{ scope: TagScope; tag: string } | null>(null)
  const [docFilter, setDocFilter] = useState<string>('')
  const [draft, setDraft] = useState<NoteDraft | null>(null)

  const docMap = useMemo(() => new Map((docs ?? []).map((d) => [d.id, d])), [docs])
  const noteTags = useMemo(() => Array.from(new Set((notes ?? []).flatMap((n) => n.tags))).sort(), [notes])
  const highlightTags = useMemo(() => {

    const noted = new Set((notes ?? []).flatMap((n) => (n.highlightId ? [n.highlightId] : [])))
    const list = (highlights ?? []).filter((h) => filter !== 'highlights' || !noted.has(h.id))
    return Array.from(new Set(list.flatMap((h) => h.tags ?? []))).sort()
  }, [highlights, notes, filter])

  const tagGroups = useMemo(() => {
    const groups: { scope: TagScope; label: string; tags: string[] }[] = []
    if (filter !== 'highlights' && noteTags.length) groups.push({ scope: 'note', label: 'Note tags', tags: noteTags })
    if (filter !== 'notes' && highlightTags.length) groups.push({ scope: 'highlight', label: 'Highlight tags', tags: highlightTags })
    return groups
  }, [filter, noteTags, highlightTags])
  const changeFilter = (f: Filter) => {
    setFilter(f)
    if (tag && ((f === 'notes' && tag.scope === 'highlight') || (f === 'highlights' && tag.scope === 'note'))) setTag(null)
  }

  const items = useMemo<Item[]>(() => {
    if (!highlights || !notes) return []
    const byHl = new Map<string, Note[]>()
    for (const n of notes) if (n.highlightId) byHl.set(n.highlightId, [...(byHl.get(n.highlightId) ?? []), n])
    const hlIds = new Set(highlights.map((h) => h.id))
    const out: Item[] = []
    for (const h of highlights) {
      const hn = byHl.get(h.id) ?? []
      out.push({ key: h.id, ts: Math.max(h.updatedAt, ...hn.map((n) => n.updatedAt)), highlight: h, notes: hn, doc: docMap.get(h.docId) })
    }
    for (const n of notes) {
      if (n.highlightId && hlIds.has(n.highlightId)) continue
      out.push({ key: n.id, ts: n.updatedAt, notes: [], standalone: n, doc: n.docId ? docMap.get(n.docId) : undefined })
    }
    const q = query.trim().toLowerCase()
    return out
      .filter((it) => {

        if (filter === 'highlights' && (!it.highlight || it.notes.length > 0)) return false
        if (filter === 'notes' && !it.standalone && it.notes.length === 0) return false
        const allNotes = it.standalone ? [it.standalone] : it.notes
        if (tag?.scope === 'note' && !allNotes.some((n) => n.tags.includes(tag.tag))) return false
        if (tag?.scope === 'highlight' && !it.highlight?.tags?.includes(tag.tag)) return false
        if (docFilter && it.doc?.id !== docFilter) return false
        if (!q) return true
        const hay = [it.highlight?.text, it.doc?.title, ...(it.highlight?.tags ?? []), ...allNotes.flatMap((n) => [n.title, n.content, n.location?.quote?.exact, ...n.tags])]
        return hay.some((s) => s?.toLowerCase().includes(q))
      })
      .sort((a, b) => b.ts - a.ts)
  }, [highlights, notes, docMap, query, filter, tag, docFilter])

  const loading = !highlights || !notes || !docs

  return (
    <div className="thin-scroll flex-1 overflow-y-auto pt-safe">
      <div className="mx-auto w-full max-w-3xl px-4 pb-10 md:px-6">
        <header className="sticky top-0 z-10 -mx-4 bg-background/95 px-4 pb-3 pt-4 backdrop-blur md:-mx-6 md:px-6">
          <div className="flex items-center gap-2">
            <h1 className="min-w-0 flex-1 font-serif text-[26px] font-semibold tracking-tight md:text-3xl">Notes</h1>
            <IconButton label="Vocabulary" onClick={() => navigate('/vocabulary')}>
              <Languages />
            </IconButton>
            <IconButton label="Export all as Markdown" onClick={() => void exportAllMarkdown()}>
              <Download />
            </IconButton>
            <Button onClick={() => setDraft({})}>
              <Plus /> <span className="hidden sm:inline">New note</span>
            </Button>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search highlights & notes…" className="pl-10" aria-label="Search notes" />
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Segmented
              label="Show"
              value={filter}
              onChange={changeFilter}
              className="sm:w-80"
              options={[
                { value: 'all', label: 'All' },
                { value: 'highlights', label: (<><Highlighter /> Highlights</>) },
                { value: 'notes', label: (<><NotebookPen /> Notes</>) },
              ]}
            />
            <select
              value={docFilter}
              onChange={(e) => setDocFilter(e.target.value)}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-[14px]"
              aria-label="Filter by document"
            >
              <option value="">All documents</option>
              {(docs ?? [])
                .slice()
                .sort((a, b) => a.title.localeCompare(b.title))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {truncate(d.title, 60)}
                  </option>
                ))}
            </select>
          </div>
          {tagGroups.map((g) => (
            <div key={g.scope} className="no-scrollbar -mx-4 mt-3 flex items-center gap-2 overflow-x-auto px-4" role="group" aria-label={g.label}>
              <span className="flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground [&_svg]:size-3.5">
                {g.scope === 'note' ? <NotebookPen /> : <Highlighter />}
                {filter === 'all' && <span className="hidden sm:inline">{g.label}</span>}
              </span>
              {g.tags.map((t) => {
                const on = tag?.scope === g.scope && tag.tag === t
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTag(on ? null : { scope: g.scope, tag: t })}
                    className={cn(
                      'flex min-h-9 shrink-0 items-center gap-1 rounded-full border border-border px-3 text-[13px] pointer-coarse:min-h-10',
                      on && 'border-foreground bg-foreground text-background',
                    )}
                  >
                    #{t}
                    {on && <X className="size-3.5" />}
                  </button>
                )
              })}
            </div>
          ))}
        </header>

        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<NotebookPen />} title={query || tag || docFilter || filter !== 'all' ? 'No matches' : 'No highlights or notes yet'}>
            {query || tag || docFilter || filter !== 'all'
              ? 'Try a different search or filter.'
              : 'Select text while reading to highlight it or attach a note. Notes support Markdown, #tags and [[Concept]] links.'}
          </EmptyState>
        ) : (
          <ul className="mt-2 flex flex-col gap-3">
            {items.map((it) => (
              <li key={it.key} className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow)]">
                {it.doc && (
                  <div className="mb-2 flex items-center gap-2 text-[12px] text-muted-foreground">
                    <span className="truncate font-medium">{it.doc.title}</span>
                    {(it.highlight?.anchor ?? it.standalone?.location) && (
                      <span className="shrink-0">· {anchorLabel((it.highlight?.anchor ?? it.standalone?.location)!)}</span>
                    )}
                    <span className="ml-auto shrink-0">{formatRelative(it.ts)}</span>
                  </div>
                )}
                {it.highlight && (
                  <button
                    type="button"
                    onClick={() => navigate(highlightHref(it.highlight!))}
                    className="group block w-full text-left"
                    aria-label="Open highlight in reader"
                  >
                    <p className="border-l-[3px] pl-3 font-serif text-[15px] leading-relaxed group-hover:underline group-hover:decoration-foreground/30" style={{ borderColor: hlSolid(it.highlight.color) }}>
                      {it.highlight.text}
                    </p>
                  </button>
                )}
                {it.highlight?.tags && it.highlight.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1 pl-3" aria-label="Highlight tags">
                    <Highlighter className="size-3.5 text-muted-foreground" />
                    {it.highlight.tags.map((t) => (
                      <Badge key={t}>#{t}</Badge>
                    ))}
                  </div>
                )}
                {(it.standalone ? [it.standalone] : it.notes).map((n) => (
                  <div key={n.id} className={cn(it.highlight && 'mt-3 rounded-lg bg-muted/60 p-3')}>
                    {!it.highlight && n.location?.quote?.exact && (
                      <button type="button" onClick={() => navigate(noteHref(n) ?? '/notes')} className="group mb-2 block w-full text-left" aria-label="Open note in reader">
                        <p className="border-l-[3px] border-border pl-3 font-serif text-[15px] italic leading-relaxed text-muted-foreground group-hover:underline group-hover:decoration-foreground/30">
                          {truncate(n.location.quote.exact, 600)}
                        </p>
                      </button>
                    )}
                    {n.title && <p className="mb-1 text-[15px] font-semibold">{n.title}</p>}
                    {n.content.trim() && <Markdown text={n.content} />}
                    {n.ink && <InkPreview strokes={n.ink.strokes} maxHeight={260} className="mt-2" />}
                    {n.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {n.tags.map((t) => (
                          <Badge key={t}>#{t}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <div className="mt-2 flex flex-wrap items-center justify-end gap-1">
                  {it.highlight && (
                    <Button size="sm" variant="ghost" onClick={() => navigate(highlightHref(it.highlight!))}>
                      <ArrowUpRight /> Open
                    </Button>
                  )}
                  {!it.highlight && it.standalone?.docId && it.doc && (
                    <Button size="sm" variant="ghost" onClick={() => navigate(noteHref(it.standalone!) ?? `/read/${it.doc!.id}`)}>
                      <ArrowUpRight /> {it.standalone.location ? 'Open where written' : 'Open document'}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const n = it.standalone ?? it.notes[0]
                      if (n) setDraft({ note: n, quote: it.highlight?.text })
                      else if (it.highlight) setDraft({ docId: it.highlight.docId, highlightId: it.highlight.id, quote: it.highlight.text })
                    }}
                  >
                    {it.standalone || it.notes.length ? <Pencil /> : <NotebookPen />} {it.standalone || it.notes.length ? 'Edit' : 'Add note'}
                  </Button>
                  <IconButton
                    label="Create graph node"
                    size="icon-sm"
                    onClick={async () => {
                      const node = it.highlight ? await ensureHighlightNode(it.highlight.id) : it.standalone ? await ensureNoteNode(it.standalone.id) : null
                      if (node) toast.success('Node ready', { action: { label: 'View graph', onClick: () => navigate(`/graph?focus=${node.id}`) } })
                    }}
                  >
                    <Network />
                  </IconButton>
                  {it.highlight && (
                    <IconButton
                      label="Delete highlight"
                      size="icon-sm"
                      onClick={async () => {
                        await deleteHighlight(it.highlight!.id)
                        toast.success('Highlight deleted')
                      }}
                    >
                      <Trash2 />
                    </IconButton>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <NoteEditor draft={draft} onOpenChange={(o) => !o && setDraft(null)} />
    </div>
  )
}
