export type DocFormat = 'pdf' | 'epub' | 'comic'

export type SourceFormat = 'pdf' | 'epub' | 'txt' | 'md' | 'html' | 'fb2' | 'cbz' | 'cbt' | 'mobi'

export interface NormBox {
  x: number
  y: number
  w: number
  h: number
}

export type DocKind = 'paper' | 'book' | 'document' | 'other'
export type ReadStatus = 'unread' | 'reading' | 'finished'

export interface DocumentRecord {

  id: string

  contentHash: string

  filePath: string

  coverPath?: string
  format: DocFormat

  sourceFormat?: SourceFormat

  contentBox?: NormBox
  kind: DocKind
  title: string
  author: string
  fileName: string
  mimeType: string
  size: number
  addedAt: number
  lastOpenedAt: number | null
  favorite: 0 | 1
  status: ReadStatus

  progress: number

  positionLabel?: string
  pageCount?: number

  cover?: Blob
  tags: string[]
}

export type PdfZoomMode = 'fit-width' | 'fit-page' | 'custom'
export type PdfReadMode = 'continuous' | 'paginated'

export interface PdfReadingState {
  page: number

  offset: number

  offsetX: number
  zoom: number
  zoomMode: PdfZoomMode
  mode: PdfReadMode
}

export interface EpubReadingState {
  cfi: string
  href?: string
  chapter?: string
}

export interface ReadingState {
  docId: string
  updatedAt: number
  progress: number
  pdf?: PdfReadingState
  epub?: EpubReadingState
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

export type HighlightDrawer = 'lighten' | 'underscore' | 'strikeout' | 'invert'

export type NoteMarker = 'none' | 'underline' | 'sideline' | 'sidemark'

export interface NormRect {

  page: number

  x: number
  y: number
  w: number
  h: number
}

export interface TextQuote {
  exact: string
  prefix?: string
  suffix?: string
}

export type Anchor =
  | { type: 'pdf'; page: number; rects: NormRect[]; quote: TextQuote }
  | { type: 'epub'; cfi: string; href?: string; chapter?: string; quote: TextQuote }

export interface Highlight {
  id: string
  docId: string
  color: HighlightColor
  anchor: Anchor
  text: string
  createdAt: number
  updatedAt: number

  order: number

  tags?: string[]

  drawer?: HighlightDrawer

  hasNote?: boolean
}

export interface InkStroke {
  id: string
  tool: 'pen' | 'highlighter'
  color: string

  size: number

  points: number[]
}

export interface InkPage {

  id: string
  docId: string
  page: number
  strokes: InkStroke[]
  updatedAt: number
}

export interface NoteInk {
  width: number
  height: number
  strokes: InkStroke[]
}

export interface Note {
  id: string
  docId?: string
  highlightId?: string

  location?: Anchor
  ink?: NoteInk
  title: string
  content: string
  tags: string[]
  createdAt: number
  updatedAt: number
}

export type NodeType = 'paper' | 'book' | 'document' | 'other' | 'highlight' | 'note' | 'concept'

export interface GraphNode {
  id: string
  type: NodeType
  label: string
  docId?: string
  highlightId?: string
  noteId?: string
  description?: string
  x: number
  y: number
  createdAt: number
  updatedAt: number
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  label?: string

  auto?: 0 | 1
  createdAt: number
}

export interface SettingRecord<T = unknown> {
  key: string
  value: T
}

export interface EpubLocationsRecord {
  docId: string
  locations: string
}

export interface Bookmark {
  id: string
  docId: string
  anchor: Anchor

  label: string

  progress: number
  createdAt: number
}

export interface LookupCache {

  key: string
  data: unknown
  fetchedAt: number
}

export interface VocabWord {
  id: string
  word: string
  lang?: string
  definition?: string
  context?: string
  docId?: string
  anchor?: Anchor
  createdAt: number

  dueAt: number
  intervalDays: number
  reviews: number
}

export interface ReadingSession {
  id: string
  docId: string
  start: number
  end: number

  ms: number
  progressStart: number
  progressEnd: number

  turns: number
}
