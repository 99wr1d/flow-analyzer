/**
 * «Кукла» для рисунков фигур. Поза задаётся один раз — суставами в объёме, — а рисунок для каждого
 * направления получается поворотом вокруг вертикали. Так у позы спереди, вполоборота, сбоку и
 * со спины одни и те же руки, ноги и наклон.
 *
 * Единицы: ступни в (0,0), рост стоящего ≈ 200, Y вниз (вверх — минус).
 * Свои оси фигуры: X — в сторону её левой руки (на виде «лицом» это вправо по экрану), Z — вперёд,
 * куда смотрит фигура (на виде «лицом» — на нас). Камера чуть сверху: ближнее к нам опускается
 * на `TILT` от глубины, как на перспективных видах поля.
 *
 * Каждая часть тела — выпуклая оболочка нескольких шаров (бедро, голень, кисть, корпус),
 * поэтому руки и ноги рисуются плавными сужающимися формами, а не палками.
 * Светотень: часть целиком заливается тенью, сверху — её копия из уменьшенных шаров,
 * сдвинутых к свету (свет слева сверху). Части сортируются по глубине.
 */
import type { JSX } from 'react'
import type { Kit } from './kit'
import { darken, lighten, luma } from './kit'
import {
  add,
  circlesHull,
  cross,
  dot,
  lerp,
  LIGHT,
  mul,
  norm,
  pathOf,
  projector,
  r1,
  sub,
  type Prim,
  type Projector,
  type Pt,
  type V3
} from './geometry'
import {
  BALL,
  BALL_R,
  ballPrims,
  BOOT,
  BOOT_SHADE,
  GLOVE_BACK,
  GLOVE_LINE,
  HEAD_RZ,
  headPrims,
  SKIN,
  SKIN_DEEP,
  SKIN_SHADE,
  SOLE,
  type HeadFrame
} from './head'

/** Направления, которые рисуются; `*-left` — зеркала `*-right`. */
export const DRAWN_FACINGS = ['front', 'front-right', 'right', 'back-right', 'back'] as const
export type DrawnFacing = (typeof DRAWN_FACINGS)[number]

/** Угол поворота фигуры для направления: 0 — лицом к нам, 90° — смотрит вправо, 180° — спиной. */
export const FACING_YAW: Record<DrawnFacing, number> = {
  front: 0,
  'front-right': Math.PI / 4,
  right: Math.PI / 2,
  'back-right': (3 * Math.PI) / 4,
  back: Math.PI
}

export interface Arm {
  elbow: V3
  /** Середина кисти (ладони). */
  hand: V3
  /** Куда смотрит ладонь. */
  palm: V3
}
export interface Leg {
  knee: V3
  ankle: V3
  /** Носок ботинка. */
  toe: V3
}
/** Поза. `L` — левая сторона фигуры (+X), `R` — правая (−X). */
export interface Skeleton {
  head: V3
  headUp?: V3
  headFwd?: V3
  /** Середина линии плеч. */
  chest: V3
  /** Середина таза (тазобедренных суставов). */
  pelvis: V3
  shoulderAxis?: V3
  hipAxis?: V3
  armL: Arm
  armR: Arm
  legL: Leg
  legR: Leg
  ball?: V3
}

/** Чем фигура одета. */
export interface Dress {
  sleeves: 'long' | 'short'
  legs: 'shorts' | 'trousers'
  gloves: boolean
  hair: string
  number?: string
  jacket?: boolean
}

interface Ball3 {
  p: V3
  r: number
}

interface Part {
  name: string
  balls: Ball3[]
  fill: string
  shade?: string
  /** Блик — узкая светлая полоса со стороны света. */
  light?: string
  stroke?: string
  strokeWidth?: number
  /** Сдвиг глубины: + ближе к нам. */
  bias?: number
  /** Эта часть всегда поверх перечисленных. */
  after?: string[]
  /** Особые формы: голова, мяч, номер — рисуются своими функциями. */
  custom?: (pr: Projector) => Prim[]
}

