
























export const KALEIDO3 = {
  colors: 4096,
  grayLevels: 16,
  ppiMono: 300,
  ppiColor: 150,
} as const


export const CHANNEL_LEVELS = Math.round(Math.cbrt(KALEIDO3.colors))


export const PASTEL_SATURATION = 0.55


export const PAPER_WHITE = [0.93, 0.93, 0.925] as const


const COOL_TINT = [0.9, 0.955, 1] as const
const WARM_TINT = [1, 0.955, 0.82] as const


export function lightTint(warmth: number): [number, number, number] {
  const w = Math.min(1, Math.max(-1, Number.isFinite(warmth) ? warmth : 0))
  const end = w < 0 ? COOL_TINT : WARM_TINT
  const a = Math.abs(w)
  return [0, 1, 2].map((i) => +(1 + (end[i] - 1) * a).toFixed(4)) as [number, number, number]
}


export const paperWhite = (warmth: number) => lightTint(warmth).map((t, i) => PAPER_WHITE[i] * t)


const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

export const KALEIDO_FILTER_ID = 'paperink-kaleido3'
export const TONE_FILTER_ID = 'paperink-ink-tone'






export function inkTone(tone: number) {
  const t = Math.min(1, Math.max(0, Number.isFinite(tone) ? tone : 0))
  const bg = 1 - t
  const inverted = bg < 0.5
  return { tone: t, bg, ink: inverted ? 1 : 0, inverted }
}

function svgHost() {
  let svg = document.getElementById('paperink-ink-filters') as SVGSVGElement | null
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.id = 'paperink-ink-filters'
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.style.position = 'absolute'
    document.body.prepend(svg)
  }
  return svg
}

let version = 0
const current: Record<string, { key: string; id: string }> = {}






function upsertFilter(base: string, key: string, build: (id: string) => string) {
  const prev = current[base]
  if (prev && prev.key === key && document.getElementById(prev.id)) return prev.id
  const id = `${base}-${++version}`
  svgHost().insertAdjacentHTML('beforeend', build(id))
  if (prev) document.getElementById(prev.id)?.remove()
  current[base] = { key, id }
  return id
}





export function ensureToneFilter(tone: number, warmth = 0) {
  const { tone: t, bg, ink } = inkTone(tone)
  
  const tint = lightTint(warmth)
  const f = (['R', 'G', 'B'] as const)
    .map((c, i) => {
      const lo = +(ink * tint[i]).toFixed(4)
      const hi = bg * tint[i]
      return `<feFunc${c} type="linear" slope="${+(hi - lo).toFixed(4)}" intercept="${lo}"/>`
    })
    .join('')
  return upsertFilter(TONE_FILTER_ID, `${t}|${tint}`, (id) => `<filter id="${id}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%"><feComponentTransfer>${f}</feComponentTransfer></filter>`)
}


export function channelTable(paper: number, ink = 0, levels = CHANNEL_LEVELS) {
  return Array.from({ length: levels }, (_, k) => +(ink + ((paper - ink) * k) / (levels - 1)).toFixed(4))
}





const DITHER_SPAN = 0.84


const GUARD = 0.003


function bayerTile() {
  const c = document.createElement('canvas')
  c.width = c.height = 4
  const ctx = c.getContext('2d')
  if (!ctx) return null
  const img = ctx.createImageData(4, 4)
  BAYER4.forEach((m, i) => {
    const v = Math.round((0.5 + ((m + 0.5) / 16 - 0.5) * DITHER_SPAN) * 255)
    img.data.set([v, v, v, 255], i * 4)
  })
  ctx.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}


export function ensureKaleidoFilter(tone = 0, warmth = 0) {
  const t = inkTone(tone)
  const paper = paperWhite(warmth)
  const key = `${t.tone}|${paper}`
  const prev = current[KALEIDO_FILTER_ID]
  if (prev && prev.key === key && document.getElementById(prev.id)) return prev.id
  
  const [r, g, b] = paper.map((w) => channelTable(w * t.bg, t.inverted ? w : 0).join(' '))
  
  const hue = t.inverted
  
  
  
  const scale = +((CHANNEL_LEVELS - 1) / CHANNEL_LEVELS).toFixed(5)
  const step = +(1 / CHANNEL_LEVELS).toFixed(5)
  const tile = bayerTile()
  
  const threshold = tile
    ? `<feImage href="${tile}" x="0" y="0" width="4" height="4" preserveAspectRatio="none" result="cell"/>
  <feTile in="cell" result="bayer"/>
  <feComposite in="pastel" in2="bayer" operator="arithmetic" k1="0" k2="${scale}" k3="${step}" k4="${GUARD}" result="dithered"/>`
    : `<feComponentTransfer in="pastel" result="dithered">
    <feFuncR type="linear" slope="${scale}" intercept="${step / 2}"/><feFuncG type="linear" slope="${scale}" intercept="${step / 2}"/><feFuncB type="linear" slope="${scale}" intercept="${step / 2}"/>
  </feComponentTransfer>`
  return upsertFilter(KALEIDO_FILTER_ID, key, (id) => `<filter id="${id}" color-interpolation-filters="sRGB" x="0" y="0" width="100%" height="100%">
  <feColorMatrix in="SourceGraphic" type="saturate" values="${PASTEL_SATURATION}" result="sat"/>
  <feColorMatrix in="sat" type="hueRotate" values="${hue ? 180 : 0}" result="pastel"/>
  ${threshold}
  <feComponentTransfer in="dithered">
    <feFuncR type="discrete" tableValues="${r}"/>
    <feFuncG type="discrete" tableValues="${g}"/>
    <feFuncB type="discrete" tableValues="${b}"/>
  </feComponentTransfer>
</filter>`)
}
