// Рисунки на поле → то, что нужно нарисовать на картинке (в пикселях). Один код для экрана, попадания курсором и экспорта.
// Фигуры строятся на плоскости поля в метрах (постоянная ширина в метрах), обрезаются по горизонту и только потом
// проецируются — поэтому вдали они сужаются, а кольцо превращается в эллипс.
import { LEGACY_RING_FILL, type PitchAnnotation } from '../annotations'
import { isToolAnnotation, paintPitchTool } from './pitchTools'
import {
  TARGET_CENTER_ALPHA,
  TARGET_LINE_SCALE,
  TARGET_RADII,
  isTarget,
  pulsePhase,
  WAVE_LINE_SCALE,
  waveOpacity,
  waveScale,
  type DashKind
} from '../styleFx'
import type { PillarPaint } from '../tools/pillar'
import { DOT_STEP, dotsAlong } from '../tools/curve'
import type { Pt } from './linalg'
import type { Projector } from './projector'

export interface PxPt {
  x: number
  y: number
}

export interface PaintSize {
  w: number
  h: number
}

/** Ручки: концы p1/p2, радиус, середина кривой c, вершины v0, v1, …, у лупы — src, lens, size. */
export type PitchHandleId = string

/** Ширина линии в метрах для каждого вида рисунка: (доля высоты кадра из стиля) × множитель. */
export const WORLD_WIDTH_FACTOR = { arrow: 32, line: 14, ring: 11, ruler: 12 } as const
const RULER_TICK_HALF = 0.6
export const DASH_LENGTH = 7.5
export const DASH_GAP = 4.5

export interface LabelPaint {
  kind: 'ruler' | 'text' | 'area' | 'segment' | 'width'
  text: string
  /** Центр плашки, пиксели. */
  x: number
  y: number
  w: number
  h: number
  fontPx: number
  /** Отрезок от точки земли до плашки (подпись над игроком). */
  stem?: { x1: number; y1: number; x2: number; y2: number }
}

/** Линия, которую рисует сам SVG (рисунки на экране): толщина в пикселях. */
export interface StrokePaint {
  points: PxPt[]
  closed: boolean
  widthPx: number
  dash: DashKind
}

/** «Луч» над светлым пятном прожектора: силуэт и границы по вертикали (для градиента). */
export interface BeamPaint {
  poly: PxPt[]
  top: number
  bottom: number
}

/** Лупа на экране: линза, исходный участок и соединительная линия. Всё в пикселях кадра. */
export interface LensPaint {
  cx: number
  cy: number
  r: number
  sx: number
  sy: number
  /** Радиус исходного участка (r / увеличение). */
  sr: number
  connector: [PxPt, PxPt] | null
}

export interface PitchPaint {
  /** Сплошные части (заливка по ненулевому правилу; дырки — обратным обходом). */
  body: PxPt[][]
  /** Мягкая заливка внутри кольца. */
  disc: PxPt[][]
  /** Прозрачность заливки диска (нет — 0.18, как у прожектора и старых колец). */
  discOpacity?: number
  /** Метка на земле под подписью. */
  dot: { x: number; y: number } | null
  label: LabelPaint | null
  /** Многоугольники для попадания курсором. */
  hit: PxPt[][]
  handles: Array<{ id: PitchHandleId; point: PxPt }>
  /** Что-то видно (фигура не целиком за горизонтом). */
  visible: boolean
  /** Линии, которые рисует сам SVG (рисунки на экране). */
  strokes: StrokePaint[]
  /** Полупрозрачная заливка (зона, связи). */
  fills: PxPt[][]
  fillOpacity: number
  /** Узлы связи: центры и радиус маркеров (рисунок на экране). */
  nodes: PxPt[]
  nodeRadius: number
  /** Дополнительные подписи (звенья, ширина линии, площадь). */
  labels: LabelPaint[]
  beam: BeamPaint | null
  /** Освещённые области прожектора. */
  lit: PxPt[][]
  lens: LensPaint | null
  /** Кольцо со свечением: средняя ширина обводки в пикселях (ореол кладётся вдоль кромок `body`). Нет — без свечения. */
  glowPx?: number
  /** «Мишень»: полосы трёх колец по отдельности (от внешнего к центру); они же лежат в body. */
  targetRings?: PxPt[][][]
  /** «Мишень»: диск заливается радиальным градиентом (центр → край), а не ровно. */
  target?: boolean
  /** Световой столб (прожектор вида «Столб»): рисует общий рисовальщик; обводки, пятна и луча при нём нет. */
  pillar?: PillarPaint
  /** Волна пульса (кольцо, расходящееся от центра) и её непрозрачность. */
  wave?: { body: PxPt[][]; opacity: number }
}

