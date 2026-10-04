import { db } from './db'
import { downloadBlob, safeFileName, uid } from './utils'
import { mergeSettings, useSettings } from '@/store/settings'
import type { Bookmark, DocumentRecord, GraphEdge, GraphNode, Highlight, InkPage, Note, ReadingSession, ReadingState, VocabWord } from '@/types'

const BACKUP_FORMAT = 'paperink-backup'
const BACKUP_VERSION = 1

type DocMeta = Omit<DocumentRecord, 'cover'>

interface BackupFile {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  documents: DocMeta[]
  readingStates: ReadingState[]
  highlights: Highlight[]
  notes: Note[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  inks?: InkPage[]
  bookmarks?: Bookmark[]
  vocab?: VocabWord[]
  sessions?: ReadingSession[]
  settings: unknown
}

export async function exportBackup() {
  const [documents, readingStates, highlights, notes, nodes, edges, settings, inks, bookmarks, vocab, sessions] = await Promise.all([
    db.documents.toArray(),
    db.readingStates.toArray(),
    db.highlights.toArray(),
    db.notes.toArray(),
    db.nodes.toArray(),
    db.edges.toArray(),
    db.settings.get('app'),
    db.inks.toArray(),
    db.bookmarks.toArray(),
    db.vocab.toArray(),
    db.sessions.toArray(),
  ])
  const data: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    documents: documents.map(({ cover: _cover, ...rest }) => rest),
    readingStates,
    highlights,
    notes,
    nodes,
    edges,
    inks,
    bookmarks,
    vocab,
    sessions,
    settings: settings?.value ?? null,
  }
  const stamp = new Date().toISOString().slice(0, 10)
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `paperink-backup-${stamp}.json`)
}

