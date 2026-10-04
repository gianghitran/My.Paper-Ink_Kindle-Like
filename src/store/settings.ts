import { applyScreenLayers, ensureKaleidoFilter, ensureToneFilter, inkTone, lightTint, paperWhite, screenLayerSpec, svgFilterUnreliable } from '@/lib/einkColor'
import { create } from 'zustand'
import { db } from '@/lib/db'
import { debounce } from '@/lib/utils'
import type { HighlightColor, HighlightDrawer, NoteMarker, PdfReadMode, PdfZoomMode } from '@/types'

export type Theme = 'light' | 'paper' | 'sepia' | 'eink' | 'dark'
export type InkMode = 'mono' | 'color'

export type InkScreen = 'off' | InkMode
export type EpubFont = 'publisher' | 'serif' | 'sans' | 'humanist' | 'mono'
export type LibrarySort = 'lastOpened' | 'added' | 'title' | 'author' | 'progress'

export type PageTurn = 'flip' | 'slide' | 'none'

export type TwoPage = 'auto' | 'landscape' | 'off'

export type InkToolName = 'pen' | 'highlighter' | 'eraser'
export type InkSize = 'fine' | 'medium' | 'bold'

export interface InkSettings {
  tool: InkToolName
  penColor: string
  highlighterColor: string
  size: InkSize

  fingerDraws: boolean
}

export interface EpubSettings {
  font: EpubFont

  fontSize: number
  lineHeight: number

  margin: number

  paragraphSpacing: number
  justify: boolean
  flow: 'paginated' | 'scrolled'

  spread: 'auto' | 'none'

  boldness: number

  wordSpacing: number
}

export interface PdfSettings {
  defaultMode: PdfReadMode
  defaultZoomMode: PdfZoomMode
}

export interface AppSettings {
  theme: Theme
  epub: EpubSettings
  pdf: PdfSettings
  sidebarCollapsed: boolean
  readerPanelWidth: number
  readerLibraryWidth: number
  libraryView: 'grid' | 'list'
  librarySort: LibrarySort
  lastHighlightColor: HighlightColor

  highlightDrawer: HighlightDrawer

  noteMarker: NoteMarker
  tapZones: boolean
  ink: InkSettings
  pageTurn: PageTurn
  twoPage: TwoPage

  pdfCoverAlone: boolean

  trimMargins: boolean

  comicRtl: boolean

  pageContrast: number

  statusBar: { timeLeftChapter: boolean; timeLeftBook: boolean; clock: boolean; battery: boolean }
  readAloud: { rate: number; voiceURI: string | null }

  lookup: { wikiLang: string; translateTo: string }

  inkFilter: { enabled: boolean; grain: boolean; mode: InkMode;  tone: number;  warmth: number }
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'paper',
  epub: {
    font: 'serif',
    fontSize: 105,
    lineHeight: 1.6,
    margin: 32,
    paragraphSpacing: 0.4,
    justify: true,
    flow: 'paginated',
    spread: 'auto',
    boldness: 0,
    wordSpacing: 0,
  },
  pdf: { defaultMode: 'continuous', defaultZoomMode: 'fit-width' },
  sidebarCollapsed: false,
  readerPanelWidth: 360,
  readerLibraryWidth: 300,
  libraryView: 'grid',
  librarySort: 'lastOpened',
  lastHighlightColor: 'yellow',
  highlightDrawer: 'lighten',
  noteMarker: 'sidemark',
  tapZones: true,
  ink: { tool: 'pen', penColor: '#1f1f1f', highlighterColor: '#facc15', size: 'medium', fingerDraws: false },
  pageTurn: 'flip',
  twoPage: 'auto',
  pdfCoverAlone: false,
  trimMargins: false,
  comicRtl: false,
  pageContrast: 1,
  statusBar: { timeLeftChapter: true, timeLeftBook: false, clock: false, battery: false },
  readAloud: { rate: 1, voiceURI: null },
  lookup: { wikiLang: 'en', translateTo: 'vi' },
  inkFilter: { enabled: false, grain: true, mode: 'mono', tone: 0, warmth: 0 },
}