function blobPrims(part: Part, pr: Projector): Prim[] {
  const circles = part.balls.map((b) => ({ c: pr(b.p), r: b.r }))
  const out: Prim[] = []
  const outline = pathOf(circlesHull(circles))
  if (!part.shade) {
    out.push({ k: 'path', d: outline, fill: part.fill, stroke: part.stroke, sw: part.strokeWidth })
    return out
  }
  out.push({ k: 'path', d: outline, fill: part.shade, stroke: part.stroke, sw: part.strokeWidth })
  const s = 0.66
  const lit = circles.map(({ c, r }) => ({
    c: [c[0] + LIGHT[0] * (1 - s) * r, c[1] + LIGHT[1] * (1 - s) * r] as Pt,
    r: r * s
  }))
  out.push({ k: 'path', d: pathOf(circlesHull(lit)), fill: part.fill })
  if (part.light) {
    const s2 = 0.34
    const hi = circles.map(({ c, r }) => ({
      c: [c[0] + LIGHT[0] * (1 - s2) * r * 0.8, c[1] + LIGHT[1] * (1 - s2) * r * 0.8] as Pt,
      r: r * s2
    }))
    out.push({ k: 'path', d: pathOf(circlesHull(hi)), fill: part.light, op: 0.7 })
  }
  if (part.stroke) {
    // контур поверх светлой части, чтобы белое не сливалось с фоном
    out.push({ k: 'path', d: outline, fill: 'none', stroke: part.stroke, sw: part.strokeWidth })
  }
  return out
}

// ——— сборка фигуры ———
const DOWN: V3 = [0, 1, 0]
const UP: V3 = [0, -1, 0]

function limbParts(
  name: string,
  a: V3,
  b: V3,
  ra: number,
  rb: number,
  fill: string,
  shade: string,
  extra?: Partial<Part>
): Part {
  return {
    name,
    balls: [
      { p: a, r: ra },
      { p: b, r: rb }
    ],
    fill,
    shade,
    ...extra
  }
}

