import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { ArrowUpRight, BookMarked, File, FileText, Highlighter, Lightbulb, NotebookPen, Shapes } from 'lucide-react'
import { NODE_TYPE_META } from '@/lib/graph'
import { cn, truncate } from '@/lib/utils'
import type { GraphNode, NodeType } from '@/types'

export type PiNodeData = {
  node: GraphNode
  dimmed: boolean
  onOpen: (n: GraphNode) => void
}
export type PiFlowNode = Node<PiNodeData, 'pi'>

const ICONS: Record<NodeType, React.ComponentType<{ className?: string }>> = {
  paper: FileText,
  book: BookMarked,
  document: File,
  other: Shapes,
  highlight: Highlighter,
  note: NotebookPen,
  concept: Lightbulb,
}

export const GraphNodeCard = memo(function GraphNodeCard({ data, selected }: NodeProps<PiFlowNode>) {
  const { node, dimmed, onOpen } = data
  const meta = NODE_TYPE_META[node.type]
  const Icon = ICONS[node.type]
  const openable = node.type !== 'concept'
  return (
    <div
      className={cn(
        'group relative flex max-w-[240px] items-start gap-2 rounded-xl border bg-card px-3 py-2 text-left shadow-[var(--shadow)] transition-opacity',
        node.type === 'concept' && 'rounded-full px-4',
        selected ? 'border-foreground ring-2 ring-foreground/40' : 'border-border',
        dimmed && 'opacity-25',
      )}
      style={{ borderLeftColor: node.type === 'concept' ? undefined : meta.color, borderLeftWidth: node.type === 'concept' ? undefined : 4 }}
    >
      <Handle type="source" position={Position.Top} className="pi-handle" />
      <Handle type="source" position={Position.Bottom} className="pi-handle" />
      <Icon className="mt-0.5 size-4 shrink-0 eink:!text-black" />
      <div className="min-w-0">
        <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: meta.color }}>
          {meta.label}
        </div>
        <div
          className={cn(
            'text-[13px] leading-snug',
            node.type === 'highlight' ? 'font-serif italic' : 'font-medium',
            node.type === 'concept' && 'text-[14px] font-semibold',
          )}
        >
          {truncate(node.label, node.type === 'highlight' ? 110 : 80)}
        </div>
      </div>
      {openable && (
        <button
          type="button"
          aria-label={`Open ${meta.label.toLowerCase()} source`}
          title="Open source"
          className="nodrag nopan -my-1 -mr-2 flex size-9 shrink-0 pointer-coarse:size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation()
            onOpen(node)
          }}
        >
          <ArrowUpRight className="size-4" />
        </button>
      )}
    </div>
  )
})
