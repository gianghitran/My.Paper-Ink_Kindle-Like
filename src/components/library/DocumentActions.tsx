import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  BookOpen,
  CheckCircle2,
  Circle,
  Download,
  MoreHorizontal,
  Network,
  Pencil,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react'
import { Button, IconButton } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input, Label } from '@/components/ui/input'
import { Segmented } from '@/components/ui/controls'
import { deleteDocument, setStatus, toggleFavorite, updateDocumentMeta } from '@/lib/library'
import { ensureDocNode } from '@/lib/graph'
import { exportDocumentMarkdown } from '@/lib/backup'
import { parseTags } from '@/lib/utils'
import type { DocKind, DocumentRecord } from '@/types'

export function EditDocumentDialog({ doc, open, onOpenChange }: { doc: DocumentRecord; open: boolean; onOpenChange: (o: boolean) => void }) {
  const [title, setTitle] = useState(doc.title)
  const [author, setAuthor] = useState(doc.author)
  const [kind, setKind] = useState<DocKind>(doc.kind)
  const [tags, setTags] = useState(doc.tags.join(', '))
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setTitle(doc.title)
          setAuthor(doc.author)
          setKind(doc.kind)
          setTags(doc.tags.join(', '))
        }
        onOpenChange(o)
      }}
    >
      <DialogContent title="Edit details">
        <form
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault()
            await updateDocumentMeta(doc.id, { title: title.trim() || doc.title, author: author.trim(), kind, tags: parseTags(tags) })
            onOpenChange(false)
            toast.success('Details saved')
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-title">Title</Label>
            <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-author">Author(s)</Label>
            <Input id="doc-author" value={author} onChange={(e) => setAuthor(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Type</Label>
            <Segmented
              label="Document type"
              value={kind}
              onChange={setKind}
              options={[
                { value: 'paper', label: 'Paper' },
                { value: 'book', label: 'Book' },
                { value: 'document', label: 'Document' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-tags">Tags</Label>
            <Input id="doc-tags" value={tags} placeholder="e.g. ml, distillation" onChange={(e) => setTags(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Delete',
  onConfirm,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  onConfirm: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description}>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
                onOpenChange(false)
              } finally {
                setBusy(false)
              }
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DocumentMenu({ doc, triggerClassName }: { doc: DocumentRecord; triggerClassName?: string }) {
  const navigate = useNavigate()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton label={`Actions for ${doc.title}`} size="icon" className={triggerClassName} onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onSelect={() => navigate(`/read/${doc.id}`)}>
            <BookOpen /> Open
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void toggleFavorite(doc)}>
            {doc.favorite ? <StarOff /> : <Star />} {doc.favorite ? 'Remove from favorites' : 'Add to favorites'}
          </DropdownMenuItem>
          {doc.status !== 'finished' ? (
            <DropdownMenuItem onSelect={() => void setStatus(doc.id, 'finished')}>
              <CheckCircle2 /> Mark as finished
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => void setStatus(doc.id, 'reading')}>
              <BookOpen /> Mark as reading
            </DropdownMenuItem>
          )}
          {doc.status !== 'unread' && (
            <DropdownMenuItem onSelect={() => void setStatus(doc.id, 'unread')}>
              <Circle /> Mark as unread
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setEditOpen(true)}>
            <Pencil /> Edit details
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={async () => {
              const node = await ensureDocNode(doc.id)
              if (node) {
                toast.success('Node ready in graph', { action: { label: 'View', onClick: () => navigate(`/graph?focus=${node.id}`) } })
              }
            }}
          >
            <Network /> Create graph node
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void exportDocumentMarkdown(doc.id)}>
            <Download /> Export notes (Markdown)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={() => setDeleteOpen(true)}>
            <Trash2 /> Remove from library
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <EditDocumentDialog doc={doc} open={editOpen} onOpenChange={setEditOpen} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove from library?"
        description={`“${doc.title}” and its reading position, highlights, notes and graph nodes will be permanently removed from your account on every device.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          await deleteDocument(doc.id)
          toast.success('Removed from library')
        }}
      />
    </>
  )
}