function buildParts(s: Skeleton, dress: Dress, pr: Projector): Part[] {
  const parts: Part[] = []
  const spineUp = norm(sub(s.chest, s.pelvis))
  const shAxis = norm(s.shoulderAxis ?? [1, 0, 0])
  const hipAxis = norm(s.hipAxis ?? shAxis)
  const fwd = norm(cross(spineUp, shAxis))
  const shoulder = (sgn: number): V3 =>
    add(add(s.chest, mul(shAxis, sgn * 18.5)), mul(spineUp, -3.5))
  const hip = (sgn: number): V3 => add(s.pelvis, mul(hipAxis, sgn * 9.6))

  // торс: сечения от плеч к поясу — пары шаров по ширине
  const torsoBalls: Ball3[] = []
  const levels: [number, number, number][] = [
    // t (0 — плечи, 1 — пояс), полуширина, толщина
    [0.04, 13.5, 7.5],
    [0.3, 19.6, 10.8],
    [0.7, 16.6, 9.6],
    [0.86, 16.8, 9.6]
  ]
  const top = add(s.chest, mul(spineUp, 0))
  const bottom = add(s.pelvis, mul(spineUp, 7))
  for (const [t, w, d] of levels) {
    const c = lerp(top, bottom, t)
    const ax = norm(lerp(shAxis, hipAxis, t))
    torsoBalls.push({ p: add(c, mul(ax, w - d)), r: d }, { p: sub(c, mul(ax, w - d)), r: d })
  }
  // низ футболки — ровный край: ряд маленьких шаров по ширине и толщине
  {
    const ax = hipAxis
    for (const x of [-12.6, -4.2, 4.2, 12.6])
      for (const z of [-4.6, 4.6])
        torsoBalls.push({ p: add(add(bottom, mul(ax, x)), mul(fwd, z)), r: 5.2 })
  }
  torsoBalls.push({ p: shoulder(1), r: 8.4 }, { p: shoulder(-1), r: 8.4 })
  parts.push({
    name: 'torso',
    balls: torsoBalls,
    fill: 'shirt',
    shade: 'shirtShade',
    after: ['pelvis']
  })
  // ворот
  const collarC = add(s.chest, mul(spineUp, 2.5))
  parts.push({
    name: 'collar',
    balls: [
      { p: add(collarC, mul(shAxis, 6)), r: dress.jacket ? 6 : 4.6 },
      { p: add(collarC, mul(shAxis, -6)), r: dress.jacket ? 6 : 4.6 },
      { p: add(collarC, mul(fwd, 3)), r: dress.jacket ? 6 : 4.6 }
    ],
    fill: dress.jacket ? 'shirt' : 'shirtShade',
    shade: dress.jacket ? 'shirtShade' : undefined,
    after: ['torso']
  })

  // молния куртки — по середине груди, когда грудь видна
  if (dress.jacket && pr.dz(fwd) > 0.15) {
    const a = add(lerp(top, bottom, 0.04), mul(fwd, 8.2))
    const b = add(lerp(top, bottom, 0.98), mul(fwd, 9.4))
    parts.push({
      name: 'zip',
      balls: [
        { p: a, r: 0 },
        { p: b, r: 0 }
      ],
      fill: 'none',
      after: ['torso', 'collar'],
      custom: (p) => {
        const [ax, ay] = p(a)
        const [bx, by] = p(b)
        return [
          {
            k: 'path',
            d: `M${r1(ax)} ${r1(ay)}L${r1(bx)} ${r1(by)}`,
            fill: 'none',
            stroke: 'shirtLight',
            sw: 1.4
          }
        ]
      }
    })
  }

  // шорты / брюки: таз
  const legsColor = 'shorts'
  parts.push({
    name: 'pelvis',
    balls: [
      { p: add(add(s.pelvis, mul(spineUp, 8)), mul(hipAxis, 8)), r: 9.6 },
      { p: add(add(s.pelvis, mul(spineUp, 8)), mul(hipAxis, -8)), r: 9.6 },
      { p: add(s.pelvis, mul(hipAxis, 8.4)), r: 9.4 },
      { p: add(s.pelvis, mul(hipAxis, -8.4)), r: 9.4 }
    ],
    fill: legsColor,
    shade: 'shortsShade',
    bias: -1
  })

  // ноги
  for (const [sgn, leg] of [
    [1, s.legL],
    [-1, s.legR]
  ] as const) {
    const h = hip(sgn)
    const n = sgn > 0 ? 'L' : 'R'
    if (dress.legs === 'shorts') {
      parts.push(
        limbParts(
          'thighShorts' + n,
          add(h, mul(sub(leg.knee, h), 0.06)),
          lerp(h, leg.knee, 0.58),
          9.9,
          8.9,
          legsColor,
          'shortsShade',
          { after: ['pelvis'] }
        )
      )
      parts.push(
        limbParts('thigh' + n, lerp(h, leg.knee, 0.5), leg.knee, 8.2, 6.7, 'skin', 'skinShade', {
          after: ['thighShorts' + n]
        })
      )
      parts.push(
        limbParts(
          'knee' + n,
          leg.knee,
          lerp(leg.knee, leg.ankle, 0.2),
          6.7,
          6.6,
          'skin',
          'skinShade',
          { after: ['thigh' + n] }
        )
      )
      parts.push({
        name: 'sock' + n,
        balls: [
          { p: lerp(leg.knee, leg.ankle, 0.17), r: 6.9 },
          { p: lerp(leg.knee, leg.ankle, 0.36), r: 7.1 },
          { p: leg.ankle, r: 4.6 }
        ],
        fill: 'socks',
        shade: 'socksShade',
        after: ['knee' + n]
      })
    } else {
      parts.push(
        limbParts('thigh' + n, h, leg.knee, 10.6, 8, legsColor, 'shortsShade', {
          after: ['pelvis']
        })
      )
      parts.push(
        limbParts('shin' + n, leg.knee, leg.ankle, 7.8, 6, legsColor, 'shortsShade', {
          after: ['thigh' + n]
        })
      )
    }
    // ботинок с подошвой
    const fd = norm(sub(leg.toe, leg.ankle))
    const flat = norm([fd[0], 0, fd[2]])
    const side = norm(cross(DOWN, flat))
    const sole = add(leg.ankle, mul(DOWN, 4.6))
    const heel = sub(sole, mul(flat, 4))
    const ballF = lerp(sole, leg.toe, 0.62)
    const bootBalls: Ball3[] = [
      { p: add(leg.ankle, mul(DOWN, 0.5)), r: 5 },
      { p: heel, r: 4.4 },
      { p: add(ballF, mul(side, 3.2)), r: 4.1 },
      { p: add(ballF, mul(side, -3.2)), r: 4.1 },
      { p: leg.toe, r: 3.7 }
    ]
    parts.push({
      name: 'sole' + n,
      balls: bootBalls.map((b) => ({ p: add(b.p, mul(DOWN, 1.9)), r: b.r * 0.92 })),
      fill: SOLE,
      after: dress.legs === 'shorts' ? ['sock' + n] : ['shin' + n]
    })
    parts.push({
      name: 'boot' + n,
      balls: bootBalls,
      fill: BOOT,
      shade: BOOT_SHADE,
      after: ['sole' + n]
    })
  }

  // руки
  for (const [sgn, arm] of [
    [1, s.armL],
    [-1, s.armR]
  ] as const) {
    const n = sgn > 0 ? 'L' : 'R'
    const sh = shoulder(sgn)
    const u = norm(sub(arm.hand, arm.elbow))
    const wrist = sub(arm.hand, mul(u, dress.gloves ? 8 : 6.5))
    if (dress.sleeves === 'long') {
      parts.push(
        limbParts('upperArm' + n, sh, arm.elbow, 7.6, 5.8, 'shirt', 'shirtShade', {
          bias: 2,
          light: 'shirtLight'
        })
      )
      parts.push(
        limbParts('forearm' + n, arm.elbow, wrist, 5.8, 4.6, 'shirt', 'shirtShade', {
          bias: 2,
          light: 'shirtLight',
          after: ['upperArm' + n]
        })
      )
    } else {
      parts.push(
        limbParts('upperArm' + n, sh, arm.elbow, 6.4, 5.2, 'skin', 'skinShade', { bias: 2 })
      )
      parts.push({
        name: 'sleeve' + n,
        balls: [
          { p: sh, r: 7.9 },
          { p: lerp(sh, arm.elbow, 0.55), r: 6.6 }
        ],
        fill: 'shirt',
        shade: 'shirtShade',
        bias: 2,
        after: ['upperArm' + n]
      })
      parts.push(
        limbParts('forearm' + n, arm.elbow, wrist, 5.2, 3.9, 'skin', 'skinShade', {
          bias: 2,
          after: ['upperArm' + n]
        })
      )
    }
    const pn = norm(arm.palm)
    const w = norm(cross(u, pn))
    const thumbDir = mul(w, sgn)
    const palmVisible = pr.dz(pn) > 0
    if (dress.gloves) {
      const H = arm.hand
      const gloveFill = palmVisible ? 'gloves' : GLOVE_BACK
      const gloveShade = palmVisible ? 'glovesShade' : darken(GLOVE_BACK, 0.35)
      parts.push({
        name: 'cuff' + n,
        balls: [
          { p: wrist, r: 5.4 },
          { p: add(wrist, mul(u, 3)), r: 5.8 }
        ],
        fill: GLOVE_BACK,
        bias: 2.2,
        after: ['forearm' + n]
      })
      const thumb: Part = {
        name: 'thumb' + n,
        balls: [
          { p: add(H, add(mul(u, -1.5), mul(thumbDir, 4))), r: 3.9 },
          { p: add(H, add(mul(u, 4), mul(thumbDir, 8.4))), r: 3.4 }
        ],
        fill: gloveFill,
        shade: gloveShade,
        stroke: GLOVE_LINE,
        strokeWidth: 1.1,
        bias: palmVisible ? 2.6 : 2.2,
        after: palmVisible ? ['glove' + n] : ['cuff' + n]
      }
      const glove: Part = {
        name: 'glove' + n,
        balls: [
          { p: add(H, mul(u, -1)), r: 6.2 },
          { p: add(H, add(mul(u, 6), mul(w, 2.6))), r: 5 },
          { p: add(H, add(mul(u, 6), mul(w, -2.6))), r: 5 },
          { p: add(H, add(mul(u, 11), mul(w, 1.9))), r: 3.9 },
          { p: add(H, add(mul(u, 11), mul(w, -1.9))), r: 3.9 }
        ],
        fill: gloveFill,
        shade: gloveShade,
        stroke: GLOVE_LINE,
        strokeWidth: 1.1,
        bias: 2.4,
        after: palmVisible ? ['cuff' + n] : ['cuff' + n, 'thumb' + n]
      }
      parts.push(thumb, glove)
    } else {
      parts.push({
        name: 'hand' + n,
        balls: [
          { p: wrist, r: 3.8 },
          { p: arm.hand, r: 4.5 },
          { p: add(arm.hand, mul(u, 4.2)), r: 3.7 },
          { p: add(arm.hand, add(mul(u, 1), mul(thumbDir, 3.6))), r: 2.6 }
        ],
        fill: 'skin',
        shade: 'skinShade',
        bias: 2.2,
        after: ['forearm' + n]
      })
      if (dress.jacket) {
        parts.push({
          name: 'cuffJ' + n,
          balls: [
            { p: sub(wrist, mul(u, 1.5)), r: 5 },
            { p: add(wrist, mul(u, 0.8)), r: 5 }
          ],
          fill: 'shirtShade',
          bias: 2.1,
          after: ['forearm' + n]
        })
      }
    }
  }

  // шея и голова
  const headUp = norm(s.headUp ?? UP)
  const rawFwd = s.headFwd ?? fwd
  const headFwd = norm(sub(rawFwd, mul(headUp, dot(rawFwd, headUp))))
  const headSide = norm(cross(headUp, headFwd))
  // headSide должен смотреть в +X при взгляде на нас: cross(up, fwd) для up=(0,-1,0), fwd=(0,0,1) = (-1,0,0)
  const hf: HeadFrame = { c: s.head, up: headUp, fwd: headFwd, side: mul(headSide, -1) }
  const neckTop = add(s.head, add(mul(headUp, -9), mul(headFwd, -2)))
  parts.push(
    limbParts('neck', add(s.chest, mul(spineUp, 3)), neckTop, 6, 5.4, 'skinShade', SKIN_DEEP, {
      after: ['torso', 'collar']
    })
  )
  parts.push({
    name: 'head',
    balls: [{ p: s.head, r: HEAD_RZ }],
    fill: 'skin',
    after: ['neck'],
    custom: (p) => headPrims(hf, p, dress.hair)
  })

  // номер на спине
  if (dress.number) {
    const back = pr.dz(fwd)
    if (back < -0.3) {
      const c = add(lerp(top, bottom, 0.42), mul(fwd, -10))
      const sx = Math.abs(pr(add(c, shAxis))[0] - pr(c)[0])
      parts.push({
        name: 'number',
        balls: [],
        fill: 'number',
        after: ['torso'],
        custom: (p) => {
          const [x, y] = p(c)
          return [
            { k: 'text', x, y: y + 9, sx, text: dress.number ?? '', fill: 'number', size: 26 }
          ]
        }
      })
    }
  }

  if (s.ball) {
    const b = s.ball
    parts.push({
      name: 'ball',
      balls: [{ p: b, r: BALL_R }],
      fill: BALL,
      bias: 1,
      custom: (p) => ballPrims(b, p)
    })
  }
  return parts
}

