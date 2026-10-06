import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

const base = process.env.BASE_PATH || './'

const originOf = (url: string | undefined) => {
  try {
    return url ? new URL(url).origin : ''
  } catch {
    return ''
  }
}

function contentSecurityPolicy(mode: string): Plugin {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const supabase = originOf(env.VITE_SUPABASE_URL)
  const files = originOf(env.VITE_FILES_URL)
  const turnstile = env.VITE_TURNSTILE_SITE_KEY ? 'https://challenges.cloudflare.com' : ''
  const list = (...items: string[]) => items.filter(Boolean).join(' ')
  const policy = [
    `default-src 'self'`,
    `script-src ${list("'self'", "'wasm-unsafe-eval'", turnstile)}`,
    `style-src 'self' 'unsafe-inline' blob:`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data: blob:`,
    `connect-src ${list("'self'", 'blob:', 'data:', supabase, files, 'https://en.wiktionary.org', 'https://*.wikipedia.org')}`,
    `worker-src 'self' blob:`,
    `frame-src ${list("'self'", 'blob:', turnstile)}`,
    `media-src 'self' data: blob:`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join('; ')
  return {
    name: 'paperink-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => {
        const tags = `
    <meta http-equiv="Content-Security-Policy" content="${policy}" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />`
        if (!/<meta charset="UTF-8" \/>/.test(html)) throw new Error('index.html must declare <meta charset="UTF-8" />')
        return html.replace(/<meta charset="UTF-8" \/>/, (m) => m + tags)
      },
    },
  }
}

export default defineConfig(({ mode }) => ({
  base,
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    mode === 'https' && basicSsl({ name: 'paperink-lan' }),
    react(),
    contentSecurityPolicy(mode),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'PaperInk — PDF & Ebook Reader',
        short_name: 'PaperInk',
        description: 'Read PDFs and EPUBs, highlight, take notes and build a knowledge graph — all on your device.',
        theme_color: '#f7f3ea',
        background_color: '#f7f3ea',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'any',
        start_url: './',
        scope: './',
        categories: ['books', 'education', 'productivity'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        file_handlers: [
          {
            action: './',
            accept: {
              'application/pdf': ['.pdf'],
              'application/epub+zip': ['.epub'],
              'application/x-fictionbook+xml': ['.fb2'],
              'text/plain': ['.txt'],
              'text/markdown': ['.md', '.markdown'],
              'text/html': ['.html', '.htm'],
              'application/vnd.comicbook+zip': ['.cbz'],
              'application/x-cbt': ['.cbt'],
            },
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,woff2,wasm,bcmap,pfb,ttf}'],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: 'index.html',

        navigateFallbackDenylist: [/\/[^/?#]+\.[a-z0-9]+(?:[?#].*)?$/i],
        cleanupOutdatedCaches: true,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  worker: { format: 'es' },
}))
