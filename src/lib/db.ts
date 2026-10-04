import { CloudTable, type TableDef } from './cloud/table'
import type {
  Bookmark,
  DocumentRecord,
  EpubLocationsRecord,
  GraphEdge,
  GraphNode,
  Highlight,
  InkPage,
  LookupCache,
  Note,
  ReadingSession,
  ReadingState,
  SettingRecord,
  VocabWord,
} from '@/types'









type Row = Record<string, unknown>
const iso = (ms: number | null | undefined) => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null)
const ms = (v: unknown) => (typeof v === 'string' ? Date.parse(v) : null)
const msNow = (v: unknown) => ms(v) ?? Date.now()
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
const optStr = (v: unknown, max: number) => (typeof v === 'string' && v ? v.slice(0, max) : null)
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const unit = (v: unknown) => Math.min(1, Math.max(0, num(v)))
const tags = (v: unknown) => (Array.isArray(v) ? v.filter((t): t is string => typeof t === 'string').map((t) => t.slice(0, 40)).slice(0, 50) : [])
const DRAWERS = new Set(['lighten', 'underscore', 'strikeout', 'invert'])
const obj = <T,>(v: unknown) => (v && typeof v === 'object' ? (v as T) : undefined)
const byId = (id: string) => ({ id })

const documents: TableDef<DocumentRecord> = {
  key: 'id',
  remote: {
    table: 'documents',
    keyColumns: ['id'],
    match: byId,
    toRow: (d) => ({
      id: d.id,
      content_hash: d.contentHash,
      format: d.format,
      source_format: d.sourceFormat ?? null,
      kind: d.kind,
      title: str(d.title, 500) || 'Untitled',
      author: str(d.author, 500),
      file_name: str(d.fileName, 255) || 'document',
      mime_type: str(d.mimeType, 100),
      size_bytes: Math.max(0, Math.round(num(d.size))),
      file_path: d.filePath,
      cover_path: d.coverPath ?? null,
      page_count: d.pageCount ?? null,
      favorite: !!d.favorite,
      status: d.status,
      progress: unit(d.progress),
      position_label: optStr(d.positionLabel, 200),
      content_box: d.contentBox ?? null,
      tags: tags(d.tags),
      added_at: iso(d.addedAt),
      last_opened_at: iso(d.lastOpenedAt),
      updated_at: new Date().toISOString(),
    }),
    fromRow: (r) => ({
      id: r.id as string,
      contentHash: r.content_hash as string,
      format: r.format as DocumentRecord['format'],
      sourceFormat: (r.source_format as DocumentRecord['sourceFormat']) ?? undefined,
      kind: r.kind as DocumentRecord['kind'],
      title: r.title as string,
      author: (r.author as string) ?? '',
      fileName: r.file_name as string,
      mimeType: r.mime_type as string,
      size: Number(r.size_bytes) || 0,
      filePath: r.file_path as string,
      coverPath: (r.cover_path as string) ?? undefined,
      pageCount: (r.page_count as number) ?? undefined,
      favorite: r.favorite ? 1 : 0,
      status: r.status as DocumentRecord['status'],
      progress: num(r.progress),
      positionLabel: (r.position_label as string) ?? undefined,
      contentBox: obj(r.content_box),
      tags: tags(r.tags),
      addedAt: msNow(r.added_at),
      lastOpenedAt: ms(r.last_opened_at),
    }),
  },
}

const readingStates: TableDef<ReadingState> = {
  key: 'docId',
  remote: {
    table: 'reading_states',
    keyColumns: ['user_id', 'document_id'],
    match: (docId) => ({ document_id: docId }),
    toRow: (s) => ({ document_id: s.docId, progress: unit(s.progress), pdf: s.pdf ?? null, epub: s.epub ?? null, updated_at: iso(s.updatedAt) }),
    fromRow: (r) => ({ docId: r.document_id as string, progress: num(r.progress), pdf: obj(r.pdf), epub: obj(r.epub), updatedAt: msNow(r.updated_at) }),
  },
}

