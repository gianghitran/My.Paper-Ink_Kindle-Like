import type { EpubSettings, Theme } from '@/store/settings'

export const EPUB_FONTS: Record<EpubSettings['font'], { label: string; stack: string | null }> = {
  publisher: { label: 'Original', stack: null },
  serif: { label: 'Serif', stack: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, 'Times New Roman', serif" },
  sans: { label: 'Sans', stack: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, Roboto, 'Helvetica Neue', Arial, sans-serif" },
  humanist: { label: 'Humanist', stack: "Optima, Candara, 'Gill Sans', 'Segoe UI', 'Noto Sans', 'Trebuchet MS', sans-serif" },
  mono: { label: 'Mono', stack: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace" },
}

const INK: Record<Theme, { fg: string; link: string; selection: string }> = {
  light: { fg: '#1d1d1f', link: '#1d4ed8', selection: 'rgba(37,99,235,.25)' },
  paper: { fg: '#2b2620', link: '#7c4a1e', selection: 'rgba(146,104,40,.25)' },
  sepia: { fg: '#47392a', link: '#7c4a1e', selection: 'rgba(146,104,40,.28)' },
  eink: { fg: '#000000', link: '#000000', selection: 'rgba(0,0,0,.2)' },
  dark: { fg: '#d6d1c7', link: '#93c5fd', selection: 'rgba(147,197,253,.3)' },
}

export function buildEpubCss(s: EpubSettings, theme: Theme): string {
  const ink = INK[theme]
  const font = EPUB_FONTS[s.font].stack
  const textEls = 'p, li, blockquote, dd, dt, div, span, td, th, figcaption, h1, h2, h3, h4, h5, h6, em, strong, b, i, small, section, article'
  return `
html {
  color-scheme: ${theme === 'dark' ? 'dark' : 'light'} !important;
  font-size: ${s.fontSize}% !important;
  background: transparent !important;
  -webkit-text-size-adjust: none !important;
  text-size-adjust: none !important;
}
body {
  color: ${ink.fg} !important;
  background: transparent !important;
  ${font ? `font-family: ${font} !important;` : ''}
  line-height: ${s.lineHeight} !important;
  ${s.boldness > 0 ? `-webkit-text-stroke: ${(s.boldness * 0.22).toFixed(2)}px currentColor; paint-order: stroke fill;` : ''}
  ${s.wordSpacing ? `word-spacing: ${s.wordSpacing}em !important;` : ''}
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  overflow-wrap: break-word;
}
${textEls} {
  color: inherit !important;
  background-color: transparent !important;
  ${font ? 'font-family: inherit !important;' : ''}
}
p, li, blockquote, dd, div {
  line-height: ${s.lineHeight} !important;
}
${
  s.paragraphSpacing > 0
    ? `p { margin-top: 0 !important; margin-bottom: ${s.paragraphSpacing}em !important; }`
    : ''
}
p {
  ${s.justify ? 'text-align: justify !important; -webkit-hyphens: auto; hyphens: auto;' : 'text-align: start !important; -webkit-hyphens: manual; hyphens: manual;'}
}
a, a * { color: ${ink.link} !important; }
pre, code, kbd, samp, tt { font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace !important; }
img, svg, video { max-width: 100% !important; height: auto; }
${theme === 'dark' ? 'img { filter: brightness(.85) contrast(1.05); }' : ''}
${theme === 'eink' ? 'img { filter: grayscale(1) contrast(1.15); }' : ''}
::selection { background: ${ink.selection}; }
`
}
