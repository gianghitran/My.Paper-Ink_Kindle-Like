import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from '@/lib/cloud/useLiveQuery'
import { ArrowDownUp, BookOpen, Highlighter, LayoutGrid, List, NotebookPen, Search, Star, Upload, X } from 'lucide-react'
import { db } from '@/lib/db'
import { cn, formatPercent, formatRelative } from '@/lib/utils'
import { useSettings, type LibrarySort } from '@/store/settings'
import { InkModeMenu } from '@/components/InkModeMenu'
import { useViewport } from '@/hooks/useViewport'
import { SHELVES, type ShelfId } from '@/components/layout/AppShell'
import { ImportButton } from '@/components/ImportButton'
import { Cover } from '@/components/library/Cover'
import { formatLabel } from '@/lib/formats'
import { DocumentMenu } from '@/components/library/DocumentActions'
import { IconButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, ProgressBar } from '@/components/ui/controls'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/Spinner'
import type { DocumentRecord } from '@/types'

const SORTS: { id: LibrarySort; label: string }[] = [
  { id: 'lastOpened', label: 'Last opened' },
  { id: 'added', label: 'Date added' },
  { id: 'title', label: 'Title' },
  { id: 'author', label: 'Author' },
  { id: 'progress', label: 'Progress' },
]

function countBy(keys: string[] | undefined) {
  const m = new Map<string, number>()
  for (const k of keys ?? []) m.set(k, (m.get(k) ?? 0) + 1)
  return m
}

function sortDocs(docs: DocumentRecord[], sort: LibrarySort) {
  const out = [...docs]
  switch (sort) {
    case 'lastOpened':
      return out.sort((a, b) => (b.lastOpenedAt ?? b.addedAt / 1e3) - (a.lastOpenedAt ?? a.addedAt / 1e3))
    case 'added':
      return out.sort((a, b) => b.addedAt - a.addedAt)
    case 'title':
      return out.sort((a, b) => a.title.localeCompare(b.title))
    case 'author':
      return out.sort((a, b) => (a.author || '￿').localeCompare(b.author || '￿'))
    case 'progress':
      return out.sort((a, b) => b.progress - a.progress)
  }
}

function filterShelf(docs: DocumentRecord[], shelf: ShelfId) {
  switch (shelf) {
    case 'papers':
      return docs.filter((d) => d.kind === 'paper')
    case 'books':
      return docs.filter((d) => d.kind === 'book')
    case 'documents':
      return docs.filter((d) => d.kind === 'document')
    case 'others':
      return docs.filter((d) => d.kind === 'other')
    case 'recent':
      return docs.filter((d) => d.lastOpenedAt).sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
    case 'favorites':
      return docs.filter((d) => d.favorite)
    case 'unread':
      return docs.filter((d) => d.status === 'unread')
    case 'finished':
      return docs.filter((d) => d.status === 'finished')
    default:
      return docs
  }
}

interface Counts {
  highlights: number
  notes: number
}

function MetaLine({ doc, counts }: { doc: DocumentRecord; counts: Counts }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
      <span>{doc.status === 'finished' ? 'Finished' : doc.lastOpenedAt ? formatRelative(doc.lastOpenedAt) : 'New'}</span>
      {counts.highlights > 0 && (
        <span className="inline-flex items-center gap-1" title={`${counts.highlights} highlights`}>
          <Highlighter className="size-3.5" />
          {counts.highlights}
        </span>
      )}
      {counts.notes > 0 && (
        <span className="inline-flex items-center gap-1" title={`${counts.notes} notes`}>
          <NotebookPen className="size-3.5" />
          {counts.notes}
        </span>
      )}
    </div>
  )
}