export type Measure = (text: string, fontPx: number) => number

/** Средняя ширина полос `body` в пикселях: 2·площадь / периметр (у кольца — ширина обводки). */
function bandWidthPx(polys: readonly PxPt[][]): number {
  let area = 0
  let perimeter = 0
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i]
      const q = poly[(i + 1) % poly.length]
      area += (p.x * q.y - q.x * p.y) / 2
      perimeter += Math.hypot(q.x - p.x, q.y - p.y)
    }
  }
  return perimeter > 0 ? (2 * Math.abs(area)) / perimeter : 0
}

export const toPx = (p: Pt, size: PaintSize): PxPt => ({ x: p.x * size.w, y: p.y * size.h })

function signedArea(poly: readonly Pt[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

/** Многоугольник с положительным обходом (против часовой стрелки в метрах). */
export const ccw = (poly: Pt[]): Pt[] => (signedArea(poly) < 0 ? [...poly].reverse() : poly)

/** Лента вдоль отрезка a→b полушириной hw. */
export function ribbon(a: Pt, b: Pt, hw: number): Pt[] {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len === 0) return []
  const nx = (-dy / len) * hw
  const ny = (dx / len) * hw
  return ccw([
    { x: a.x + nx, y: a.y + ny },
    { x: b.x + nx, y: b.y + ny },
    { x: b.x - nx, y: b.y - ny },
    { x: a.x - nx, y: a.y - ny }
  ])
}

/** Штрихи вдоль отрезка a→b (длины в метрах). Для сплошной линии — один отрезок. */
/** Точка пунктира «точки» на поле: круг радиуса hw (м) вокруг центра (в перспективе после проекции — эллипс). */
export const dotDisc = (c: Pt, hw: number): Pt[] =>
  ccw(Array.from({ length: DOT_SIDES }, (_, i) => onCircle(c, hw, (i * 2 * Math.PI) / DOT_SIDES)))
const DOT_SIDES = 12

/** Центры точек вдоль ломаной на поле: шаг ≈ 2.5 толщины (w — толщина линии, м). */
export const worldDots = (line: readonly Pt[], w: number, closed = false): Pt[] =>
  dotsAlong(line, DOT_STEP * w, closed)

export function dashSegments(a: Pt, b: Pt, dash: number, gap: number): Array<[Pt, Pt]> {
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len === 0) return []
  const ux = (b.x - a.x) / len
  const uy = (b.y - a.y) / len
  const out: Array<[Pt, Pt]> = []
  for (let s = 0; s < len; s += dash + gap) {
    const e = Math.min(len, s + dash)
    out.push([
      { x: a.x + ux * s, y: a.y + uy * s },
      { x: a.x + ux * e, y: a.y + uy * e }
    ])
  }
  return out
}

/** Расстояние между двумя точками поля, метры. */
export const worldDistance = (a: Pt, b: Pt): number => Math.hypot(b.x - a.x, b.y - a.y)

/** Подпись линейки: «23.4 м». */
export const formatMeters = (m: number): string => `${(Math.round(m * 10) / 10).toFixed(1)} м`

/**
 * Углы вдоль окружности: равномерно, затем сгущаются там, где проекция ещё заметно отличается от ломаной
 * (допуск tolPx пикселей). Окружность замкнута: последний угол не повторяет первый.
 */