export interface ImportSummary {
  documents: number
  highlights: number
  notes: number
  nodes: number
  edges: number
  inkPages: number
  missingFiles: number
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
const arr = <T>(v: unknown, check: (x: Record<string, unknown>) => boolean): T[] =>
  Array.isArray(v) ? (v.filter((x) => isObj(x) && check(x)) as T[]) : []
const str = (v: unknown) => typeof v === 'string' && v.length > 0

export async function importBackup(file: File): Promise<ImportSummary> {
  let raw: unknown
  try {
    raw = JSON.parse(await file.text())
  } catch {
    throw new Error('This file is not valid JSON.')
  }
  if (!isObj(raw) || raw.format !== BACKUP_FORMAT) throw new Error('This is not a PaperInk backup file.')

  const documents = arr<DocMeta>(raw.documents, (d) => str(d.id) && (d.format === 'pdf' || d.format === 'epub' || d.format === 'comic'))
  const readingStates = arr<ReadingState>(raw.readingStates, (r) => str(r.docId))
  const highlights = arr<Highlight>(raw.highlights, (h) => str(h.id) && str(h.docId) && isObj(h.anchor))
  const notes = arr<Note>(raw.notes, (n) => str(n.id) && typeof n.content === 'string')
  const nodes = arr<GraphNode>(raw.nodes, (n) => str(n.id) && str(n.type) && typeof n.label === 'string')
  const edges = arr<GraphEdge>(raw.edges, (e) => str(e.id) && str(e.source) && str(e.target))
  const bookmarks = arr<Bookmark>(raw.bookmarks, (b) => str(b.id) && str(b.docId) && isObj(b.anchor))
  const vocab = arr<VocabWord>(raw.vocab, (v) => str(v.id) && str(v.word))
  const sessions = arr<ReadingSession>(raw.sessions, (x) => str(x.id) && str(x.docId))
  const inks = arr<InkPage>(raw.inks, (k) => str(k.id) && str(k.docId) && typeof k.page === 'number' && Array.isArray(k.strokes))

  const library = await db.documents.toArray()
  const byHash = new Map(library.map((d) => [d.contentHash, d.id]))
  const docMap = new Map<string, string>()
  let missingFiles = 0
  for (const d of documents) {
    const hash = typeof d.contentHash === 'string' ? d.contentHash : /^[0-9a-f]{64}$/.test(d.id) ? d.id : ''
    const target = byHash.get(hash)
    if (target) docMap.set(d.id, target)
    else missingFiles++
  }
  const fresh = new Map<string, string>()
  const remap = (id: string | undefined) => {
    if (!id) return undefined
    let n = fresh.get(id)
    if (!n) {
      n = uid()
      fresh.set(id, n)
    }
    return n
  }
  const doc = (id: string | undefined) => (id ? docMap.get(id) : undefined)
  const now = Date.now()

  for (const r of readingStates) {
    const d = doc(r.docId)
    if (d) await db.readingStates.put({ ...r, docId: d, updatedAt: now })
  }
  const hlIds = new Set<string>()
  for (const h of highlights) {
    const d = doc(h.docId)
    if (!d) continue
    const id = remap(h.id)!
    hlIds.add(id)
    await db.highlights.put({ ...h, id, docId: d })
  }
  const noteIds = new Set<string>()
  for (const n of notes) {
    const d = n.docId ? doc(n.docId) : undefined
    if (n.docId && !d) continue
    const highlightId = n.highlightId ? remap(n.highlightId) : undefined
    if (highlightId && !hlIds.has(highlightId)) continue
    const id = remap(n.id)!
    noteIds.add(id)
    await db.notes.put({ ...n, id, docId: d, highlightId, tags: Array.isArray(n.tags) ? n.tags : [], title: n.title ?? '' })
  }
  const nodeIds = new Set<string>()
  for (const n of nodes) {
    const d = n.docId ? doc(n.docId) : undefined
    if (n.docId && !d) continue
    const highlightId = n.highlightId ? remap(n.highlightId) : undefined
    const noteId = n.noteId ? remap(n.noteId) : undefined
    if ((highlightId && !hlIds.has(highlightId)) || (noteId && !noteIds.has(noteId))) continue
    const id = remap(n.id)!
    nodeIds.add(id)
    await db.nodes.put({ ...n, id, docId: d, highlightId, noteId, x: Number(n.x) || 0, y: Number(n.y) || 0 })
  }
  for (const e of edges) {
    const source = remap(e.source)!
    const target = remap(e.target)!
    if (nodeIds.has(source) && nodeIds.has(target) && source !== target) await db.edges.put({ ...e, id: remap(e.id)!, source, target })
  }
  for (const k of inks) {
    const d = doc(k.docId)
    if (d) await db.inks.put({ ...k, id: `${d}|${k.page}`, docId: d })
  }
  for (const b of bookmarks) {
    const d = doc(b.docId)
    if (d) await db.bookmarks.put({ ...b, id: remap(b.id)!, docId: d })
  }
  const knownWords = new Set((await db.vocab.toArray()).map((w) => w.word))
  for (const v of vocab) {
    if (knownWords.has(v.word.toLowerCase())) continue
    await db.vocab.put({ ...v, id: remap(v.id)!, word: v.word.toLowerCase(), docId: doc(v.docId) })
  }
  for (const x of sessions) {
    const d = doc(x.docId)
    if (d) await db.sessions.put({ ...x, id: remap(x.id)!, docId: d })
  }
  if (isObj(raw.settings)) {
    const merged = mergeSettings(raw.settings)
    await db.settings.put({ key: 'app', value: merged })
    useSettings.getState().replace(merged)
  }
  return {
    documents: documents.length,
    highlights: highlights.length,
    notes: notes.length,
    nodes: nodes.length,
    edges: edges.length,
    inkPages: inks.length,
    missingFiles,
  }
}

function noteBody(n: Note) {
  const ink = n.ink?.strokes.length ? '_(handwritten note — view in PaperInk)_' : ''
  return [n.content.trim(), ink].filter(Boolean).join('\n\n')
}

function locationLabel(h: Highlight) {
  if (h.anchor.type === 'pdf') return `p. ${h.anchor.page}`
  return h.anchor.chapter || ''
}

export async function documentMarkdown(docId: string): Promise<string> {
  const doc = await db.documents.get(docId)
  if (!doc) return ''
  const highlights = await db.highlights.where('docId').equals(docId).sortBy('order')
  const notes = await db.notes.where('docId').equals(docId).toArray()
  const inkPages = (await db.inks.where('docId').equals(docId).toArray()).filter((p) => p.strokes.length).map((p) => p.page).sort((a, b) => a - b)
  const lines: string[] = [`# ${doc.title}`, '']
  if (doc.author) lines.push(`*${doc.author}*`, '')
  if (doc.tags.length) lines.push(`Tags: ${doc.tags.map((t) => `#${t}`).join(' ')}`, '')
  if (inkPages.length) lines.push(`Handwritten annotations on page${inkPages.length > 1 ? 's' : ''} ${inkPages.join(', ')} (view them in PaperInk).`, '')
  if (highlights.length) {
    lines.push('## Highlights', '')
    for (const h of highlights) {
      const loc = locationLabel(h)
      lines.push(`> ${h.text.replace(/\s+/g, ' ').trim()}`, '')
      lines.push(`— ${loc ? `${loc} · ` : ''}${h.color}`, '')
      for (const n of notes.filter((n) => n.highlightId === h.id)) {
        lines.push(n.title ? `**${n.title}**` : '', noteBody(n), '')
        if (n.tags.length) lines.push(n.tags.map((t) => `#${t}`).join(' '), '')
      }
    }
  }
  const loose = notes.filter((n) => !n.highlightId || !highlights.some((h) => h.id === n.highlightId))
  if (loose.length) {
    lines.push('## Notes', '')
    for (const n of loose) {
      lines.push(`### ${n.title || 'Note'}`, '', noteBody(n), '')
      if (n.tags.length) lines.push(n.tags.map((t) => `#${t}`).join(' '), '')
    }
  }
  return lines.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n')
}

export async function exportDocumentMarkdown(docId: string) {
  const doc = await db.documents.get(docId)
  if (!doc) return
  const md = await documentMarkdown(docId)
  downloadBlob(new Blob([md], { type: 'text/markdown' }), `${safeFileName(doc.title)}.md`)
}

export async function exportAllMarkdown() {
  const docs = await db.documents.orderBy('title').toArray()
  const parts: string[] = [`# PaperInk export — ${new Date().toLocaleDateString()}`, '']
  for (const d of docs) {
    const hasAny = (await db.highlights.where('docId').equals(d.id).count()) + (await db.notes.where('docId').equals(d.id).count())
    if (!hasAny) continue

    parts.push((await documentMarkdown(d.id)).replace(/^(#+) /gm, '#$1 '), '', '---', '')
  }
  const standalone = await db.notes.filter((n) => !n.docId).toArray()
  if (standalone.length) {
    parts.push('## Standalone notes', '')
    for (const n of standalone) {
      parts.push(`### ${n.title || 'Note'}`, '', noteBody(n), '')
      if (n.tags.length) parts.push(n.tags.map((t) => `#${t}`).join(' '), '')
    }
  }
  downloadBlob(new Blob([parts.join('\n')], { type: 'text/markdown' }), `paperink-notes-${new Date().toISOString().slice(0, 10)}.md`)
}
