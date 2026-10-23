/** Голова (волосы, лицо, уши) и мяч — особые формы рисунка фигуры. */
import { darken } from './kit'
import {
  add,
  dot,
  hull,
  litPolygon,
  mul,
  norm,
  pathOf,
  r1,
  type Prim,
  type Projector,
  type Pt,
  type V3
} from './geometry'

// ——— цвета, не зависящие от формы ———
export const SKIN = '#e3b08a'
export const SKIN_SHADE = '#c58e68'
export const SKIN_DEEP = '#a8734f'
export const BOOT = '#1b1d21'
export const BOOT_SHADE = '#0e0f12'
export const SOLE = '#d8d9d4'
export const GLOVE_BACK = '#2c3038'
export const GLOVE_LINE = '#1d2026'
export const BALL = '#fbfbf8'
export const BALL_SHADE = '#d9dcd6'
export const BALL_PATCH = '#24272c'

// ——— голова ———
export const HEAD_RX = 12.4
export const HEAD_RY = 14.4
export const HEAD_RZ = 13.6
export const SPHERE: V3[] = (() => {
  const out: V3[] = []
  const LAT = 14
  const LON = 28
  for (let i = 0; i <= LAT; i++) {
    const phi = -Math.PI / 2 + (i / LAT) * Math.PI
    for (let j = 0; j < LON; j++) {
      const th = (j / LON) * Math.PI * 2
      out.push([Math.cos(phi) * Math.cos(th), Math.sin(phi), Math.cos(phi) * Math.sin(th)])
    }
  }
  return out
})()

export interface HeadFrame {
  c: V3
  side: V3
  up: V3
  fwd: V3
}

export const onHead = (h: HeadFrame, a: number, b: number, c: number, k = 1): V3 =>
  add(
    h.c,
    add(mul(h.side, a * HEAD_RX * k), add(mul(h.up, b * HEAD_RY * k), mul(h.fwd, c * HEAD_RZ * k)))
  )

