/**
 * Рисованные фоны доски тренера: три вида поля в стиле «иллюстрация» — плоские цвета,
 * полосы газона, белая разметка, ворота с сеткой. Всё рисуется здесь же, без картинок.
 *
 * Мир — метры: X — поперёк поля (вправо +), Y — вверх, Z — вдоль поля от линии ворот (в поле +).
 * Перспективные виды смотрят камерой-«дыркой» на ворота при Z = 0; линии разметки — полосы
 * на земле, их ширина тоже уходит в перспективу. Пропорции настоящие: поле 105×68,
 * штрафная 16.5×40.32, вратарская 5.5×18.32, ворота 7.32×2.44, точка 11 м, дуга r 9.15.
 */
import type { JSX } from 'react'
import { PITCH_VIEW_IDS, type PitchViewId } from '../../../../../shared/board/ids'
import { BOARD_H, BOARD_W } from './constants'

export interface PitchView {
  id: PitchViewId
  label: string
  Background: () => JSX.Element
  /** Масштаб фигуры по умолчанию, когда её ступни стоят на высоте `y` (доля 0..1 высоты поля). */
  scaleAt(y: number): number
}

// ——— размеры поля, м ———
const LEN = 105
const HALF_W = 34
const BOX_D = 16.5
const BOX_HW = 20.16
const SIX_D = 5.5
const SIX_HW = 9.16
const SPOT = 11
const ARC_R = 9.15
const GOAL_HW = 3.66
const GOAL_H = 2.44
const POST = 0.16
const NET_TOP_D = 0.9
const NET_BOTTOM_D = 2
const CORNER_R = 1

/** Рост стоящей фигуры в её рисунке (ступни в 0, макушка ≈ −200) и рост человека, м. */
const FIGURE_ART_HEIGHT = 200
const PERSON_M = 1.85
/** Фигуры на доске рисуются крупнее натуры, чтобы их было видно с нескольких метров. */
const FIGURE_BOOST = 1.5
const MIN_SCALE = 0.2
const MAX_SCALE = 4

const C = {
  sky: '#24303b',
  standBack: '#2c3844',
  standRow: '#3c4b59',
  standRowAlt: '#334150',
  standWall: '#1f2830',
  boards: '#24496b',
  boardsTop: '#3b6a94',
  runoff: '#5b9a48',
  grassA: '#6fae5a',
  grassB: '#78b763',
  line: '#ffffff',
  shadow: 'rgba(0,0,0,0.16)',
  netFill: 'rgba(255,255,255,0.10)',
  netMesh: 'rgba(255,255,255,0.55)',
  netBar: '#d9dee3',
  postEdge: 'rgba(0,0,0,0.28)'
}

type Pt = [number, number]
/** Точка мира (X, Y, Z) → точка доски. */
type Project = (x: number, y: number, z: number) => Pt

