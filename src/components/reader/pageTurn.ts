import type { PageTurn } from '@/store/settings'

export interface Snapshot {
  el: HTMLElement
  left: number
  top: number
  width: number
  height: number
}

export function snapshotPages(pageEls: HTMLElement[], overlay: HTMLElement): Snapshot[] {
  const o = overlay.getBoundingClientRect()
  return pageEls
    .map((pe) => {
      const r = pe.getBoundingClientRect()
      const d = document.createElement('div')
      d.className = 'pdf-page turn-leaf'
      const left = r.left - o.left
      const top = r.top - o.top
      Object.assign(d.style, { position: 'absolute', left: `${left}px`, top: `${top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: '0' })

      const innerSrc = pe.querySelector<HTMLElement>('.pdf-page-inner')
      const inner = document.createElement('div')
      inner.className = 'absolute'
      inner.style.cssText = innerSrc?.style.cssText ?? 'inset:0'
      d.style.overflow = 'hidden'
      d.appendChild(inner)
      const src = pe.querySelector<HTMLCanvasElement>('canvas.pdf-canvas')
      if (src && src.width > 0) {
        const c = document.createElement('canvas')
        c.className = 'pdf-canvas'
        c.width = src.width
        c.height = src.height
        c.getContext('2d')?.drawImage(src, 0, 0)
        inner.appendChild(c)
      }
      const tint = document.createElement('div')
      tint.className = 'pdf-tint'
      inner.appendChild(tint)
      pe.querySelectorAll('.pdf-hl-layer, svg.ink-layer').forEach((n) => {
        const c = n.cloneNode(true) as HTMLElement
        c.classList.remove('ink-layer-active')
        c.style.pointerEvents = 'none'
        inner.appendChild(c)
      })
      const shade = document.createElement('div')
      shade.className = 'turn-shade'
      d.appendChild(shade)
      return { el: d, left, top, width: r.width, height: r.height }
    })
    .sort((a, b) => a.left - b.left)
}

export interface TurnHandle {
  finish(): void
}

const EASE_OUT = 'cubic-bezier(0.22, 0.75, 0.25, 1)'
const EASE_IN = 'cubic-bezier(0.55, 0, 0.75, 0.3)'

function group(snaps: Snapshot[]) {
  const g = document.createElement('div')
  g.style.position = 'absolute'
  g.style.inset = '0'
  snaps.forEach((s) => g.appendChild(s.el))
  return g
}

function shadeOf(s: Snapshot) {
  return s.el.querySelector<HTMLElement>('.turn-shade')!
}

export function playTurn({
  overlay,
  content,
  oldSnap,
  newSnap,
  dir,
  style,
  onDone,
}: {
  overlay: HTMLElement
  content: HTMLElement
  oldSnap: Snapshot[]
  newSnap: Snapshot[]
  dir: 1 | -1
  style: Exclude<PageTurn, 'none'>
  onDone?: () => void
}): TurnHandle {
  const anims: Animation[] = []
  let finished = false
  const cleanup = () => {
    if (finished) return
    finished = true
    anims.forEach((a) => a.cancel())
    overlay.replaceChildren()
    overlay.style.display = 'none'
    content.style.visibility = ''
    onDone?.()
  }

  overlay.replaceChildren()
  overlay.style.display = 'block'
  content.style.visibility = 'hidden'
  const add = (a: Animation) => {
    anims.push(a)
    return a
  }

  if (style === 'slide') {
    const W = overlay.clientWidth
    const oldG = group(oldSnap)
    const newG = group(newSnap)
    overlay.append(oldG, newG)
    const opts: KeyframeAnimationOptions = { duration: 320, easing: EASE_OUT, fill: 'both' }
    add(oldG.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${-dir * W}px)` }], opts))
    add(newG.animate([{ transform: `translateX(${dir * W}px)` }, { transform: 'translateX(0)' }], opts))
  } else if (oldSnap.length === 2 && newSnap.length === 2) {

    const D = 560
    const [oldL, oldR] = oldSnap
    const [newL, newR] = newSnap
    const staticPages = dir > 0 ? [oldL, newR] : [newL, oldR]
    const leaf1 = dir > 0 ? oldR : oldL
    const leaf2 = dir > 0 ? newL : newR
    overlay.append(...staticPages.map((s) => s.el), leaf1.el, leaf2.el)
    leaf1.el.style.transformOrigin = dir > 0 ? 'left center' : 'right center'
    leaf2.el.style.transformOrigin = dir > 0 ? 'right center' : 'left center'
    leaf1.el.classList.add('turn-lifting')
    leaf2.el.classList.add('turn-lifting')
    const a = dir > 0 ? -90 : 90
    add(leaf1.el.animate([{ transform: 'rotateY(0deg)' }, { transform: `rotateY(${a}deg)` }], { duration: D / 2, easing: EASE_IN, fill: 'both' }))
    add(shadeOf(leaf1).animate([{ opacity: 0 }, { opacity: 0.55 }], { duration: D / 2, easing: EASE_IN, fill: 'both' }))
    add(leaf2.el.animate([{ transform: `rotateY(${-a}deg)` }, { transform: 'rotateY(0deg)' }], { duration: D / 2, delay: D / 2, easing: EASE_OUT, fill: 'both' }))
    add(shadeOf(leaf2).animate([{ opacity: 0.55 }, { opacity: 0 }], { duration: D / 2, delay: D / 2, easing: EASE_OUT, fill: 'both' }))

    const revealed = dir > 0 ? newR : newL
    add(shadeOf(revealed).animate([{ opacity: 0.3 }, { opacity: 0 }], { duration: D / 2, easing: 'ease-out', fill: 'both' }))
  } else {

    const D = 480
    const oldG = group(oldSnap)
    const newG = group(newSnap)
    const box = (snaps: Snapshot[]) => {
      const l = Math.min(...snaps.map((s) => s.left))
      const r = Math.max(...snaps.map((s) => s.left + s.width))
      return { l, r }
    }
    if (dir > 0) {
      overlay.append(newG, oldG)
      const { l } = box(oldSnap)
      oldG.style.transformOrigin = `${l}px 50%`
      oldG.classList.add('turn-lifting')
      add(oldG.animate([{ transform: 'rotateY(0deg)', opacity: 1 }, { transform: 'rotateY(-88deg)', opacity: 0.85 }], { duration: D, easing: EASE_IN, fill: 'both' }))
      oldSnap.forEach((s) => add(shadeOf(s).animate([{ opacity: 0 }, { opacity: 0.5 }], { duration: D, easing: EASE_IN, fill: 'both' })))
      newSnap.forEach((s) => add(shadeOf(s).animate([{ opacity: 0.35 }, { opacity: 0 }], { duration: D, easing: 'ease-out', fill: 'both' })))
    } else {
      overlay.append(oldG, newG)
      const { l } = box(newSnap)
      newG.style.transformOrigin = `${l}px 50%`
      newG.classList.add('turn-lifting')
      add(newG.animate([{ transform: 'rotateY(-88deg)', opacity: 0.85 }, { transform: 'rotateY(0deg)', opacity: 1 }], { duration: D, easing: EASE_OUT, fill: 'both' }))
      newSnap.forEach((s) => add(shadeOf(s).animate([{ opacity: 0.5 }, { opacity: 0 }], { duration: D, easing: EASE_OUT, fill: 'both' })))
      oldSnap.forEach((s) => add(shadeOf(s).animate([{ opacity: 0 }, { opacity: 0.35 }], { duration: D, easing: 'ease-in', fill: 'both' })))
    }
  }

  Promise.all(anims.map((a) => a.finished))
    .then(cleanup)
    .catch(cleanup)

  setTimeout(cleanup, 1200)
  return { finish: cleanup }
}
