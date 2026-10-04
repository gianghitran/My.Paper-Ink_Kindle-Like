import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from '@/lib/cloud/useLiveQuery'
import { toast } from 'sonner'
import { Cloud, Database, Download, FileJson, KeyRound, LogOut, MonitorSmartphone, ShieldCheck, Trash2, Upload, UserRound } from 'lucide-react'
import { db } from '@/lib/db'
import { signOutEverywhere } from '@/lib/cloud/session'
import { accountLabel, hasPassword, isGoogleAccount, isUsernameAccount, useAuth } from '@/lib/services/auth'
import { SyncStatus } from '@/components/SyncStatus'
import { clearDeviceCache, deviceCacheUsage } from '@/lib/services/deviceCache'
import { exportAllMarkdown, exportBackup, importBackup } from '@/lib/backup'
import { deleteDocument, eraseAllUserData } from '@/lib/library'
import { cn, formatBytes } from '@/lib/utils'
import { useSettings } from '@/store/settings'
import { Button, IconButton } from '@/components/ui/button'
import { Segmented, Switch } from '@/components/ui/controls'
import { ConfirmDialog } from '@/components/library/DocumentActions'
import { BookLayoutSettings, HighlightSettings, InkFilterSettings, StatusBarSettings, ThemePicker } from '@/components/reader/ReaderSettings'

function Section({ title, icon, children, description }: { title: string; icon: React.ReactNode; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow)] md:p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-[18px]">{icon}</div>
        <div>
          <h2 className="text-[16px] font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  )
}

