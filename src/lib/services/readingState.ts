import { db } from '@/lib/db'
import type { ReadingState } from '@/types'






export function getReadingState(docId: string) {
  return db.readingStates.get(docId)
}

export async function saveReadingPosition(docId: string, state: Pick<ReadingState, 'progress' | 'pdf' | 'epub'>, label: string) {
  const now = Date.now()
  await db.readingStates.put({ docId, updatedAt: now, ...state })
  await db.documents.update(docId, { progress: state.progress, positionLabel: label, lastOpenedAt: now })
}

export async function getEpubLocations(docId: string) {
  return (await db.epubLocations.get(docId))?.locations
}

export function saveEpubLocations(docId: string, locations: string) {
  return db.epubLocations.put({ docId, locations })
}
