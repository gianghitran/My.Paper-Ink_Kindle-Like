import { useRef } from 'react'
import { cn } from '@/lib/utils'


export function ResizeHandle({
  onResize,
  onCommit,
  side,
  label,
}: {
  
  onResize: (delta: number) => void
  onCommit: () => void
  
  side: 'left' | 'right'
  label: string
}) {
  const start = useRef<number | null>(null)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      className={cn(
        'group relative z-20 w-0 shrink-0 cursor-col-resize touch-none select-none',
        'before:absolute before:inset-y-0 before:-left-2.5 before:w-5 before:content-[""] pointer-coarse:before:-left-4 pointer-coarse:before:w-8',
      )}
      onPointerDown={(e) => {
        start.current = e.clientX
        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (start.current === null) return
        const d = e.clientX - start.current
        onResize(side === 'left' ? d : -d)
      }}
      onPointerUp={() => {
        if (start.current === null) return
        start.current = null
        onCommit()
      }}
      onPointerCancel={() => {
        start.current = null
        onCommit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const d = e.key === 'ArrowLeft' ? -16 : 16
          onResize(side === 'left' ? d : -d)
          onCommit()
        }
      }}
    >
      <div className="absolute inset-y-0 -left-px w-px bg-border group-hover:bg-foreground/30" />
      <div className="absolute left-1/2 top-1/2 h-10 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground/20 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100" />
    </div>
  )
}