export default function SettingsPage() {
  const { settings, update, updatePdf } = useSettings()
  const navigate = useNavigate()
  const user = useAuth((s) => s.user)
  const [confirmReset, setConfirmReset] = useState(false)
  const [confirmDoc, setConfirmDoc] = useState<{ id: string; title: string } | null>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  const docs = useLiveQuery(() => db.documents.toArray(), [])
  const counts = useLiveQuery(
    async () => ({
      highlights: await db.highlights.count(),
      notes: await db.notes.count(),
      nodes: await db.nodes.count(),
      edges: await db.edges.count(),
    }),
    [],
  )

  const totalDocBytes = (docs ?? []).reduce((s, d) => s + d.size, 0)

  return (
    <div className="thin-scroll flex-1 overflow-y-auto pt-safe">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-12 md:px-6">
        <h1 className="pt-4 font-serif text-[26px] font-semibold tracking-tight md:text-3xl">Settings</h1>

        <Section title="Account" icon={<UserRound />} description="Your library, reading positions and notes are private to this account and sync across your devices.">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 text-[14px]">
              <p className="truncate font-medium">{accountLabel(user)}</p>
              <p className="text-[12px] text-muted-foreground">{isGoogleAccount(user) ? 'Signed in with Google' : isUsernameAccount(user) ? 'Username account' : 'Email account'}</p>
              <SyncStatus className="mt-0.5" />
            </div>
            <div className="flex flex-wrap gap-2">
              {hasPassword(user) && (
                <Button variant="secondary" onClick={() => navigate('/change-password')}>
                  <KeyRound /> Change password
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={async () => {
                  await signOutEverywhere()
                  navigate('/login', { replace: true })
                }}
              >
                <LogOut /> Sign out
              </Button>
            </div>
          </div>
        </Section>

        <Section title="Appearance" icon={<MonitorSmartphone />} description="Applies to the whole app and the reader.">
          <ThemePicker />
          <InkFilterSettings />
        </Section>

        <Section title="Reading" icon={<ShieldCheck />}>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-muted-foreground">New PDFs open in</span>
            <Segmented
              label="Default PDF layout"
              value={settings.pdf.defaultMode}
              onChange={(v) => updatePdf({ defaultMode: v })}
              options={[
                { value: 'continuous', label: 'Continuous scroll' },
                { value: 'paginated', label: 'Book (flip pages)' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-muted-foreground">Default PDF zoom</span>
            <Segmented
              label="Default PDF zoom"
              value={settings.pdf.defaultZoomMode === 'custom' ? 'fit-width' : settings.pdf.defaultZoomMode}
              onChange={(v) => updatePdf({ defaultZoomMode: v })}
              options={[
                { value: 'fit-width', label: 'Fit width' },
                { value: 'fit-page', label: 'Fit page' },
              ]}
            />
          </div>
          <BookLayoutSettings />
          <StatusBarSettings />
          <HighlightSettings />
          <div className="flex min-h-11 items-center justify-between gap-3">
            <label htmlFor="tz" className="text-[14px]">
              Tap page edges to turn pages
            </label>
            <Switch id="tz" checked={settings.tapZones} onCheckedChange={(v) => update({ tapZones: v })} />
          </div>
        </Section>

        <Section title="Cloud library" icon={<Cloud />} description="Files are stored in your private cloud storage; only you can access them.">
          <p className="text-[14px]">{formatBytes(totalDocBytes)} in {docs?.length ?? 0} documents (limit 200 MB per file).</p>
          <DeviceCacheRow />
          <div>
            <p className="mb-2 text-[13px] text-muted-foreground">
              {docs?.length ?? 0} documents · {formatBytes(totalDocBytes)} · {counts?.highlights ?? 0} highlights · {counts?.notes ?? 0} notes · {counts?.nodes ?? 0} nodes
            </p>
            {docs && docs.length > 0 && (
              <ul className="max-h-80 overflow-y-auto rounded-xl border border-border">
                {docs
                  .slice()
                  .sort((a, b) => b.size - a.size)
                  .map((d) => (
                    <li key={d.id} className="flex items-center gap-3 border-b border-border px-3 py-1.5 last:border-b-0">
                      <span className="min-w-0 flex-1 truncate text-[14px]">{d.title}</span>
                      <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{formatBytes(d.size)}</span>
                      <IconButton label={`Delete ${d.title}`} size="icon-sm" onClick={() => setConfirmDoc({ id: d.id, title: d.title })}>
                        <Trash2 />
                      </IconButton>
                    </li>
                  ))}
              </ul>
            )}
          </div>
          <div className={cn('flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 p-3')}>
            <div className="text-[14px]">
              <p className="font-medium">Erase all data</p>
              <p className="text-[12px] text-muted-foreground">Permanently deletes every document, file, note, highlight and setting in your account.</p>
            </div>
            <Button variant="destructive" onClick={() => setConfirmReset(true)}>
              <Trash2 /> Erase
            </Button>
          </div>
        </Section>

        <Section
          title="Backup & export"
          icon={<Database />}
          description="Backups contain metadata, reading positions, highlights, notes and the graph — not the document files."
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="secondary" onClick={() => void exportBackup()}>
              <FileJson /> Export JSON backup
            </Button>
            <Button variant="secondary" onClick={() => backupInput.current?.click()}>
              <Upload /> Import JSON backup
            </Button>
            <Button variant="secondary" className="sm:col-span-2" onClick={() => void exportAllMarkdown()}>
              <Download /> Export all highlights & notes (Markdown)
            </Button>
          </div>
          <input
            ref={backupInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              try {
                const s = await importBackup(f)
                toast.success(
                  `Restored ${s.highlights} highlights and ${s.notes} notes.` +
                    (s.missingFiles ? ` ${s.missingFiles} document(s) from the backup are not in your library — import those files first, then restore again.` : ''),
                )
              } catch (err) {
                toast.error((err as Error).message)
              }
            }}
          />
        </Section>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Erase all PaperInk data?"
        description="This permanently deletes all documents, files, highlights, notes, graph nodes and settings in your account, on every device. Export a backup first if you want to keep your notes."
        confirmLabel="Erase everything"
        onConfirm={async () => {
          try {
            await eraseAllUserData()
            toast.success('All data erased')
          } catch (err) {
            toast.error((err as Error).message)
          }
        }}
      />
      <ConfirmDialog
        open={!!confirmDoc}
        onOpenChange={(o) => !o && setConfirmDoc(null)}
        title="Remove document?"
        description={`“${confirmDoc?.title ?? ''}” and its file, highlights, notes and nodes will be permanently deleted from your account.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (confirmDoc) await deleteDocument(confirmDoc.id)
          toast.success('Removed')
        }}
      />
    </div>
  )
}


function DeviceCacheRow() {
  const [usage, setUsage] = useState<{ files: number; bytes: number } | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    let alive = true
    void deviceCacheUsage().then((u) => alive && setUsage(u))
    return () => {
      alive = false
    }
  }, [version])
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2">
      <div className="min-w-0 text-[14px]">
        <p>Downloaded on this device: {usage ? `${usage.files} file${usage.files === 1 ? '' : 's'} · ${formatBytes(usage.bytes)}` : '…'}</p>
        <p className="text-[12px] text-muted-foreground">Books open from here instead of being downloaded again. Removed when you sign out.</p>
      </div>
      <Button
        variant="secondary"
        disabled={!usage?.files}
        onClick={async () => {
          await clearDeviceCache()
          setVersion((v) => v + 1)
          toast.success('Downloaded books removed from this device')
        }}
      >
        Clear
      </Button>
    </div>
  )
}
