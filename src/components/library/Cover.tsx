import { useEffect, useState } from 'react'
import { useObjectUrl } from '@/hooks/useObjectUrl'
import { downloadObject } from '@/lib/services/storage'
import { cn } from '@/lib/utils'
import { formatLabel } from '@/lib/formats'
import type { DocumentRecord } from '@/types'

const PALETTE = ['#8b6f47', '#4f6d7a', '#6b705c', '#7d5a50', '#5c4d7d', '#3d5a40', '#7a4e48', '#4a5568']

function hashCode(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}


function useCoverBlob(doc: Pick<DocumentRecord, 'cover' | 'coverPath'>) {
  const [blob, setBlob] = useState<Blob | undefined>(doc.cover)
  useEffect(() => {
    if (doc.cover) return setBlob(doc.cover)
    if (!doc.coverPath) return setBlob(undefined)
    let alive = true
    downloadObject(doc.coverPath)
      .then((b) => alive && setBlob(b))
      .catch(() => alive && setBlob(undefined))
    return () => {
      alive = false
    }
  }, [doc.cover, doc.coverPath])
  return blob
}

export function Cover({ doc, className }: { doc: Pick<DocumentRecord, 'id' | 'title' | 'author' | 'cover' | 'coverPath' | 'format' | 'sourceFormat'>; className?: string }) {
  const url = useObjectUrl(useCoverBlob(doc))
  if (url) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        className={cn('h-full w-full object-cover eink:grayscale dark:brightness-90', className)}
        loading="lazy"
      />
    )
  }
  const color = PALETTE[hashCode(doc.id) % PALETTE.length]
  return (
    <div
      className={cn('flex h-full w-full flex-col justify-between p-3 pt-8 text-left text-white eink:!bg-neutral-700', className)}
      style={{ background: `linear-gradient(160deg, ${color}, color-mix(in srgb, ${color} 70%, black))` }}
      aria-hidden
    >
      <span className="line-clamp-5 font-serif text-[13px] font-semibold leading-snug">{doc.title}</span>
      <span className="line-clamp-2 text-[10px] opacity-80">{doc.author || formatLabel(doc.sourceFormat, doc.format)}</span>
    </div>
  )
}
