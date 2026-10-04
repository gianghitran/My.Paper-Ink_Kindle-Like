import { db } from './db'
import { uid } from './utils'
import { deleteNode, ensureHighlightNode, syncNoteWikilinks } from './graph'
import type { Anchor, Highlight, HighlightColor, HighlightDrawer, Note } from '@/types'

export const HIGHLIGHT_COLORS: { id: HighlightColor; label: string }[] = [
  { id: 'yellow', label: 'Yellow' },
  { id: 'green', label: 'Green' },
  { id: 'blue', label: 'Blue' },
  { id: 'pink', label: 'Pink' },
  { id: 'purple', label: 'Purple' },
]

export const hlFill = (c: HighlightColor) => `var(--hl-${c})`
export const hlSolid = (c: HighlightColor) => `var(--hl-${c}-solid)`


export function hlRgba(c: HighlightColor, theme: string) {
  if (theme === 'eink') {
    return { yellow: '#000000', green: '#000000', blue: '#000000', pink: '#000000', purple: '#000000' }[c]
  }
  return { yellow: '#facc15', green: '#4ade80', blue: '#60a5fa', pink: '#f472b6', purple: '#a78bfa' }[c]
}

export async function createHighlight(input: {
  docId: string
  anchor: Anchor
  text: string
  color: HighlightColor
  order: number
  drawer?: HighlightDrawer
}): Promise<Highlight> {
  const now = Date.now()
  
  const { drawer, ...rest } = input
  const hl: Highlight = { id: uid('h'), ...rest, ...(drawer && drawer !== 'lighten' ? { drawer } : {}), createdAt: now, updatedAt: now }
  await db.highlights.add(hl)
  return hl
}

export function updateHighlightColor(id: string, color: HighlightColor) {
  return db.highlights.update(id, { color, updatedAt: Date.now() })
}

export function updateHighlightDrawer(id: string, drawer: HighlightDrawer) {
  return db.highlights.update(id, { drawer, updatedAt: Date.now() })
}


export function unionPdfAnchors(hits: Highlight[]): { anchor: Anchor; text: string } | null {
  const pdf = [...hits].filter((h) => h.anchor.type === 'pdf').sort((a, b) => a.order - b.order)
  if (pdf.length < 2) return null
  const anchors = pdf.map((h) => h.anchor as Extract<Anchor, { type: 'pdf' }>)
  const seen = new Set<string>()
  const rects = anchors.flatMap((a) => a.rects).filter((r) => {
    const k = [r.page, r.x, r.y, r.w, r.h].map((v) => v.toFixed(4)).join()
    return !seen.has(k) && !!seen.add(k)
  })
  const text = pdf.map((h) => h.text).join(' ')
  return {
    anchor: { ...anchors[0], page: Math.min(...anchors.map((a) => a.page)), rects, quote: { exact: text, prefix: anchors[0].quote.prefix, suffix: anchors[anchors.length - 1].quote.suffix } },
    text,
  }
}





export async function mergeHighlights(hits: Highlight[], merged: { anchor: Anchor; text: string }) {
  const sorted = [...hits].sort((a, b) => a.order - b.order)
  const [keep, ...rest] = sorted
  const ids = new Set(sorted.map((h) => h.id))
  const notes = (await db.notes.toArray()).filter((n) => n.highlightId && ids.has(n.highlightId))
  if (notes.length) {
    const ordered = sorted.flatMap((h) => notes.filter((n) => n.highlightId === h.id))
    const target = ordered[0]
    await saveNote({
      ...target,
      highlightId: keep.id,
      title: ordered.find((n) => n.title.trim())?.title ?? '',
      content: ordered.map((n) => n.content.trim()).filter(Boolean).join('\n\n'),
      tags: Array.from(new Set(ordered.flatMap((n) => n.tags))),
    })
    for (const n of ordered.slice(1)) await deleteNote(n.id)
  }
  const tags = Array.from(new Set(sorted.flatMap((h) => h.tags ?? [])))
  await db.highlights.update(keep.id, { anchor: merged.anchor, text: merged.text, ...(tags.length ? { tags } : {}), updatedAt: Date.now() })
  for (const h of rest) await deleteHighlight(h.id)
  return keep.id
}


export async function deleteHighlight(id: string) {
  const notes = await db.notes.where('highlightId').equals(id).toArray()
  const nodes = await db.nodes.where('highlightId').equals(id).toArray()
  for (const n of nodes) await deleteNode(n.id)
  for (const note of notes) {
    const noteNodes = await db.nodes.where('noteId').equals(note.id).toArray()
    for (const n of noteNodes) await deleteNode(n.id)
  }
  await db.notes.bulkDelete(notes.map((n) => n.id))
  await db.highlights.delete(id)
}

export async function saveNote(input: Partial<Note> & { content: string }): Promise<Note> {
  const now = Date.now()
  const existing = input.id ? await db.notes.get(input.id) : undefined
  const note: Note = {
    id: existing?.id ?? input.id ?? uid('note'),
    docId: input.docId ?? existing?.docId,
    highlightId: input.highlightId ?? existing?.highlightId,
    location: input.location ?? existing?.location,
    ink: 'ink' in input ? (input.ink?.strokes.length ? input.ink : undefined) : existing?.ink,
    title: input.title ?? existing?.title ?? '',
    content: input.content,
    tags: input.tags ?? existing?.tags ?? [],
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  await db.notes.put(note)
  await syncNoteWikilinks(note.id)
  return note
}

export async function deleteNote(id: string) {
  const nodes = await db.nodes.where('noteId').equals(id).toArray()
  for (const n of nodes) await deleteNode(n.id)
  await db.notes.delete(id)
}

export async function createNodeFromHighlight(highlightId: string) {
  return ensureHighlightNode(highlightId)
}


export function noteHref(n: Pick<Note, 'id' | 'docId' | 'highlightId' | 'location'>) {
  if (!n.docId) return null
  if (n.highlightId) return highlightHref({ docId: n.docId, id: n.highlightId })
  if (n.location) return `/read/${n.docId}?note=${encodeURIComponent(n.id)}`
  return `/read/${n.docId}`
}


export function highlightHref(h: Pick<Highlight, 'docId' | 'id'>) {
  return `/read/${h.docId}?hl=${encodeURIComponent(h.id)}`
}
