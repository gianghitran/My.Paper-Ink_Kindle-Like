import { db } from './db'
import { uid } from './utils'
import type { Anchor, VocabWord } from '@/types'

const DAY = 86_400_000

export async function saveWord(input: { word: string; lang?: string; definition?: string; context?: string; docId?: string; anchor?: Anchor }) {
  const existing = await db.vocab.where('word').equals(input.word.toLowerCase()).first()
  if (existing) {

    await db.vocab.update(existing.id, {
      context: input.context ?? existing.context,
      definition: input.definition ?? existing.definition,
      ...(input.docId ? { docId: input.docId, anchor: input.anchor } : {}),
    })
    return existing.id
  }
  const now = Date.now()
  const w: VocabWord = { id: uid('v'), ...input, word: input.word.toLowerCase(), createdAt: now, dueAt: now, intervalDays: 0, reviews: 0 }
  await db.vocab.add(w)
  return w.id
}

export async function reviewWord(w: VocabWord, remembered: boolean) {
  const interval = remembered ? (w.intervalDays ? Math.round(w.intervalDays * 2.2 + 0.5) : 1) : 0
  await db.vocab.update(w.id, { intervalDays: interval, dueAt: Date.now() + interval * DAY, reviews: w.reviews + 1 })
}
