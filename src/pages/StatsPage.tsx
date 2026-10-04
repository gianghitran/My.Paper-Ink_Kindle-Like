import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useLiveQuery } from '@/lib/cloud/useLiveQuery'
import { BarChart3, BookOpen, CalendarDays, Clock } from 'lucide-react'
import { db } from '@/lib/db'
import { dayKey, docStats, estimateLeft, formatDuration, msByDay } from '@/lib/stats'
import { cn, formatPercent } from '@/lib/utils'
import { EmptyState, ProgressBar } from '@/components/ui/controls'
import { Spinner } from '@/components/Spinner'

const WEEKS = 18
const DAY = 86_400_000

function Tile({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow)]">
      <div className="flex items-center gap-2 text-[12px] font-medium text-muted-foreground [&_svg]:size-4">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-[22px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}

export default function StatsPage() {
  const sessions = useLiveQuery(() => db.sessions.toArray(), [])
  const docs = useLiveQuery(() => db.documents.toArray(), [])

  const data = useMemo(() => {
    if (!sessions || !docs) return null
    const now = Date.now()
    const startOfToday = new Date(new Date().toDateString()).getTime()
    const today = sessions.filter((s) => s.start >= startOfToday).reduce((a, s) => a + s.ms, 0)
    const week = sessions.filter((s) => s.start >= now - 7 * DAY).reduce((a, s) => a + s.ms, 0)
    const total = sessions.reduce((a, s) => a + s.ms, 0)
    const byDay = msByDay(sessions)

    const lastSaturday = startOfToday + (6 - new Date(startOfToday).getDay()) * DAY
    const first = lastSaturday - (WEEKS * 7 - 1) * DAY
    const days: { key: string; ms: number; date: Date; future: boolean }[] = []
    for (let t = first; days.length < WEEKS * 7; t += DAY) {
      const d = new Date(t)
      days.push({ key: dayKey(t), ms: byDay.get(dayKey(t)) ?? 0, date: d, future: t > now })
    }
    const max = Math.max(1, ...days.map((d) => d.ms))
    let streak = 0
    for (let t = startOfToday; byDay.get(dayKey(t)); t -= DAY) streak++
    const perDoc = docs
      .map((d) => ({ doc: d, stats: docStats(sessions.filter((s) => s.docId === d.id)) }))
      .filter((x) => x.stats.totalMs > 0)
      .sort((a, b) => (b.stats.lastRead ?? 0) - (a.stats.lastRead ?? 0))
    return { today, week, total, days, max, streak, perDoc }
  }, [sessions, docs])

  return (
    <div className="thin-scroll flex-1 overflow-y-auto pt-safe">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 pb-12 md:px-6">
        <h1 className="pt-4 font-serif text-[26px] font-semibold tracking-tight md:text-3xl">Reading statistics</h1>
        {!data ? (
          <Spinner />
        ) : data.total === 0 ? (
          <EmptyState icon={<BarChart3 />} title="No reading recorded yet">
            Reading time is tracked while a document is open and you’re actively reading (idle time isn’t counted).
          </EmptyState>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Tile label="Today" value={formatDuration(data.today)} icon={<Clock />} />
              <Tile label="Last 7 days" value={formatDuration(data.week)} icon={<CalendarDays />} />
              <Tile label="All time" value={formatDuration(data.total)} icon={<BookOpen />} />
              <Tile label="Day streak" value={`${data.streak}`} icon={<BarChart3 />} />
            </div>

            <section className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow)]">
              <h2 className="mb-3 text-[15px] font-semibold">Activity</h2>
              <div className="no-scrollbar overflow-x-auto">
                <div className="grid w-max grid-flow-col grid-rows-7 gap-[3px]" role="img" aria-label="Reading activity calendar">
                  {data.days.map((d) => (
                    <div
                      key={d.key}
                      title={`${d.date.toLocaleDateString()}: ${formatDuration(d.ms)}`}
                      className={cn('size-3.5 rounded-[3px] bg-foreground/[0.07]', d.future && 'opacity-0')}
                      style={d.ms ? { background: `color-mix(in srgb, var(--foreground) ${Math.round(20 + (d.ms / data.max) * 70)}%, transparent)` } : undefined}
                    />
                  ))}
                </div>
              </div>
              <p className="mt-2 text-[12px] text-muted-foreground">Last {WEEKS} weeks · darker = more reading time</p>
            </section>

            <section className="rounded-2xl border border-border bg-card shadow-[var(--shadow)]">
              <h2 className="px-4 pt-4 text-[15px] font-semibold">Books & papers</h2>
              <ul>
                {data.perDoc.map(({ doc, stats }) => {
                  const left = estimateLeft(stats.rate, 1 - doc.progress)
                  return (
                    <li key={doc.id} className="border-b border-border last:border-b-0">
                      <Link to={`/read/${doc.id}`} className="flex flex-col gap-1.5 px-4 py-3 hover:bg-muted/50">
                        <div className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{doc.title}</span>
                          <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{formatPercent(doc.progress)}</span>
                        </div>
                        <ProgressBar value={doc.progress} />
                        <div className="flex flex-wrap gap-x-4 text-[12px] text-muted-foreground">
                          <span>{formatDuration(stats.totalMs)} read</span>
                          <span>{stats.sessions} session{stats.sessions === 1 ? '' : 's'}</span>
                          {stats.rate && <span>{Math.round(stats.rate * 3_600_000 * 100)}% per hour</span>}
                          {left !== null && doc.status !== 'finished' && <span>≈ {formatDuration(left)} left</span>}
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
