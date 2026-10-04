import type { Anchor, DocumentRecord, Highlight, InkStroke, ReadingState } from '@/types'
import type { InkSize, InkToolName } from '@/store/settings'

export interface TocItem {
  id: string
  label: string
  level: number

  target: unknown
  children: TocItem[]
}

export interface SearchResult {
  id: string

  where: string
  excerpt: string
  target: unknown
}

export interface ReaderPosition {

  label: string

  detail?: string

  progress: number
  page?: number
  total?: number

  chapter?: string

  chapterEnd?: number
}

export interface SelectionInfo {
  text: string
  anchor: Anchor
  order: number

  rect: { left: number; top: number; width: number; height: number }
}

export interface ReaderHandle {
  next(): void
  prev(): void
  goToToc(item: TocItem): void
  goToHighlight(h: Highlight): void
  goToAnchor(a: Anchor): void

  unionAnchor?(anchors: Anchor[]): { anchor: Anchor; text: string } | null

  adjustAnchor?(a: Anchor, side: 0 | 1, dir: -1 | 1, byChar: boolean): Promise<{ anchor: Anchor; text: string } | null>

  spanAnchors?(a: Anchor, b: Anchor): Promise<{ anchor: Anchor; text: string; order: number } | null>

  getLocation(): Anchor | null
  goToProgress(p: number): void
  search(query: string, onResults: (r: SearchResult[]) => void, signal: AbortSignal): Promise<void>
  goToSearchResult(r: SearchResult, query: string): void
  clearSearch(): void
  clearSelection(): void

  isAnchorVisible(a: Anchor): boolean

  progressOf(a: Anchor): number | null

  getVisibleText(): Promise<string>

  getLanguage(): string | null

  pageCount?(): number
  renderThumbnail?(page: number, canvas: HTMLCanvasElement, width: number): Promise<void>
  goToPage?(page: number): void

  goToHref?(href: string): void
}

export interface ReaderProps {
  doc: DocumentRecord
  file: Blob
  initialState?: ReadingState

  initialAnchor?: Anchor
  highlights: Highlight[]
  tapZones: boolean
  onReady(): void
  onError(message: string): void
  onPosition(pos: ReaderPosition): void
  onSaveState(state: Pick<ReadingState, 'progress' | 'pdf' | 'epub'>, label: string): void
  onSelection(sel: SelectionInfo | null): void

  onHighlightTap(hits: Highlight[], rect: { left: number; top: number; width: number; height: number }): void
  onToggleChrome(): void
  onToc(items: TocItem[]): void

  onJump?(): void

  onFootnote?(note: { text: string; href: string }): void
}

export interface InkBinding {
  active: boolean
  tool: InkToolName
  color: string
  size: InkSize
  fingersDraw: boolean
  pages: Map<number, InkStroke[]>
  onAdd: (page: number, stroke: InkStroke) => void
  onErase: (page: number, ids: string[]) => void
}
