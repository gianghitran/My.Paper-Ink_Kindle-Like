import { BookOpen, Columns2, Maximize, MoveHorizontal, Rows3, ScrollText, Square, ZoomIn, ZoomOut } from 'lucide-react'
import { Segmented, Slider, Switch } from '@/components/ui/controls'
import { Button, IconButton } from '@/components/ui/button'
import { THEME_META, inkScreenOf, readingModeOf, useSettings, withInkScreen, withReadingMode, type EpubFont, type Theme } from '@/store/settings'
import { INK_SCREENS, InkToneSlider } from '@/components/InkModeMenu'
import { DRAWERS } from './AnnotationToolbar'
import type { HighlightDrawer, NoteMarker } from '@/types'
import { EPUB_FONTS } from './epub/epubStyles'
import { cn, clamp } from '@/lib/utils'
import type { DocFormat } from '@/types'
import type { PdfView } from './pdf/PdfReader'

const MIN_SCALE = 0.3
const MAX_SCALE = 6

function Row({ label, value, children }: { label: string; value?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[13px]">
        <span className="font-medium text-muted-foreground">{label}</span>
        {value && <span className="tabular-nums text-muted-foreground">{value}</span>}
      </div>
      {children}
    </div>
  )
}

export function ThemePicker() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const mode = readingModeOf(settings)
  return (
    <div className="grid grid-cols-5 gap-2" role="radiogroup" aria-label="Reading theme">
      {(Object.keys(THEME_META) as Theme[]).map((t) => (
        <button
          key={t}
          type="button"
          role="radio"
          aria-checked={mode === t}
          onClick={() => update(withReadingMode(settings, t))}
          className="flex flex-col items-center gap-1.5"
        >
          <span
            className={cn(
              'flex h-12 w-full items-center justify-center rounded-xl border font-serif text-lg',
              mode === t ? 'border-foreground ring-2 ring-foreground/70' : 'border-border',
            )}
            style={{ background: THEME_META[t].swatch, color: THEME_META[t].ink }}
          >
            Aa
          </span>
          <span className={cn('text-[12px]', mode === t ? 'font-semibold' : 'text-muted-foreground')}>{THEME_META[t].label}</span>
        </button>
      ))}
    </div>
  )
}