function order(parts: Part[], pr: Projector): Part[] {
  const depth = (p: Part): number => {
    const ds = p.balls.length ? p.balls.map((b) => pr.depth(b.p)) : [0]
    return ds.reduce((a, b) => a + b, 0) / ds.length + (p.bias ?? 0)
  }
  const sorted = [...parts].sort((a, b) => depth(a) - depth(b))
  for (let pass = 0; pass < 4; pass++) {
    let moved = false
    for (const p of [...sorted]) {
      if (!p.after) continue
      const i = sorted.indexOf(p)
      const last = Math.max(...p.after.map((n) => sorted.findIndex((q) => q.name === n)))
      if (last > i) {
        sorted.splice(i, 1)
        sorted.splice(last, 0, p)
        moved = true
      }
    }
    if (!moved) break
  }
  return sorted
}

/** Тень на земле под фигурой (размытая — два овала). */
function shadowPrims(s: Skeleton, pr: Projector): Prim[] {
  const joints: V3[] = [
    s.head,
    s.chest,
    s.pelvis,
    s.armL.hand,
    s.armR.hand,
    s.legL.knee,
    s.legR.knee,
    s.legL.ankle,
    s.legR.ankle,
    s.legL.toe,
    s.legR.toe
  ]
  const ground = joints.map((j) => pr([j[0], 0, j[2]]))
  const xs = ground.map((g) => g[0])
  const ys = ground.map((g) => g[1])
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  const rx = (Math.max(...xs) - Math.min(...xs)) / 2 + 14
  const ry = (Math.max(...ys) - Math.min(...ys)) / 2 + 5
  return [
    { k: 'ellipse', cx, cy, rx: rx + 7, ry: ry + 2.5, fill: '#000000', op: 0.1 },
    { k: 'ellipse', cx, cy, rx, ry, fill: '#000000', op: 0.14 },
    { k: 'ellipse', cx, cy, rx: rx * 0.7, ry: ry * 0.7, fill: '#000000', op: 0.1 }
  ]
}