export const THEME_META: Record<Theme, { label: string; swatch: string; ink: string; themeColor: string }> = {
  light: { label: 'Light', swatch: '#ffffff', ink: '#1d1d1f', themeColor: '#fbfbfa' },
  paper: { label: 'Paper', swatch: '#f7f3ea', ink: '#2b2620', themeColor: '#f7f3ea' },
  sepia: { label: 'Sepia', swatch: '#f1e6cf', ink: '#47392a', themeColor: '#f1e6cf' },
  eink: { label: 'E-Ink', swatch: '#f3f3ef', ink: '#000000', themeColor: '#f3f3ef' },
  dark: { label: 'Dark', swatch: '#121212', ink: '#dedad2', themeColor: '#121212' },
}

const SETTINGS_KEY = 'app'

interface SettingsState {
  settings: AppSettings
  loaded: boolean
  update: (patch: Partial<AppSettings>) => void
  updateEpub: (patch: Partial<EpubSettings>) => void
  updatePdf: (patch: Partial<PdfSettings>) => void
  updateInk: (patch: Partial<InkSettings>) => void
  replace: (s: AppSettings) => void
}

let settingsDirty = false
const persist = debounce((s: AppSettings) => {
  settingsDirty = false
  void db.settings.put({ key: SETTINGS_KEY, value: s })
}, 300)

if (typeof window !== 'undefined') {
  const flush = () => persist.flush()
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  update: (patch) => {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    settingsDirty = true
    persist(settings)
  },
  updateEpub: (patch) => {
    const s = get().settings
    get().update({ epub: { ...s.epub, ...patch } })
  },
  updatePdf: (patch) => {
    const s = get().settings
    get().update({ pdf: { ...s.pdf, ...patch } })
  },
  updateInk: (patch) => {
    const s = get().settings
    get().update({ ink: { ...s.ink, ...patch } })
  },
  replace: (settings) => {
    set({ settings })
    settingsDirty = true
    persist(settings)
  },
}))

export function mergeSettings(raw: unknown): AppSettings {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppSettings>
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...v,
    epub: { ...DEFAULT_SETTINGS.epub, ...(v.epub ?? {}) },
    pdf: { ...DEFAULT_SETTINGS.pdf, ...(v.pdf ?? {}) },
    ink: { ...DEFAULT_SETTINGS.ink, ...(v.ink ?? {}) },
    statusBar: { ...DEFAULT_SETTINGS.statusBar, ...(v.statusBar ?? {}) },
    readAloud: { ...DEFAULT_SETTINGS.readAloud, ...(v.readAloud ?? {}) },
    lookup: { ...DEFAULT_SETTINGS.lookup, ...(v.lookup ?? {}) },
    inkFilter: (() => {
      const f = { ...DEFAULT_SETTINGS.inkFilter, ...(v.inkFilter ?? {}) }
      const tone = Number(f.tone)
      const warmth = Number(f.warmth)
      return {
        ...f,
        mode: f.mode === 'color' ? 'color' : 'mono',
        tone: Number.isFinite(tone) ? Math.min(1, Math.max(0, tone)) : 0,
        warmth: Number.isFinite(warmth) ? Math.min(1, Math.max(-1, warmth)) : 0,
      }
    })(),
  }

  return merged.inkFilter.enabled ? { ...merged, theme: INK_BASE_THEME[merged.inkFilter.mode] } : merged
}

export function flushSettings() {
  persist.flush()
}

