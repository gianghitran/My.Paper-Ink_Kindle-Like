import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from '@/lib/cloud/useLiveQuery'
import { ArrowUpRight, Bookmark as BookmarkIcon, ChevronRight, LayoutGrid, Highlighter, ListTree, NotebookPen, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { db } from '@/lib/db'
import { deleteHighlight, HIGHLIGHT_COLORS, hlSolid } from '@/lib/annotations'
import { cn, truncate } from '@/lib/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger, EmptyState } from '@/components/ui/controls'
import { Input } from '@/components/ui/input'
import { Button, IconButton } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { Markdown } from '@/components/notes/Markdown'
import type { NoteDraft } from '@/components/notes/NoteEditor'
import type { Anchor, Bookmark, Highlight, HighlightColor, InkStroke, Note } from '@/types'
import { PageBrowser } from './PageBrowser'
import { InkPreview } from '@/components/ink/InkPreview'
import type { ReaderHandle, SearchResult, TocItem } from './types'

export type PanelTab = 'contents' | 'pages' | 'notes' | 'search'

function TocNode({ item, onPick, depth }: { item: TocItem; onPick: (t: TocItem) => void; depth: number }) {
  const [open, setOpen] = useState(depth < 1)
  const hasChildren = item.children.length > 0
  return (
    <li>
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => onPick(item)}
          className={cn(
            'flex min-h-11 flex-1 items-center rounded-lg px-2 text-left text-[14px] leading-snug hover:bg-muted',
            depth === 0 ? 'font-medium' : 'text-muted-foreground',
          )}
          style={{ paddingLeft: 8 + depth * 14 }}
        >
          {item.label}
        </button>
        {hasChildren && (
          <IconButton label={open ? 'Collapse' : 'Expand'} size="icon" onClick={() => setOpen((o) => !o)}>
            <ChevronRight className={cn('transition-transform', open && 'rotate-90')} />
          </IconButton>
        )}
      </div>
      {hasChildren && open && (
        <ul>
          {item.children.map((c) => (
            <TocNode key={c.id} item={c} onPick={onPick} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

function location(h: Highlight) {
  return h.anchor.type === 'pdf' ? `p. ${h.anchor.page}` : h.anchor.chapter || ''
}

function noteLocationLabel(a: Anchor | undefined) {
  if (!a) return null
  return a.type === 'pdf' ? `p. ${a.page}` : a.chapter || 'In book'
}

function AnnotationList({
  docId,
  highlights,
  inkPages,
  bookmarks,
  onGo,
  onGoAnchor,
  onEditNote,
}: {
  docId: string
  highlights: Highlight[]
  inkPages?: Map<number, InkStroke[]>
  bookmarks: Bookmark[]
  onGo: (h: Highlight) => void
  onGoAnchor: (a: Anchor) => void
  onEditNote: (d: NoteDraft) => void
}) {
  const inkList = useMemo(
    () => [...(inkPages ?? new Map<number, InkStroke[]>()).entries()].filter(([, s]) => s.length > 0).sort((a, b) => a[0] - b[0]),
    [inkPages],
  )
  const notes = useLiveQuery(() => db.notes.where('docId').equals(docId).toArray(), [docId])
  const [color, setColor] = useState<HighlightColor | 'all'>('all')
  const notesByHl = useMemo(() => {
    const m = new Map<string, Note[]>()
    for (const n of notes ?? []) if (n.highlightId) m.set(n.highlightId, [...(m.get(n.highlightId) ?? []), n])
    return m
  }, [notes])
  const loose = (notes ?? []).filter((n) => !n.highlightId)
  const list = highlights.filter((h) => color === 'all' || h.color === color)

  return (
    <div className="flex flex-col gap-3 px-3 pb-6">
      <div className="flex items-center gap-1">
        <div className="no-scrollbar flex flex-1 items-center gap-1 overflow-x-auto" role="group" aria-label="Filter by colour">
          <button
            type="button"
            onClick={() => setColor('all')}
            className={cn('min-h-9 rounded-full px-3 text-[13px] pointer-coarse:min-h-11', color === 'all' ? 'bg-foreground text-background' : 'bg-muted')}
          >
            All
          </button>
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-label={`Show ${c.label} highlights`}
              onClick={() => setColor(c.id)}
              className="flex size-11 shrink-0 items-center justify-center"
            >
              <span
                className={cn('block size-5 rounded-full', color === c.id && 'ring-2 ring-foreground ring-offset-2 ring-offset-[var(--background)]')}
                style={{ background: hlSolid(c.id) }}
              />
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => onEditNote({ docId })}>
          <Plus /> Note
        </Button>
      </div>

      {list.length === 0 && loose.length === 0 && inkList.length === 0 && bookmarks.length === 0 && (
        <EmptyState icon={<Highlighter />} title="No highlights yet" className="py-10">
          Select text to highlight it, add a note or create a graph node — or tap the pen to write with Apple Pencil.
        </EmptyState>
      )}

      {bookmarks.length > 0 && (
        <>
          <h3 className="px-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Bookmarks</h3>
          <ul className="flex flex-col gap-1">
            {[...bookmarks]
              .sort((a, b) => a.progress - b.progress)
              .map((b) => (
                <li key={b.id} className="flex items-center gap-1 rounded-xl border border-border bg-card">
                  <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-2 px-3 text-left text-[14px]" onClick={() => onGoAnchor(b.anchor)}>
                    <BookmarkIcon className="size-4 shrink-0 fill-current text-muted-foreground" />
                    <span className="truncate">{b.label}</span>
                    <span className="ml-auto shrink-0 text-[12px] tabular-nums text-muted-foreground">{Math.round(b.progress * 100)}%</span>
                  </button>
                  <IconButton label="Remove bookmark" size="icon-sm" onClick={() => void db.bookmarks.delete(b.id)}>
                    <Trash2 />
                  </IconButton>
                </li>
              ))}
          </ul>
        </>
      )}

      {inkList.length > 0 && (
        <>
          <h3 className="px-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Handwriting on pages</h3>
          <div className="grid grid-cols-2 gap-2">
            {inkList.map(([page, strokes]) => (
              <button
                key={page}
                type="button"
                onClick={() => onGoAnchor({ type: 'pdf', page, rects: [{ page, x: 0, y: 0, w: 0, h: 0 }], quote: { exact: '' } })}
                className="rounded-xl border border-border bg-card p-2 text-left hover:bg-muted"
                aria-label={`Go to handwriting on page ${page}`}
              >
                <span className="mb-1 block text-[12px] text-muted-foreground">
                  p. {page} · {strokes.length} stroke{strokes.length === 1 ? '' : 's'}
                </span>
                <InkPreview strokes={strokes} maxHeight={90} />
              </button>
            ))}
          </div>
        </>
      )}

      {list.map((h) => {
        const hn = notesByHl.get(h.id) ?? []
        return (
          <div key={h.id} className="rounded-xl border border-border bg-card p-3">
            <button type="button" className="block w-full text-left" onClick={() => onGo(h)}>
              <div className="mb-1.5 flex items-center gap-2 text-[12px] text-muted-foreground">
                <span className="block size-2.5 rounded-full" style={{ background: hlSolid(h.color) }} />
                {location(h)}
              </div>
              <p className="border-l-[3px] pl-2.5 font-serif text-[14px] leading-relaxed" style={{ borderColor: hlSolid(h.color) }}>
                {truncate(h.text, 320)}
              </p>
            </button>
            {hn.map((n) => (
              <button
                key={n.id}
                type="button"
                className="mt-2 block w-full rounded-lg bg-muted/70 p-2.5 text-left"
                onClick={() => onEditNote({ note: n, quote: h.text })}
              >
                {n.title && <p className="mb-1 text-[13px] font-semibold">{n.title}</p>}
                <Markdown text={n.content} className="text-[13px]" />
                {n.ink && <InkPreview strokes={n.ink.strokes} maxHeight={140} className="mt-1" />}
              </button>
            ))}
            <div className="mt-1.5 flex justify-end gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onEditNote({ docId, highlightId: h.id, quote: h.text })}
                aria-label="Add note to highlight"
              >
                <NotebookPen /> {hn.length ? 'Add' : 'Note'}
              </Button>
              <IconButton label="Delete highlight" size="icon-sm" onClick={() => void deleteHighlight(h.id)}>
                <Trash2 />
              </IconButton>
            </div>
          </div>
        )
      })}

      {loose.length > 0 && (
        <>
          <h3 className="mt-2 px-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Notes</h3>
          {loose.map((n) => (
            <div key={n.id} className="rounded-xl border border-border bg-card p-3">
              {n.location && <p className="mb-1 text-[12px] text-muted-foreground">{noteLocationLabel(n.location)}</p>}
              {n.title && <p className="mb-1 text-[14px] font-semibold">{n.title}</p>}
              <Markdown text={n.content} className="text-[14px]" />
              {n.ink && <InkPreview strokes={n.ink.strokes} maxHeight={180} className="mt-1" />}
              <div className="mt-1 flex justify-end gap-1">
                {n.location && (
                  <Button size="sm" variant="ghost" onClick={() => onGoAnchor(n.location!)}>
                    <ArrowUpRight /> Go to
                  </Button>
                )}
                <IconButton label="Edit note" size="icon-sm" onClick={() => onEditNote({ note: n })}>
                  <Pencil />
                </IconButton>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function SearchPane({ handle, onPicked, onBeforeJump }: { handle: React.RefObject<ReaderHandle | null>; onPicked: () => void; onBeforeJump: () => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = async (q: string) => {
    abortRef.current?.abort()
    if (!q.trim()) {
      setResults(null)
      handle.current?.clearSearch()
      return
    }
    const ac = new AbortController()
    abortRef.current = ac
    setBusy(true)
    setResults([])
    try {
      await handle.current?.search(q, (r) => !ac.signal.aborted && setResults(r), ac.signal)
    } finally {
      if (!ac.signal.aborted) setBusy(false)
    }
  }

  const highlightMatch = (text: string) => {
    const q = query.trim()
    if (!q) return text
    const i = text.toLowerCase().indexOf(q.toLowerCase())
    if (i < 0) return text
    return (
      <>
        {text.slice(0, i)}
        <mark className="rounded bg-orange-300/60 px-0.5 text-inherit eink:bg-black/20">{text.slice(i, i + q.length)}</mark>
        {text.slice(i + q.length)}
      </>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <form
        className="flex gap-2 px-3 pb-3"
        onSubmit={(e) => {
          e.preventDefault()
          void run(query)
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search in document"
            className="pl-9"
            aria-label="Search in document"
            autoFocus
          />
        </div>
        {query ? (
          <IconButton
            label="Clear search"
            onClick={() => {
              setQuery('')
              void run('')
            }}
          >
            <X />
          </IconButton>
        ) : null}
        <Button type="submit" variant="secondary">
          Find
        </Button>
      </form>
      <div className="px-4 pb-2 text-[12px] text-muted-foreground" aria-live="polite">
        {busy ? (
          <span className="inline-flex items-center gap-2">
            <Spinner className="scale-50" /> Searching… {results?.length ? `${results.length} found` : ''}
          </span>
        ) : results ? (
          `${results.length} result${results.length === 1 ? '' : 's'}`
        ) : null}
      </div>
      <ul className="flex flex-col gap-1 px-2 pb-6">
        {results?.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              onClick={() => {
                setActiveId(r.id)
                onBeforeJump()
                handle.current?.goToSearchResult(r, query)
                onPicked()
              }}
              className={cn('w-full rounded-lg px-3 py-2.5 text-left hover:bg-muted', activeId === r.id && 'bg-muted')}
            >
              <span className="block text-[12px] font-medium text-muted-foreground">{r.where}</span>
              <span className="block text-[13px] leading-snug">{highlightMatch(r.excerpt.trim())}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ReaderSidePanel({
  tab,
  onTab,
  toc,
  docId,
  highlights,
  inkPages,
  bookmarks,
  currentPage,
  handle,
  onNavigate,
  onBeforeJump,
  onEditNote,
  className,
}: {
  tab: PanelTab
  onTab: (t: PanelTab) => void
  toc: TocItem[] | null
  docId: string
  highlights: Highlight[]
  inkPages?: Map<number, InkStroke[]>
  bookmarks: Bookmark[]
  
  currentPage?: number
  handle: React.RefObject<ReaderHandle | null>
  
  onBeforeJump: () => void
  
  onNavigate: () => void
  onEditNote: (d: NoteDraft) => void
  className?: string
}) {
  return (
    <Tabs value={tab} onValueChange={(v) => onTab(v as PanelTab)} className={cn('flex h-full min-h-0 flex-col', className)}>
      <TabsList className="mx-3 mb-3">
        <TabsTrigger value="contents">
          <ListTree /> Contents
        </TabsTrigger>
        {currentPage !== undefined && (
          <TabsTrigger value="pages">
            <LayoutGrid /> Pages
          </TabsTrigger>
        )}
        <TabsTrigger value="notes">
          <Highlighter /> Notes {highlights.length ? <span className="text-muted-foreground">{highlights.length}</span> : null}
        </TabsTrigger>
        <TabsTrigger value="search">
          <Search /> Search
        </TabsTrigger>
      </TabsList>
      <TabsContent value="contents" className="thin-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-6">
        {toc === null ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : toc.length === 0 ? (
          <EmptyState icon={<ListTree />} title="No table of contents" className="py-10">
            This document doesn’t include an outline.
          </EmptyState>
        ) : (
          <ul>
            {toc.map((t) => (
              <TocNode
                key={t.id}
                item={t}
                depth={0}
                onPick={(item) => {
                  onBeforeJump()
                  handle.current?.goToToc(item)
                  onNavigate()
                }}
              />
            ))}
          </ul>
        )}
      </TabsContent>
      <TabsContent value="notes" className="thin-scroll min-h-0 flex-1 overflow-y-auto">
        <AnnotationList
          docId={docId}
          highlights={highlights}
          inkPages={inkPages}
          bookmarks={bookmarks}
          onGo={(h) => {
            onBeforeJump()
            handle.current?.goToHighlight(h)
            onNavigate()
          }}
          onGoAnchor={(a) => {
            onBeforeJump()
            handle.current?.goToAnchor(a)
            onNavigate()
          }}
          onEditNote={onEditNote}
        />
      </TabsContent>
      <TabsContent value="search" forceMount className="thin-scroll min-h-0 flex-1 overflow-y-auto data-[state=inactive]:hidden">
        <SearchPane handle={handle} onPicked={onNavigate} onBeforeJump={onBeforeJump} />
      </TabsContent>
      {currentPage !== undefined && (
        <TabsContent value="pages" className="thin-scroll min-h-0 flex-1 overflow-y-auto">
          <PageBrowser
            handle={handle}
            currentPage={currentPage}
            bookmarkedPages={new Set(bookmarks.flatMap((b) => (b.anchor.type === 'pdf' ? [b.anchor.page] : [])))}
            highlightPages={new Set(highlights.flatMap((h) => (h.anchor.type === 'pdf' ? [h.anchor.page] : [])))}
            inkPages={new Set([...(inkPages?.entries() ?? [])].filter(([, st]) => st.length).map(([pg]) => pg))}
            onPicked={() => {
              onBeforeJump()
              onNavigate()
            }}
          />
        </TabsContent>
      )}
    </Tabs>
  )
}