/** Геометрия рисунка (без цветов формы) — считается один раз на позу и направление. */
export function compose(s: Skeleton, dress: Dress, yaw: number): Prim[] {
  const pr = projector(yaw)
  const parts = order(buildParts(s, dress, pr), pr)
  const prims: Prim[] = shadowPrims(s, pr)
  for (const p of parts) prims.push(...(p.custom ? p.custom(pr) : blobPrims(p, pr)))
  return prims
}

export interface FigureDrawingProps {
  kit: Kit
  /** Рисунок будет отражён (`*-left`): номер на спине отражается обратно, чтобы читался. */
  mirrored?: boolean
}
export type FigureDrawing = (props: FigureDrawingProps) => JSX.Element

function palette(kit: Kit): Record<string, string> {
  return {
    shirt: kit.shirt,
    shirtShade: kit.shirtShade,
    shirtLight: kit.shirtLight,
    shorts: kit.shorts,
    shortsShade: luma(kit.shorts) > 200 ? darken(kit.shorts, 0.14) : darken(kit.shorts, 0.35),
    socks: kit.socks,
    socksShade: darken(kit.socks, 0.24),
    gloves: kit.gloves ?? '#ffffff',
    glovesShade: darken(kit.gloves ?? '#ffffff', 0.13),
    skin: SKIN,
    skinShade: SKIN_SHADE,
    number: luma(kit.shirt) > 150 ? '#1c1f24' : lighten(kit.shirt, 0.92)
  }
}

