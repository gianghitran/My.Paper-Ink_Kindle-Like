import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from '@/lib/cloud/useLiveQuery'
import { Search } from 'lucide-react'
import { db } from '@/lib/db'
import { cn, formatPercent } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Cover } from '@/components/library/Cover'
import { formatLabel } from '@/lib/formats'


export function ReaderLibraryPanel({ currentId }: { currentId: string }) {
  const navigate = useNavigate()
  const docs = useLiveQuery(() => db.documents.toArray(), [])
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return (docs ?? [])
      .filter((d) => !s || d.title.toLowerCase().includes(s) || d.author.toLowerCase().includes(s))
      .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0) || b.addedAt - a.addedAt)
  }, [docs, q])
  return (
    <div className="flex h-full flex-col">
      <div className="relative px-3 pb-2">
        <Search className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-[60%] text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Filter library" className="pl-9" aria-label="Filter library" />
      </div>
      <ul className="thin-scroll flex-1 overflow-y-auto px-2 pb-4">
        {list.map((d) => (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => d.id !== currentId && navigate(`/read/${d.id}`)}
              aria-current={d.id === currentId ? 'page' : undefined}
              className={cn('flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-muted', d.id === currentId && 'bg-muted')}
            >
              <div className="h-14 w-10 shrink-0 overflow-hidden rounded border border-border">
                <Cover doc={d} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-[13px] font-medium leading-snug">{d.title}</p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {d.author || formatLabel(d.sourceFormat, d.format)} · {formatPercent(d.progress)}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
