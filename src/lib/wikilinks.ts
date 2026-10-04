const WIKILINK_RE = /\[\[([^[\]|#\n]+)(?:\|([^[\]\n]+))?\]\]/g

export function extractWikilinks(text: string): string[] {
  const seen = new Map<string, string>()
  for (const m of text.matchAll(WIKILINK_RE)) {
    const name = m[1].trim()
    if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name)
  }
  return [...seen.values()]
}

export function wikilinksToMarkdown(text: string): string {
  return text.replace(WIKILINK_RE, (_m, name: string, alias?: string) => {
    const label = (alias ?? name).trim().replace(/[[\]]/g, '')
    return `[${label}](wikilink:${encodeURIComponent(name.trim())})`
  })
}

export function normalizeConcept(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}
