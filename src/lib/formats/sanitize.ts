




const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'noscript', 'template', 'svg', 'math', 'video', 'audio', 'canvas', 'frame', 'frameset'])
const ALLOWED_ATTRS = new Set(['href', 'src', 'alt', 'title', 'id', 'colspan', 'rowspan', 'lang', 'dir', 'start', 'class'])

export function sanitizeTree(root: Element) {
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase()
      if (DROP.has(tag)) {
        child.remove()
        continue
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase()
        if (!ALLOWED_ATTRS.has(name)) child.removeAttribute(attr.name)
      }
      if (child.hasAttribute('href')) {
        const href = child.getAttribute('href')!.trim()
        if (!/^(https?:|mailto:|#)/i.test(href)) child.removeAttribute('href')
      }
      if (child.hasAttribute('src')) {
        const src = child.getAttribute('src')!.trim()
        
        if (!/^data:image\//i.test(src) && !src.startsWith('images/')) child.remove()
      }
      if (child.isConnected) walk(child)
    }
  }
  walk(root)
  return root
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}


export function splitByHeadings(container: Element, fallbackTitle: string) {
  const level = container.querySelector('h1') && container.querySelectorAll('h1').length > 1 ? 'H1' : container.querySelectorAll('h2').length > 1 ? 'H2' : container.querySelector('h1') ? 'H1' : null
  const chapters: { title: string; body: Node[] }[] = []
  let cur: { title: string; body: Node[] } | null = null
  for (const node of Array.from(container.childNodes)) {
    const isHeading = level && node.nodeType === 1 && (node as Element).tagName === level
    if (isHeading || !cur) {
      cur = { title: isHeading ? (node.textContent ?? '').trim().slice(0, 120) || fallbackTitle : fallbackTitle, body: [] }
      chapters.push(cur)
    }
    cur.body.push(node)
  }
  return chapters.filter((c) => c.body.some((n) => (n.textContent ?? '').trim() || (n as Element).querySelector?.('img')))
}


export function extractDataImages(root: Element) {
  const images: { name: string; mime: string; data: Uint8Array }[] = []
  root.querySelectorAll('img[src^="data:"]').forEach((img, i) => {
    const m = img.getAttribute('src')!.match(/^data:(image\/[\w.+-]+);base64,(.*)$/i)
    if (!m) {
      img.remove()
      return
    }
    try {
      const bin = atob(m[2].replace(/\s+/g, ''))
      const data = Uint8Array.from(bin, (c) => c.charCodeAt(0))
      const ext = m[1].split('/')[1].replace('jpeg', 'jpg').replace('svg+xml', 'svg')
      const name = `inline${i}.${ext}`
      images.push({ name, mime: m[1], data })
      img.setAttribute('src', `images/${name}`)
    } catch {
      img.remove()
    }
  })
  return images
}

const XHTML_NS = 'http://www.w3.org/1999/xhtml'
const EPUB_DROP = 'script, iframe, frame, frameset, object, embed, applet, form, portal, noscript'
const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction', 'data', 'poster', 'background']





export const EPUB_CSP =
  "default-src 'none'; script-src 'none'; object-src 'none'; frame-src 'none'; child-src 'none'; form-action 'none'; " +
  "img-src blob: data:; style-src 'unsafe-inline' blob: data:; font-src blob: data:; media-src blob: data:"









export function hardenEpubSection(doc: Document) {
  const root = doc.documentElement
  if (!root) return
  root.querySelectorAll(EPUB_DROP).forEach((el) => el.remove())
  doc.querySelectorAll('meta').forEach((m) => {
    const equiv = (m.getAttribute('http-equiv') ?? '').toLowerCase()
    if (equiv && equiv !== 'content-type') m.remove() 
  })
  
  doc.querySelectorAll('set, animate').forEach((el) => {
    if (/href/i.test(el.getAttribute('attributeName') ?? '')) el.remove()
  })
  for (const el of Array.from(root.getElementsByTagName('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      if (name.startsWith('on') || name === 'srcdoc' || name === 'formaction') {
        el.removeAttributeNode(attr)
        continue
      }
      if (URL_ATTRS.includes(name) && /^\s*(javascript|vbscript|data:(?!image\/|font\/|audio\/|video\/))/i.test(attr.value)) {
        el.removeAttributeNode(attr)
      }
    }
  }
  let head = doc.getElementsByTagName('head')[0]
  if (!head) {
    head = doc.createElementNS(XHTML_NS, 'head')
    root.insertBefore(head, root.firstChild)
  }
  const csp = doc.createElementNS(XHTML_NS, 'meta')
  csp.setAttribute('http-equiv', 'Content-Security-Policy')
  csp.setAttribute('content', EPUB_CSP)
  head.insertBefore(csp, head.firstChild)
}
