import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { byteSource } from '@/lib/byteSource'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

type IterableStream = ReadableStream & { [Symbol.asyncIterator]?: () => AsyncIterator<unknown>; values?: () => AsyncIterator<unknown> }
if (typeof ReadableStream !== 'undefined' && !(ReadableStream.prototype as IterableStream)[Symbol.asyncIterator]) {
  async function* iterate(this: ReadableStream) {
    const reader = this.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        yield value
      }
    } finally {
      reader.releaseLock()
    }
  }
  Object.defineProperty(ReadableStream.prototype, Symbol.asyncIterator, { value: iterate, configurable: true, writable: true })
  if (!(ReadableStream.prototype as IterableStream).values) Object.defineProperty(ReadableStream.prototype, 'values', { value: iterate, configurable: true, writable: true })
}

function assetUrl(path: string) {
  return new URL(path, document.baseURI).href
}

const RANGE_THRESHOLD = 32 * 1024 * 1024

export async function openPdfBlob(blob: Blob): Promise<PDFDocumentProxy> {
  const src = byteSource(blob)
  if (src.size <= RANGE_THRESHOLD) return openPdf(new Uint8Array(await blob.arrayBuffer()))
  const read = (begin: number, end: number) => src.read(begin, end)
  const transport = new pdfjsLib.PDFDataRangeTransport(src.size, await read(0, 1024 * 1024))
  transport.requestDataRange = (begin: number, end: number) => {
    void read(begin, end).then((chunk) => transport.onDataRange(begin, chunk))
  }
  return pdfjsLib.getDocument({
    range: transport,
    rangeChunkSize: 1024 * 1024,
    disableAutoFetch: true,
    disableStream: true,
    enableXfa: false,
    cMapUrl: assetUrl('pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('pdfjs/standard_fonts/'),
    wasmUrl: assetUrl('pdfjs/wasm/'),
    iccUrl: assetUrl('pdfjs/iccs/'),
  }).promise
}

export function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  return pdfjsLib.getDocument({
    data,

    enableXfa: false,
    cMapUrl: assetUrl('pdfjs/cmaps/'),
    cMapPacked: true,
    standardFontDataUrl: assetUrl('pdfjs/standard_fonts/'),
    wasmUrl: assetUrl('pdfjs/wasm/'),
    iccUrl: assetUrl('pdfjs/iccs/'),
  }).promise
}

export { pdfjsLib }