function GridCard({ doc, counts }: { doc: DocumentRecord; counts: Counts }) {
  return (
    <div className="group relative flex flex-col">
      <Link
        to={`/read/${doc.id}`}
        className="relative block aspect-[2/3] overflow-hidden rounded-md border border-border bg-muted shadow-[var(--shadow)] eink:border-black"
        aria-label={`Open ${doc.title}`}
      >
        <Cover doc={doc} />
        <span className="absolute left-1.5 top-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
          {formatLabel(doc.sourceFormat, doc.format)}
        </span>
        {doc.favorite ? (
          <Star className="absolute right-1.5 top-1.5 size-4 fill-amber-400 text-amber-500 drop-shadow eink:fill-black eink:text-black" />
        ) : null}
        {doc.progress > 0 && doc.status !== 'finished' && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
            <div className="h-full bg-white/90 eink:bg-black" style={{ width: formatPercent(doc.progress) }} />
          </div>
        )}
      </Link>
      <div className="mt-2 flex items-start gap-1">
        <Link to={`/read/${doc.id}`} className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-[14px] font-semibold leading-snug">{doc.title}</h3>
          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{doc.author || 'Unknown author'}</p>
        </Link>
        <DocumentMenu doc={doc} triggerClassName="-mr-2 -mt-1.5 shrink-0" />
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <MetaLine doc={doc} counts={counts} />
        {doc.progress > 0 && doc.status !== 'finished' && (
          <span className="text-[12px] tabular-nums text-muted-foreground">{formatPercent(doc.progress)}</span>
        )}
      </div>
    </div>
  )
}

function ListRow({ doc, counts }: { doc: DocumentRecord; counts: Counts }) {
  return (
    <div className="flex items-center gap-3 border-b border-border py-3 last:border-b-0">
      <Link to={`/read/${doc.id}`} className="h-[72px] w-12 shrink-0 overflow-hidden rounded border border-border bg-muted" aria-hidden tabIndex={-1}>
        <Cover doc={doc} />
      </Link>
      <Link to={`/read/${doc.id}`} className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-[15px] font-semibold">{doc.title}</h3>
          {doc.favorite ? <Star className="size-3.5 shrink-0 fill-amber-400 text-amber-500 eink:fill-black eink:text-black" /> : null}
        </div>
        <p className="truncate text-[13px] text-muted-foreground">
          {doc.author || 'Unknown author'} · {formatLabel(doc.sourceFormat, doc.format)}
          {doc.positionLabel ? ` · ${doc.positionLabel}` : ''}
        </p>
        <div className="flex items-center gap-3">
          <ProgressBar value={doc.progress} className="max-w-40" />
          <span className="text-[12px] tabular-nums text-muted-foreground">{formatPercent(doc.progress)}</span>
          <MetaLine doc={doc} counts={counts} />
        </div>
      </Link>
      <DocumentMenu doc={doc} />
    </div>
  )
}

