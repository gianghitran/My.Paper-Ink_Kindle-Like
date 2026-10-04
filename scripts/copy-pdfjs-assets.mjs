

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const pkgDir = dirname(require.resolve('pdfjs-dist/package.json'))
const out = join(process.cwd(), 'public', 'pdfjs')

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  const src = join(pkgDir, dir)
  
  if (existsSync(src)) cpSync(src, join(out, dir), { recursive: true, filter: (p) => !/quickjs/i.test(p) })
}
console.log('pdf.js assets copied to public/pdfjs')