export function renderPrims(prims: Prim[], kit: Kit, mirrored = false): JSX.Element {
  const pal = palette(kit)
  const col = (c: string | undefined): string | undefined =>
    c === undefined ? undefined : (pal[c] ?? c)
  return (
    <g>
      {prims.map((p, i) => {
        if (p.k === 'ellipse')
          return (
            <ellipse
              key={i}
              cx={r1(p.cx)}
              cy={r1(p.cy)}
              rx={r1(p.rx)}
              ry={r1(p.ry)}
              fill={col(p.fill)}
              opacity={p.op}
            />
          )
        if (p.k === 'text') {
          const sx = mirrored ? -p.sx : p.sx
          return (
            <text
              key={i}
              transform={`matrix(${r1(sx)} 0 0 1 ${r1(p.x)} ${r1(p.y)})`}
              fontFamily="Arial, Helvetica, sans-serif"
              fontWeight={800}
              fontSize={p.size}
              textAnchor="middle"
              fill={col(p.fill)}
            >
              {p.text}
            </text>
          )
        }
        return (
          <path
            key={i}
            d={p.d}
            fill={col(p.fill)}
            stroke={col(p.stroke)}
            strokeWidth={p.sw}
            strokeLinejoin={p.stroke ? 'round' : undefined}
            opacity={p.op}
          />
        )
      })}
    </g>
  )
}