export function headPrims(h: HeadFrame, pr: Projector, hairColor: string): Prim[] {
  const out: Prim[] = []
  // Волосы — две «шапочки» на сфере головы: сверху (линия лба) и сзади (затылок).
  // Лицо и шея сзади — всё остальное. Берутся только точки с видимой стороны.
  const caps: { dir: V3; t: number; pts: Pt[] }[] = [
    { dir: norm([0, 0.94, -0.34]), t: 0.4, pts: [] },
    { dir: norm([0, 0.3, -0.95]), t: -0.05, pts: [] }
  ]
  const allPts: Pt[] = []
  const facePts: Pt[] = []
  for (const u of SPHERE) {
    const world = norm(add(mul(h.side, u[0]), add(mul(h.up, u[1]), mul(h.fwd, u[2]))))
    if (pr.dz(world) < -0.08) continue
    allPts.push(pr(onHead(h, u[0], u[1], u[2])))
    let inHair = false
    for (const cap of caps)
      if (dot(u, cap.dir) > cap.t) {
        cap.pts.push(pr(onHead(h, u[0], u[1], u[2], 1.05)))
        inHair = true
      }
    if (!inHair) facePts.push(pr(onHead(h, u[0], u[1], u[2])))
  }
  // уши: по бокам, чуть сзади середины
  const ears: Prim[] = []
  for (const sgn of [1, -1]) {
    const e = onHead(h, sgn * 0.97, -0.05, -0.08)
    const vis = pr.dz(mul(h.side, sgn))
    if (vis < -0.35) continue
    const [x, y] = pr(e)
    const w = 1.5 + 1.6 * Math.abs(vis)
    ears.push({ k: 'ellipse', cx: x, cy: y, rx: w + 0.4, ry: 4.2, fill: SKIN_SHADE })
    ears.push({
      k: 'ellipse',
      cx: x,
      cy: y,
      rx: Math.max(0.6, w - 0.6),
      ry: 2.6,
      fill: SKIN_DEEP,
      op: 0.45
    })
  }
  // подложка всей головы — чтобы между волосами и лицом не просвечивало
  out.push({ k: 'path', d: pathOf(hull(allPts)), fill: SKIN_SHADE })
  // Видимая часть области, повёрнутой от нас, — серп у края, и его оболочка залезает
  // на соседние области. Поэтому области рисуются от повёрнутой от нас к повёрнутой к нам:
  // ближняя выпуклая и закрывает лишнее.
  const toWorld = (d: V3): V3 => add(mul(h.side, d[0]), add(mul(h.up, d[1]), mul(h.fwd, d[2])))
  const regions: { dz: number; draw: () => void }[] = caps.map((cap) => ({
    dz: pr.dz(toWorld(cap.dir)),
    draw: () => {
      if (cap.pts.length < 3) return
      const hp = hull(cap.pts)
      out.push({ k: 'path', d: pathOf(hp), fill: darken(hairColor, 0.3) })
      out.push({ k: 'path', d: pathOf(litPolygon(hp, 0.82)), fill: hairColor })
    }
  }))
  regions.push({
    dz: pr.dz(toWorld([0, -0.3, 0.95])),
    draw: () => {
      if (facePts.length < 3) return
      const fp = hull(facePts)
      out.push({ k: 'path', d: pathOf(fp), fill: SKIN_SHADE })
      out.push({ k: 'path', d: pathOf(litPolygon(fp, 0.82)), fill: SKIN })
    }
  })
  for (const r of regions.sort((a, b) => a.dz - b.dz)) r.draw()
  out.push(...ears)
  // лицо: нос и глаза, только когда фигура к нам лицом или вполоборота
  const faceVis = pr.dz(h.fwd)
  if (faceVis > -0.2) {
    const nose = onHead(h, 0, -0.26, 1.0)
    const [nx, ny] = pr(nose)
    out.push({ k: 'ellipse', cx: nx, cy: ny, rx: 1.7, ry: 2.3, fill: SKIN_SHADE })
  }
  if (faceVis > 0.25) {
    for (const sgn of [1, -1]) {
      const eye = onHead(h, sgn * 0.4, 0.08, 0.93)
      const ev = pr.dz(norm(add(mul(h.side, sgn * 0.45), h.fwd)))
      if (ev < 0.2) continue
      const [ex, ey] = pr(eye)
      out.push({
        k: 'ellipse',
        cx: ex,
        cy: ey,
        rx: 1.3 * Math.min(1, ev + 0.2),
        ry: 1.7,
        fill: '#3a2a20'
      })
    }
  }
  return out
}

// ——— мяч ———
export const BALL_R = 11.5
export function ballPrims(c: V3, pr: Projector): Prim[] {
  const [x, y] = pr(c)
  const r = BALL_R
  const pent = (cx: number, cy: number, rr: number, rot: number): string =>
    pathOf(
      Array.from({ length: 5 }, (_, i) => {
        const a = rot + (i / 5) * Math.PI * 2
        return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as Pt
      })
    )
  return [
    { k: 'ellipse', cx: x, cy: y, rx: r, ry: r, fill: BALL_SHADE },
    { k: 'ellipse', cx: x - 1.6, cy: y - 1.2, rx: r - 2.2, ry: r - 2.2, fill: BALL },
    { k: 'path', d: pent(x, y, 4.2, -Math.PI / 2), fill: BALL_PATCH },
    { k: 'path', d: pent(x + 8.6, y - 3.4, 2.4, 0.4), fill: BALL_PATCH, op: 0.85 },
    { k: 'path', d: pent(x - 8.4, y - 3.6, 2.4, 2.6), fill: BALL_PATCH, op: 0.85 },
    { k: 'path', d: pent(x - 4.9, y + 8.2, 2.3, 1.2), fill: BALL_PATCH, op: 0.85 },
    { k: 'path', d: pent(x + 5.2, y + 8, 2.3, 1.9), fill: BALL_PATCH, op: 0.85 },
    {
      k: 'path',
      d: `M${r1(x - r)} ${r1(y)}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0Z`,
      fill: 'none',
      stroke: '#2a2d33',
      sw: 1.2
    }
  ]
}
