import { AlertTriangle, CloudCheck, CloudOff, RefreshCw } from 'lucide-react'
import { useSyncStatus } from '@/lib/cloud/sync'
import { cn } from '@/lib/utils'


export function SyncStatus({ className, compact }: { className?: string; compact?: boolean }) {
  const { pending, syncing, offline, lastError } = useSyncStatus()
  let icon = <CloudCheck />
  let text = 'All changes saved'
  if (offline) {
    icon = <CloudOff />
    text = `Offline — ${pending} change${pending === 1 ? '' : 's'} waiting`
  } else if (pending > 0 || syncing) {
    icon = <RefreshCw className="animate-spin eink:animate-none" />
    text = 'Saving…'
  } else if (lastError) {
    icon = <AlertTriangle />
    text = 'Some changes were not saved'
  }
  return (
    <span
      role="status"
      aria-live="polite"
      title={lastError && !offline && !pending ? lastError : text}
      className={cn('inline-flex items-center gap-1.5 text-[12px] text-muted-foreground [&_svg]:size-3.5', className)}
    >
      {icon}
      {!compact && <span className="truncate">{text}</span>}
    </span>
  )
}