export async function loadSettings() {
  try {
    const rec = await db.settings.get(SETTINGS_KEY)
    useSettings.setState({ settings: mergeSettings(rec?.value), loaded: true })
  } catch (err) {
    console.error('Failed to load settings', err)
    useSettings.setState({ loaded: true })
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
}

const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`

export function screenChromeColor(s: Pick<AppSettings, 'theme' | 'inkFilter'>) {
  const base = THEME_META[s.theme].themeColor
  if (!s.inkFilter.enabled) return base
  const t = inkTone(s.inkFilter.tone)
  if (s.inkFilter.mode === 'color') return toHex(paperWhite(s.inkFilter.warmth).map((w) => w * t.bg * 255))

  const [r, g, b] = [1, 3, 5].map((i) => parseInt(base.slice(i, i + 2), 16))
  const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  const gray = Math.min(1, ((y - 0.5) * 1.08 + 0.5) * 0.99)
  const v = t.tone ? t.ink + (t.bg - t.ink) * gray : gray
  return toHex(lightTint(s.inkFilter.warmth).map((c) => v * c * 255))
}

export function applyChromeColor(s: Pick<AppSettings, 'theme' | 'inkFilter'>) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', screenChromeColor(s))
}

export function wantsTwoPages(setting: TwoPage, width: number, height: number) {
  if (!width || !height || setting === 'off') return false
  if (setting === 'landscape') return width > height * 1.05
  return width / height >= 1.3 && width >= 800
}

export function applyInkFilter(f: AppSettings['inkFilter']) {
  const el = document.documentElement
  if (svgFilterUnreliable()) {
    const toned = f.enabled && (f.mode === 'color' || f.tone > 0 || f.warmth !== 0)
    applyScreenLayers(toned ? screenLayerSpec(f.mode, f.tone, f.warmth) : null)
    if (toned) el.style.filter = 'none'
    else el.style.removeProperty('filter')
  } else if (f.enabled && f.mode === 'color') el.style.filter = `url(#${ensureKaleidoFilter(f.tone, f.warmth)})`
  else if (f.enabled && (f.tone > 0 || f.warmth !== 0))
    el.style.filter = `grayscale(1) contrast(1.08) brightness(0.99) url(#${ensureToneFilter(f.tone, f.warmth)})`
  else el.style.removeProperty('filter') 
  if (f.enabled) {
    el.dataset.inkFilter = f.grain ? 'grain' : 'plain'
    el.dataset.inkMode = f.mode

    if (f.mode === 'mono' && (f.tone > 0 || f.warmth !== 0)) el.dataset.inkToned = ''
    else delete el.dataset.inkToned
  } else {
    delete el.dataset.inkFilter
    delete el.dataset.inkMode
    delete el.dataset.inkToned
  }
}

export const inkScreenOf = (f: AppSettings['inkFilter']): InkScreen => (f.enabled ? f.mode : 'off')

export type ReadingMode = Theme | 'ink-mono' | 'ink-color'
export const INK_BASE_THEME: Record<InkMode, Theme> = { mono: 'eink', color: 'light' }

export const readingModeOf = (s: Pick<AppSettings, 'theme' | 'inkFilter'>): ReadingMode =>
  s.inkFilter.enabled ? (s.inkFilter.mode === 'color' ? 'ink-color' : 'ink-mono') : s.theme

export function withReadingMode(s: Pick<AppSettings, 'inkFilter'>, mode: ReadingMode): Pick<AppSettings, 'theme' | 'inkFilter'> {
  if (mode === 'ink-mono' || mode === 'ink-color') {
    const ink: InkMode = mode === 'ink-color' ? 'color' : 'mono'
    return { theme: INK_BASE_THEME[ink], inkFilter: { ...s.inkFilter, enabled: true, mode: ink } }
  }
  return { theme: mode, inkFilter: { ...s.inkFilter, enabled: false } }
}

export const withInkScreen = (s: Pick<AppSettings, 'theme' | 'inkFilter'>, screen: InkScreen): Pick<AppSettings, 'theme' | 'inkFilter'> =>
  screen === 'off' ? { theme: s.theme, inkFilter: { ...s.inkFilter, enabled: false } } : withReadingMode(s, screen === 'color' ? 'ink-color' : 'ink-mono')

export function applyRemoteSettings(raw: unknown) {
  if (!raw || settingsDirty) return
  const next = mergeSettings(raw)
  if (JSON.stringify(next) === JSON.stringify(useSettings.getState().settings)) return
  useSettings.setState({ settings: next })
}

export function isEinkLike(s: Pick<AppSettings, 'theme' | 'inkFilter'>) {
  return s.theme === 'eink' || s.inkFilter.enabled
}