export function circleAngles(
  center: Pt,
  radius: number,
  proj: Projector,
  size: PaintSize,
  tolPx = 0.2
): number[] {
  const at = (a: number): PxPt | null => {
    const p = proj.toImage({
      x: center.x + radius * Math.cos(a),
      y: center.y + radius * Math.sin(a)
    })
    return p ? toPx(p, size) : null
  }
  const angles: number[] = []
  const refine = (
    a0: number,
    a1: number,
    p0: PxPt | null,
    p1: PxPt | null,
    depth: number
  ): void => {
    const am = (a0 + a1) / 2
    const pm = at(am)
    let split = false
    if (depth < 8) {
      if (!p0 || !p1 || !pm) split = depth < 3
      else {
        const dx = p1.x - p0.x
        const dy = p1.y - p0.y
        const len = Math.hypot(dx, dy)
        const dev =
          len === 0
            ? Math.hypot(pm.x - p0.x, pm.y - p0.y)
            : Math.abs((pm.x - p0.x) * dy - (pm.y - p0.y) * dx) / len
        split = dev > tolPx || len > 40
      }
    }
    if (split) {
      refine(a0, am, p0, pm, depth + 1)
      refine(am, a1, pm, p1, depth + 1)
    } else {
      angles.push(a0)
    }
  }
  const N0 = 32
  const pts = Array.from({ length: N0 + 1 }, (_, i) => at((i * 2 * Math.PI) / N0))
  for (let i = 0; i < N0; i += 1) {
    refine((i * 2 * Math.PI) / N0, ((i + 1) * 2 * Math.PI) / N0, pts[i], pts[i + 1], 0)
  }
  return angles
}

export const onCircle = (c: Pt, r: number, a: number): Pt => ({
  x: c.x + r * Math.cos(a),
  y: c.y + r * Math.sin(a)
})

export function labelBox(text: string, fontPx: number, measure: Measure): { w: number; h: number } {
  const pad = fontPx * 0.3
  return { w: measure(text, fontPx) + pad * 2, h: fontPx * 1.2 + pad * 2 }
}

export function emptyPaint(): PitchPaint {
  return {
    body: [],
    disc: [],
    dot: null,
    label: null,
    hit: [],
    handles: [],
    visible: false,
    strokes: [],
    fills: [],
    fillOpacity: 0,
    nodes: [],
    nodeRadius: 0,
    labels: [],
    beam: null,
    lit: [],
    lens: null
  }
}

/** Размер шрифта подписи линейки, пиксели. */
export const rulerFontPx = (styleWidth: number, size: PaintSize): number =>
  size.h * (0.022 + styleWidth * 1.2)

/** Ширина линии рисунка на поле, метры. */
export const worldWidthOf = (a: PitchAnnotation): number => {
  const f =
    a.type === 'pcurve'
      ? WORLD_WIDTH_FACTOR.arrow
      : a.type === 'ppen'
        ? WORLD_WIDTH_FACTOR.line
        : a.type === 'pchain'
          ? WORLD_WIDTH_FACTOR.line * 1.4
          : a.type === 'pzone'
            ? WORLD_WIDTH_FACTOR.line * 0.8
            : a.type === 'pspot'
              ? WORLD_WIDTH_FACTOR.ring * 0.7
              : a.type === 'parrow'
                ? WORLD_WIDTH_FACTOR.arrow
                : a.type === 'pline'
                  ? WORLD_WIDTH_FACTOR.line
                  : a.type === 'ring'
                    ? WORLD_WIDTH_FACTOR.ring
                    : a.type === 'ruler'
                      ? WORLD_WIDTH_FACTOR.ruler
                      : 0
  return a.type === 'ptext' ? 0 : a.style.width * f
}

