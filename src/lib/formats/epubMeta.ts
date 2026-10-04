import ePub from 'epubjs'
import { makeThumbnail, titleFromFileName, type ExtractedMetadata } from './index'

export async function extractEpubMetadata(data: ArrayBuffer, fileName: string): Promise<ExtractedMetadata> {
  const book = ePub(data.slice(0))
  try {
    await book.ready
    const md = await book.loaded.metadata
    let cover: Blob | undefined
    try {
      const url = await book.coverUrl()
      if (url) {
        const blob = await (await fetch(url)).blob()
        const bitmap = await createImageBitmap(blob)
        cover = await makeThumbnail(bitmap)
        bitmap.close()
      }
    } catch (err) {
      console.warn('EPUB cover extraction failed', err)
    }
    return {
      title: md.title?.trim() || titleFromFileName(fileName),
      author: md.creator?.trim() || undefined,
      cover,
    }
  } finally {
    
    void book.opened.catch(() => {}).finally(() => book.destroy())
  }
}
