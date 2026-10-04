import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from '@/lib/cloud/useLiveQuery'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Bookmark as BookmarkIcon,
  Undo2,
  Volume2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  Expand,
  FileWarning,
  Library,
  ListTree,
  MoreHorizontal,
  Network,
  NotebookPen,
  PanelRight,
  Search,
  Shrink,
  Star,
  PenLine,
  Type,
} from 'lucide-react'
import { db } from '@/lib/db'
import { getReadingState, saveReadingPosition } from '@/lib/services/readingState'
import { getDocumentFile, markOpened, setStatus, toggleFavorite } from '@/lib/library'
import { createHighlight, deleteHighlight, mergeHighlights, unionPdfAnchors, updateHighlightColor, updateHighlightDrawer } from '@/lib/annotations'
import { ensureDocNode, ensureHighlightNode } from '@/lib/graph'
import { exportDocumentMarkdown } from '@/lib/backup'
import { clamp, copyText, cn, debounce, isCoarsePointer, uid } from '@/lib/utils'
import { THEME_META, readingModeOf, useSettings, withReadingMode, type Theme } from '@/store/settings'
import { InkModeMenu } from '@/components/InkModeMenu'
import { useViewport } from '@/hooks/useViewport'
import { Button, IconButton } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Slider, EmptyState } from '@/components/ui/controls'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/Spinner'
import { ImportButton } from '@/components/ImportButton'
import { NoteEditor, type NoteDraft } from '@/components/notes/NoteEditor'
import { InkToolbar } from '@/components/ink/InkToolbar'
import { LookupSheet, type LookupRequest } from './LookupSheet'
import { useReadingSession } from './useReadingSession'
import { useStatusItems } from './StatusLine'
import { ReadAloudBar, readAloudSupported, useReadAloud } from './ReadAloud'
import { lookupTerm, sentenceAround } from '@/lib/lookup'
import { useDocInk } from '@/components/ink/useInkHistory'
import { inkColorFor } from '@/lib/ink'
import { AnnotationToolbar } from './AnnotationToolbar'
import { NotePeek } from './NotePeek'
import { HighlightChooser } from './HighlightChooser'
import { ReaderSidePanel, type PanelTab } from './ReaderSidePanel'
import { ReaderSettings } from './ReaderSettings'
import { ReaderLibraryPanel } from './ReaderLibraryPanel'
import { ResizeHandle } from './ResizeHandle'
import type { PdfView } from './pdf/PdfReader'
import type { InkBinding, ReaderHandle, ReaderPosition, ReaderProps, SelectionInfo, TocItem } from './types'
import type { Anchor, DocumentRecord, Highlight, HighlightColor, HighlightDrawer, ReadingState } from '@/types'


const PdfReader = lazy(() => import('./pdf/PdfReader'))
const EpubReader = lazy(() => import('./epub/EpubReader'))

type Loaded = {
  doc: DocumentRecord
  file: Blob
  state?: ReadingState
  
  anchor?: Anchor
  linkKey?: string
}

async function resolveDeepLink(params: URLSearchParams): Promise<{ anchor?: Anchor; linkKey?: string }> {
  const hlId = params.get('hl')
  if (hlId) return { anchor: (await db.highlights.get(hlId))?.anchor, linkKey: `hl:${hlId}` }
  const noteId = params.get('note')
  if (noteId) return { anchor: (await db.notes.get(noteId))?.location, linkKey: `note:${noteId}` }
  const vocabId = params.get('vocab')
  if (vocabId) return { anchor: (await db.vocab.get(vocabId))?.anchor, linkKey: `vocab:${vocabId}` }
  return {}
}

export default function ReaderPage() {
  const { docId = '' } = useParams()
  return <ReaderLoader key={docId} docId={docId} />
}

function ReaderLoader({ docId }: { docId: string }) {
  const [params] = useSearchParams()
  const [data, setData] = useState<Loaded | 'missing' | 'nofile' | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const doc = await db.documents.get(docId)
      if (!doc) return !cancelled && setData('missing')
      const file = await getDocumentFile(docId)
      if (!file) return !cancelled && setData('nofile')
      const state = await getReadingState(docId)
      const link = await resolveDeepLink(params)
      await markOpened(docId)
      if (!cancelled) setData({ doc, file, state, ...link })
    })()
    return () => {
      cancelled = true
    }
  }, [docId, attempt]) 

  if (data === null) {
    return (
      <div className="flex h-full items-center justify-center bg-page">
        <Spinner />
      </div>
    )
  }
  if (data === 'missing') {
    return (
      <div className="flex h-full items-center justify-center pt-safe">
        <EmptyState icon={<FileWarning />} title="Document not found">
          <p>It isn’t in your library (it may have been deleted on another device).</p>
          <Button className="mt-5" onClick={() => history.back()}>
            Go back
          </Button>
        </EmptyState>
      </div>
    )
  }
  if (data === 'nofile') {
    return (
      <div className="flex h-full items-center justify-center pt-safe">
        <EmptyState icon={<FileWarning />} title="Couldn’t download this document">
          <p>Check your connection and try again. If the file was removed from cloud storage, import it again.</p>
          <Button className="mt-5" onClick={() => {
            setData(null)
            setAttempt((a) => a + 1)
          }}>
            Try again
          </Button>
          <div className="mt-5 flex justify-center gap-2">
            <Link to="/" className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium hover:bg-muted">
              Library
            </Link>
            <ImportButton label="Import file" />
          </div>
        </EmptyState>
      </div>
    )
  }
  return <ReaderView {...data} />
}

