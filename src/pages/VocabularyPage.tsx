import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from '@/lib/cloud/useLiveQuery'
import { ArrowUpRight, Brain, Languages, Search, Trash2 } from 'lucide-react'
import { db } from '@/lib/db'
import { reviewWord } from '@/lib/vocab'
import { Button, IconButton } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/controls'
import { Spinner } from '@/components/Spinner'
import type { VocabWord } from '@/types'

function Review({ due, onDone }: { due: VocabWord[]; onDone: () => void }) {
  const [i, setI] = useState(0)
  const [shown, setShown] = useState(false)
  const w = due[i]
  if (!w) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="text-[16px] font-semibold">All caught up</p>
        <Button className="mt-4" onClick={onDone}>
          Back to the list
        </Button>
      </div>
    )
  }
  const answer = async (remembered: boolean) => {
    await reviewWord(w, remembered)
    setShown(false)
    setI((x) => x + 1)
  }
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-[var(--shadow)]">
      <p className="text-[12px] text-muted-foreground">
        {i + 1} / {due.length}
      </p>
      <p className="font-serif text-[30px] font-semibold">{w.word}</p>
      {w.context && <p className="font-serif text-[15px] italic text-muted-foreground">“{w.context}”</p>}
      {shown ? (
        <>
          <p className="text-[15px] leading-relaxed">{w.definition || 'No definition saved — look it up again while reading.'}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => void answer(false)}>
              Again
            </Button>
            <Button onClick={() => void answer(true)}>Got it</Button>
          </div>
        </>
      ) : (
        <Button variant="secondary" onClick={() => setShown(true)}>
          Show meaning
        </Button>
      )}
    </div>
  )
}

export default function VocabularyPage() {
  const navigate = useNavigate()
  const words = useLiveQuery(() => db.vocab.orderBy('createdAt').reverse().toArray(), [])
  const docs = useLiveQuery(() => db.documents.toArray(), [])
  const [q, setQ] = useState('')
  const [reviewing, setReviewing] = useState(false)
  const docTitle = useMemo(() => new Map((docs ?? []).map((d) => [d.id, d.title])), [docs])
  const due = useMemo(() => (words ?? []).filter((w) => w.dueAt <= Date.now()), [words])
  const list = (words ?? []).filter((w) => !q || w.word.includes(q.toLowerCase()) || w.definition?.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="thin-scroll flex-1 overflow-y-auto pt-safe">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-12 md:px-6">
        <div className="flex items-center gap-2 pt-4">
          <h1 className="min-w-0 flex-1 font-serif text-[26px] font-semibold tracking-tight md:text-3xl">Vocabulary</h1>
          {!reviewing && (
            <Button onClick={() => setReviewing(true)} disabled={!due.length}>
              <Brain /> Review{due.length ? ` (${due.length})` : ''}
            </Button>
          )}
        </div>
        {!words ? (
          <Spinner />
        ) : reviewing ? (
          <Review due={due} onDone={() => setReviewing(false)} />
        ) : words.length === 0 ? (
          <EmptyState icon={<Languages />} title="No words yet">
            While reading, select a word and choose <strong>Look up</strong>, then <strong>Vocabulary</strong> to save it here with its sentence.
          </EmptyState>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
              <Input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search words" className="pl-10" aria-label="Search words" />
            </div>
            <ul className="flex flex-col gap-2">
              {list.map((w) => (
                <li key={w.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[17px] font-semibold">{w.word}</p>
                      {w.definition && <p className="mt-0.5 text-[14px] leading-relaxed">{w.definition}</p>}
                      {w.context && <p className="mt-1 font-serif text-[14px] italic text-muted-foreground">“{w.context}”</p>}
                      {w.docId && docTitle.get(w.docId) && <p className="mt-1 text-[12px] text-muted-foreground">{docTitle.get(w.docId)}</p>}
                    </div>
                    {w.docId && docTitle.get(w.docId) && (
                      <IconButton label="Open where found" size="icon-sm" onClick={() => navigate(`/read/${w.docId}${w.anchor ? `?vocab=${w.id}` : ''}`)}>
                        <ArrowUpRight />
                      </IconButton>
                    )}
                    <IconButton label={`Delete ${w.word}`} size="icon-sm" onClick={() => void db.vocab.delete(w.id)}>
                      <Trash2 />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
