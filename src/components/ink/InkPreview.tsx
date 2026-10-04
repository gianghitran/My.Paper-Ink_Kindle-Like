import { memo } from 'react'
import { strokePath, strokesBBox } from '@/lib/ink'
import { cn } from '@/lib/utils'
import type { InkStroke } from '@/types'


export const InkPreview = memo(function InkPreview({
  strokes,
  className,
  maxHeight = 220,
}: {
  strokes: InkStroke[]
  className?: string
  maxHeight?: number
}) {
  const box = strokesBBox(strokes)
  if (!box) return null
  const pad = Math.max(box.w, box.h) * 0.04 + 4
  const vb = `${box.x - pad} ${box.y - pad} ${box.w + pad * 2} ${box.h + pad * 2}`
  return (
    <svg
      viewBox={vb}
      className={cn('ink-surface block w-full', className)}
      style={{ maxHeight, aspectRatio: `${box.w + pad * 2} / ${box.h + pad * 2}` }}
      role="img"
      aria-label="Handwritten note"
      preserveAspectRatio="xMinYMin meet"
    >
      {strokes.map((s) => (s.tool === 'highlighter' ? <path key={s.id} d={strokePath(s)} fill={s.color} opacity={0.38} /> : null))}
      {strokes.map((s) => (s.tool === 'pen' ? <path key={s.id} d={strokePath(s)} fill={s.color} /> : null))}
    </svg>
  )
})
