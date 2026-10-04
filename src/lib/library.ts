import { db } from './db'
import { sha256Hex } from './hash'
import { detectFormat, titleFromFileName } from './formats'
import { clearDeviceCache } from './services/deviceCache'
import { cacheObject, clearFileCache, downloadObject, objectPath, removeObjects, uploadObject } from './services/storage'
import { flush } from './cloud/sync'
import { supabase } from './supabase/client'
import { uid } from './utils'
import { isDocNodeType } from './graph'
import type { DocKind, DocumentRecord, ReadStatus } from '@/types'

export type ImportResult =
  | { status: 'imported'; doc: DocumentRecord }
  | { status: 'duplicate'; doc: DocumentRecord; fileName: string }
  | { status: 'error'; fileName: string; message: string }

export async function importFile(file: File): Promise<ImportResult> {
  try {
    const buffer = await file.arrayBuffer()
    const handler = detectFormat(file, new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 1024)))
    if (!handler) {
      return { status: 'error', fileName: file.name, message: 'Unsupported file type. PaperInk reads PDF, EPUB, MOBI, FB2, TXT, Markdown, HTML and CBZ/CBT comics.' }
    }
    const contentHash = await sha256Hex(buffer)
    const existing = await db.documents.where('contentHash').equals(contentHash).first()
    if (existing) return { status: 'duplicate', doc: existing, fileName: file.name }

    let meta: Awaited<ReturnType<typeof handler.extract>> = {}
    let stored: Blob | null = null
    let converted: { format?: DocumentRecord['format']; mimeType?: string; extension?: string } = {}
    try {
      if (handler.convert) {
        const r = await handler.convert(buffer, file.name)
        stored = r.blob
        meta = r.meta
        converted = { format: r.format, mimeType: r.mimeType, extension: r.extension }
      } else meta = await handler.extract(buffer, file.name)
    } catch (err) {
      console.error('Metadata extraction failed', err)
      if (handler.format === 'pdf') {
        const encrypted = (err as Error)?.name === 'PasswordException'
        return { status: 'error', fileName: file.name, message: encrypted ? 'This PDF is password-protected. Remove the password and import it again.' : 'This PDF could not be opened (it may be damaged).' }
      }
      if (handler.source === 'epub') return { status: 'error', fileName: file.name, message: 'This EPUB could not be opened (it may be damaged or DRM-protected).' }
      return { status: 'error', fileName: file.name, message: `This ${handler.label} file could not be read: ${(err as Error)?.message ?? 'unknown error'}` }
    }

    const mimeType = stored ? (converted.mimeType ?? 'application/epub+zip') : handler.mimeTypes[0]
    const blob = stored ? new Blob([stored], { type: mimeType }) : new Blob([buffer], { type: mimeType })
    const id = uid()
    const storedName = stored ? `${titleFromFileName(file.name) || 'book'}${converted.extension ?? '.epub'}` : file.name
    const doc: DocumentRecord = {
      id,
      contentHash,
      filePath: await objectPath(id, storedName),
      format: converted.format ?? handler.format,
      sourceFormat: handler.source,
      kind: handler.defaultKind,
      title: (meta.title || titleFromFileName(file.name) || 'Untitled').slice(0, 500),
      author: (meta.author || '').slice(0, 500),
      fileName: file.name.slice(0, 255),
      mimeType,
      size: blob.size,
      addedAt: Date.now(),
      lastOpenedAt: null,
      favorite: 0,
      status: 'unread',
      progress: 0,
      pageCount: meta.pageCount,
      tags: [],
    }
    await db.documents.putNow(doc)
    try {
      await uploadObject(doc.filePath, blob, mimeType)
    } catch (err) {
      await db.documents.deleteNow(id).catch(() => {})
      throw err
    }
    cacheObject(doc.filePath, blob)
    if (meta.cover) {
      try {
        const coverPath = await objectPath(id, 'cover.jpg')
        await uploadObject(coverPath, meta.cover, 'image/jpeg')
        cacheObject(coverPath, meta.cover)

        const current = await db.documents.get(id)
        if (current) await db.documents.putNow({ ...current, coverPath, cover: meta.cover })
      } catch (err) {
        console.warn('Cover upload failed', (err as Error).message)
      }
    }
    return { status: 'imported', doc: (await db.documents.get(id)) ?? doc }
  } catch (err) {
    return { status: 'error', fileName: file.name, message: (err as Error)?.message || 'Import failed.' }
  }
}

