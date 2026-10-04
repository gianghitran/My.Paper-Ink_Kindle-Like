




type Modify = (alter: 'extend', direction: 'forward' | 'backward', granularity: 'word' | 'character') => void

export function adjustRange(win: Window, range: Range, side: 0 | 1, dir: -1 | 1, byChar: boolean): Range | null {
  const sel = win.getSelection()
  if (!sel || typeof (sel as unknown as { modify?: Modify }).modify !== 'function') return null
  const modify = (sel as unknown as { modify: Modify }).modify.bind(sel)
  const before = range.toString()
  sel.removeAllRanges()
  
  if (side === 0) sel.setBaseAndExtent(range.endContainer, range.endOffset, range.startContainer, range.startOffset)
  else sel.setBaseAndExtent(range.startContainer, range.startOffset, range.endContainer, range.endOffset)
  const direction = dir > 0 ? 'forward' : 'backward'
  let out: Range | null = null
  for (let i = 0; i < 4; i++) {
    modify('extend', direction, byChar ? 'character' : 'word')
    if (!sel.rangeCount) break
    out = sel.getRangeAt(0).cloneRange()
    const edge = side === 0 ? out.toString().charAt(0) : out.toString().slice(-1)
    
    if (!byChar || !/\s/.test(edge)) break
  }
  sel.removeAllRanges()
  if (!out) return null
  trimRange(out)
  const text = out.toString()
  if (!text.trim() || text === before) return null
  return out
}


export function trimRange(r: Range) {
  const text = r.toString()
  const lead = text.length - text.trimStart().length
  const trail = text.length - text.trimEnd().length
  if (lead) shift(r, 'start', lead)
  if (trail) shift(r, 'end', -trail)
}


function shift(r: Range, which: 'start' | 'end', n: number) {
  const doc = r.startContainer.ownerDocument
  if (!doc) return
  const node = which === 'start' ? r.startContainer : r.endContainer
  const offset = which === 'start' ? r.startOffset : r.endOffset
  const walker = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT)
  
  let cur: Text | null = null
  let pos = 0
  if (node.nodeType === Node.TEXT_NODE) {
    walker.currentNode = node
    cur = node as Text
    pos = offset
  } else {
    const child = node.childNodes[offset] ?? null
    walker.currentNode = child ?? node
    cur = (child?.nodeType === Node.TEXT_NODE ? child : walker.nextNode()) as Text | null
    pos = 0
  }
  let left = n
  while (cur && left !== 0) {
    if (left > 0) {
      const room = cur.data.length - pos
      if (left <= room) {
        pos += left
        left = 0
      } else {
        left -= room
        cur = walker.nextNode() as Text | null
        pos = 0
      }
    } else {
      if (-left <= pos) {
        pos += left
        left = 0
      } else {
        left += pos
        cur = walker.previousNode() as Text | null
        pos = cur ? cur.data.length : 0
      }
    }
  }
  if (!cur) return
  if (which === 'start') r.setStart(cur, pos)
  else r.setEnd(cur, pos)
}