export function ReaderSettings({
  format,
  pdfView,
  onPdfView,
  scale,
}: {
  format: DocFormat
  pdfView: PdfView
  onPdfView: (v: PdfView) => void
  scale: number
}) {
  const { settings, updateEpub, update } = useSettings()
  const e = settings.epub

  return (
    <div className="flex flex-col gap-5 px-4 pb-6">
      <Row label="Theme">
        <ThemePicker />
      </Row>
      <InkFilterSettings />

      {format !== 'epub' && (
        <>
          <div className="flex min-h-11 items-center justify-between gap-3">
            <label htmlFor="trim" className="text-[14px]">
              Trim margins
              <span className="block text-[12px] text-muted-foreground">Zoom to the printed area — bigger text for papers on phones and tablets.</span>
            </label>
            <Switch id="trim" checked={settings.trimMargins} onCheckedChange={(v) => update({ trimMargins: v })} />
          </div>
          <Row label="Contrast" value={settings.pageContrast === 1 ? 'Original' : `${Math.round(settings.pageContrast * 100)}%`}>
            <Slider label="Page contrast" min={1} max={2.2} step={0.05} value={[settings.pageContrast]} onValueChange={([v]) => update({ pageContrast: Math.round(v * 100) / 100 })} />
          </Row>
          {format === 'comic' && (
            <div className="flex min-h-11 items-center justify-between gap-3">
              <label htmlFor="rtl" className="text-[14px]">
                Right-to-left (manga)
                <span className="block text-[12px] text-muted-foreground">Turn pages and pair spreads from right to left.</span>
              </label>
              <Switch id="rtl" checked={settings.comicRtl} onCheckedChange={(v) => update({ comicRtl: v })} />
            </div>
          )}
          <Row label="Layout">
            <Segmented
              label="PDF layout"
              value={pdfView.mode}
              onChange={(mode) => onPdfView({ ...pdfView, mode, zoomMode: mode === 'paginated' && pdfView.zoomMode === 'fit-width' ? 'fit-page' : pdfView.zoomMode })}
              options={[
                { value: 'continuous', label: (<><ScrollText /> Continuous</>) },
                { value: 'paginated', label: (<><BookOpen /> Book (flip pages)</>) },
              ]}
            />
          </Row>
          <Row label="Zoom" value={`${Math.round(scale * 100)}%`}>
            <div className="flex items-center gap-2">
              <IconButton
                label="Zoom out"
                variant="secondary"
                onClick={() => onPdfView({ ...pdfView, zoomMode: 'custom', zoom: clamp(scale / 1.2, MIN_SCALE, MAX_SCALE) })}
              >
                <ZoomOut />
              </IconButton>
              <Slider
                label="Zoom level"
                min={MIN_SCALE}
                max={4}
                step={0.05}
                value={[clamp(scale, MIN_SCALE, 4)]}
                onValueChange={([v]) => onPdfView({ ...pdfView, zoomMode: 'custom', zoom: v })}
              />
              <IconButton
                label="Zoom in"
                variant="secondary"
                onClick={() => onPdfView({ ...pdfView, zoomMode: 'custom', zoom: clamp(scale * 1.2, MIN_SCALE, MAX_SCALE) })}
              >
                <ZoomIn />
              </IconButton>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <Button
                variant={pdfView.zoomMode === 'fit-width' ? 'default' : 'secondary'}
                onClick={() => onPdfView({ ...pdfView, zoomMode: 'fit-width' })}
              >
                <MoveHorizontal /> Fit width
              </Button>
              <Button
                variant={pdfView.zoomMode === 'fit-page' ? 'default' : 'secondary'}
                onClick={() => onPdfView({ ...pdfView, zoomMode: 'fit-page' })}
              >
                <Maximize /> Fit page
              </Button>
            </div>
          </Row>
        </>
      )}

      {format === 'epub' && (
        <>
          <Row label="Font">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {(Object.keys(EPUB_FONTS) as EpubFont[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => updateEpub({ font: f })}
                  aria-pressed={e.font === f}
                  className={cn(
                    'min-h-11 rounded-lg border px-2 text-[14px]',
                    e.font === f ? 'border-foreground bg-muted font-semibold' : 'border-border',
                  )}
                  style={{ fontFamily: EPUB_FONTS[f].stack ?? undefined }}
                >
                  {EPUB_FONTS[f].label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Text size" value={`${e.fontSize}%`}>
            <div className="flex items-center gap-2">
              <IconButton label="Smaller text" variant="secondary" onClick={() => updateEpub({ fontSize: clamp(useSettings.getState().settings.epub.fontSize - 5, 60, 250) })}>
                <span className="text-[13px] font-semibold">A</span>
              </IconButton>
              <Slider label="Text size" min={60} max={250} step={5} value={[e.fontSize]} onValueChange={([v]) => updateEpub({ fontSize: v })} />
              <IconButton label="Larger text" variant="secondary" onClick={() => updateEpub({ fontSize: clamp(useSettings.getState().settings.epub.fontSize + 5, 60, 250) })}>
                <span className="text-[19px] font-semibold">A</span>
              </IconButton>
            </div>
          </Row>
          <Row label="Line spacing" value={e.lineHeight.toFixed(2)}>
            <Slider label="Line spacing" min={1.1} max={2.4} step={0.05} value={[e.lineHeight]} onValueChange={([v]) => updateEpub({ lineHeight: Math.round(v * 100) / 100 })} />
          </Row>
          <Row label="Margins" value={`${e.margin}px`}>
            <Slider label="Margins" min={0} max={120} step={4} value={[e.margin]} onValueChange={([v]) => updateEpub({ margin: v })} />
          </Row>
          <Row label="Paragraph spacing" value={e.paragraphSpacing === 0 ? 'Original' : `${e.paragraphSpacing.toFixed(1)} em`}>
            <Slider
              label="Paragraph spacing"
              min={0}
              max={2}
              step={0.1}
              value={[e.paragraphSpacing]}
              onValueChange={([v]) => updateEpub({ paragraphSpacing: Math.round(v * 10) / 10 })}
            />
          </Row>
          <Row label="Boldness" value={e.boldness ? `+${e.boldness}` : 'Original'}>
            <Slider label="Boldness" min={0} max={4} step={1} value={[e.boldness]} onValueChange={([v]) => updateEpub({ boldness: v })} />
          </Row>
          <Row label="Word spacing" value={e.wordSpacing === 0 ? 'Original' : `${e.wordSpacing > 0 ? '+' : ''}${e.wordSpacing.toFixed(2)} em`}>
            <Slider label="Word spacing" min={-0.1} max={0.4} step={0.02} value={[e.wordSpacing]} onValueChange={([v]) => updateEpub({ wordSpacing: Math.round(v * 100) / 100 })} />
          </Row>
          <div className="flex min-h-11 items-center justify-between">
            <label htmlFor="justify" className="text-[14px]">
              Justify text
            </label>
            <Switch id="justify" checked={e.justify} onCheckedChange={(v) => updateEpub({ justify: v })} />
          </div>
          <Row label="Reading mode">
            <Segmented
              label="Reading mode"
              value={e.flow}
              onChange={(flow) => updateEpub({ flow })}
              options={[
                { value: 'paginated', label: (<><Rows3 /> Pages</>) },
                { value: 'scrolled', label: (<><ScrollText /> Scroll</>) },
              ]}
            />
          </Row>
        </>
      )}

      {(format !== 'epub' ? pdfView.mode === 'paginated' : e.flow === 'paginated') && <BookLayoutSettings format={format} />}

      <StatusBarSettings />
      <HighlightSettings />

      <div className="flex min-h-11 items-center justify-between gap-3">
        <label htmlFor="tapzones" className="text-[14px]">
          Tap left/right edges to turn pages
          <span className="block text-[12px] text-muted-foreground">Tap the centre to show or hide controls.</span>
        </label>
        <Switch id="tapzones" checked={settings.tapZones} onCheckedChange={(v) => update({ tapZones: v })} />
      </div>
    </div>
  )
}

export function BookLayoutSettings({ format }: { format?: DocFormat }) {
  const { settings, update } = useSettings()
  return (
    <>
      <Row label="Pages per screen">
        <Segmented
          label="Pages per screen"
          value={settings.twoPage}
          onChange={(twoPage) => update({ twoPage })}
          options={[
            { value: 'off', label: (<><Square /> One</>), title: 'Always one page' },
            { value: 'auto', label: (<><Columns2 /> Auto</>), title: 'Two pages on wide screens (16:9, 16:10, iPad landscape)' },
            { value: 'landscape', label: (<><Columns2 /> Landscape</>), title: 'Two pages whenever the screen is landscape' },
          ]}
        />
        <p className="text-[12px] text-muted-foreground">Auto shows two facing pages on wide screens such as 16:9 monitors and tablets in landscape.</p>
      </Row>
      {format !== 'epub' && settings.twoPage !== 'off' && (
        <div className="flex min-h-11 items-center justify-between gap-3">
          <label htmlFor="cover-alone" className="text-[14px]">
            Show first page alone (cover)
            <span className="block text-[12px] text-muted-foreground">Pairs pages 2–3, 4–5… like a printed book.</span>
          </label>
          <Switch id="cover-alone" checked={settings.pdfCoverAlone} onCheckedChange={(v) => update({ pdfCoverAlone: v })} />
        </div>
      )}
      <Row label="Page turn">
        <Segmented
          label="Page turn animation"
          value={settings.pageTurn}
          onChange={(pageTurn) => update({ pageTurn })}
          options={[
            { value: 'flip', label: 'Flip' },
            { value: 'slide', label: 'Slide' },
            { value: 'none', label: 'None' },
          ]}
        />
        {settings.theme === 'eink' && <p className="text-[12px] text-muted-foreground">E-Ink theme always turns pages instantly.</p>}
      </Row>
    </>
  )
}

export function StatusBarSettings() {
  const sb = useSettings((s) => s.settings.statusBar)
  const update = useSettings((s) => s.update)
  const items: { key: keyof typeof sb; label: string }[] = [
    { key: 'timeLeftChapter', label: 'Time left in chapter' },
    { key: 'timeLeftBook', label: 'Time left in book' },
    { key: 'clock', label: 'Clock' },
    { key: 'battery', label: 'Battery (where supported)' },
  ]
  return (
    <Row label="Status line">
      <div className="flex flex-col">
        {items.map((it) => (
          <div key={it.key} className="flex min-h-11 items-center justify-between gap-3">
            <label htmlFor={`sb-${it.key}`} className="text-[14px]">
              {it.label}
            </label>
            <Switch id={`sb-${it.key}`} checked={sb[it.key]} onCheckedChange={(v) => update({ statusBar: { ...sb, [it.key]: v } })} />
          </div>
        ))}
        <p className="text-[12px] text-muted-foreground">Time estimates use your own reading speed for this document.</p>
      </div>
    </Row>
  )
}

export function InkFilterSettings() {
  const settings = useSettings((s) => s.settings)
  const f = settings.inkFilter
  const update = useSettings((s) => s.update)
  const screen = inkScreenOf(f)
  return (
    <div className="flex flex-col rounded-xl bg-muted/60 px-3 py-1">
      <div className="flex flex-col gap-2 py-2">
        <p className="text-[14px]">
          E-ink screen
          <span className="block text-[12px] text-muted-foreground">
            {screen === 'color'
              ? 'Kaleido 3-style colour e-paper: pastel colours, 4,096 colours (16 levels per channel), non-emissive paper white, crisp black text and instant page turns.'
              : screen === 'mono'
                ? 'Grayscale e-paper with e-ink contrast and instant page turns, like iPad Color Filters.'
                : 'Off — the theme above is used. Choosing an e-ink screen replaces the theme (and choosing a theme turns the e-ink screen off).'}
          </span>
        </p>
        <Segmented
          label="E-ink screen"
          value={screen}
          onChange={(v) => update(withInkScreen(settings, v))}
          options={INK_SCREENS.map((s) => ({ value: s.value, label: s.label, title: s.hint }))}
        />
      </div>
      {f.enabled && <InkToneSlider className="pb-1" />}
      {f.enabled && (
        <div className="flex min-h-11 items-center justify-between gap-3">
          <label htmlFor="ink-grain" className="text-[14px]">
            Paper texture
          </label>
          <Switch id="ink-grain" checked={f.grain} onCheckedChange={(v) => update({ inkFilter: { ...f, grain: v } })} />
        </div>
      )}
    </div>
  )
}

export function HighlightSettings() {
  const drawer = useSettings((s) => s.settings.highlightDrawer)
  const marker = useSettings((s) => s.settings.noteMarker)
  const update = useSettings((s) => s.update)
  return (
    <Row label="Highlights">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] text-muted-foreground">Style for new highlights</p>
          <Segmented<HighlightDrawer>
            label="Highlight style"
            value={drawer}
            onChange={(v) => update({ highlightDrawer: v })}
            options={DRAWERS.map((d) => ({ value: d.id, label: (<><d.icon /> <span className="hidden sm:inline">{d.label}</span></>), title: d.label }))}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-[13px] text-muted-foreground">Mark highlights that have a note</p>
          <Segmented<NoteMarker>
            label="Note marker"
            value={marker}
            onChange={(v) => update({ noteMarker: v })}
            options={[
              { value: 'none', label: 'None' },
              { value: 'underline', label: 'Underline' },
              { value: 'sideline', label: 'Side line' },
              { value: 'sidemark', label: 'Side mark' },
            ]}
          />
        </div>
        <p className="text-[12px] text-muted-foreground">Tap a highlight to change its style or colour; tap one with a note to read the note.</p>
      </div>
    </Row>
  )
}
