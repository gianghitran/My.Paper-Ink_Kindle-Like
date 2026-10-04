import { memo, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { ReaderHandle } from './types'

const THUMB_W = 150

const Thumb = memo(function Thumb({
  page,
  handle,
  current,
  marks,
  onPick,
}: {
  page: number
  handle: React.RefObject<ReaderHandle | null>
  current: boolean
  marks: { bookmark: boolean; highlight: boolean; ink: boolean }
  onPick: (p: number) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || drawn) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        const c = canvasRef.current
        if (c && handle.current?.renderThumbnail) void handle.current.renderThumbnail(page, c, THUMB_W).then(() => setDrawn(true)).catch(() => {})
      },
      { rootMargin: '300px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [page, handle, drawn])
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onPick(page)}
      aria-label={`Go to page ${page}`}
      aria-current={current ? 'page' : undefined}
      className={cn('flex flex-col items-center gap-1 rounded-lg p-1.5 hover:bg-muted', current && 'bg-muted ring-2 ring-foreground/60')}
    >
      <div className="relative w-full overflow-hidden rounded border border-border bg-white shadow-sm">
        <canvas ref={canvasRef} className="pdf-canvas-thumb block h-auto w-full" style={{ aspectRatio: drawn ? undefined : '3 / 4', filter: 'var(--page-filter)' }} />
        {marks.bookmark && <span className="absolute right-0 top-0 size-0 border-l-[14px] border-t-[14px] border-l-transparent border-t-foreground/70" aria-label="Bookmarked" />}
      </div>
      <span className="flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
        {page}
        {marks.highlight && <span className="size-1.5 rounded-full bg-[var(--hl-yellow-solid)]" aria-label="Has highlights" />}
        {marks.ink && <span className="size-1.5 rounded-full bg-foreground/60" aria-label="Has handwriting" />}
      </span>
    </button>
  )
})

export function PageBrowser({
  handle,
  currentPage,
  bookmarkedPages,
  highlightPages,
  inkPages,
  onPicked,
}: {
  handle: React.RefObject<ReaderHandle | null>
  currentPage: number | undefined
  bookmarkedPages: Set<number>
  highlightPages: Set<number>
  inkPages: Set<number>
  onPicked: () => void
}) {
  const total = handle.current?.pageCount?.() ?? 0
  const currentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    currentRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'center' })
  }, [])
  if (!total) return <p className="p-4 text-sm text-muted-foreground">Page thumbnails are available for PDFs and comics.</p>
  return (
    <div ref={currentRef} className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-1 px-2 pb-6">
      {Array.from({ length: total }, (_, i) => i + 1).map((p) => (
        <Thumb
          key={p}
          page={p}
          handle={handle}
          current={p === currentPage}
          marks={{ bookmark: bookmarkedPages.has(p), highlight: highlightPages.has(p), ink: inkPages.has(p) }}
          onPick={(pg) => {

            onPicked()
            handle.current?.goToPage?.(pg)
          }}
        />
      ))}
    </div>
  )
}
