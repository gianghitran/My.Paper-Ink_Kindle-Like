import JSZip from 'jszip'

export interface BuildChapter {
  title: string

  body: Node[]
}

export interface BuildImage {

  name: string
  mime: string
  data: Uint8Array
}

export interface BuildInput {
  title: string
  author?: string
  lang?: string
  chapters: BuildChapter[]
  images?: BuildImage[]
  coverImage?: string
  css?: string
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const BASE_CSS = `
body { margin: 0; padding: 0 0.2em; }
h1, h2, h3 { line-height: 1.25; margin: 1.2em 0 0.6em; }
h1 { font-size: 1.5em; } h2 { font-size: 1.3em; } h3 { font-size: 1.12em; }
p { margin: 0 0 0.8em; }
blockquote { margin: 0.8em 1.2em; font-style: italic; }
pre { white-space: pre-wrap; font-size: 0.88em; }
img { max-width: 100%; height: auto; }
.poem { margin: 0.8em 1.5em; }
.poem p { margin: 0; }
.subtitle { text-align: center; font-weight: bold; }
.epigraph { margin: 1em 0 1em 25%; font-style: italic; }
.text-author { text-align: right; }
.note-title { font-weight: bold; }
`

function xhtmlFor(title: string, lang: string, nodes: Node[]) {
  const doc = document.implementation.createHTMLDocument(title)
  const holder = doc.createElement('div')
  nodes.forEach((n) => holder.appendChild(doc.importNode(n, true)))
  const ser = new XMLSerializer()
  const inner = Array.from(holder.childNodes)
    .map((n) => ser.serializeToString(n))
    .join('\n')

    .replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '')
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${esc(lang)}" lang="${esc(lang)}">
<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${inner}
</body>
</html>`
}

export async function buildEpub(input: BuildInput): Promise<Blob> {
  const lang = input.lang || 'en'
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  )
  zip.file('OEBPS/style.css', BASE_CSS + (input.css ?? ''))

  const chapters = input.chapters.length ? input.chapters : [{ title: input.title, body: [] }]
  let manifest = '<item id="css" href="style.css" media-type="text/css"/>'
  let spine = ''
  let navItems = ''
  chapters.forEach((c, i) => {
    const file = `ch${String(i + 1).padStart(4, '0')}.xhtml`
    zip.file(`OEBPS/${file}`, xhtmlFor(c.title, lang, c.body))
    manifest += `<item id="c${i}" href="${file}" media-type="application/xhtml+xml"/>`
    spine += `<itemref idref="c${i}"/>`
    navItems += `<li><a href="${file}">${esc(c.title || `Part ${i + 1}`)}</a></li>`
  })
  for (const [i, img] of (input.images ?? []).entries()) {
    zip.file(`OEBPS/images/${img.name}`, img.data)
    const props = input.coverImage === img.name ? ' properties="cover-image"' : ''
    manifest += `<item id="img${i}" href="images/${esc(img.name)}" media-type="${esc(img.mime)}"${props}/>`
  }
  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="utf-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${navItems}</ol></nav></body></html>`,
  )
  manifest += '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
  const uid = `paperink-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${esc(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${uid}</dc:identifier>
<dc:title>${esc(input.title)}</dc:title>
${input.author ? `<dc:creator>${esc(input.author)}</dc:creator>` : ''}
<dc:language>${esc(lang)}</dc:language>
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
${input.coverImage ? '<meta name="cover" content="img' + (input.images ?? []).findIndex((x) => x.name === input.coverImage) + '"/>' : ''}
</metadata>
<manifest>${manifest}</manifest>
<spine>${spine}</spine>
</package>`,
  )
  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' })
}