const QUICK_BACKGROUNDS: { theme: Theme; label: string }[] = [
  { theme: 'light', label: 'White background' },
  { theme: 'sepia', label: 'Yellow (sepia) background' },
  { theme: 'dark', label: 'Dark background' },
]


function QuickBackground({ tabIndex }: { tabIndex: number }) {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const mode = readingModeOf(settings)
  return (
    <div className="flex shrink-0 items-center">
    <div role="radiogroup" aria-label="Page background" className="flex shrink-0 items-center">
      {QUICK_BACKGROUNDS.map((b) => (
        <button
          key={b.theme}
          type="button"
          role="radio"
          aria-checked={mode === b.theme}
          aria-label={b.label}
          title={b.label}
          tabIndex={tabIndex}
          onClick={() => update(withReadingMode(settings, b.theme))}
          className="flex size-11 items-center justify-center"
        >
          <span
            className={cn(
              'block size-6 rounded-full border border-foreground/25',
              mode === b.theme && 'ring-2 ring-foreground ring-offset-2 ring-offset-[var(--background)]',
            )}
            style={{ background: THEME_META[b.theme].swatch }}
          />
        </button>
      ))}
    </div>
      <InkModeMenu variant="pill" tabIndex={tabIndex} />
    </div>
  )
}

interface ToolbarState {
  rect: SelectionInfo['rect']
  selection?: SelectionInfo
  highlight?: Highlight
}

