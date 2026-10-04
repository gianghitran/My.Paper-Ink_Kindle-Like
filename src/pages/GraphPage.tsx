import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLiveQuery } from '@/lib/cloud/useLiveQuery'
import { toast } from 'sonner'
import {
  Background,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ArrowUpRight, Link2, Network, Pencil, Plus, Search, Sparkles, Trash2, Unlink, X } from 'lucide-react'
import { db } from '@/lib/db'
import { addEdge, isDocNodeType, backlinksForConcept, createConceptNode, deleteNode, ensureConceptNode, NODE_TYPE_META, renameNode } from '@/lib/graph'
import { highlightHref, noteHref } from '@/lib/annotations'
import { InkPreview } from '@/components/ink/InkPreview'
import { cn, truncate } from '@/lib/utils'
import { useSettings } from '@/store/settings'
import { useViewport } from '@/hooks/useViewport'
import { Button, IconButton } from '@/components/ui/button'
import { Input, Label, Textarea } from '@/components/ui/input'
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Badge, EmptyState } from '@/components/ui/controls'
import { Markdown } from '@/components/notes/Markdown'
import { NoteEditor, type NoteDraft } from '@/components/notes/NoteEditor'
import { GraphNodeCard, type PiFlowNode } from '@/components/graph/GraphNodeCard'
import { forceLayout } from '@/components/graph/layout'
import type { GraphNode, Note, NodeType } from '@/types'

const nodeTypes = { pi: GraphNodeCard }
const ALL_TYPES: NodeType[] = ['paper', 'book', 'document', 'other', 'highlight', 'note', 'concept']

export default function GraphPage() {
  return (
    <ReactFlowProvider>
      <GraphView />
    </ReactFlowProvider>
  )
}

function useOpenNode() {
  const navigate = useNavigate()
  return useCallback(
    async (n: GraphNode, onStandaloneNote?: (note: Note) => void) => {
      if (isDocNodeType(n.type) && n.docId) return navigate(`/read/${n.docId}`)
      if (n.type === 'highlight' && n.highlightId && n.docId) return navigate(highlightHref({ docId: n.docId, id: n.highlightId }))
      if (n.type === 'note' && n.noteId) {
        const note = await db.notes.get(n.noteId)
        if (!note) return toast.error('This note no longer exists')
        const href = noteHref(note)
        if (href) return navigate(href)
        onStandaloneNote?.(note)
      }
    },
    [navigate],
  )
}