/** Что рисовать для рисунка на поле. size — размер кадра в пикселях; measure — ширина текста. */
export function paintPitch(
  a: PitchAnnotation,
  proj: Projector,
  size: PaintSize,
  measure: Measure,
  /** Время видео (секунды): нужно пульсу. */
  time?: number
): PitchPaint {
  if (isToolAnnotation(a)) return paintPitchTool(a, proj, size, measure)
  const out = emptyPaint()
  const px = (poly: Pt[]): PxPt[] => poly.map((p) => toPx(p, size))
  const pushBody = (worldPoly: Pt[]): void => {
    if (worldPoly.length < 3) return
    const projected = proj.projectPolygon(worldPoly)
    if (projected.length >= 3) out.body.push(px(projected))
  }
  const handle = (id: PitchHandleId, w: Pt): void => {
    const p = proj.toImage(w)
    if (p) out.handles.push({ id, point: toPx(p, size) })
  }

  if (a.type === 'ring') {
    const hw = worldWidthOf(a) / 2
    const r = a.radius
    const angles = circleAngles(a.center, r + hw, proj, size)
    const circle = (rad: number): Pt[] => angles.map((t) => onCircle(a.center, rad, t))
    const outer = ccw(circle(r + hw))
    // Полоса кольца радиуса rad: внешний контур и обратный обход внутреннего (дырка).
    const pushBand = (rad: number, half: number, into: PxPt[][]): void => {
      const outerProj = proj.projectPolygon(ccw(circle(rad + half)))
      const innerProj = proj.projectPolygon([...ccw(circle(Math.max(rad - half, 0.01)))].reverse())
      if (outerProj.length >= 3) into.push(px(outerProj))
      if (outerProj.length >= 3 && innerProj.length >= 3) into.push(px(innerProj))
    }
    const discProj = proj.projectPolygon(ccw(circle(r)))
    if (discProj.length >= 3) out.disc.push(px(discProj))
    out.discOpacity = a.fillOpacity ?? LEGACY_RING_FILL
    if (a.style.dash === 'dotted' && !isTarget(a)) {
      // Точки по окружности: круглые, поровну.
      const ring = circle(r)
      for (const c of worldDots(ring, hw * 2, true)) pushBody(dotDisc(c, hw))
    } else if (a.style.dash === 'dashed' && !isTarget(a)) {
      // Штрихи по окружности: секторы кольца.
      const circ = 2 * Math.PI * r
      const count = Math.max(6, Math.round(circ / ((DASH_LENGTH + DASH_GAP) * hw * 2)))
      const step = (2 * Math.PI) / count
      for (let i = 0; i < count; i += 1) {
        const from = i * step
        const to = from + step * (DASH_LENGTH / (DASH_LENGTH + DASH_GAP))
        const n = Math.max(3, Math.ceil(((to - from) / (2 * Math.PI)) * angles.length))
        const arc = (rad: number): Pt[] =>
          Array.from({ length: n + 1 }, (_, k) =>
            onCircle(a.center, rad, from + ((to - from) * k) / n)
          )
        pushBody(ccw([...arc(r + hw), ...arc(Math.max(r - hw, 0.01)).reverse()]))
      }
    } else if (isTarget(a)) {
      // «Мишень»: три кольца (тоньше обычного и тем бледнее, чем дальше от центра); заливка диска — радиальный градиент (рисует вид).
      out.targetRings = TARGET_RADII.map((k) => {
        const ringPolys: PxPt[][] = []
        pushBand(r * k, hw * TARGET_LINE_SCALE, ringPolys)
        out.body.push(...ringPolys)
        return ringPolys
      })
      out.target = true
      out.discOpacity = TARGET_CENTER_ALPHA
    } else {
      pushBand(r, hw, out.body)
    }
    if (time !== undefined && a.pulse === true && a.timing.mode === 'range') {
      // Пульс: волна от центра наружу, по времени видео.
      const phase = pulsePhase(time)
      const wave: PxPt[][] = []
      pushBand(r * waveScale(phase), hw * WAVE_LINE_SCALE, wave)
      if (wave.length > 0) out.wave = { body: wave, opacity: waveOpacity(phase) }
    }
    const hit = proj.projectPolygon(outer)
    if (hit.length >= 3) out.hit.push(px(hit))
    if (a.glow === true && out.body.length > 0) out.glowPx = bandWidthPx(out.body)
    handle('radius', { x: a.center.x + r, y: a.center.y })
  } else if (a.type === 'pline' || a.type === 'parrow' || a.type === 'ruler') {
    const w = worldWidthOf(a)
    const hw = w / 2
    const len = worldDistance(a.p1, a.p2)
    if (len > 0) {
      const ux = (a.p2.x - a.p1.x) / len
      const uy = (a.p2.y - a.p1.y) / len
      if (a.type === 'parrow') {
        const head = Math.min(Math.max(w * 4, 1.2), len * 0.6)
        const half = Math.max(head * 0.5, hw * 1.6)
        const base: Pt = { x: a.p2.x - ux * head, y: a.p2.y - uy * head }
        const shaftEnd: Pt = { x: a.p2.x - ux * head * 0.8, y: a.p2.y - uy * head * 0.8 }
        if (a.style.dash === 'dotted') {
          for (const c of worldDots([a.p1, shaftEnd], w)) pushBody(dotDisc(c, hw))
        } else {
          const segs =
            a.style.dash === 'dashed'
              ? dashSegments(a.p1, shaftEnd, DASH_LENGTH * w, DASH_GAP * w)
              : [[a.p1, shaftEnd] as [Pt, Pt]]
          segs.forEach(([s, e]) => pushBody(ribbon(s, e, hw)))
        }
        pushBody(
          ccw([
            a.p2,
            { x: base.x - uy * half, y: base.y + ux * half },
            { x: base.x + uy * half, y: base.y - ux * half }
          ])
        )
      } else {
        if (a.type === 'pline' && a.style.dash === 'dotted') {
          for (const c of worldDots([a.p1, a.p2], w)) pushBody(dotDisc(c, hw))
        } else {
          const segs =
            a.type === 'pline' && a.style.dash === 'dashed'
              ? dashSegments(a.p1, a.p2, DASH_LENGTH * w, DASH_GAP * w)
              : [[a.p1, a.p2] as [Pt, Pt]]
          segs.forEach(([s, e]) => pushBody(ribbon(s, e, hw)))
        }
      }
      if (a.type === 'ruler') {
        for (const end of [a.p1, a.p2]) {
          pushBody(
            ribbon(
              { x: end.x - uy * RULER_TICK_HALF, y: end.y + ux * RULER_TICK_HALF },
              { x: end.x + uy * RULER_TICK_HALF, y: end.y - ux * RULER_TICK_HALF },
              hw * 0.9
            )
          )
        }
        const mid = proj.toImage({ x: (a.p1.x + a.p2.x) / 2, y: (a.p1.y + a.p2.y) / 2 })
        if (mid) {
          const fontPx = rulerFontPx(a.style.width, size)
          const text = formatMeters(len)
          const box = labelBox(text, fontPx, measure)
          const m = toPx(mid, size)
          const lift = box.h / 2 + fontPx * 0.45
          out.label = {
            kind: 'ruler',
            text,
            x: m.x,
            y: m.y - lift,
            w: box.w,
            h: box.h,
            fontPx
          }
        }
      }
      // Область попадания — те же ленты, но тоньше не меньше линии (допуск добавляется при проверке).
      out.hit = out.body.slice()
    }
    handle('p1', a.p1)
    handle('p2', a.p2)
  } else {
    // ptext: подпись стоит вертикально над точкой земли.
    const g = proj.toImage(a.pos)
    if (g) {
      const fontPx = a.style.size * size.h
      const box = labelBox(a.text, fontPx, measure)
      const p = toPx(g, size)
      const lift = fontPx * 0.7
      out.dot = p
      out.label = {
        kind: 'text',
        text: a.text,
        x: p.x,
        y: p.y - lift - box.h / 2,
        w: box.w,
        h: box.h,
        fontPx,
        stem: { x1: p.x, y1: p.y, x2: p.x, y2: p.y - lift }
      }
    }
  }

  if (out.label) {
    const l = out.label
    out.hit.push([
      { x: l.x - l.w / 2, y: l.y - l.h / 2 },
      { x: l.x + l.w / 2, y: l.y - l.h / 2 },
      { x: l.x + l.w / 2, y: l.y + l.h / 2 },
      { x: l.x - l.w / 2, y: l.y + l.h / 2 }
    ])
    if (out.label.stem) {
      const s = out.label.stem
      out.hit.push([
        { x: s.x1 - 6, y: s.y1 },
        { x: s.x1 + 6, y: s.y1 },
        { x: s.x2 + 6, y: s.y2 },
        { x: s.x2 - 6, y: s.y2 }
      ])
    }
  }
  out.visible = out.body.length > 0 || out.disc.length > 0 || out.label !== null
  return out
}
