import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { importFiles } from '@/lib/library'
import { create } from 'zustand'

interface ImportState {
  busy: number
  setBusy: (delta: number) => void
}
export const useImportState = create<ImportState>((set) => ({
  busy: 0,
  setBusy: (delta) => set((s) => ({ busy: Math.max(0, s.busy + delta) })),
}))

export function useImport() {
  const navigate = useNavigate()
  const setBusy = useImportState((s) => s.setBusy)

  const run = useCallback(
    async (files: File[] | FileList | null | undefined, opts: { openSingle?: boolean } = {}) => {
      const list = Array.from(files ?? [])
      if (!list.length) return
      setBusy(1)
      const toastId = toast.loading(list.length === 1 ? `Importing “${list[0].name}”…` : `Importing ${list.length} files…`)
      try {
        const results = await importFiles(list)
        const imported = results.filter((r) => r.status === 'imported')
        const dups = results.filter((r) => r.status === 'duplicate')
        const errors = results.filter((r) => r.status === 'error')
        if (imported.length) {
          const first = imported[0]
          toast.success(
            imported.length === 1 && first.status === 'imported' ? `Added “${first.doc.title}”` : `Added ${imported.length} documents`,
            imported.length === 1 && first.status === 'imported'
              ? { id: toastId, action: { label: 'Open', onClick: () => navigate(`/read/${first.doc.id}`) } }
              : { id: toastId },
          )
          if (opts.openSingle && list.length === 1 && first.status === 'imported') navigate(`/read/${first.doc.id}`)
        } else {
          toast.dismiss(toastId)
        }
        for (const d of dups) {
          if (d.status !== 'duplicate') continue
          toast.info(`Already in your library: “${d.doc.title}”`, {
            action: { label: 'Open', onClick: () => navigate(`/read/${d.doc.id}`) },
          })
          if (opts.openSingle && list.length === 1) navigate(`/read/${d.doc.id}`)
        }
        for (const e of errors) {
          if (e.status !== 'error') continue
          toast.error(`${e.fileName}: ${e.message}`)
        }
      } finally {
        setBusy(-1)
      }
    },
    [navigate, setBusy],
  )

  return { importFiles: run }
}
