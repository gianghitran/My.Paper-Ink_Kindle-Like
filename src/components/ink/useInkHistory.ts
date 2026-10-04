import { useCallback, useEffect, useRef, useState } from 'react'
import { loadDocInk, writePageInk } from '@/lib/ink'
import type { InkStroke } from '@/types'

type Op = { kind: 'add'; key: number; strokes: InkStroke[] } | { kind: 'erase'; key: number; strokes: InkStroke[] }





export function useInkHistory(initial: Map<number, InkStroke[]>, persist?: (key: number, strokes: InkStroke[]) => void) {
  const [surfaces, setSurfaces] = useState(initial)
  const ref = useRef(initial)
  const undoStack = useRef<Op[]>([])
  const redoStack = useRef<Op[]>([])
  const [, setVersion] = useState(0)

  const set = useCallback(
    (key: number, strokes: InkStroke[]) => {
      const next = new Map(ref.current)
      next.set(key, strokes)
      ref.current = next
      setSurfaces(next)
      persist?.(key, strokes)
    },
    [persist],
  )

  const reset = useCallback((m: Map<number, InkStroke[]>) => {
    ref.current = m
    setSurfaces(m)
    undoStack.current = []
    redoStack.current = []
    setVersion((v) => v + 1)
  }, [])

  const apply = useCallback(
    (op: Op, inverse: boolean) => {
      const cur = ref.current.get(op.key) ?? []
      const adding = (op.kind === 'add') !== inverse
      if (adding) set(op.key, [...cur, ...op.strokes.filter((s) => !cur.some((c) => c.id === s.id))])
      else {
        const ids = new Set(op.strokes.map((s) => s.id))
        set(op.key, cur.filter((s) => !ids.has(s.id)))
      }
    },
    [set],
  )

  const add = useCallback(
    (key: number, stroke: InkStroke) => {
      const op: Op = { kind: 'add', key, strokes: [stroke] }
      apply(op, false)
      undoStack.current.push(op)
      redoStack.current = []
      setVersion((v) => v + 1)
    },
    [apply],
  )

  const erase = useCallback(
    (key: number, ids: string[]) => {
      const removed = (ref.current.get(key) ?? []).filter((s) => ids.includes(s.id))
      if (!removed.length) return
      const op: Op = { kind: 'erase', key, strokes: removed }
      apply(op, false)
      undoStack.current.push(op)
      redoStack.current = []
      setVersion((v) => v + 1)
    },
    [apply],
  )

  const clear = useCallback(
    (key: number) => {
      const all = ref.current.get(key) ?? []
      if (all.length) erase(key, all.map((s) => s.id))
    },
    [erase],
  )

  const undo = useCallback(() => {
    const op = undoStack.current.pop()
    if (!op) return
    apply(op, true)
    redoStack.current.push(op)
    setVersion((v) => v + 1)
  }, [apply])

  const redo = useCallback(() => {
    const op = redoStack.current.pop()
    if (!op) return
    apply(op, false)
    undoStack.current.push(op)
    setVersion((v) => v + 1)
  }, [apply])

  return {
    surfaces,
    add,
    erase,
    clear,
    undo,
    redo,
    reset,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
  }
}


export function useDocInk(docId: string) {
  const persist = useCallback((page: number, strokes: InkStroke[]) => void writePageInk(docId, page, strokes), [docId])
  const h = useInkHistory(new Map(), persist)
  const { reset } = h
  useEffect(() => {
    let cancelled = false
    void loadDocInk(docId).then((m) => !cancelled && reset(m))
    return () => {
      cancelled = true
    }
  }, [docId, reset])
  return h
}