/** Рисунок позы для одного направления: геометрия готова заранее, форма подставляется. */
export function drawing(
  s: Skeleton,
  dress: Dress,
  facing: DrawnFacing,
  yaw = FACING_YAW[facing]
): FigureDrawing {
  const prims = compose(s, dress, yaw)
  const Drawing = ({ kit, mirrored }: FigureDrawingProps): JSX.Element =>
    renderPrims(prims, kit, mirrored)
  return Drawing
}

/** Рисунки позы для перечисленных направлений. */
export function drawings(
  s: Skeleton,
  dress: Dress,
  facings: readonly DrawnFacing[] = DRAWN_FACINGS,
  yaws: Partial<Record<DrawnFacing, number>> = {}
): Partial<Record<DrawnFacing, FigureDrawing>> {
  const out: Partial<Record<DrawnFacing, FigureDrawing>> = {}
  for (const f of facings) out[f] = drawing(s, dress, f, yaws[f])
  return out
}

/** Повернуть позу вокруг оси Z (в плоскости экрана на виде «лицом») и сдвинуть — для бросков. */
export function rollSkeleton(s: Skeleton, angleDeg: number, pivot: V3, shift: V3): Skeleton {
  const a = (angleDeg * Math.PI) / 180
  const c = Math.cos(a)
  const sn = Math.sin(a)
  const rotD = (v: V3): V3 => [v[0] * c - v[1] * sn, v[0] * sn + v[1] * c, v[2]]
  const rotP = (v: V3): V3 => add(add(rotD(sub(v, pivot)), pivot), shift)
  const arm = (x: Arm): Arm => ({ elbow: rotP(x.elbow), hand: rotP(x.hand), palm: rotD(x.palm) })
  const leg = (x: Leg): Leg => ({ knee: rotP(x.knee), ankle: rotP(x.ankle), toe: rotP(x.toe) })
  return {
    head: rotP(s.head),
    headUp: rotD(s.headUp ?? UP),
    headFwd: s.headFwd ? rotD(s.headFwd) : undefined,
    chest: rotP(s.chest),
    pelvis: rotP(s.pelvis),
    shoulderAxis: rotD(s.shoulderAxis ?? [1, 0, 0]),
    hipAxis: rotD(s.hipAxis ?? s.shoulderAxis ?? [1, 0, 0]),
    armL: arm(s.armL),
    armR: arm(s.armR),
    legL: leg(s.legL),
    legR: leg(s.legR),
    ball: s.ball ? rotP(s.ball) : undefined
  }
}
