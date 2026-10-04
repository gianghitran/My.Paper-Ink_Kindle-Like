import { db } from './db'

export interface DictSense {
  partOfSpeech: string
  definitions: { text: string; examples: string[] }[]
}
export interface DictResult {
  term: string

  languages: { lang: string; language: string; senses: DictSense[] }[]
}
export interface WikiResult {
  title: string
  extract: string
  url: string
}

const htmlToText = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body.textContent?.replace(/\s+/g, ' ').trim() ?? ''

async function cached<T>(key: string, fetcher: () => Promise<T | null>): Promise<{ data: T | null; offline: boolean }> {
  const hit = await db.lookups.get(key)
  if (hit) return { data: hit.data as T | null, offline: false }
  if (!navigator.onLine) return { data: null, offline: true }
  const data = await fetcher()
  await db.lookups.put({ key, data, fetchedAt: Date.now() })
  return { data, offline: false }
}

export function lookupTerm(selection: string) {
  return selection
    .replace(/[’']s\b/g, '')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

export async function lookupDictionary(term: string) {
  return cached<DictResult>(`wiktionary:en:${term.toLowerCase()}`, async () => {
    for (const t of [term, term.toLowerCase()]) {
      const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(t.replace(/ /g, '_'))}`, {
        headers: { Accept: 'application/json' },
      })
      if (res.status === 404) continue
      if (!res.ok) throw new Error(`Dictionary error ${res.status}`)
      const json = (await res.json()) as Record<string, { partOfSpeech: string; language: string; definitions: { definition: string; examples?: string[] }[] }[]>
      const languages = Object.entries(json).map(([lang, entries]) => ({
        lang,
        language: entries[0]?.language ?? lang,
        senses: entries.map((e) => ({
          partOfSpeech: e.partOfSpeech,
          definitions: e.definitions
            .map((d) => ({ text: htmlToText(d.definition), examples: (d.examples ?? []).map(htmlToText).slice(0, 2) }))
            .filter((d) => d.text),
        })),
      }))
      return { term: t, languages }
    }
    return null
  })
}

export async function lookupWikipedia(term: string, lang: string) {
  return cached<WikiResult>(`wikipedia:${lang}:${term.toLowerCase()}`, async () => {
    const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term.replace(/ /g, '_'))}?redirect=true`, {
      headers: { Accept: 'application/json' },
    })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`Wikipedia error ${res.status}`)
    const j = (await res.json()) as { title: string; extract?: string; type?: string; content_urls?: { desktop?: { page?: string } } }
    if (!j.extract) return null
    return { title: j.title, extract: j.extract, url: j.content_urls?.desktop?.page ?? `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(j.title)}` }
  })
}

export function translateUrl(text: string, target: string) {
  return `https://translate.google.com/?sl=auto&tl=${encodeURIComponent(target)}&text=${encodeURIComponent(text.slice(0, 1500))}&op=translate`
}

export function sentenceAround(prefix: string | undefined, exact: string, suffix: string | undefined) {
  const before = (prefix ?? '').split(/(?<=[.!?。！？])\s+/).pop() ?? ''
  const after = (suffix ?? '').split(/(?<=[.!?。！？])\s/)[0] ?? ''
  return `${before}${exact}${after}`.replace(/\s+/g, ' ').trim()
}