export async function importFiles(files: Iterable<File>): Promise<ImportResult[]> {
  const out: ImportResult[] = []
  for (const f of files) out.push(await importFile(f))
  return out
}

export async function getDocumentFile(id: string): Promise<Blob | undefined> {
  const doc = await db.documents.get(id)
  if (!doc?.filePath) return undefined
  try {
    return await downloadObject(doc.filePath)
  } catch (err) {
    console.warn('Document download failed', (err as Error).message)
    return undefined
  }
}

export async function markOpened(id: string) {
  const doc = await db.documents.get(id)
  if (!doc) return
  await db.documents.update(id, {
    lastOpenedAt: Date.now(),
    status: doc.status === 'unread' ? 'reading' : doc.status,
  })
}

export function toggleFavorite(doc: DocumentRecord) {
  return db.documents.update(doc.id, { favorite: doc.favorite ? 0 : 1 })
}

export function setStatus(id: string, status: ReadStatus) {
  const patch: Partial<DocumentRecord> = { status }
  if (status === 'finished') patch.progress = 1
  return db.documents.update(id, patch)
}

export function updateDocumentMeta(id: string, patch: { title?: string; author?: string; kind?: DocKind; tags?: string[] }) {
  return db.transaction('rw', db.documents, db.nodes, async () => {
    await db.documents.update(id, patch)
    if (patch.title || patch.kind) {
      const nodes = await db.nodes.where('docId').equals(id).toArray()
      for (const n of nodes) {
        if (isDocNodeType(n.type)) {
          await db.nodes.update(n.id, {
            ...(patch.title ? { label: patch.title } : {}),
            ...(patch.kind ? { type: patch.kind } : {}),
            updatedAt: Date.now(),
          })
        }
      }
    }
  })
}

export async function deleteDocument(id: string) {
  const doc = await db.documents.get(id)
  if (!doc) return
  await removeObjects([doc.filePath, doc.coverPath ?? '']).catch((err) => console.warn('Storage cleanup failed', (err as Error).message))
  await db.documents.deleteNow(id)
  const noteIds = new Set((await db.notes.where('docId').equals(id).primaryKeys()) as string[])
  const hlIds = new Set((await db.highlights.where('docId').equals(id).primaryKeys()) as string[])
  db.highlights.forget((h) => h.docId === id)
  db.notes.forget((n) => n.docId === id || (!!n.highlightId && hlIds.has(n.highlightId)))
  const nodeIds = new Set(
    ((await db.nodes.toArray()).filter((n) => n.docId === id || (n.noteId && noteIds.has(n.noteId)) || (n.highlightId && hlIds.has(n.highlightId))).map((n) => n.id)),
  )
  db.nodes.forget((n) => nodeIds.has(n.id))
  db.edges.forget((e) => nodeIds.has(e.source) || nodeIds.has(e.target))
  db.readingStates.forget((r) => r.docId === id)
  db.epubLocations.forget((r) => r.docId === id)
  db.inks.forget((r) => r.docId === id)
  db.bookmarks.forget((r) => r.docId === id)
  db.sessions.forget((r) => r.docId === id)
  db.vocab.patchLocal((w) => w.docId === id, { docId: undefined })
}

export async function eraseAllUserData() {
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) throw new Error('Not signed in')
  await flush()
  const docs = await db.documents.toArray()
  const paths = docs.flatMap((d) => [d.filePath, d.coverPath ?? '']).filter(Boolean)
  for (let i = 0; i < paths.length; i += 100) await removeObjects(paths.slice(i, i + 100))

  for (const t of ['documents', 'edges', 'nodes', 'notes', 'vocab_words', 'user_settings']) {
    const { error } = await supabase.from(t).delete().eq('user_id', userId)
    if (error) throw new Error(`${t}: ${error.message}`)
  }
  db.reset()
  clearFileCache()
  await clearDeviceCache()
}