const highlights: TableDef<Highlight> = {
  key: 'id',
  remote: {
    table: 'highlights',
    keyColumns: ['id'],
    match: byId,
    toRow: (h) => ({
      id: h.id,
      document_id: h.docId,
      color: h.color,
      anchor: h.anchor,
      text: str(h.text, 20000),
      sort_order: num(h.order),
      created_at: iso(h.createdAt),
      updated_at: iso(h.updatedAt),
      
      ...(h.tags ? { tags: tags(h.tags) } : {}),
      ...(h.drawer ? { drawer: h.drawer } : {}),
    }),
    fromRow: (r) => ({
      id: r.id as string,
      docId: r.document_id as string,
      color: r.color as Highlight['color'],
      anchor: r.anchor as Highlight['anchor'],
      text: (r.text as string) ?? '',
      order: num(r.sort_order),
      createdAt: msNow(r.created_at),
      updatedAt: msNow(r.updated_at),
      tags: Array.isArray(r.tags) ? tags(r.tags) : undefined,
      drawer: DRAWERS.has(r.drawer as string) ? (r.drawer as Highlight['drawer']) : undefined,
    }),
  },
}

const notes: TableDef<Note> = {
  key: 'id',
  remote: {
    table: 'notes',
    keyColumns: ['id'],
    match: byId,
    toRow: (n) => ({
      id: n.id,
      document_id: n.docId ?? null,
      highlight_id: n.highlightId ?? null,
      title: str(n.title, 500),
      content: str(n.content, 200000),
      tags: tags(n.tags),
      location: n.location ?? null,
      ink: n.ink ?? null,
      created_at: iso(n.createdAt),
      updated_at: iso(n.updatedAt),
    }),
    fromRow: (r) => ({
      id: r.id as string,
      docId: (r.document_id as string) ?? undefined,
      highlightId: (r.highlight_id as string) ?? undefined,
      title: (r.title as string) ?? '',
      content: (r.content as string) ?? '',
      tags: tags(r.tags),
      location: obj(r.location),
      ink: obj(r.ink),
      createdAt: msNow(r.created_at),
      updatedAt: msNow(r.updated_at),
    }),
  },
}

const nodes: TableDef<GraphNode> = {
  key: 'id',
  remote: {
    table: 'nodes',
    keyColumns: ['id'],
    match: byId,
    toRow: (n) => ({
      id: n.id,
      type: n.type,
      label: str(n.label, 1000),
      description: optStr(n.description, 20000),
      document_id: n.docId ?? null,
      highlight_id: n.highlightId ?? null,
      note_id: n.noteId ?? null,
      x: num(n.x),
      y: num(n.y),
      created_at: iso(n.createdAt),
      updated_at: iso(n.updatedAt),
    }),
    fromRow: (r) => ({
      id: r.id as string,
      type: r.type as GraphNode['type'],
      label: (r.label as string) ?? '',
      description: (r.description as string) ?? undefined,
      docId: (r.document_id as string) ?? undefined,
      highlightId: (r.highlight_id as string) ?? undefined,
      noteId: (r.note_id as string) ?? undefined,
      x: num(r.x),
      y: num(r.y),
      createdAt: msNow(r.created_at),
      updatedAt: msNow(r.updated_at),
    }),
  },
}

const edges: TableDef<GraphEdge> = {
  key: 'id',
  remote: {
    table: 'edges',
    keyColumns: ['id'],
    match: byId,
    toRow: (e) => ({ id: e.id, source_id: e.source, target_id: e.target, label: optStr(e.label, 200), auto: !!e.auto, created_at: iso(e.createdAt) }),
    fromRow: (r) => ({
      id: r.id as string,
      source: r.source_id as string,
      target: r.target_id as string,
      label: (r.label as string) ?? undefined,
      auto: r.auto ? 1 : 0,
      createdAt: msNow(r.created_at),
    }),
  },
}


const settings: TableDef<SettingRecord> = {
  key: 'key',
  remote: {
    table: 'user_settings',
    keyColumns: ['user_id'],
    match: () => ({}),
    toRow: (s) => ({ settings: s.value ?? {}, updated_at: new Date().toISOString() }),
    fromRow: (r) => ({ key: 'app', value: r.settings }),
  },
}

const epubLocations: TableDef<EpubLocationsRecord> = {
  key: 'docId',
  remote: {
    table: 'epub_locations',
    keyColumns: ['user_id', 'document_id'],
    match: (docId) => ({ document_id: docId }),
    toRow: (l) => ({ document_id: l.docId, locations: l.locations }),
    fromRow: (r) => ({ docId: r.document_id as string, locations: r.locations as string }),
  },
}

const inks: TableDef<InkPage> = {
  key: 'id',
  remote: {
    table: 'ink_pages',
    keyColumns: ['id'],
    match: byId,
    toRow: (p) => ({ id: p.id, document_id: p.docId, page: p.page, strokes: p.strokes, updated_at: iso(p.updatedAt) }),
    fromRow: (r) => ({ id: r.id as string, docId: r.document_id as string, page: num(r.page, 1), strokes: (r.strokes as InkPage['strokes']) ?? [], updatedAt: msNow(r.updated_at) }),
  },
}