const f1 = (n: number): string => (Math.round(n * 10) / 10).toString()
const poly = (pts: Pt[]): string =>
  pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${f1(x)} ${f1(y)}`).join('') + 'Z'

// ——— перспективная камера ———
interface Camera {
  /** Положение камеры, м. */
  x: number
  h: number
  z: number
  /** Точка на земле, куда смотрит камера (по ней — поворот и наклон). */
  lookX: number
  lookZ: number
  /** Фокус в единицах доски и центр проекции. */
  f: number
  cx: number
  cy: number
}

/** Наклон вниз (s, c — синус и косинус) и проекция мира на доску. */
function perspective(cam: Camera): { project: Project; s: number; c: number } {
  const dx = cam.lookX - cam.x
  const dz = cam.lookZ - cam.z
  const yaw = Math.atan2(dx, -dz)
  const th = Math.atan2(cam.h, Math.hypot(dx, dz))
  const s = Math.sin(th)
  const c = Math.cos(th)
  const sw = Math.sin(yaw)
  const cw = Math.cos(yaw)
  // вправо (cw, 0, sw); вперёд (sw·c, −s, −cw·c); вверх (sw·s, c, −cw·s)
  const project: Project = (x, y, z) => {
    const vx = x - cam.x
    const vy = y - cam.h
    const vz = z - cam.z
    const xc = vx * cw + vz * sw
    const yc = vx * sw * s + vy * c - vz * cw * s
    const zc = vx * sw * c - vy * s - vz * cw * c
    return [cam.cx + (cam.f * xc) / zc, cam.cy - (cam.f * yc) / zc]
  }
  return { project, s, c }
}

/**
 * Масштаб фигуры по высоте ступней. Луч через строку доски y встречает землю на глубине
 * h / ((y − cy)·c / f + s), так что «точек доски на метр» = (f·s + (y − cy)·c) / h — линейно по y
 * и не зависит от x (камера без крена). У горизонта масштаб плавно упирается в MIN_SCALE.
 */
function perspectiveScale(cam: Camera): (y: number) => number {
  const { s, c } = perspective(cam)
  const k = (PERSON_M * FIGURE_BOOST) / FIGURE_ART_HEIGHT
  const soft = 0.04
  return (yNorm) => {
    const pxPerM = (cam.f * s + (yNorm * BOARD_H - cam.cy) * c) / cam.h
    const raw = pxPerM * k
    const floored = MIN_SCALE + soft * Math.log1p(Math.exp((raw - MIN_SCALE) / soft))
    return Math.min(MAX_SCALE, floored)
  }
}

type V3 = [number, number, number]

/** Подбирает фокус и центр так, чтобы точки мира `pts` вписались в прямоугольник доски `box`. */
function fitCamera(
  cam: Omit<Camera, 'f' | 'cx' | 'cy'>,
  pts: V3[],
  box: { x0: number; y0: number; x1: number; y1: number }
): Camera {
  const { project } = perspective({ ...cam, f: 1, cx: 0, cy: 0 })
  const xy = pts.map(([x, y, z]) => project(x, y, z))
  const xs = xy.map((q) => q[0])
  const ys = xy.map((q) => q[1])
  const [minX, maxX, minY, maxY] = [
    Math.min(...xs),
    Math.max(...xs),
    Math.min(...ys),
    Math.max(...ys)
  ]
  const f = Math.min((box.x1 - box.x0) / (maxX - minX), (box.y1 - box.y0) / (maxY - minY))
  return {
    ...cam,
    f,
    cx: (box.x0 + box.x1) / 2 - (f * (minX + maxX)) / 2,
    cy: (box.y0 + box.y1) / 2 - (f * (minY + maxY)) / 2
  }
}

// ——— разметка на земле ———
/** Отрезок на земле шириной w (концы продлены на w/2, чтобы углы смыкались). */
function groundSeg(p: Project, x1: number, z1: number, x2: number, z2: number, w: number): string {
  const len = Math.hypot(x2 - x1, z2 - z1)
  const ux = (x2 - x1) / len
  const uz = (z2 - z1) / len
  const h = w / 2
  const nx = -uz * h
  const nz = ux * h
  const ax = x1 - ux * h
  const az = z1 - uz * h
  const bx = x2 + ux * h
  const bz = z2 + uz * h
  return poly([
    p(ax + nx, 0, az + nz),
    p(bx + nx, 0, bz + nz),
    p(bx - nx, 0, bz - nz),
    p(ax - nx, 0, az - nz)
  ])
}

/** Дуга-полоса на земле: центр (cx, cz), радиус r, углы от оси +Z в сторону +X, градусы. */
function groundArc(
  p: Project,
  cx: number,
  cz: number,
  r: number,
  from: number,
  to: number,
  w: number
): string {
  const n = Math.max(8, Math.ceil(Math.abs(to - from) / 3))
  const outer: Pt[] = []
  const inner: Pt[] = []
  for (let i = 0; i <= n; i++) {
    const a = ((from + ((to - from) * i) / n) * Math.PI) / 180
    const sx = Math.sin(a)
    const cz2 = Math.cos(a)
    outer.push(p(cx + sx * (r + w / 2), 0, cz + cz2 * (r + w / 2)))
    inner.push(p(cx + sx * (r - w / 2), 0, cz + cz2 * (r - w / 2)))
  }
  return poly([...outer, ...inner.reverse()])
}

function groundDisc(p: Project, cx: number, cz: number, r: number): string {
  const pts: Pt[] = []
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    pts.push(p(cx + Math.sin(a) * r, 0, cz + Math.cos(a) * r))
  }
  return poly(pts)
}

function groundQuad(p: Project, x1: number, z1: number, x2: number, z2: number): string {
  return poly([p(x1, 0, z1), p(x2, 0, z1), p(x2, 0, z2), p(x1, 0, z2)])
}

/**
 * Разметка от линии ворот (Z = 0): боковые линии до touchEnd, штрафная, вратарская, точка, дуга,
 * угловые дуги; с `centre` — ещё средняя линия, центральный круг и точка.
 * `flip` отражает всё на другую половину (вторые ворота на виде сверху).
 */
function halfMarkings(
  base: Project,
  w: number,
  touchEnd: number,
  centre: boolean,
  flip = false
): string {
  const p: Project = flip ? (x, y, z) => base(-x, y, LEN - z) : base
  const d: string[] = []
  d.push(groundSeg(p, -HALF_W, 0, HALF_W, 0, w))
  d.push(groundSeg(p, -HALF_W, 0, -HALF_W, touchEnd, w))
  d.push(groundSeg(p, HALF_W, 0, HALF_W, touchEnd, w))
  // штрафная и вратарская
  d.push(groundSeg(p, -BOX_HW, 0, -BOX_HW, BOX_D, w))
  d.push(groundSeg(p, BOX_HW, 0, BOX_HW, BOX_D, w))
  d.push(groundSeg(p, -BOX_HW, BOX_D, BOX_HW, BOX_D, w))
  d.push(groundSeg(p, -SIX_HW, 0, -SIX_HW, SIX_D, w))
  d.push(groundSeg(p, SIX_HW, 0, SIX_HW, SIX_D, w))
  d.push(groundSeg(p, -SIX_HW, SIX_D, SIX_HW, SIX_D, w))
  // точка и дуга за штрафной
  const dot = Math.max(0.22, w * 1.3)
  d.push(groundDisc(p, 0, SPOT, dot))
  const arcHalf = (Math.acos((BOX_D - SPOT) / ARC_R) * 180) / Math.PI
  d.push(groundArc(p, 0, SPOT, ARC_R, -arcHalf, arcHalf, w))
  // угловые дуги
  d.push(groundArc(p, -HALF_W, 0, CORNER_R, 0, 90, w))
  d.push(groundArc(p, HALF_W, 0, CORNER_R, -90, 0, w))
  if (centre) {
    d.push(groundSeg(p, -HALF_W, LEN / 2, HALF_W, LEN / 2, w))
    d.push(groundArc(p, 0, LEN / 2, ARC_R, 0, 360, w))
    d.push(groundDisc(p, 0, LEN / 2, dot))
  }
  return d.join('')
}

/** Полосы газона поперёк поля, по 5.5 м от линии ворот (совпадают с вратарской и штрафной). */
function stripes(p: Project, xHalf: number, z0: number, z1: number): { a: string; b: string } {
  const a: string[] = []
  const b: string[] = []
  const step = SIX_D
  for (let i = 0, z = z0; z < z1; i++, z += step) {
    ;(i % 2 === 0 ? a : b).push(groundQuad(p, -xHalf, z, xHalf, Math.min(z1, z + step)))
  }
  return { a: a.join(''), b: b.join('') }
}

// ——— ворота в перспективе ———
function goal3d(p: Project, mesh: number): JSX.Element {
  const back = (y: number): number => -NET_BOTTOM_D + ((NET_BOTTOM_D - NET_TOP_D) * y) / GOAL_H
  const L = -GOAL_HW
  const R = GOAL_HW
  const panels = [
    // задняя стенка, боковины, крыша
    poly([
      p(L, GOAL_H, -NET_TOP_D),
      p(R, GOAL_H, -NET_TOP_D),
      p(R, 0, -NET_BOTTOM_D),
      p(L, 0, -NET_BOTTOM_D)
    ]),
    poly([p(L, 0, 0), p(L, GOAL_H, 0), p(L, GOAL_H, -NET_TOP_D), p(L, 0, -NET_BOTTOM_D)]),
    poly([p(R, 0, 0), p(R, GOAL_H, 0), p(R, GOAL_H, -NET_TOP_D), p(R, 0, -NET_BOTTOM_D)]),
    poly([p(L, GOAL_H, 0), p(R, GOAL_H, 0), p(R, GOAL_H, -NET_TOP_D), p(L, GOAL_H, -NET_TOP_D)])
  ].join('')
  const line = (a: Pt, b: Pt): string => `M${f1(a[0])} ${f1(a[1])}L${f1(b[0])} ${f1(b[1])}`
  const m: string[] = []
  const cols = Math.round((2 * GOAL_HW) / mesh)
  for (let i = 1; i < cols; i++) {
    const x = L + (2 * GOAL_HW * i) / cols
    m.push(line(p(x, GOAL_H, -NET_TOP_D), p(x, 0, -NET_BOTTOM_D)))
    m.push(line(p(x, GOAL_H, 0), p(x, GOAL_H, -NET_TOP_D)))
  }
  const rows = Math.round(GOAL_H / mesh)
  for (let i = 1; i < rows; i++) {
    const y = (GOAL_H * i) / rows
    m.push(line(p(L, y, back(y)), p(R, y, back(y))))
    m.push(line(p(L, y, 0), p(L, y, back(y))))
    m.push(line(p(R, y, 0), p(R, y, back(y))))
  }
  const deep = Math.round(NET_BOTTOM_D / mesh)
  for (let i = 1; i < deep; i++) {
    const z = (-NET_BOTTOM_D * i) / deep
    const top =
      z >= -NET_TOP_D ? GOAL_H : (GOAL_H * (z + NET_BOTTOM_D)) / (NET_BOTTOM_D - NET_TOP_D)
    m.push(line(p(L, 0, z), p(L, top, z)))
    m.push(line(p(R, 0, z), p(R, top, z)))
  }
  const roofRows = Math.max(1, Math.round(NET_TOP_D / mesh))
  for (let i = 1; i < roofRows; i++) {
    const z = (-NET_TOP_D * i) / roofRows
    m.push(line(p(L, GOAL_H, z), p(R, GOAL_H, z)))
  }
  const bars = [
    line(p(L, GOAL_H, -NET_TOP_D), p(R, GOAL_H, -NET_TOP_D)),
    line(p(L, GOAL_H, -NET_TOP_D), p(L, 0, -NET_BOTTOM_D)),
    line(p(R, GOAL_H, -NET_TOP_D), p(R, 0, -NET_BOTTOM_D)),
    line(p(L, 0, -NET_BOTTOM_D), p(R, 0, -NET_BOTTOM_D)),
    line(p(L, GOAL_H, 0), p(L, GOAL_H, -NET_TOP_D)),
    line(p(R, GOAL_H, 0), p(R, GOAL_H, -NET_TOP_D))
  ].join('')
  const o = GOAL_HW + POST
  const frame = poly([
    p(-o, 0, 0),
    p(-o, GOAL_H + POST, 0),
    p(o, GOAL_H + POST, 0),
    p(o, 0, 0),
    p(R, 0, 0),
    p(R, GOAL_H, 0),
    p(L, GOAL_H, 0),
    p(L, 0, 0)
  ])
  return (
    <g>
      <path d={groundQuad(p, L, -NET_BOTTOM_D, R, 0)} fill={C.shadow} />
      <path d={panels} fill={C.netFill} />
      <path d={m.join('')} stroke={C.netMesh} strokeWidth={1} fill="none" />
      <path d={bars} stroke={C.netBar} strokeWidth={2.5} strokeLinecap="round" fill="none" />
      <path d={frame} fill={C.line} stroke={C.postEdge} strokeWidth={1.5} strokeLinejoin="round" />
    </g>
  )
}

// ——— окружение стадиона ———
/** Рекламные щиты без надписей — вертикальная полоса вдоль линии z (за воротами). */
function boardsBehind(p: Project, z: number, xHalf: number): JSX.Element {
  const h = 0.9
  return (
    <g>
      <path
        d={poly([p(-xHalf, 0, z), p(xHalf, 0, z), p(xHalf, h, z), p(-xHalf, h, z)])}
        fill={C.boards}
      />
      <path
        d={poly([p(-xHalf, h - 0.12, z), p(xHalf, h - 0.12, z), p(xHalf, h, z), p(-xHalf, h, z)])}
        fill={C.boardsTop}
      />
    </g>
  )
}

/** Трибуна за воротами: стенка и ряды уступами, уходящие вверх и назад. */
function standBehind(p: Project, z: number, xHalf: number): JSX.Element {
  const wall = 1.4
  const rows = 14
  const rise = 0.55
  const run = 0.85
  const tiers: JSX.Element[] = []
  for (let i = rows - 1; i >= 0; i--) {
    const y0 = wall + i * rise
    const z0 = z - i * run
    tiers.push(
      <path
        key={i}
        d={poly([
          p(-xHalf, y0, z0),
          p(xHalf, y0, z0),
          p(xHalf, y0 + rise, z0 - run),
          p(-xHalf, y0 + rise, z0 - run)
        ])}
        fill={i % 2 === 0 ? C.standRow : C.standRowAlt}
      />
    )
  }
  return (
    <g>
      {tiers}
      <path
        d={poly([p(-xHalf, 0, z), p(xHalf, 0, z), p(xHalf, wall, z), p(-xHalf, wall, z)])}
        fill={C.standWall}
      />
    </g>
  )
}

const sky = <rect x={0} y={0} width={BOARD_W} height={BOARD_H} fill={C.sky} />

// ——— вид 1: из-за линии штрафной лицом к воротам ———
const BOX_FRONT_CAM: Camera = {
  x: 0,
  h: 29.69,
  z: 45,
  lookX: 0,
  lookZ: 8,
  f: 1833.4,
  cx: 800,
  cy: 401
}

const boxFront = ((): (() => JSX.Element) => {
  const { project: p } = perspective(BOX_FRONT_CAM)
  const zMax = 40
  const st = stripes(p, 60, 0, zMax)
  const lines = halfMarkings(p, 0.24, zMax, false)
  const runoff = groundQuad(p, -60, -8, 60, zMax)
  const goal = goal3d(p, 0.3)
  const boards = boardsBehind(p, -5, 60)
  const stand = standBehind(p, -8, 60)
  return function BoxFrontBackground(): JSX.Element {
    return (
      <g>
        {sky}
        {stand}
        <path d={runoff} fill={C.runoff} />
        <path d={st.a} fill={C.grassA} />
        <path d={st.b} fill={C.grassB} />
        <path d={lines} fill={C.line} />
        {boards}
        {goal}
      </g>
    )
  }
})()

// ——— вид 2: половина поля сверху-сбоку ———
const HALF_ANGLE_CAM: Camera = fitCamera(
  { x: -28, h: 62, z: 105, lookX: 0, lookZ: 24 },
  [
    [-HALF_W, 0, 0],
    [HALF_W, 0, 0],
    [-HALF_W, 0, LEN / 2],
    [HALF_W, 0, LEN / 2],
    [0, GOAL_H, -NET_TOP_D]
  ],
  { x0: 60, y0: 130, x1: 1540, y1: 860 }
)

const halfAngle = ((): (() => JSX.Element) => {
  const { project: p } = perspective(HALF_ANGLE_CAM)
  const zNear = HALF_ANGLE_CAM.z - 12
  const st = stripes(p, HALF_W, 0, zNear)
  const lines = halfMarkings(p, 0.35, zNear, true)
  const runoff = groundQuad(p, -120, -8, 200, zNear)
  const goal = goal3d(p, 0.45)
  const boards = boardsBehind(p, -5, 200)
  const stand = standBehind(p, -8, 200)
  return function HalfAngleBackground(): JSX.Element {
    return (
      <g>
        {sky}
        {stand}
        <path d={runoff} fill={C.runoff} />
        <path d={st.a} fill={C.grassA} />
        <path d={st.b} fill={C.grassB} />
        <path d={lines} fill={C.line} />
        {boards}
        {goal}
      </g>
    )
  }
})()

// ——— вид 3: всё поле сверху ———
const TOP_K = 12.5
const topProject: Project = (x, _y, z) => [
  BOARD_W / 2 + (z - LEN / 2) * TOP_K,
  BOARD_H / 2 + x * TOP_K
]

function topGoal(flip: boolean): JSX.Element {
  const p: Project = flip ? (x, y, z) => topProject(-x, y, LEN - z) : topProject
  const net = groundQuad(p, -GOAL_HW, -NET_BOTTOM_D, GOAL_HW, 0)
  const mesh: string[] = []
  const step = 0.5
  const seg = (a: Pt, b: Pt): string => `M${f1(a[0])} ${f1(a[1])}L${f1(b[0])} ${f1(b[1])}`
  for (let x = -GOAL_HW + step; x < GOAL_HW; x += step)
    mesh.push(seg(p(x, 0, 0), p(x, 0, -NET_BOTTOM_D)))
  for (let z = -step; z > -NET_BOTTOM_D; z -= step)
    mesh.push(seg(p(-GOAL_HW, 0, z), p(GOAL_HW, 0, z)))
  const posts = [-GOAL_HW - POST, GOAL_HW]
    .map((x) => groundQuad(p, x, -POST * 1.5, x + POST * 1.5, 0))
    .join('')
  return (
    <g>
      <path d={net} fill="rgba(255,255,255,0.22)" stroke={C.netBar} strokeWidth={2} />
      <path d={mesh.join('')} stroke={C.netMesh} strokeWidth={1} fill="none" />
      <path d={posts} fill={C.line} />
    </g>
  )
}

const fullTop = ((): (() => JSX.Element) => {
  const p = topProject
  const w = 0.28
  const n = 18
  const step = LEN / n
  const a: string[] = []
  const b: string[] = []
  for (let i = 0; i < n; i++)
    (i % 2 === 0 ? a : b).push(groundQuad(p, -HALF_W, i * step, HALF_W, (i + 1) * step))
  const lines = halfMarkings(p, w, LEN / 2, true) + halfMarkings(p, w, LEN / 2, false, true)
  return function FullTopBackground(): JSX.Element {
    return (
      <g>
        <rect x={0} y={0} width={BOARD_W} height={BOARD_H} fill={C.runoff} />
        <path d={a.join('')} fill={C.grassA} />
        <path d={b.join('')} fill={C.grassB} />
        <path d={lines} fill={C.line} />
        {topGoal(false)}
        {topGoal(true)}
      </g>
    )
  }
})()

const BUILD: Record<PitchViewId, Omit<PitchView, 'id'>> = {
  'box-front': {
    label: 'Штрафная спереди',
    Background: boxFront,
    scaleAt: perspectiveScale(BOX_FRONT_CAM)
  },
  'half-angle': {
    label: 'Половина поля',
    Background: halfAngle,
    scaleAt: perspectiveScale(HALF_ANGLE_CAM)
  },
  'full-top': {
    label: 'Всё поле сверху',
    Background: fullTop,
    scaleAt: () => 0.45
  }
}

export const PITCH_VIEWS: readonly PitchView[] = PITCH_VIEW_IDS.map((id) => ({ id, ...BUILD[id] }))

export function pitchView(id: PitchViewId): PitchView {
  return PITCH_VIEWS.find((v) => v.id === id) ?? PITCH_VIEWS[0]
}