function ReaderView({ doc: initialDoc, file, state: initialState, anchor: initialAnchor, linkKey }: Loaded) {
  const docId = initialDoc.id
  const doc = useLiveQuery(() => db.documents.get(docId), [docId]) ?? initialDoc
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { settings, update } = useSettings()
  const { width, isPhone } = useViewport()
  const splitCapable = width >= 1000

  const handle = useRef<ReaderHandle | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [chrome, setChrome] = useState(true)
  const [position, setPosition] = useState<ReaderPosition>({ label: '', progress: initialState?.progress ?? 0 })
  const [toc, setToc] = useState<TocItem[] | null>(null)
  const [toolbar, setToolbarRaw] = useState<ToolbarState | null>(null)
  const setToolbar: typeof setToolbarRaw = (v) => { console.log("[dbg] setToolbar", typeof v === "function" ? "fn" : v ? "set" : "null", (new Error().stack ?? "").split("\n").slice(2, 5).join(" | ")); setToolbarRaw(v) }
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const [panelTab, setPanelTab] = useState<PanelTab>('contents')
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [inkMode, setInkMode] = useState(false)
  const docInk = useDocInk(docId)
  const [lookupReq, setLookupReq] = useState<LookupRequest | null>(null)
  const [footnote, setFootnote] = useState<{ text: string; href: string } | null>(null)
  
  const [backStack, setBackStack] = useState<Anchor[]>([])
  const bookmarks = useLiveQuery(() => db.bookmarks.where('docId').equals(docId).toArray(), [docId]) ?? []
  const [scale, setScale] = useState(1)
  const [scrub, setScrub] = useState<number | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [pdfView, setPdfView] = useState<PdfView>(() => ({
    mode: initialState?.pdf?.mode ?? settings.pdf.defaultMode,
    zoomMode: initialState?.pdf?.zoomMode ?? settings.pdf.defaultZoomMode,
    zoom: initialState?.pdf?.zoom ?? 1,
  }))
  const [panelW, setPanelW] = useState(settings.readerPanelWidth)
  const [libW, setLibW] = useState(settings.readerLibraryWidth)
  const dragBase = useRef<number | null>(null)

  const highlights =
    useLiveQuery(
      () => db.highlights.where('docId').equals(docId).sortBy('order'),
      [docId],
    ) ?? []
  const docNotes = useLiveQuery(() => db.notes.where('docId').equals(docId).toArray(), [docId]) ?? []
  const notesByHighlight = useMemo(() => new Map(docNotes.filter((n) => n.highlightId).map((n) => [n.highlightId!, n])), [docNotes])
  
  




  const [selectMode, setSelectMode] = useState<{ item: Highlight; tmp: boolean } | null>(null)
  const selectModeRef = useRef(selectMode)
  selectModeRef.current = selectMode
  const readerHighlights = useMemo<Highlight[]>(() => {
    const list = highlights.map((h) => (notesByHighlight.has(h.id) ? { ...h, hasNote: true } : h))
    return selectMode?.tmp ? [...list, selectMode.item] : list
  }, [highlights, notesByHighlight, selectMode])
  const [peek, setPeek] = useState<{ noteId: string; quote?: string; highlightId?: string; rect?: SelectionInfo['rect'] } | null>(null)
  const [chooser, setChooser] = useState<{ hits: Highlight[]; rect: SelectionInfo['rect'] } | null>(null)
  
  useEffect(() => {
    if (noteDraft) setPeek(null)
  }, [noteDraft])
  const notesByHighlightRef = useRef(notesByHighlight)
  notesByHighlightRef.current = notesByHighlight
  
  const openAnnotation = useCallback((h: Highlight, rect: SelectionInfo['rect']) => {
    const n = notesByHighlightRef.current.get(h.id)
    if (n) {
      setToolbar(null)
      setPeek({ noteId: n.id, quote: h.text, highlightId: h.id, rect })
    } else {
      setPeek(null)
      setToolbar({ rect, highlight: h })
    }
  }, [])
  const peekNote = peek ? docNotes.find((n) => n.id === peek.noteId) : undefined

  const stats = useReadingSession(docId, position.progress, ready)
  const statusItems = useStatusItems(position, stats)
  const positionRef = useRef(position)
  positionRef.current = position
  const tts = useReadAloud(
    handle,
    useCallback(() => positionRef.current.page, []),
  )

  const pushBack = useCallback(() => {
    const loc = handle.current?.getLocation()
    if (loc) setBackStack((st) => [...st.slice(-29), loc])
  }, [])
  const goBack = () => {
    const last = backStack[backStack.length - 1]
    if (!last) return
    setBackStack((st) => st.slice(0, -1))
    handle.current?.goToAnchor(last)
  }

  
  const bookmarkHere = ready ? bookmarks.find((b) => handle.current?.isAnchorVisible(b.anchor)) : undefined
  const toggleBookmark = async () => {
    if (bookmarkHere) {
      await db.bookmarks.delete(bookmarkHere.id)
      return
    }
    const anchor: Anchor | null | undefined =
      doc.format !== 'epub' && position.page
        ? { type: 'pdf', page: position.page, rects: [{ page: position.page, x: 0, y: 0, w: 0, h: 0 }], quote: { exact: '' } }
        : handle.current?.getLocation()
    if (!anchor) return
    const label = anchor.type === 'pdf' ? `p. ${anchor.page}${position.chapter ? ` · ${position.chapter}` : ''}` : (position.chapter ?? 'Bookmark')
    await db.bookmarks.add({ id: uid('b'), docId, anchor, label, progress: position.progress, createdAt: Date.now() })
  }

  
  const pending = useRef<{ state: Pick<ReadingState, 'progress' | 'pdf' | 'epub'>; label: string } | null>(null)
  const flush = useCallback(async () => {
    const p = pending.current
    if (!p) return
    pending.current = null
    await saveReadingPosition(docId, p.state, p.label)
  }, [docId])
  const saveDebounced = useMemo(() => debounce(() => void flush(), 450), [flush])
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') saveDebounced.flush()
    }
    const onPageHide = () => saveDebounced.flush()
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('beforeunload', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('beforeunload', onPageHide)
      saveDebounced.flush()
    }
  }, [saveDebounced])

  
  const hlParam = params.get('hl')
  const noteParam = params.get('note') ?? params.get('vocab')
  const consumedLink = useRef(linkKey ?? null)
  useEffect(() => {
    if (!ready || (!hlParam && !noteParam)) return
    const key = hlParam ? `hl:${hlParam}` : params.get('note') ? `note:${noteParam}` : `vocab:${noteParam}`
    if (key !== consumedLink.current) {
      consumedLink.current = key
      void resolveDeepLink(params).then(({ anchor }) => anchor && handle.current?.goToAnchor(anchor))
    }
    const next = new URLSearchParams(params)
    next.delete('hl')
    next.delete('note')
    next.delete('vocab')
    setParams(next, { replace: true })
  }, [ready, hlParam, noteParam]) 

  
  useEffect(() => {
    if (!ready) return
    const t = setTimeout(() => setChrome(false), 2200)
    return () => clearTimeout(t)
  }, [ready])

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (inkMode && !t?.closest('input, textarea, [role="dialog"]')) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault()
          if (e.shiftKey) docInk.redo()
          else docInk.undo()
          return
        }
        if (e.key === 'Escape') {
          setInkMode(false)
          return
        }
      }
      if (t && (t.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]') || e.metaKey || e.ctrlKey || e.altKey)) return
      
      const rtl = doc.format === 'comic' && useSettings.getState().settings.comicRtl
      if (e.key === 'PageDown' || e.key === (rtl ? 'ArrowLeft' : 'ArrowRight')) {
        e.preventDefault()
        handle.current?.next()
      } else if (e.key === 'PageUp' || e.key === (rtl ? 'ArrowRight' : 'ArrowLeft')) {
        e.preventDefault()
        handle.current?.prev()
      } else if (e.key === ' ' && (doc.format === 'epub' || pdfView.mode === 'paginated')) {
        e.preventDefault()
        if (e.shiftKey) handle.current?.prev()
        else handle.current?.next()
      } else if (e.key === 'Escape') {
        setToolbar(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [doc.format, pdfView.mode, inkMode, docInk.undo, docInk.redo])

  
  const inkSettings = settings.ink
  const inkBinding: InkBinding = useMemo(
    () => ({
      active: inkMode,
      tool: inkSettings.tool,
      color: inkColorFor(inkSettings.tool, inkSettings.penColor, inkSettings.highlighterColor),
      size: inkSettings.size,
      fingersDraw: inkSettings.fingerDraws,
      pages: docInk.surfaces,
      onAdd: docInk.add,
      onErase: docInk.erase,
    }),
    [inkMode, inkSettings, docInk.surfaces, docInk.add, docInk.erase],
  )
  const startInk = () => {
    setToolbar(null)
    handle.current?.clearSelection()
    setPanelOpen((o) => (splitCapable ? o : false))
    setChrome(false)
    setInkMode(true)
  }
  
  const startHandwrittenNote = () => {
    const location = handle.current?.getLocation() ?? undefined
    setNoteDraft({ docId, location, initialTab: 'draw' })
  }

  
  const onSelection = useCallback((sel: SelectionInfo | null) => {
    const mode = selectModeRef.current
    if (sel && mode) {
      void extendSelectionRef.current(mode, sel)
      return
    }
    setToolbar((cur) => {
      if (!sel) return cur?.selection ? null : cur
      return { rect: sel.rect, selection: sel }
    })
  }, [])
  
  const extendSelection = async (mode: { item: Highlight; tmp: boolean }, sel: SelectionInfo) => {
    const span = await handle.current?.spanAnchors?.(mode.item.anchor, sel.anchor)
    setSelectMode(null)
    if (!span) {
      handle.current?.clearSelection()
      toast.error(doc.format === 'epub' ? 'The start and end must be in the same chapter.' : 'Could not select that passage.')
      return
    }
    if (mode.tmp) {
      
      
      setToolbar({ rect: sel.rect, selection: { text: span.text, anchor: span.anchor, order: span.order, rect: sel.rect } })
      return
    }
    
    handle.current?.clearSelection()
    await db.highlights.update(mode.item.id, { anchor: span.anchor, text: span.text, order: span.order, updatedAt: Date.now() })
    toast.success('Highlight extended')
  }
  const lastPosKey = useRef('')
  const extendSelectionRef = useRef(extendSelection)
  extendSelectionRef.current = extendSelection

  const readerProps: ReaderProps = {
    doc,
    file,
    initialState,
    initialAnchor,
    highlights: readerHighlights,
    tapZones: settings.tapZones,
    onReady: useCallback(() => setReady(true), []),
    onError: useCallback((m: string) => setError(m), []),
    onPosition: useCallback((p: ReaderPosition) => {
      setPosition(p)
      const key = `${p.page ?? ''}|${p.progress.toFixed(5)}`
      if (key === lastPosKey.current) return
      lastPosKey.current = key
      setToolbar((cur) => (cur && (cur.highlight || !isCoarsePointer()) ? null : cur))
    }, []),
    onSaveState: useCallback(
      (s: Pick<ReadingState, 'progress' | 'pdf' | 'epub'>, label: string) => {
        pending.current = { state: s, label }
        saveDebounced()
      },
      [saveDebounced],
    ),
    onSelection,
    onHighlightTap: useCallback(
      (hits: Highlight[], rect: SelectionInfo['rect']) => {
        const mode = selectModeRef.current
        if (mode && hits.some((h) => h.id === mode.item.id)) {
          setSelectMode(null)
          toast('Selection cancelled')
          return
        }
        
        if (hits.length > 1) {
          setToolbar(null)
          setPeek(null)
          setChooser({ hits, rect })
          return
        }
        setChooser(null)
        if (hits[0]) openAnnotation(hits[0], rect)
      },
      [openAnnotation],
    ),
    onToggleChrome: useCallback(() => {
      setToolbar(null)
      setPeek(null)
      setChooser(null)
      setChrome((c) => !c)
    }, []),
    onToc: useCallback((items: TocItem[]) => setToc(items), []),
    onJump: pushBack,
    onFootnote: useCallback((n: { text: string; href: string }) => setFootnote(n), []),
  }

  
  const makeHighlight = async (sel: SelectionInfo, color: HighlightColor) => {
    const h = await createHighlight({ docId, anchor: sel.anchor, text: sel.text, color, order: sel.order, drawer: settings.highlightDrawer })
    update({ lastHighlightColor: color })
    handle.current?.clearSelection()
    return h
  }

  const toolbarActions = toolbar && {
    onColor: async (c: HighlightColor) => {
      if (toolbar.selection) await makeHighlight(toolbar.selection, c)
      else if (toolbar.highlight) {
        await updateHighlightColor(toolbar.highlight.id, c)
        update({ lastHighlightColor: c })
      }
      setToolbar(null)
    },
    onSelectMode: () => {
      const sel = toolbar.selection
      if (!sel) return
      const now = Date.now()
      setSelectMode({
        tmp: true,
        item: { id: 'select-mode', docId, anchor: sel.anchor, text: sel.text, color: settings.lastHighlightColor, drawer: 'underscore', order: sel.order, createdAt: now, updatedAt: now },
      })
      handle.current?.clearSelection()
      setToolbar(null)
    },
    onExtend: () => {
      if (!toolbar.highlight) return
      setSelectMode({ tmp: false, item: toolbar.highlight })
      setToolbar(null)
    },
    onAdjust: async (side: 0 | 1, dir: -1 | 1, byChar: boolean) => {
      const h = toolbar.highlight
      if (!h) return
      const res = await handle.current?.adjustAnchor?.(h.anchor, side, dir, byChar)
      if (!res) return
      const order = h.anchor.type === 'pdf' && res.anchor.type === 'pdf' ? res.anchor.rects[0].page * 1e6 + Math.round(res.anchor.rects[0].y * 1e5) : h.order
      await db.highlights.update(h.id, { anchor: res.anchor, text: res.text, order, updatedAt: Date.now() })
      
      setToolbar((t) => (t?.highlight?.id === h.id ? { ...t, highlight: { ...t.highlight, anchor: res.anchor, text: res.text, order } } : t))
    },
    onDrawer: async (d: HighlightDrawer) => {
      if (!toolbar.highlight) return
      await updateHighlightDrawer(toolbar.highlight.id, d)
      update({ highlightDrawer: d }) 
      setToolbar(null)
    },
    onNote: async () => {
      
      if (toolbar.selection && !toolbar.highlight) {
        const h = await makeHighlight(toolbar.selection, settings.lastHighlightColor)
        setToolbar(null)
        setNoteDraft({ docId, highlightId: h.id, quote: h.text })
        return
      }
      const h = toolbar.highlight
      if (!h) return
      const existing = toolbar.highlight ? await db.notes.where('highlightId').equals(h.id).first() : undefined
      setToolbar(null)
      setNoteDraft(existing ? { note: existing, quote: h.text } : { docId, highlightId: h.id, quote: h.text })
    },
    onNode: async () => {
      let h = toolbar.highlight
      if (toolbar.selection) h = await makeHighlight(toolbar.selection, settings.lastHighlightColor)
      setToolbar(null)
      if (!h) return
      const node = await ensureHighlightNode(h.id)
      if (node) toast.success('Highlight node created', { action: { label: 'View graph', onClick: () => navigate(`/graph?focus=${node.id}`) } })
    },
    onLookup: () => {
      const text = toolbar.selection?.text ?? toolbar.highlight?.text ?? ''
      const anchor = toolbar.selection?.anchor ?? toolbar.highlight?.anchor
      const term = lookupTerm(text)
      if (!term) return
      setLookupReq({
        term,
        lang: handle.current?.getLanguage(),
        context: anchor ? sentenceAround(anchor.quote.prefix, anchor.quote.exact, anchor.quote.suffix).slice(0, 300) : undefined,
        docId,
        anchor,
      })
      setToolbar(null)
    },
    onCopy: async () => {
      const text = toolbar.selection?.text ?? toolbar.highlight?.text ?? ''
      const ok = await copyText(text)
      toast[ok ? 'success' : 'error'](ok ? 'Copied to clipboard' : 'Could not copy')
      setToolbar(null)
    },
    onDelete: toolbar.highlight
      ? async () => {
          await deleteHighlight(toolbar.highlight!.id)
          setToolbar(null)
          toast.success('Highlight deleted')
        }
      : undefined,
  }

  
  const openPanel = (tab: PanelTab) => {
    if (panelOpen && panelTab === tab) {
      setPanelOpen(false)
      return
    }
    setPanelTab(tab)
    setPanelOpen(true)
    if (splitCapable && width < 1300) setLibraryOpen(false)
  }
  const toggleLibrary = () => {
    setLibraryOpen((o) => !o)
    if (!libraryOpen && width < 1300) setPanelOpen(false)
  }
  const inlinePanel = splitCapable && panelOpen
  const inlineLibrary = splitCapable && libraryOpen

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      toast.error('Full screen is not available here')
    }
  }

  const progressMarks = useMemo(() => {
    const h = handle.current
    if (!ready || !h) return []
    const marks: { id: string; p: number; kind: 'bookmark' | 'highlight' | 'note'; color?: string }[] = []
    for (const b of bookmarks) marks.push({ id: b.id, p: b.progress, kind: 'bookmark' })
    for (const hl of readerHighlights) {
      const p = h.progressOf(hl.anchor)
      if (p === null) continue
      marks.push({ id: hl.id, p: clamp(p, 0, 1), kind: hl.hasNote ? 'note' : 'highlight', color: `var(--hl-${hl.color}-solid)` })
    }
    return marks
    
  }, [ready, bookmarks, readerHighlights, position.chapterEnd]) 

  const progressShown = scrub ?? position.progress
  const scrubLabel =
    scrub !== null
      ? position.total
        ? `Page ${clamp(Math.round(scrub * position.total), 1, position.total)} of ${position.total}`
        : `${Math.round(scrub * 100)}%`
      : null

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-background">
      {inlineLibrary && (
        <>
          <aside className="flex h-full shrink-0 flex-col border-r border-border bg-card/60 pt-safe" style={{ width: libW }}>
            <div className="flex h-14 items-center gap-2 px-3">
              <Library className="size-[18px] text-muted-foreground" />
              <span className="flex-1 text-[15px] font-semibold">Library</span>
            </div>
            <ReaderLibraryPanel currentId={docId} />
          </aside>
          <ResizeHandle
            side="left"
            label="Resize library panel"
            onResize={(d) => {
              dragBase.current ??= libW
              setLibW(clamp(dragBase.current + d, 220, 480))
            }}
            onCommit={() => {
              dragBase.current = null
              update({ readerLibraryWidth: libW })
            }}
          />
        </>
      )}

      {}
      <div className="relative min-w-0 flex-1 bg-page" style={{ '--page-contrast': settings.pageContrast } as React.CSSProperties}>
        <div className="absolute inset-0">
          {error ? (
            <div className="flex h-full items-center justify-center">
              <EmptyState icon={<FileWarning />} title="Can’t open this document">
                {error}
              </EmptyState>
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Spinner />
                </div>
              }
            >
              {doc.format !== 'epub' ? (
                <PdfReader
                  ref={handle}
                  {...readerProps}
                  view={pdfView}
                  onViewChange={setPdfView}
                  onScaleChange={setScale}
                  ink={inkBinding}
                />
              ) : (
                <EpubReader ref={handle} {...readerProps} />
              )}
            </Suspense>
          )}
          {!ready && !error && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-page">
              <Spinner label="Opening document" />
            </div>
          )}
        </div>

        {}
        {ready && !inkMode && (
          <button
            type="button"
            onClick={() => void toggleBookmark()}
            aria-label={bookmarkHere ? 'Remove bookmark' : 'Bookmark this page'}
            aria-pressed={!!bookmarkHere}
            className={cn('absolute right-0 top-0 z-20 size-12 pr-safe', chrome && 'pointer-events-none opacity-0')}
            style={{ marginTop: 'var(--safe-top)' }}
          >
            {bookmarkHere && <span className="absolute right-0 top-0 size-0 border-l-[30px] border-t-[30px] border-l-transparent border-t-foreground/75 eink:border-t-black" />}
          </button>
        )}

        {backStack.length > 0 && !inkMode && (
          <button
            type="button"
            onClick={goBack}
            className="anim-fade-in absolute left-3 z-30 flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-popover/95 px-3.5 text-[13px] font-medium shadow-lg"
            style={{ bottom: chrome ? 'calc(var(--safe-bottom) + 100px)' : 'calc(var(--safe-bottom) + 36px)' }}
          >
            <Undo2 className="size-4" /> Back
          </button>
        )}

        {}
        <header
          className={cn(
            'absolute inset-x-0 top-0 z-30 border-b border-border bg-background/95 pt-safe backdrop-blur transition-transform duration-200 supports-[backdrop-filter]:bg-background/85',
            !chrome && '-translate-y-full',
          )}
          aria-hidden={!chrome}
        >
          <div className="flex h-14 items-center gap-1 px-1.5 pl-safe pr-safe">
            <IconButton label="Back to library" onClick={() => navigate('/')} tabIndex={chrome ? 0 : -1}>
              <ArrowLeft />
            </IconButton>
            {splitCapable && (
              <IconButton label="Toggle library panel" active={libraryOpen} onClick={toggleLibrary} tabIndex={chrome ? 0 : -1}>
                <Library />
              </IconButton>
            )}
            <div className="min-w-0 flex-1 px-1.5">
              <h1 className="truncate text-[15px] font-semibold leading-tight">{doc.title}</h1>
              {doc.author && !isPhone && <p className="truncate text-[12px] text-muted-foreground">{doc.author}</p>}
            </div>
            <IconButton
              label={doc.format !== 'epub' ? 'Write with Apple Pencil' : 'Handwritten note here'}
              active={inkMode}
              onClick={doc.format !== 'epub' ? startInk : startHandwrittenNote}
              tabIndex={chrome ? 0 : -1}
            >
              <PenLine />
            </IconButton>
            {!isPhone && (
              <IconButton label={bookmarkHere ? 'Remove bookmark' : 'Bookmark this page'} active={!!bookmarkHere} onClick={() => void toggleBookmark()} tabIndex={chrome ? 0 : -1}>
                <BookmarkIcon className={cn(bookmarkHere && 'fill-current')} />
              </IconButton>
            )}
            <IconButton label="Search in document" active={panelOpen && panelTab === 'search'} onClick={() => openPanel('search')} tabIndex={chrome ? 0 : -1}>
              <Search />
            </IconButton>
            <IconButton
              label="Contents, highlights & notes"
              active={panelOpen && panelTab !== 'search'}
              onClick={() => openPanel(panelOpen && panelTab !== 'search' ? panelTab : 'contents')}
              tabIndex={chrome ? 0 : -1}
            >
              {splitCapable ? <PanelRight /> : <ListTree />}
            </IconButton>
            <IconButton label="Reading settings" active={settingsOpen} onClick={() => setSettingsOpen(true)} tabIndex={chrome ? 0 : -1}>
              <Type />
            </IconButton>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <IconButton label="More actions" tabIndex={chrome ? 0 : -1}>
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void toggleFavorite(doc)}>
                  <Star className={cn(doc.favorite && 'fill-current')} /> {doc.favorite ? 'Remove from favorites' : 'Add to favorites'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={async () => {
                    await setStatus(doc.id, doc.status === 'finished' ? 'reading' : 'finished')
                    toast.success(doc.status === 'finished' ? 'Marked as reading' : 'Marked as finished')
                  }}
                >
                  <CheckCircle2 /> {doc.status === 'finished' ? 'Mark as reading' : 'Mark as finished'}
                </DropdownMenuItem>
                {isPhone && (
                  <DropdownMenuItem onSelect={() => void toggleBookmark()}>
                    <BookmarkIcon className={cn(bookmarkHere && 'fill-current')} /> {bookmarkHere ? 'Remove bookmark' : 'Bookmark this page'}
                  </DropdownMenuItem>
                )}
                {readAloudSupported() && (
                  <DropdownMenuItem onSelect={() => (tts.status === 'idle' ? tts.start() : tts.stop())}>
                    <Volume2 /> {tts.status === 'idle' ? 'Read aloud' : 'Stop reading aloud'}
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setNoteDraft({ docId })}>
                  <NotebookPen /> New note for this document
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={async () => {
                    const node = await ensureDocNode(docId)
                    if (node) toast.success('Document node ready', { action: { label: 'View graph', onClick: () => navigate(`/graph?focus=${node.id}`) } })
                  }}
                >
                  <Network /> Create graph node
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void exportDocumentMarkdown(docId)}>
                  <Download /> Export highlights & notes
                </DropdownMenuItem>
                {document.fullscreenEnabled && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void toggleFullscreen()}>
                      {isFullscreen ? <Shrink /> : <Expand />} {isFullscreen ? 'Exit full screen' : 'Full screen'}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {}
        <footer
          className={cn(
            'absolute inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 pb-safe backdrop-blur transition-transform duration-200 supports-[backdrop-filter]:bg-background/85',
            !chrome && 'translate-y-full',
          )}
          aria-hidden={!chrome}
        >
          <div className="flex items-center gap-1 px-1.5 pt-1 pl-safe pr-safe">
            <IconButton label="Previous page" onClick={() => handle.current?.prev()} tabIndex={chrome ? 0 : -1}>
              <ChevronLeft />
            </IconButton>
            <div className="relative min-w-0 flex-1">
              {}
              <div className="pointer-events-none absolute inset-x-3 top-1/2 h-0" aria-hidden>
                {progressMarks.map((m) => (
                  <span
                    key={m.id}
                    className={cn(
                      'absolute -top-3 -translate-x-1/2 rounded-full',
                      m.kind === 'bookmark' ? 'h-2.5 w-[3px] bg-foreground/70' : m.kind === 'note' ? 'size-[5px] -translate-y-px bg-foreground/60' : 'h-2 w-[3px]',
                    )}
                    style={{ left: `${m.p * 100}%`, background: m.color }}
                  />
                ))}
              </div>
              <Slider
                label="Reading progress"
                min={0}
                max={1}
                step={0.001}
                value={[progressShown]}
                onValueChange={([v]) => setScrub(v)}
                onValueCommit={([v]) => {
                  setScrub(null)
                  pushBack()
                  handle.current?.goToProgress(v)
                }}
                tabIndex={chrome ? 0 : -1}
              />
            </div>
            <IconButton label="Next page" onClick={() => handle.current?.next()} tabIndex={chrome ? 0 : -1}>
              <ChevronRight />
            </IconButton>
          </div>
          <div className="flex items-center gap-2 px-3 pb-1 pl-safe pr-safe">
            <QuickBackground tabIndex={chrome ? 0 : -1} />
            <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-[12px] tabular-nums text-muted-foreground">
              <span className="truncate">{scrubLabel ?? position.label}</span>
              {!scrubLabel && position.detail && <span className="hidden truncate sm:inline">· {position.detail}</span>}
              {!scrubLabel && statusItems.length > 0 && <span className="hidden truncate md:inline">· {statusItems.join(' · ')}</span>}
            </div>
            {}
            <div className="hidden w-[212px] shrink-0 sm:block" />
          </div>
        </footer>

        {}
        {!chrome && position.label && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-[calc(var(--safe-bottom)+8px)]">
            <span className="max-w-[80%] truncate rounded-full bg-page/90 px-3 py-0.5 text-[11px] tabular-nums tracking-wide text-muted-foreground">
              {[position.label, ...statusItems].join(' · ')}
            </span>
          </div>
        )}
      </div>

      {inlinePanel && (
        <>
          <ResizeHandle
            side="right"
            label="Resize side panel"
            onResize={(d) => {
              dragBase.current ??= panelW
              setPanelW(clamp(dragBase.current + d, 280, Math.min(640, width * 0.5)))
            }}
            onCommit={() => {
              dragBase.current = null
              update({ readerPanelWidth: panelW })
            }}
          />
          <aside className="flex h-full shrink-0 flex-col border-l border-border bg-card/60 pt-safe pr-safe" style={{ width: panelW }}>
            <div className="flex h-14 shrink-0 items-center justify-between px-3">
              <span className="min-w-0 truncate text-[15px] font-semibold">{doc.title}</span>
              <Button size="sm" variant="ghost" onClick={() => setPanelOpen(false)}>
                Close
              </Button>
            </div>
            <ReaderSidePanel
              tab={panelTab}
              onTab={setPanelTab}
              toc={toc}
              docId={docId}
              highlights={highlights}
              inkPages={doc.format !== 'epub' ? docInk.surfaces : undefined}
              bookmarks={bookmarks}
              currentPage={doc.format !== 'epub' ? (position.page ?? 1) : undefined}
              onBeforeJump={pushBack}
              handle={handle}
              onNavigate={() => {}}
              onEditNote={setNoteDraft}
            />
          </aside>
        </>
      )}

      {!splitCapable && (
        <Sheet open={panelOpen} onOpenChange={setPanelOpen}>
          <SheetContent side={isPhone ? 'bottom' : 'right'} title={doc.title} className={cn(isPhone && 'h-[85dvh]')}>
            <ReaderSidePanel
              tab={panelTab}
              onTab={setPanelTab}
              toc={toc}
              docId={docId}
              highlights={highlights}
              inkPages={doc.format !== 'epub' ? docInk.surfaces : undefined}
              bookmarks={bookmarks}
              currentPage={doc.format !== 'epub' ? (position.page ?? 1) : undefined}
              onBeforeJump={pushBack}
              handle={handle}
              onNavigate={() => setPanelOpen(false)}
              onEditNote={setNoteDraft}
              className="pt-1"
            />
          </SheetContent>
        </Sheet>
      )}

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side={isPhone ? 'bottom' : 'right'} title="Reading settings" className={cn(!isPhone && 'w-[min(400px,92vw)]')}>
          <ReaderSettings format={doc.format} pdfView={pdfView} onPdfView={setPdfView} scale={scale} />
        </SheetContent>
      </Sheet>

      {toolbar && toolbarActions && (
        <AnnotationToolbar
          rect={toolbar.rect}
          activeColor={toolbar.highlight?.color}
          onColor={toolbarActions.onColor}
          drawer={toolbar.highlight?.drawer}
          onDrawer={toolbar.highlight ? toolbarActions.onDrawer : undefined}
          onAdjust={toolbar.highlight && handle.current?.adjustAnchor ? toolbarActions.onAdjust : undefined}
          onExtend={toolbar.highlight && handle.current?.spanAnchors ? toolbarActions.onExtend : undefined}
          onSelectMode={toolbar.selection && handle.current?.spanAnchors ? toolbarActions.onSelectMode : undefined}
          onNote={toolbarActions.onNote}
          onNode={toolbarActions.onNode}
          onCopy={toolbarActions.onCopy}
          onLookup={toolbarActions.onLookup}
          onDelete={toolbarActions.onDelete}
          onClose={() => {
            setToolbar(null)
            if (toolbar.selection) handle.current?.clearSelection()
          }}
        />
      )}

      {inkMode && (
        <InkToolbar
          canUndo={docInk.canUndo}
          canRedo={docInk.canRedo}
          onUndo={docInk.undo}
          onRedo={docInk.redo}
          onDone={() => setInkMode(false)}
        />
      )}

      {peekNote && !noteDraft && (
        <NotePeek
          note={peekNote}
          quote={peek?.quote}
          onEdit={() => {
            setToolbar(null)
            setPeek(null)
            setNoteDraft({ note: peekNote, quote: peek?.quote })
          }}
          onHighlightMenu={
            peek?.highlightId && peek.rect
              ? () => {
                  const h = highlights.find((x) => x.id === peek.highlightId)
                  setPeek(null)
                  if (h) setToolbar({ rect: peek.rect!, highlight: h })
                }
              : undefined
          }
          onClose={() => setPeek(null)}
        />
      )}

      {selectMode && (
        <div
          role="status"
          className="fixed inset-x-3 top-[calc(var(--safe-top)+64px)] z-40 mx-auto flex max-w-lg items-center gap-3 rounded-2xl border border-border bg-popover px-4 py-2.5 shadow-2xl"
        >
          <p className="min-w-0 flex-1 text-[13px] leading-snug">
            <span className="font-semibold">{selectMode.tmp ? 'Select mode' : 'Extend highlight'}:</span> select where the passage should end — you can turn pages.
            {selectMode.tmp && ' Tap the first fragment to cancel.'}
          </p>
          <Button size="sm" variant="secondary" onClick={() => setSelectMode(null)}>
            Cancel
          </Button>
        </div>
      )}

      {chooser && !noteDraft && (
        <HighlightChooser
          hits={chooser.hits}
          hasNote={(id) => notesByHighlight.has(id)}
          onPick={(h) => {
            setChooser(null)
            openAnnotation(h, chooser.rect)
          }}
          onMerge={async () => {
            const hits = chooser.hits
            setChooser(null)
            const union = hits.every((h) => h.anchor.type === 'pdf') ? unionPdfAnchors(hits) : (handle.current?.unionAnchor?.(hits.map((h) => h.anchor)) ?? null)
            if (!union) return void toast.error('These highlights can’t be merged')
            await mergeHighlights(hits, union)
            toast.success('Highlights merged')
          }}
          onClose={() => setChooser(null)}
        />
      )}

      <NoteEditor draft={noteDraft} onOpenChange={(o) => !o && setNoteDraft(null)} />

      <LookupSheet request={lookupReq} onClose={() => setLookupReq(null)} />

      <Sheet open={!!footnote} onOpenChange={(o) => !o && setFootnote(null)}>
        <SheetContent side="bottom" title="Note" className="max-h-[60dvh]">
          <div className="flex flex-col gap-3 px-4 pb-5">
            <p className="font-serif text-[16px] leading-relaxed">{footnote?.text}</p>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                onClick={() => {
                  if (!footnote) return
                  pushBack()
                  handle.current?.goToHref?.(footnote.href)
                  setFootnote(null)
                }}
              >
                Go to note
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      <ReadAloudBar status={tts.status} onToggle={tts.togglePause} onStop={tts.stop} />
    </div>
  )
}