const bookmarks: TableDef<Bookmark> = {
  key: 'id',
  remote: {
    table: 'bookmarks',
    keyColumns: ['id'],
    match: byId,
    toRow: (b) => ({ id: b.id, document_id: b.docId, anchor: b.anchor, label: str(b.label, 300), progress: unit(b.progress), created_at: iso(b.createdAt) }),
    fromRow: (r) => ({
      id: r.id as string,
      docId: r.document_id as string,
      anchor: r.anchor as Bookmark['anchor'],
      label: (r.label as string) ?? '',
      progress: num(r.progress),
      createdAt: msNow(r.created_at),
    }),
  },
}

const vocab: TableDef<VocabWord> = {
  key: 'id',
  remote: {
    table: 'vocab_words',
    keyColumns: ['id'],
    match: byId,
    toRow: (w) => ({
      id: w.id,
      word: str(w.word, 200),
      lang: optStr(w.lang, 20),
      definition: optStr(w.definition, 5000),
      context: optStr(w.context, 2000),
      document_id: w.docId ?? null,
      anchor: w.anchor ?? null,
      created_at: iso(w.createdAt),
      due_at: iso(w.dueAt),
      interval_days: Math.max(0, Math.round(num(w.intervalDays))),
      reviews: Math.max(0, Math.round(num(w.reviews))),
    }),
    fromRow: (r) => ({
      id: r.id as string,
      word: r.word as string,
      lang: (r.lang as string) ?? undefined,
      definition: (r.definition as string) ?? undefined,
      context: (r.context as string) ?? undefined,
      docId: (r.document_id as string) ?? undefined,
      anchor: obj(r.anchor),
      createdAt: msNow(r.created_at),
      dueAt: msNow(r.due_at),
      intervalDays: num(r.interval_days),
      reviews: num(r.reviews),
    }),
  },
}

const sessions: TableDef<ReadingSession> = {
  key: 'id',
  remote: {
    table: 'reading_sessions',
    keyColumns: ['id'],
    match: byId,
    toRow: (s) => ({
      id: s.id,
      document_id: s.docId,
      started_at: iso(s.start),
      ended_at: iso(Math.max(s.end, s.start)),
      active_ms: Math.min(604_800_000, Math.max(0, Math.round(s.ms))),
      progress_start: unit(s.progressStart),
      progress_end: unit(s.progressEnd),
      turns: Math.max(0, Math.round(s.turns)),
    }),
    fromRow: (r) => ({
      id: r.id as string,
      docId: r.document_id as string,
      start: msNow(r.started_at),
      end: msNow(r.ended_at),
      ms: num(Number(r.active_ms)),
      progressStart: num(r.progress_start),
      progressEnd: num(r.progress_end),
      turns: num(r.turns),
    }),
  },
}


const lookups: TableDef<LookupCache> = { key: 'key', remote: null }

export class PaperInkDB {
  documents = new CloudTable('documents', documents)
  readingStates = new CloudTable('readingStates', readingStates)
  highlights = new CloudTable('highlights', highlights)
  notes = new CloudTable('notes', notes)
  nodes = new CloudTable('nodes', nodes)
  edges = new CloudTable('edges', edges)
  settings = new CloudTable('settings', settings)
  epubLocations = new CloudTable('epubLocations', epubLocations)
  inks = new CloudTable('inks', inks)
  bookmarks = new CloudTable('bookmarks', bookmarks)
  vocab = new CloudTable('vocab', vocab)
  sessions = new CloudTable('sessions', sessions)
  lookups = new CloudTable('lookups', lookups)

  get tables() {
    return [
      this.documents,
      this.readingStates,
      this.highlights,
      this.notes,
      this.nodes,
      this.edges,
      this.settings,
      this.epubLocations,
      this.inks,
      this.bookmarks,
      this.vocab,
      this.sessions,
      this.lookups,
    ]
  }

  



  async transaction<R>(...args: unknown[]): Promise<R> {
    const fn = args[args.length - 1] as () => Promise<R>
    return fn()
  }

  
  async hydrate() {
    await Promise.all(this.tables.map((t) => t.hydrate()))
  }

  reset() {
    this.tables.forEach((t) => t.reset())
  }
}

export const db = new PaperInkDB()
export type { Row }
