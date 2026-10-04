import type { GraphEdge, GraphNode } from '@/types'





export function forceLayout(nodes: GraphNode[], edges: GraphEdge[], iterations = 300) {
  const n = nodes.length
  if (n === 0) return new Map<string, { x: number; y: number }>()
  const idx = new Map(nodes.map((nd, i) => [nd.id, i]))
  const pos = nodes.map((nd, i) => {
    const a = (i / n) * Math.PI * 2
    const r = 40 * Math.sqrt(n)
    return { x: Number.isFinite(nd.x) ? nd.x : Math.cos(a) * r, y: Number.isFinite(nd.y) ? nd.y : Math.sin(a) * r }
  })
  
  const spread = Math.max(...pos.map((p) => Math.abs(p.x))) + Math.max(...pos.map((p) => Math.abs(p.y)))
  if (spread < 1) pos.forEach((p, i) => ((p.x = Math.cos((i / n) * 6.283) * 200), (p.y = Math.sin((i / n) * 6.283) * 200)))

  const links = edges.map((e) => [idx.get(e.source), idx.get(e.target)]).filter((l): l is [number, number] => l[0] !== undefined && l[1] !== undefined)
  const k = 190
  let temp = 220
  const disp = pos.map(() => ({ x: 0, y: 0 }))
  for (let it = 0; it < iterations; it++) {
    for (const d of disp) (d.x = 0), (d.y = 0)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x
        let dy = pos[i].y - pos[j].y
        let dist = Math.hypot(dx, dy)
        if (dist < 0.01) {
          dx = Math.random() - 0.5
          dy = Math.random() - 0.5
          dist = 0.5
        }
        const f = (k * k) / dist
        disp[i].x += (dx / dist) * f
        disp[i].y += (dy / dist) * f
        disp[j].x -= (dx / dist) * f
        disp[j].y -= (dy / dist) * f
      }
    }
    for (const [a, b] of links) {
      const dx = pos[a].x - pos[b].x
      const dy = pos[a].y - pos[b].y
      const dist = Math.max(0.01, Math.hypot(dx, dy))
      const f = (dist * dist) / k
      disp[a].x -= (dx / dist) * f
      disp[a].y -= (dy / dist) * f
      disp[b].x += (dx / dist) * f
      disp[b].y += (dy / dist) * f
    }
    for (let i = 0; i < n; i++) {
      
      disp[i].x -= pos[i].x * 0.02
      disp[i].y -= pos[i].y * 0.02
      const d = Math.max(0.01, Math.hypot(disp[i].x, disp[i].y))
      pos[i].x += (disp[i].x / d) * Math.min(d, temp)
      pos[i].y += (disp[i].y / d) * Math.min(d, temp)
    }
    temp = Math.max(2, temp * 0.97)
  }
  return new Map(nodes.map((nd, i) => [nd.id, { x: Math.round(pos[i].x), y: Math.round(pos[i].y) }]))
}
