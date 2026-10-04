import { useState } from 'react'
import { Segmented } from '@/components/ui/controls'
import { Highlighter, NotebookPen, X } from 'lucide-react'
import { Input, Label } from '@/components/ui/input'
import { cn, parseTags } from '@/lib/utils'

export type TagScope = 'note' | 'highlight'
export interface ScopedTag {
  tag: string
  scope: TagScope
}


export function addTags(list: ScopedTag[], text: string, scope: TagScope = 'note'): ScopedTag[] {
  const have = new Set(list.map((t) => t.tag))
  const added = parseTags(text).filter((t) => !have.has(t))
  return [...list, ...added.map((tag) => ({ tag, scope }))]
}





export function TagEditor({
  value,
  onChange,
  pending,
  onPendingChange,
  allowHighlight,
}: {
  value: ScopedTag[]
  onChange: (v: ScopedTag[]) => void
  pending: string
  onPendingChange: (v: string) => void
  allowHighlight: boolean
}) {
  const [scope, setScope] = useState<TagScope>('note')
  const add = (text: string) => addTags(value, text, allowHighlight ? scope : 'note')
  const commit = () => {
    if (!pending.trim()) return
    onChange(add(pending))
    onPendingChange('')
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor="note-tags">Tags</Label>
        {allowHighlight && (
          <Segmented
            label="New tags are"
            value={scope}
            onChange={setScope}
            className="w-64 p-0.5"
            options={[
              { value: 'note', label: (<><NotebookPen /> Note tags</>), title: 'Listed under Notes' },
              { value: 'highlight', label: (<><Highlighter /> Highlight tags</>), title: 'Stored on the highlight, listed under Highlights' },
            ]}
          />
        )}
      </div>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tags">
          {value.map((t) => (
            <li key={t.tag} className="flex items-center overflow-hidden rounded-full border border-border bg-card text-[13px]">
              {allowHighlight && (
                <button
                  type="button"
                  onClick={() => onChange(value.map((x) => (x.tag === t.tag ? { ...x, scope: x.scope === 'note' ? 'highlight' : 'note' } : x)))}
                  aria-label={`#${t.tag}: ${t.scope === 'note' ? 'note tag' : 'highlight tag'} — switch to ${t.scope === 'note' ? 'highlight' : 'note'}`}
                  title={t.scope === 'note' ? 'Note tag · tap to make it a highlight tag' : 'Highlight tag · tap to make it a note tag'}
                  className={cn(
                    'flex min-h-9 items-center gap-1 border-r border-border px-2 text-[12px] pointer-coarse:min-h-10 [&_svg]:size-3.5',
                    t.scope === 'highlight' ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {t.scope === 'note' ? <NotebookPen /> : <Highlighter />}
                  {t.scope === 'note' ? 'Note' : 'Highlight'}
                </button>
              )}
              <span className="px-2">#{t.tag}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((x) => x.tag !== t.tag))}
                aria-label={`Remove tag ${t.tag}`}
                className="flex min-h-9 items-center pr-2 text-muted-foreground hover:text-foreground pointer-coarse:min-h-10"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Input
        id="note-tags"
        value={pending}
        onChange={(e) => {
          const v = e.target.value
          
          if (/[,\s]$/.test(v) && v.trim()) {
            onChange(add(v))
            onPendingChange('')
          } else onPendingChange(v)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Backspace' && !pending && value.length) onChange(value.slice(0, -1))
        }}
        onBlur={commit}
        placeholder="Add tags, e.g. method, todo"
        autoCapitalize="none"
        autoCorrect="off"
      />
      {allowHighlight && (
        <p className="text-[12px] text-muted-foreground">
          Note tags are listed under Notes, highlight tags under Highlights. Tap a tag’s label to switch it.
        </p>
      )}
    </div>
  )
}
