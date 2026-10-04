import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BookA, ExternalLink, Globe, Languages, Plus, WifiOff } from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/controls'
import { Spinner } from '@/components/Spinner'
import { lookupDictionary, lookupWikipedia, translateUrl, type DictResult, type WikiResult } from '@/lib/lookup'
import { saveWord } from '@/lib/vocab'
import { useSettings } from '@/store/settings'
import { useViewport } from '@/hooks/useViewport'
import type { Anchor } from '@/types'

export interface LookupRequest {
  term: string
  
  lang?: string | null
  context?: string
  docId?: string
  anchor?: Anchor
}

const WIKI_LANGS = [
  { value: 'en', label: 'English' },
  { value: 'vi', label: 'Vietnamese' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'es', label: 'Spanish' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
]

type State<T> = { status: 'loading' } | { status: 'done'; data: T | null; offline: boolean } | { status: 'error'; message: string }


export function LookupSheet({ request, onClose }: { request: LookupRequest | null; onClose: () => void }) {
  const { isPhone } = useViewport()
  const lookup = useSettings((s) => s.settings.lookup)
  const update = useSettings((s) => s.update)
  const [tab, setTab] = useState<'dict' | 'wiki'>('dict')
  const [dict, setDict] = useState<State<DictResult>>({ status: 'loading' })
  const [wiki, setWiki] = useState<State<WikiResult>>({ status: 'loading' })
  const term = request?.term ?? ''

  useEffect(() => {
    if (!term) return
    setTab(term.includes(' ') ? 'wiki' : 'dict')
    setDict({ status: 'loading' })
    lookupDictionary(term)
      .then((r) => setDict({ status: 'done', data: r.data, offline: r.offline }))
      .catch((e: Error) => setDict({ status: 'error', message: e.message }))
  }, [term])

  useEffect(() => {
    if (!term) return
    setWiki({ status: 'loading' })
    lookupWikipedia(term, lookup.wikiLang)
      .then((r) => setWiki({ status: 'done', data: r.data, offline: r.offline }))
      .catch((e: Error) => setWiki({ status: 'error', message: e.message }))
  }, [term, lookup.wikiLang])

  const bookLang = request?.lang?.slice(0, 2).toLowerCase()
  const languages =
    dict.status === 'done' && dict.data
      ? [...dict.data.languages].sort((a, b) => Number(b.lang === bookLang) - Number(a.lang === bookLang) || Number(b.lang === 'en') - Number(a.lang === 'en'))
      : []
  const firstDefinition = languages[0]?.senses[0]?.definitions[0]?.text

  const offlineNote = (offline: boolean) =>
    offline ? (
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <WifiOff className="size-4" /> You’re offline and this word hasn’t been looked up before.
      </p>
    ) : (
      <p className="text-[13px] text-muted-foreground">Nothing found.</p>
    )

  return (
    <Sheet open={!!request} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={isPhone ? 'bottom' : 'right'} title={term} description="Dictionary & encyclopedia lookup" className={isPhone ? 'h-[70dvh]' : 'w-[min(440px,94vw)]'}>
        <div className="flex flex-col gap-3 px-4 pb-6">
          {request?.context && <p className="rounded-lg bg-muted/60 p-2.5 font-serif text-[14px] italic text-muted-foreground">“{request.context}”</p>}
          <Segmented
            label="Lookup source"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'dict', label: (<><BookA /> Dictionary</>) },
              { value: 'wiki', label: (<><Globe /> Wikipedia</>) },
            ]}
          />
          {tab === 'dict' && (
            <div className="flex flex-col gap-3">
              {dict.status === 'loading' && <Spinner />}
              {dict.status === 'error' && <p className="text-[13px] text-destructive">{dict.message}</p>}
              {dict.status === 'done' && !dict.data && offlineNote(dict.offline)}
              {languages.slice(0, 4).map((l) => (
                <section key={l.lang}>
                  <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">{l.language}</h3>
                  {l.senses.slice(0, 4).map((s, i) => (
                    <div key={i} className="mb-2">
                      <p className="text-[13px] font-semibold italic">{s.partOfSpeech}</p>
                      <ol className="ml-5 list-decimal text-[14px] leading-relaxed">
                        {s.definitions.slice(0, 5).map((d, j) => (
                          <li key={j}>
                            {d.text}
                            {d.examples[0] && <span className="block text-[13px] italic text-muted-foreground">{d.examples[0]}</span>}
                          </li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </section>
              ))}
              {dict.status === 'done' && dict.data && (
                <a className="text-[12px] text-muted-foreground underline" href={`https://en.wiktionary.org/wiki/${encodeURIComponent(dict.data.term)}`} target="_blank" rel="noopener noreferrer">
                  Source: Wiktionary (CC BY-SA)
                </a>
              )}
            </div>
          )}
          {tab === 'wiki' && (
            <div className="flex flex-col gap-3">
              <select
                value={lookup.wikiLang}
                onChange={(e) => update({ lookup: { ...lookup, wikiLang: e.target.value } })}
                className="min-h-11 rounded-lg border border-border bg-card px-3 text-[14px]"
                aria-label="Wikipedia language"
              >
                {WIKI_LANGS.map((l) => (
                  <option key={l.value} value={l.value}>
                    Wikipedia — {l.label}
                  </option>
                ))}
              </select>
              {wiki.status === 'loading' && <Spinner />}
              {wiki.status === 'error' && <p className="text-[13px] text-destructive">{wiki.message}</p>}
              {wiki.status === 'done' && !wiki.data && offlineNote(wiki.offline)}
              {wiki.status === 'done' && wiki.data && (
                <article>
                  <h3 className="mb-1 text-[16px] font-semibold">{wiki.data.title}</h3>
                  <p className="font-serif text-[15px] leading-relaxed">{wiki.data.extract}</p>
                  <a href={wiki.data.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] underline">
                    Open article <ExternalLink className="size-3.5" />
                  </a>
                </article>
              )}
            </div>
          )}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={async () => {
                await saveWord({ word: term, lang: bookLang, definition: firstDefinition, context: request?.context, docId: request?.docId, anchor: request?.anchor })
                toast.success(`“${term}” saved to vocabulary`)
              }}
            >
              <Plus /> Vocabulary
            </Button>
            <Button variant="secondary" onClick={() => window.open(translateUrl(term, lookup.translateTo), '_blank', 'noopener,noreferrer')}>
              <Languages /> Translate
            </Button>
          </div>
          <p className="text-[12px] text-muted-foreground">
            Lookups are fetched from Wiktionary / Wikipedia only when you ask, and kept in memory for this session.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  )
}