function ContinueReading({ docs }: { docs: DocumentRecord[] }) {
  if (!docs.length) return null
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">Continue reading</h2>
      <div className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 md:-mx-6 md:px-6">
        {docs.map((d) => (
          <Link
            key={d.id}
            to={`/read/${d.id}`}
            className="flex w-[280px] shrink-0 snap-start items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-[var(--shadow)]"
          >
            <div className="h-20 w-14 shrink-0 overflow-hidden rounded border border-border">
              <Cover doc={d} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-[14px] font-semibold leading-snug">{d.title}</p>
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{d.positionLabel || formatRelative(d.lastOpenedAt)}</p>
              <div className="mt-2 flex items-center gap-2">
                <ProgressBar value={d.progress} />
                <span className="text-[11px] tabular-nums text-muted-foreground">{formatPercent(d.progress)}</span>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

export function LibraryPage() {
  const [params, setParams] = useSearchParams()
  const shelf = (SHELVES.some((s) => s.id === params.get('shelf')) ? params.get('shelf') : 'all') as ShelfId
  const [query, setQuery] = useState('')
  const { settings, update } = useSettings()
  const { tier } = useViewport()

  const docs = useLiveQuery(() => db.documents.toArray(), [])
  const hlKeys = useLiveQuery(() => db.highlights.orderBy('docId').keys() as Promise<string[]>, [])
  const noteKeys = useLiveQuery(() => db.notes.orderBy('docId').keys() as Promise<string[]>, [])
  const hlCounts = useMemo(() => countBy(hlKeys), [hlKeys])
  const noteCounts = useMemo(() => countBy(noteKeys), [noteKeys])

  const visible = useMemo(() => {
    if (!docs) return []
    let list = filterShelf(docs, shelf)
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((d) =>
        [d.title, d.author, d.fileName, ...d.tags].some((f) => f?.toLowerCase().includes(q)),
      )
    }
    return shelf === 'recent' && !q ? list : sortDocs(list, settings.librarySort)
  }, [docs, shelf, query, settings.librarySort])

  const continueReading = useMemo(
    () =>
      (docs ?? [])
        .filter((d) => d.lastOpenedAt && d.status !== 'finished')
        .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
        .slice(0, 8),
    [docs],
  )

  const shelfMeta = SHELVES.find((s) => s.id === shelf)!
  const counts = (id: string): Counts => ({ highlights: hlCounts.get(id) ?? 0, notes: noteCounts.get(id) ?? 0 })

  if (!docs) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="thin-scroll flex-1 overflow-y-auto pt-safe">
      <div className="mx-auto w-full max-w-6xl px-4 pb-10 md:px-6">
        <header className="sticky top-0 z-10 -mx-4 bg-background/95 px-4 pb-3 pt-4 backdrop-blur md:-mx-6 md:px-6">
          <div className="flex items-center gap-2">
            <h1 className="min-w-0 flex-1 truncate font-serif text-[26px] font-semibold tracking-tight md:text-3xl">
              {shelf === 'all' ? 'Library' : shelfMeta.label}
            </h1>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <IconButton label="Sort">
                  <ArrowDownUp />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={settings.librarySort} onValueChange={(v) => update({ librarySort: v as LibrarySort })}>
                  {SORTS.map((s) => (
                    <DropdownMenuRadioItem key={s.id} value={s.id}>
                      {s.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <IconButton
              label={settings.libraryView === 'grid' ? 'Show as list' : 'Show as grid'}
              onClick={() => update({ libraryView: settings.libraryView === 'grid' ? 'list' : 'grid' })}
            >
              {settings.libraryView === 'grid' ? <List /> : <LayoutGrid />}
            </IconButton>
            <InkModeMenu variant="icon" />
            {tier === 'phone' && <ImportButton compact label="Import documents" />}
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title, author, tag…"
              className="pl-10 pr-10"
              aria-label="Search library"
            />
            {query && (
              <button
                type="button"
                className="absolute right-0 top-0 flex size-11 items-center justify-center text-muted-foreground"
                onClick={() => setQuery('')}
                aria-label="Clear search"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          {tier !== 'wide' && (
            <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4" role="tablist" aria-label="Shelves">
              {SHELVES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={shelf === s.id}
                  onClick={() => setParams(s.id === 'all' ? {} : { shelf: s.id }, { replace: true })}
                  className={cn(
                    'flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-border px-3.5 text-[13px] text-muted-foreground pointer-coarse:min-h-10',
                    shelf === s.id && 'border-foreground bg-foreground text-background',
                  )}
                >
                  <s.icon className="size-3.5" />
                  {s.label}
                </button>
              ))}
            </div>
          )}
        </header>

        {docs.length === 0 ? (
          <EmptyState icon={<BookOpen />} title="Your library is empty" className="py-20">
            <p>Import PDF, EPUB, FB2, TXT, Markdown, HTML and CBZ/CBT comics. They are stored privately in your account — only you can open them.</p>
            <div className="mt-6 flex flex-col items-center gap-3">
              <ImportButton label="Import documents" size="lg" />
              <span className="hidden items-center gap-1.5 text-[13px] md:inline-flex">
                <Upload className="size-4" /> or drag & drop files anywhere
              </span>
            </div>
          </EmptyState>
        ) : (
          <>
            {shelf === 'all' && !query && <ContinueReading docs={continueReading} />}
            {visible.length === 0 ? (
              <EmptyState icon={<Search />} title="Nothing here">
                {query ? 'No documents match your search.' : 'No documents on this shelf yet.'}
              </EmptyState>
            ) : (
              <section>
                {shelf === 'all' && !query && continueReading.length > 0 && (
                  <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
                    All documents · {visible.length}
                  </h2>
                )}
                {settings.libraryView === 'grid' ? (
                  <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                    {visible.map((d) => (
                      <GridCard key={d.id} doc={d} counts={counts(d.id)} />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-border bg-card px-3">
                    {visible.map((d) => (
                      <ListRow key={d.id} doc={d} counts={counts(d.id)} />
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}
