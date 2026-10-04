import { useRef } from 'react'
import { Plus } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { ACCEPT_ATTR } from '@/lib/formats'
import { useImport, useImportState } from '@/hooks/useImport'
import { cn } from '@/lib/utils'


export function ImportButton({ label = 'Import', compact, className, variant = 'default', ...rest }: ButtonProps & { label?: string; compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const { importFiles } = useImport()
  const busy = useImportState((s) => s.busy > 0)
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : []
          e.target.value = ''
          void importFiles(files)
        }}
      />
      <Button
        variant={variant}
        size={compact ? 'icon' : 'default'}
        aria-label={label}
        title={label}
        disabled={busy}
        className={cn(className)}
        onClick={() => inputRef.current?.click()}
        {...rest}
      >
        <Plus />
        {!compact && <span>{busy ? 'Importing…' : label}</span>}
      </Button>
    </>
  )
}