function NewConceptDialog({ open, onOpenChange, onCreate }: { open: boolean; onOpenChange: (o: boolean) => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('')
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setName('')
        onOpenChange(o)
      }}
    >
      <DialogContent title="New concept" description="Concepts connect ideas across papers, books and notes. Reference them in notes as [[Concept]].">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            onCreate(name.trim())
            onOpenChange(false)
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Knowledge Distillation" aria-label="Concept name" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Inspector({
  node,
  allNodes,
  onFocus,
  onClose,
  onEditNote,
}: {
  node: GraphNode
  allNodes: GraphNode[]
  onFocus: (id: string) => void
  onClose: () => void
  onEditNote: (d: NoteDraft) => void
}) {
  const openNode = useOpenNode()
  const meta = NODE_TYPE_META[node.type]
  const [editing, setEditing] = useState(false)
  const [label, setLabel] = useState(node.label)
  const [desc, setDesc] = useState(node.description ?? '')
  const [connectQuery, setConnectQuery] = useState('')
  useEffect(() => {
    setLabel(node.label)
    setDesc(node.description ?? '')
    setEditing(false)
    setConnectQuery('')
  }, [node.id, node.label, node.description])

  const edges = useLiveQuery(
    async () => [...(await db.edges.where('source').equals(node.id).toArray()), ...(await db.edges.where('target').equals(node.id).toArray())],
    [node.id],
  )
  const doc = useLiveQuery(async () => (node.docId ? db.documents.get(node.docId) : undefined), [node.docId])
  const highlight = useLiveQuery(async () => (node.highlightId ? db.highlights.get(node.highlightId) : undefined), [node.highlightId])
  const note = useLiveQuery(async () => (node.noteId ? db.notes.get(node.noteId) : undefined), [node.noteId])
  const backlinks = useLiveQuery(async () => (node.type === 'concept' ? backlinksForConcept(node.label) : []), [node.type, node.label])

  const byId = useMemo(() => new Map(allNodes.map((n) => [n.id, n])), [allNodes])
  const neighbours = (edges ?? [])
    .map((e) => ({ edge: e, other: byId.get(e.source === node.id ? e.target : e.source) }))
    .filter((x): x is { edge: (typeof x)['edge']; other: GraphNode } => !!x.other)
  const connectCandidates = connectQuery.trim()
    ? allNodes
        .filter((n) => n.id !== node.id && !neighbours.some((x) => x.other.id === n.id) && n.label.toLowerCase().includes(connectQuery.trim().toLowerCase()))
        .slice(0, 8)
    : []

  return (
    <div className="flex flex-col gap-4 px-4 pb-6">
      <div className="flex items-center gap-2">
        <Badge style={{ color: meta.color }}>{meta.label}</Badge>
        <div className="flex-1" />
        {node.type !== 'concept' && (
          <Button size="sm" onClick={() => void openNode(node, (n) => onEditNote({ note: n }))}>
            <ArrowUpRight /> Open source
          </Button>
        )}
      </div>

      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault()
            await renameNode(node.id, label.trim() || node.label, desc)
            setEditing(false)
          }}
        >
          <Label htmlFor="node-label">Name</Label>
          <Input id="node-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Label htmlFor="node-desc">Description (Markdown)</Label>
          <Textarea id="node-desc" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </div>
        </form>
      ) : (
        <div>
          <div className="flex items-start gap-2">
            <h3 className={cn('flex-1 text-[17px] font-semibold leading-snug', node.type === 'highlight' && 'font-serif font-normal italic')}>
              {node.type === 'highlight' ? highlight?.text ?? node.label : node.label}
            </h3>
            {node.type === 'concept' && (
              <IconButton label="Edit concept" size="icon-sm" onClick={() => setEditing(true)}>
                <Pencil />
              </IconButton>
            )}
          </div>
          {node.description && <Markdown text={node.description} className="mt-2 text-[14px]" />}
          {doc && !isDocNodeType(node.type) && (
            <p className="mt-2 text-[13px] text-muted-foreground">
              From <span className="font-medium text-foreground">{doc.title}</span>
              {highlight?.anchor.type === 'pdf' ? ` · p. ${highlight.anchor.page}` : highlight?.anchor.type === 'epub' ? ` · ${highlight.anchor.chapter ?? ''}` : ''}
            </p>
          )}
          {doc && isDocNodeType(node.type) && (
            <p className="mt-1 text-[13px] text-muted-foreground">{doc.author || 'Unknown author'}</p>
          )}
          {note && (
            <div className="mt-3 rounded-lg bg-muted/60 p-3">
              <Markdown text={note.content} className="text-[14px]" />
              {note.ink && <InkPreview strokes={note.ink.strokes} maxHeight={200} className="mt-1" />}
              <div className="mt-1 flex justify-end">
                <Button size="sm" variant="ghost" onClick={() => onEditNote({ note })}>
                  <Pencil /> Edit note
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {node.type === 'concept' && (
        <div>
          <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            Backlinks · {backlinks?.length ?? 0}
          </h4>
          {backlinks && backlinks.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {backlinks.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className="w-full rounded-lg border border-border px-3 py-2 text-left text-[13px] hover:bg-muted"
                    onClick={async () => {
                      const nn = await db.nodes.where('noteId').equals(n.id).first()
                      if (nn) onFocus(nn.id)
                      else onEditNote({ note: n })
                    }}
                  >
                    <span className="font-medium">{n.title || truncate(n.content, 60)}</span>
                    {n.title && <span className="block text-muted-foreground">{truncate(n.content, 90)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">
              No notes mention <code className="rounded bg-muted px-1">[[{node.label}]]</code> yet.
            </p>
          )}
        </div>
      )}

      <div>
        <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">Connections · {neighbours.length}</h4>
        <ul className="flex flex-col gap-1">
          {neighbours.map(({ edge, other }) => (
            <li key={edge.id} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onFocus(other.id)}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-[13px] hover:bg-muted"
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: NODE_TYPE_META[other.type].color }} />
                <span className="truncate">{other.label}</span>
                {edge.auto ? <span className="shrink-0 text-[11px] text-muted-foreground">[[link]]</span> : null}
              </button>
              <IconButton label="Remove connection" size="icon-sm" onClick={() => void db.edges.delete(edge.id)}>
                <Unlink />
              </IconButton>
            </li>
          ))}
        </ul>
        <div className="mt-2">
          <div className="relative">
            <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={connectQuery}
              onChange={(e) => setConnectQuery(e.target.value)}
              placeholder="Connect to…"
              className="pl-9"
              aria-label="Find a node to connect"
            />
          </div>
          {connectCandidates.length > 0 && (
            <ul className="mt-1 flex flex-col rounded-lg border border-border">
              {connectCandidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-[13px] hover:bg-muted"
                    onClick={async () => {
                      await addEdge(node.id, c.id)
                      setConnectQuery('')
                      toast.success('Connected')
                    }}
                  >
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: NODE_TYPE_META[c.type].color }} />
                    <span className="truncate">{c.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <Button
        variant="ghost"
        className="self-start text-destructive"
        onClick={async () => {
          await deleteNode(node.id)
          onClose()
          toast.success('Node removed from graph')
        }}
      >
        <Trash2 /> Remove node
      </Button>
    </div>
  )
}

function GraphView() {
  const [params, setParams] = useSearchParams()
  const theme = useSettings((s) => s.settings.theme)
  const { width, isPhone } = useViewport()
  const rf = useReactFlow<PiFlowNode, Edge>()
  const openNode = useOpenNode()

  const dbNodes = useLiveQuery(() => db.nodes.toArray(), [])
  const dbEdges = useLiveQuery(() => db.edges.toArray(), [])
  const [nodes, setNodes] = useState<PiFlowNode[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [types, setTypes] = useState<Set<NodeType>>(() => new Set(ALL_TYPES))
  const [newConcept, setNewConcept] = useState(false)
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null)

  const onOpen = useCallback((n: GraphNode) => void openNode(n, (note) => setNoteDraft({ note })), [openNode])

  useEffect(() => {
    if (!dbNodes) return
    const q = query.trim().toLowerCase()
    setNodes((prev) => {
      const prevMap = new Map(prev.map((p) => [p.id, p]))
      return dbNodes.map((n) => {
        const p = prevMap.get(n.id)
        return {
          ...(p ?? {}),
          id: n.id,
          type: 'pi' as const,
          position: p?.dragging ? p.position : { x: n.x, y: n.y },
          selected: p?.selected ?? false,
          hidden: !types.has(n.type),
          data: { node: n, dimmed: !!q && !n.label.toLowerCase().includes(q), onOpen },
        }
      })
    })
  }, [dbNodes, query, types, onOpen])

  useEffect(() => {
    if (!dbEdges || !dbNodes) return
    const visible = new Set(dbNodes.filter((n) => types.has(n.type)).map((n) => n.id))
    setEdges((prev) => {
      const prevMap = new Map(prev.map((p) => [p.id, p]))
      return dbEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        selected: prevMap.get(e.id)?.selected ?? false,
        hidden: !visible.has(e.source) || !visible.has(e.target),
        style: e.auto ? { strokeDasharray: '5 4' } : undefined,
      }))
    })
  }, [dbEdges, dbNodes, types])

  const focusNode = useCallback(
    (id: string) => {
      const n = rf.getNode(id)
      if (!n) return
      setNodes((nds) => nds.map((x) => ({ ...x, selected: x.id === id })))
      setSelectedId(id)
      const w = n.measured?.width ?? 200
      const h = n.measured?.height ?? 60
      void rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: Math.max(rf.getZoom(), 1.1), duration: theme === 'eink' ? 0 : 400 })
    },
    [rf, theme],
  )

  const focusParam = params.get('focus')
  const conceptParam = params.get('concept')
  useEffect(() => {
    if (!dbNodes) return
    if (conceptParam) {
      void ensureConceptNode(conceptParam).then((n) => setParams({ focus: n.id }, { replace: true }))
      return
    }
    if (focusParam && nodes.some((n) => n.id === focusParam)) {

      const t = setTimeout(() => {
        focusNode(focusParam)
        setParams({}, { replace: true })
      }, 120)
      return () => clearTimeout(t)
    }
  }, [dbNodes, nodes.length, focusParam, conceptParam]) 

  const onNodesChange = useCallback((changes: NodeChange<PiFlowNode>[]) => setNodes((nds) => applyNodeChanges(changes, nds)), [])
  const onEdgesChange = useCallback((changes: EdgeChange<Edge>[]) => setEdges((eds) => applyEdgeChanges(changes, eds)), [])

  const selectedNode = useMemo(() => dbNodes?.find((n) => n.id === selectedId) ?? null, [dbNodes, selectedId])

  const addConcept = async (name: string) => {
    const existing = dbNodes?.find((n) => n.type === 'concept' && n.label.toLowerCase() === name.toLowerCase())
    if (existing) {
      focusNode(existing.id)
      return
    }
    const el = document.querySelector('.react-flow')?.getBoundingClientRect()
    const center = el ? rf.screenToFlowPosition({ x: el.left + el.width / 2, y: el.top + el.height / 2 }) : { x: 0, y: 0 }
    const n = await createConceptNode(name, { x: Math.round(center.x - 60), y: Math.round(center.y - 20) })
    if (selectedId) await addEdge(selectedId, n.id)
    setTimeout(() => focusNode(n.id), 150)
  }

  const autoLayout = async () => {
    if (!dbNodes || !dbEdges) return
    const pos = forceLayout(dbNodes, dbEdges)
    await db.transaction('rw', db.nodes, async () => {
      for (const [id, p] of pos) await db.nodes.update(id, { x: p.x, y: p.y })
    })
    setTimeout(() => void rf.fitView({ padding: 0.15, duration: theme === 'eink' ? 0 : 400 }), 100)
  }

  const { height } = useViewport()
  const lastSize = useRef({ width, height })
  useEffect(() => {
    const prev = lastSize.current
    if (Math.abs(prev.width - width) < 150 && Math.abs(prev.height - height) < 150) return
    lastSize.current = { width, height }
    const t = setTimeout(() => void rf.fitView({ padding: 0.2, maxZoom: 1.2 }), 200)
    return () => clearTimeout(t)
  }, [width, height, rf])

  const inlineInspector = width >= 1000
  const empty = dbNodes && dbNodes.length === 0

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col pt-safe">
      <header className="z-10 flex flex-col gap-2 border-b border-border bg-background px-3 py-2 md:px-4">
        <div className="flex items-center gap-2">
          <h1 className="font-serif text-[22px] font-semibold tracking-tight md:text-2xl">Graph</h1>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search nodes" className="pl-9" aria-label="Search nodes" />
          </div>
          <IconButton label="Auto-arrange" onClick={() => void autoLayout()} disabled={!dbNodes?.length}>
            <Sparkles />
          </IconButton>
          <Button onClick={() => setNewConcept(true)}>
            <Plus /> <span className="hidden sm:inline">Concept</span>
          </Button>
        </div>
        <div className="no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 md:mx-0 md:px-0" role="group" aria-label="Filter node types">
          {ALL_TYPES.map((t) => {
            const on = types.has(t)
            return (
              <button
                key={t}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setTypes((s) => {
                    const n = new Set(s)
                    if (n.has(t)) n.delete(t)
                    else n.add(t)
                    return n
                  })
                }
                className={cn(
                  'flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] pointer-coarse:min-h-10',
                  on ? 'border-foreground/60 bg-card' : 'border-border text-muted-foreground line-through opacity-70',
                )}
              >
                <span className="size-2.5 rounded-full" style={{ background: NODE_TYPE_META[t].color }} />
                {NODE_TYPE_META[t].label}
                <span className="tabular-nums text-muted-foreground">{dbNodes?.filter((n) => n.type === t).length ?? 0}</span>
              </button>
            )
          })}
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          <ReactFlow<PiFlowNode, Edge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={(c) => {
              if (c.source && c.target) void addEdge(c.source, c.target)
            }}
            onNodeDragStop={(_e, _n, dragged) => {
              void db.transaction('rw', db.nodes, async () => {
                for (const d of dragged) await db.nodes.update(d.id, { x: Math.round(d.position.x), y: Math.round(d.position.y), updatedAt: Date.now() })
              })
            }}
            onNodesDelete={(deleted) => {
              for (const d of deleted) void deleteNode(d.id)
              setSelectedId(null)
            }}
            onEdgesDelete={(deleted) => void db.edges.bulkDelete(deleted.map((d) => d.id))}
            onSelectionChange={({ nodes: sel }) => setSelectedId(sel.length === 1 ? sel[0].id : null)}
            onNodeDoubleClick={(_e, n) => n.data.node.type !== 'concept' && onOpen(n.data.node)}
            onPaneClick={() => setSelectedId(null)}
            connectionMode={ConnectionMode.Loose}
            deleteKeyCode={['Backspace', 'Delete']}
            colorMode={theme === 'dark' ? 'dark' : 'light'}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1.2 }}
            minZoom={0.1}
            maxZoom={2.5}
            proOptions={{ hideAttribution: true }}
            zoomOnDoubleClick={false}
            panOnScroll={false}
          >
            <Background gap={22} size={1} color="color-mix(in srgb, var(--foreground) 14%, transparent)" />
            <Controls showInteractive={false} position="bottom-left" />
            {!isPhone && (
              <MiniMap
                pannable
                zoomable
                position="bottom-right"
                nodeColor={(n) => NODE_TYPE_META[(n.data as { node: GraphNode }).node.type].color}
                maskColor="color-mix(in srgb, var(--background) 70%, transparent)"
              />
            )}
          </ReactFlow>
          {empty && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="pointer-events-auto rounded-2xl border border-border bg-card/95 shadow-[var(--shadow)]">
                <EmptyState icon={<Network />} title="Your knowledge graph is empty" className="py-8">
                  <p>
                    Create nodes from highlights while reading (“Node”), from documents in the library menu, or add concepts here. Notes that mention
                    <code className="mx-1 rounded bg-muted px-1">[[Concept]]</code>link automatically.
                  </p>
                  <Button className="mt-4" onClick={() => setNewConcept(true)}>
                    <Plus /> Add a concept
                  </Button>
                </EmptyState>
              </div>
            </div>
          )}
        </div>

        {inlineInspector && selectedNode && (
          <aside className="thin-scroll w-[360px] shrink-0 overflow-y-auto border-l border-border bg-card/60 pr-safe">
            <div className="flex h-12 items-center justify-between px-4">
              <span className="text-[14px] font-semibold">Node</span>
              <IconButton label="Close inspector" size="icon-sm" onClick={() => setSelectedId(null)}>
                <X />
              </IconButton>
            </div>
            <Inspector node={selectedNode} allNodes={dbNodes ?? []} onFocus={focusNode} onClose={() => setSelectedId(null)} onEditNote={setNoteDraft} />
          </aside>
        )}
      </div>

      {!inlineInspector && (
        <Sheet open={!!selectedNode} onOpenChange={(o) => !o && setSelectedId(null)} modal={false}>
          {selectedNode && (
            <SheetContent
              side="bottom"
              title={NODE_TYPE_META[selectedNode.type].label}
              className="h-[55dvh]"
              onInteractOutside={(e) => e.preventDefault()}
            >
              <Inspector node={selectedNode} allNodes={dbNodes ?? []} onFocus={focusNode} onClose={() => setSelectedId(null)} onEditNote={setNoteDraft} />
            </SheetContent>
          )}
        </Sheet>
      )}

      <NewConceptDialog open={newConcept} onOpenChange={setNewConcept} onCreate={(n) => void addConcept(n)} />
      <NoteEditor draft={noteDraft} onOpenChange={(o) => !o && setNoteDraft(null)} />
    </div>
  )
}
