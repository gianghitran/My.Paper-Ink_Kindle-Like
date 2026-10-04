import { db } from './db'
import { uid, truncate } from './utils'
import { extractWikilinks, normalizeConcept } from './wikilinks'
import type { GraphEdge, GraphNode, NodeType } from '@/types'

function placeNear(anchor?: { x: number; y: number }) {
  const angle = Math.random() * Math.PI * 2
  const r = anchor ? 180 + Math.random() * 80 : Math.random() * 300
  const cx = anchor?.x ?? 0
  const cy = anchor?.y ?? 0
  return { x: Math.round(cx + Math.cos(angle) * r), y: Math.round(cy + Math.sin(angle) * r) }
}

async function createNode(partial: Omit<GraphNode, 'id' | 'x' | 'y' | 'createdAt' | 'updatedAt'> & { x?: number; y?: number }, near?: GraphNode) {
  const pos = partial.x !== undefined && partial.y !== undefined ? { x: partial.x, y: partial.y } : placeNear(near)
  const now = Date.now()
  const node: GraphNode = { ...partial, id: uid('n'), x: pos.x, y: pos.y, createdAt: now, updatedAt: now }
  await db.nodes.add(node)
  return node
}

export async function addEdge(source: string, target: string, opts: { label?: string; auto?: boolean } = {}) {
  if (source === target) return null
  const existing = await db.edges
    .where('source')
    .equals(source)
    .filter((e) => e.target === target)
    .first()
  const reverse = await db.edges
    .where('source')
    .equals(target)
    .filter((e) => e.target === source)
    .first()
  if (existing || reverse) return existing ?? reverse ?? null
  const edge: GraphEdge = { id: uid('e'), source, target, label: opts.label, auto: opts.auto ? 1 : 0, createdAt: Date.now() }
  await db.edges.add(edge)
  return edge
}

export async function ensureDocNode(docId: string): Promise<GraphNode | null> {
  const existing = await db.nodes
    .where('docId')
    .equals(docId)
    .filter((n) => isDocNodeType(n.type))
    .first()
  if (existing) return existing
  const doc = await db.documents.get(docId)
  if (!doc) return null
  return createNode({ type: doc.kind, label: doc.title, docId })
}

export async function ensureHighlightNode(highlightId: string): Promise<GraphNode | null> {
  const existing = await db.nodes.where('highlightId').equals(highlightId).filter((n) => n.type === 'highlight').first()
  if (existing) return existing
  const hl = await db.highlights.get(highlightId)
  if (!hl) return null
  const docNode = await ensureDocNode(hl.docId)
  const node = await createNode({ type: 'highlight', label: truncate(hl.text, 120), docId: hl.docId, highlightId }, docNode ?? undefined)
  if (docNode) await addEdge(docNode.id, node.id)
  return node
}

export async function ensureNoteNode(noteId: string): Promise<GraphNode | null> {
  const existing = await db.nodes.where('noteId').equals(noteId).first()
  if (existing) return existing
  const note = await db.notes.get(noteId)
  if (!note) return null
  let anchor: GraphNode | null = null
  if (note.highlightId) anchor = await ensureHighlightNode(note.highlightId)
  else if (note.docId) anchor = await ensureDocNode(note.docId)
  const node = await createNode(
    { type: 'note', label: note.title || truncate(note.content, 80) || (note.ink ? 'Handwritten note' : 'Note'), docId: note.docId, highlightId: note.highlightId, noteId },
    anchor ?? undefined,
  )
  if (anchor) await addEdge(anchor.id, node.id)
  return node
}

export async function findConceptNode(name: string) {
  const key = normalizeConcept(name)
  return db.nodes
    .where('type')
    .equals('concept')
    .filter((n) => normalizeConcept(n.label) === key)
    .first()
}

export async function ensureConceptNode(name: string, near?: GraphNode): Promise<GraphNode> {
  const existing = await findConceptNode(name)
  if (existing) return existing
  return createNode({ type: 'concept', label: name.trim() }, near)
}

export async function createConceptNode(label: string, pos?: { x: number; y: number }) {
  return createNode({ type: 'concept', label: label.trim() || 'New concept', ...(pos ?? {}) })
}





export async function syncNoteWikilinks(noteId: string) {
  const note = await db.notes.get(noteId)
  if (!note) return
  const links = extractWikilinks(`${note.title}\n${note.content}`)
  let noteNode = await db.nodes.where('noteId').equals(noteId).first()
  if (!noteNode && links.length === 0) return
  if (!noteNode) noteNode = (await ensureNoteNode(noteId)) ?? undefined
  if (!noteNode) return
  await db.nodes.update(noteNode.id, { label: note.title || truncate(note.content, 80) || (note.ink ? 'Handwritten note' : 'Note'), updatedAt: Date.now() })

  const wanted = new Set<string>()
  for (const name of links) {
    const concept = await ensureConceptNode(name, noteNode)
    wanted.add(concept.id)
    await addEdge(noteNode.id, concept.id, { auto: true })
  }
  const autoEdges = await db.edges
    .where('source')
    .equals(noteNode.id)
    .filter((e) => e.auto === 1)
    .toArray()
  const stale = autoEdges.filter((e) => !wanted.has(e.target)).map((e) => e.id)
  if (stale.length) await db.edges.bulkDelete(stale)
}

export async function deleteNode(id: string) {
  await db.transaction('rw', db.nodes, db.edges, async () => {
    await db.edges.where('source').equals(id).delete()
    await db.edges.where('target').equals(id).delete()
    await db.nodes.delete(id)
  })
}

export async function renameNode(id: string, label: string, description?: string) {
  await db.nodes.update(id, { label, ...(description !== undefined ? { description } : {}), updatedAt: Date.now() })
}


export async function backlinksForConcept(label: string) {
  const key = normalizeConcept(label)
  const notes = await db.notes.toArray()
  return notes.filter((n) => extractWikilinks(`${n.title}\n${n.content}`).some((l) => normalizeConcept(l) === key))
}


export const DOC_NODE_TYPES: NodeType[] = ['paper', 'book', 'document', 'other']
export const isDocNodeType = (t: NodeType) => DOC_NODE_TYPES.includes(t)

export const NODE_TYPE_META: Record<NodeType, { label: string; color: string }> = {
  paper: { label: 'Paper', color: '#2563eb' },
  book: { label: 'Book', color: '#7c3aed' },
  document: { label: 'Document', color: '#0d9488' },
  other: { label: 'Other', color: '#64748b' },
  highlight: { label: 'Highlight', color: '#ca8a04' },
  note: { label: 'Note', color: '#16a34a' },
  concept: { label: 'Concept', color: '#db2777' },
}
