// Замер оценки движения камеры на настоящем видео (запуск вручную; видео и кадры в репозиторий не кладём).
//
//   npx tsx scripts/camera-measure.ts scan   --video <mp4> --moments <моменты.json> --out <папка> [--only 51.02,99.02]
//                                            [--set NAME=VAL ...] [--mask x,y,w,h ...]   — опыт: пороги/маски только в копии
//   npx tsx scripts/camera-measure.ts report --scan <папка scan>                       — сводка по окнам и причинам
//   npx tsx scripts/camera-measure.ts sheet  --video <mp4> --out <папка> --t0 <с>              — лист кадров окна (каждые 0.5 с)
//   npx tsx scripts/camera-measure.ts frames --video <mp4> --out <папка> --t0 <с> --idx 1300,1340 [--zoom x:y,x:y]
//                                                                         — кадры 960 px с сеткой; --zoom — увеличенные куски
//   npx tsx scripts/camera-measure.ts points --video <mp4> --out <папка> --t0 <с> --idx 2485  — точки оценки на кадре
//   npx tsx scripts/camera-measure.ts drift  --video <mp4> --marks scripts/camera-measure-marks.json --scan <папка scan>
//                                            --out <папка снимков> [--exp]                — --exp: цепочка опыта из scan
//
// scan: окна [t0−3, t0+3) из моменты.json декодируются тем же decodeFrames (960 px), что и слежение; смена плана —
// isSceneCut, как в трекере; движение — CameraEstimator без масок игроков. Параллельно та же оценка гоняется копией
// estimate.ts с отладочными счётчиками (почему кадр ненадёжен: мало углов, полосы газона, поток потерян, …) и, по --set,
// с другими порогами из types.ts — для опытов, без правки рабочих порогов. Грубая панорама — перебор сдвигов на
// кадре 1/4 (независимо от оценки), чтобы видеть скорость и там, где оценка не справилась.
//
// drift: на кадрах A и B окна вручную отмечены одни и те же точки разметки поля (пиксели кадра 960 px; если известны —
// координаты на поле в метрах). Точки A переносятся в B цепочкой chain.between(A, B) и сравниваются с отметками B:
// в пикселях кадра 480 px и в метрах (гомография поля по отметкам B).
import { spawnSync } from 'child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
import { CameraEstimator } from '../src/main/camera/estimator'
import { toGray } from '../src/main/camera/gray'
import { decodeFrames, type DecodedFrame } from '../src/main/tracking/frames'
import { MotionChain } from '../src/shared/camera/chain'
import type { Gray, MaskRect } from '../src/shared/camera/estimate'
import type { FrameMotion } from '../src/shared/camera/types'
import { applyH, fitHomography } from '../src/shared/pitch/homography'
import { inv3, type Mat3, type Pt } from '../src/shared/pitch/linalg'
import { frameHistOf, isSceneCut } from '../src/shared/tracking/sceneCut'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const FFMPEG = require('ffmpeg-static') as string

const ROOT = resolve(__dirname, '..')
const DECODE_WIDTH = 960
const REF = 480
/** Окно вокруг t0, с. */
const HALF_WINDOW = 3
/** «Быстрая панорама» для разбора причин: грубый сдвиг кадра больше (px при 480). */
const FAST_PAN_PX = 15
/** «Полосы»: проверка неоднозначности отбросила не меньше этой доли угловых точек. */
const STRIPES_SHARE = 0.5

// ───────────────────────── аргументы ─────────────────────────

function args(): { cmd: string; opt: Map<string, string[]> } {
  const [cmd = '', ...rest] = process.argv.slice(2)
  const opt = new Map<string, string[]>()
  for (let i = 0; i < rest.length; i += 1) {
    if (!rest[i].startsWith('--')) continue
    const k = rest[i].slice(2)
    const v = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : 'true'
    opt.set(k, [...(opt.get(k) ?? []), v])
  }
  return { cmd, opt }
}
const one = (o: Map<string, string[]>, k: string): string => {
  const v = o.get(k)?.[0]
  if (!v) throw new Error(`нужен --${k}`)
  return v
}

// ───────────────────────── отладочная копия оценки ─────────────────────────

interface Diag {
  corners: number
  amb: number
  lost: number
  fb: number
  tracked: number
  inliers: number
  hull: number
  rms: number
  scale: number
  rival: boolean
  /** Смещения согласованных/всех отслеженных точек (нормированные координаты estimate.ts: половина ширины = 1). */
  dx: number[]
  dy: number[]
  /** Точки последней подгонки (нормированные координаты), согласованность и полуширина кадра в px. */
  src: Pt[]
  dst: Pt[]
  inl: boolean[]
  half: number
}
interface InstrModule {
  estimateMotion: (
    a: Gray,
    b: Gray,
    o: { masks: readonly MaskRect[] }
  ) => { reliable: boolean; H: Mat3; inliers: number }
  __S: Diag
}

/**
 * Копия src/shared/camera/estimate.ts с отладочными счётчиками и подменой порогов (overrides) — во временной папке.
 * Каждая правка текста проверяется: если исходник изменился и вставка не легла — ошибка, а не тихо неверный замер.
 */
async function loadInstrumented(overrides: Record<string, number>): Promise<InstrModule> {
  const dir = join(
    tmpdir(),
    `flow-camera-measure-${process.pid}-${Object.entries(overrides).flat().join('_') || 'base'}`
  )
  mkdirSync(dir, { recursive: true })
  const url = (p: string): string => pathToFileURL(join(ROOT, p)).href
  const types =
    `export * from '${url('src/shared/camera/types.ts')}'\n` +
    Object.entries(overrides)
      .map(([k, v]) => `export const ${k} = ${v}\n`)
      .join('')
  writeFileSync(join(dir, 'types.ts'), types)
  let src = readFileSync(join(ROOT, 'src/shared/camera/estimate.ts'), 'utf8')
  const patch = (from: string, to: string): void => {
    if (!src.includes(from)) throw new Error(`отладочная копия: не найдено «${from}»`)
    src = src.replace(from, to)
  }
  patch(`from '../pitch/homography'`, `from '${url('src/shared/pitch/homography.ts')}'`)
  patch(`from '../pitch/linalg'`, `from '${url('src/shared/pitch/linalg.ts')}'`)
  patch(`from './types'`, `from './types.ts'`)
  src +=
    '\nexport const __S: any = {}\n' +
    'function __reset(n: number): void { Object.assign(__S, { corners: n, amb: 0, lost: 0, fb: 0, tracked: 0, inliers: 0, hull: 0, rms: Infinity, scale: 1, rival: false, dx: [], dy: [], src: [], dst: [], inl: [], half: 1 }) }\n'
  patch(
    'if (corners.length < MOTION_MIN_INLIERS) return unreliable()',
    '__reset(corners.length)\n  if (corners.length < MOTION_MIN_INLIERS) return unreliable()'
  )
  patch(
    'if (ambiguous(pa[2], p.x / 4, p.y / 4, ambFar, 2)) continue',
    'if (ambiguous(pa[2], p.x / 4, p.y / 4, ambFar, 2)) { __S.amb++; continue }'
  )
  patch(
    'if (ambiguous(pa[1], p.x / 2, p.y / 2, ambNear, 1)) continue',
    'if (ambiguous(pa[1], p.x / 2, p.y / 2, ambNear, 1)) { __S.amb++; continue }'
  )
  patch(
    'if (!q || q.residual > LK_MAX_RESIDUAL) continue',
    'if (!q || q.residual > LK_MAX_RESIDUAL) { __S.lost++; continue }'
  )
  patch(
    'if (!back || (back.x - p.x) ** 2 + (back.y - p.y) ** 2 > fb2) continue',
    'if (!back || (back.x - p.x) ** 2 + (back.y - p.y) ** 2 > fb2) { __S.fb++; continue }'
  )
  patch(
    'if (src.length < MOTION_MIN_INLIERS) return unreliable()',
    '__S.tracked = src.length; for (let i = 0; i < src.length; i += 1) { __S.dx.push(dst[i].x - src[i].x); __S.dy.push(dst[i].y - src[i].y) }\n  if (src.length < MOTION_MIN_INLIERS) return unreliable()'
  )
  patch(
    'if (!reliable) return unreliable(inliers, rmsPx)',
    'Object.assign(__S, { inliers, hull: hullOf(fit.inl), rms: rmsPx, scale, src, dst, inl: fit.inl, half })\n  if (!reliable) return unreliable(inliers, rmsPx)'
  )
  patch(
    'if (rival && count(rival.inl) >= rivalMin) return unreliable(inliers, rmsPx)',
    'if (rival && count(rival.inl) >= rivalMin) { __S.rival = true; return unreliable(inliers, rmsPx) }'
  )
  const file = join(dir, 'estimate.ts')
  writeFileSync(file, src)
  return (await import(pathToFileURL(file).href)) as InstrModule
}

/** Почему кадр ненадёжен — первая сработавшая проверка estimateMotion (в том же порядке). */
function failReason(d: Diag, T: Record<string, number>): string {
  if (d.corners < T.MOTION_MIN_INLIERS) return 'мало углов'
  if (d.tracked < T.MOTION_MIN_INLIERS) return 'мало прослежено'
  if (d.inliers < T.MOTION_MIN_INLIERS) return 'мало согласованных'
  if (d.inliers < T.MOTION_MIN_INLIER_SHARE * d.corners) return 'доля согласованных'
  if (d.hull < T.MOTION_MIN_HULL_SHARE) return 'кучно'
  if (d.rms > T.MOTION_MAX_RMS_PX) return 'ошибка подгонки'
  if (d.scale > T.MOTION_MAX_SCALE_STEP || d.scale < 1 / T.MOTION_MAX_SCALE_STEP)
    return 'скачок масштаба'
  if (d.rival) return 'второе движение'
  return 'прочее'
}

// ───────────────────────── грубая панорама ─────────────────────────

/** Уменьшение серого кадра в k раз усреднением. */
function shrink(g: Gray, k: number): Gray {
  const w = Math.floor(g.width / k)
  const h = Math.floor(g.height / k)
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h; y += 1)
    for (let x = 0; x < w; x += 1) {
      let s = 0
      for (let j = 0; j < k; j += 1)
        for (let i = 0; i < k; i += 1) s += g.data[(y * k + j) * g.width + x * k + i]
      data[y * w + x] = s / (k * k)
    }
  return { width: w, height: h, data }
}

/**
 * Сдвиг кадра b относительно a перебором (кадр 1/4, ±16 px → ±64 px при 480) по средней разнице яркости в средней части
 * кадра (без краёв и полосы счёта). Возвращает сдвиг в px при 480 и отношение лучшей разницы к разнице без сдвига.
 */
function roughPan(a: Gray, b: Gray): { dx: number; dy: number; sad: number } {
  const A = shrink(a, 4)
  const B = shrink(b, 4)
  const R = 16
  const { width: w, height: h } = A
  const x0 = R + 4
  const x1 = w - R - 4
  const y0 = Math.max(R + 2, Math.round(h * 0.15))
  const y1 = h - R - 2
  let best = Infinity
  let bx = 0
  let by = 0
  for (let dy = -R; dy <= R; dy += 1)
    for (let dx = -R; dx <= R; dx += 1) {
      let s = 0
      for (let y = y0; y < y1 && s < best; y += 2)
        for (let x = x0; x < x1; x += 2)
          s += Math.abs(A.data[y * w + x] - B.data[(y + dy) * w + x + dx])
      if (s < best) {
        best = s
        bx = dx
        by = dy
      }
    }
  const n = Math.ceil((y1 - y0) / 2) * Math.ceil((x1 - x0) / 2)
  // Доли пикселя — параболой по соседним сдвигам (полные суммы, без досрочного выхода).
  const full = (dx: number, dy: number): number => {
    if (Math.abs(dx) > R || Math.abs(dy) > R) return Infinity
    let s = 0
    for (let y = y0; y < y1; y += 2)
      for (let x = x0; x < x1; x += 2)
        s += Math.abs(A.data[y * w + x] - B.data[(y + dy) * w + x + dx])
    return s
  }
  const sub = (m: number, c: number, p: number): number => {
    const d = m - 2 * c + p
    return Number.isFinite(d) && d > 0 ? Math.max(-0.5, Math.min(0.5, (m - p) / (2 * d))) : 0
  }
  const c0 = full(bx, by)
  const fx = bx + sub(full(bx - 1, by), c0, full(bx + 1, by))
  const fy = by + sub(full(bx, by - 1), c0, full(bx, by + 1))
  // A(x, y) ≈ B(x + dx, y + dy): картинка сдвинулась на (dx, dy).
  return { dx: (fx * 4 * REF) / a.width, dy: (fy * 4 * REF) / a.width, sad: best / n }
}

// ───────────────────────── PNG и рисование ─────────────────────────

function writePng(rgba: Uint8Array, w: number, h: number, file: string): void {
  const r = spawnSync(
    FFMPEG,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-s',
      `${w}x${h}`,
      '-i',
      '-',
      file
    ],
    { input: rgba, maxBuffer: 1 << 26 }
  )
  if (r.status !== 0) throw new Error(`ffmpeg png: ${r.stderr}`)
}

type RGB = [number, number, number]
function px(img: Uint8Array, w: number, h: number, x: number, y: number, c: RGB): void {
  x = Math.round(x)
  y = Math.round(y)
  if (x < 0 || y < 0 || x >= w || y >= h) return
  const i = (y * w + x) * 4
  img[i] = c[0]
  img[i + 1] = c[1]
  img[i + 2] = c[2]
}
function line(img: Uint8Array, w: number, h: number, a: Pt, b: Pt, c: RGB): void {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)))
  for (let i = 0; i <= n; i += 1)
    px(img, w, h, a.x + ((b.x - a.x) * i) / n, a.y + ((b.y - a.y) * i) / n, c)
}
function cross(img: Uint8Array, w: number, h: number, p: Pt, r: number, c: RGB): void {
  line(img, w, h, { x: p.x - r, y: p.y }, { x: p.x + r, y: p.y }, c)
  line(img, w, h, { x: p.x, y: p.y - r }, { x: p.x, y: p.y + r }, c)
}
function ring(img: Uint8Array, w: number, h: number, p: Pt, r: number, c: RGB): void {
  for (let a = 0; a < 64; a += 1)
    px(img, w, h, p.x + r * Math.cos((a * Math.PI) / 32), p.y + r * Math.sin((a * Math.PI) / 32), c)
}

// Цифры 3×5 для подписей сетки.
const GLYPHS: Record<string, string> = {
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001111001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001001001001',
  '8': '111101111101111',
  '9': '111101111001111',
  '-': '000000111000000',
  A: '010101111101101',
  B: '110101110101110'
}
function text(
  img: Uint8Array,
  w: number,
  h: number,
  s: string,
  x: number,
  y: number,
  k: number,
  c: RGB
): void {
  for (const ch of s) {
    const g = GLYPHS[ch]
    if (g)
      for (let j = 0; j < 5; j += 1)
        for (let i = 0; i < 3; i += 1)
          if (g[j * 3 + i] === '1')
            for (let v = 0; v < k; v += 1)
              for (let u = 0; u < k; u += 1) px(img, w, h, x + i * k + u, y + j * k + v, c)
    x += 4 * k
  }
}

// ───────────────────────── декодирование окна ─────────────────────────

async function* frames(video: string, from: number, to: number): AsyncGenerator<DecodedFrame> {
  const ctl = new AbortController()
  yield* decodeFrames({
    videoPath: video,
    from: Math.max(0, from),
    to,
    width: DECODE_WIDTH,
    signal: ctl.signal
  })
}

// ───────────────────────── scan ─────────────────────────

interface FrameRow {
  index: number
  t: number
  cut: boolean
  reliable: boolean | null
  inliers: number
  ms: number
  /** Сдвиг центра кадра по найденной H, px при 480 (только надёжные). */
  pan: number | null
  rough: { dx: number; dy: number; sad: number } | null
  /** Медиана смещения прослеженных точек, px при 480 (и для ненадёжных, если точки прослежены). */
  flow: number | null
  diag:
    (Omit<Diag, 'dx' | 'dy' | 'src' | 'dst' | 'inl' | 'half'> & { reason: string | null }) | null
  exp: { reliable: boolean; reason: string | null } | null
}

const median = (v: number[]): number => {
  if (!v.length) return NaN
  const s = [...v].sort((a, b) => a - b)
  return s[Math.floor((s.length - 1) / 2)]
}
const quantile = (v: number[], q: number): number => {
  if (!v.length) return NaN
  const s = [...v].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]
}

async function scan(opt: Map<string, string[]>): Promise<void> {
  const video = one(opt, 'video')
  const out = one(opt, 'out')
  mkdirSync(out, { recursive: true })
  const moments = JSON.parse(readFileSync(one(opt, 'moments'), 'utf8')) as { t0: number }[]
  const only = opt.get('only')?.[0]?.split(',').map(Number)
  const overrides: Record<string, number> = {}
  for (const s of opt.get('set') ?? []) {
    const [k, v] = s.split('=')
    overrides[k] = Number(v)
  }
  // --mask x,y,w,h (доли кадра) — неподвижные надписи трансляции (счёт, логотип); только для опыта.
  const masks: MaskRect[] = (opt.get('mask') ?? []).map((s) => {
    const [x, y, w, h] = s.split(',').map(Number)
    return { x, y, w, h }
  })
  const T = (await import('../src/shared/camera/types')) as unknown as Record<string, number>
  const Texp = { ...T, ...overrides }
  const base = await loadInstrumented({})
  const exp =
    Object.keys(overrides).length || masks.length ? await loadInstrumented(overrides) : null
  const summary: unknown[] = []
  console.log(
    'окно      кадров  надёжно%  ms/кадр  планов  панорама px/кадр (мед/p90/макс)  причины ненадёжных' +
      (exp ? `  | опыт ${JSON.stringify({ ...overrides, masks })} надёжно%` : '')
  )
  for (const m of moments) {
    if (only && !only.some((t) => Math.abs(t - m.t0) < 0.01)) continue
    const cam = new CameraEstimator()
    // Цепочка опыта (другие пороги/маски) — чтобы проверить перенос разметки и с ней (drift --exp).
    const expChain = new MotionChain()
    const rows: FrameRow[] = []
    let prevHist: Float32Array | null = null
    let prevGray: Gray | null = null
    let mismatch = 0
    for await (const f of frames(video, m.t0 - HALF_WINDOW, m.t0 + HALF_WINDOW)) {
      const hist = frameHistOf(f.rgba, f.width, f.height)
      const cut = prevHist !== null && isSceneCut(prevHist, hist)
      prevHist = hist
      const t1 = performance.now()
      const motion = cam.push(f, [], cut)
      const ms = performance.now() - t1
      const gray = toGray(f)
      const row: FrameRow = {
        index: f.index,
        t: f.t,
        cut,
        reliable: motion ? motion.reliable : null,
        inliers: motion?.inliers ?? 0,
        ms,
        pan: null,
        rough: null,
        flow: null,
        diag: null,
        exp: null
      }
      if (motion?.reliable) {
        const c = applyH(motion.H, { x: 0.5, y: 0.5 })
        if (c) row.pan = Math.hypot(c.x - 0.5, ((c.y - 0.5) * gray.height) / gray.width) * REF
      }
      if (cut) expChain.cut(f.index)
      if (prevGray && !cut) {
        row.rough = roughPan(prevGray, gray)
        const r = base.estimateMotion(prevGray, gray, { masks: [] })
        if (r.reliable !== motion?.reliable) mismatch += 1
        const d = base.__S
        const mags = d.dx.map((x, i) => Math.hypot(x, d.dy[i]) * (REF / 2))
        row.flow = mags.length ? median(mags) : null
        row.diag = {
          corners: d.corners,
          amb: d.amb,
          lost: d.lost,
          fb: d.fb,
          tracked: d.tracked,
          inliers: d.inliers,
          hull: d.hull,
          rms: d.rms,
          scale: d.scale,
          rival: d.rival,
          reason: r.reliable ? null : failReason(d, T)
        }
        if (exp) {
          const e = exp.estimateMotion(prevGray, gray, { masks })
          row.exp = { reliable: e.reliable, reason: e.reliable ? null : failReason(exp.__S, Texp) }
          expChain.push({ index: f.index, H: e.H, reliable: e.reliable, inliers: e.inliers })
        }
      }
      prevGray = gray
      rows.push(row)
    }
    writeFileSync(
      join(out, `окно-${m.t0}.json`),
      JSON.stringify({
        t0: m.t0,
        rows,
        chain: cam.chain.toJSON(),
        chainExp: exp ? expChain.toJSON() : null
      })
    )
    const est = rows.filter((r) => r.reliable !== null)
    const rel = est.filter((r) => r.reliable)
    const cuts = rows.filter((r) => r.cut).length
    const pans = rows.filter((r) => r.rough).map((r) => Math.hypot(r.rough!.dx, r.rough!.dy))
    const reasons = new Map<string, number>()
    for (const r of est.filter((x) => !x.reliable && !x.cut)) {
      const k = r.diag?.reason ?? '?'
      reasons.set(k, (reasons.get(k) ?? 0) + 1)
    }
    const expRel = exp ? est.filter((r) => r.exp?.reliable).length : 0
    const line1 =
      `${String(m.t0).padEnd(9)} ${String(rows.length).padStart(5)}  ${((100 * rel.length) / Math.max(1, est.length)).toFixed(0).padStart(7)}%` +
      `  ${median(est.map((r) => r.ms))
        .toFixed(1)
        .padStart(7)}  ${String(cuts + 1).padStart(6)}` +
      `  ${median(pans).toFixed(1)}/${quantile(pans, 0.9).toFixed(1)}/${Math.max(0, ...pans).toFixed(1)}`.padEnd(
        34
      ) +
      `  ${[...reasons].map(([k, v]) => `${k}:${v}`).join(', ')}` +
      (exp ? `  | ${((100 * expRel) / Math.max(1, est.length)).toFixed(0)}%` : '') +
      (mismatch ? `  [!] копия расходится с рабочей оценкой на ${mismatch} кадрах` : '')
    console.log(line1)
    summary.push({
      t0: m.t0,
      frames: rows.length,
      reliable: rel.length,
      estimated: est.length,
      cuts,
      mismatch
    })
  }
  writeFileSync(join(out, 'сводка.json'), JSON.stringify(summary, null, 1))
}

// ───────────────────────── report ─────────────────────────

/** Средняя разница яркости после лучшего грубого сдвига больше — похоже на смену плана, которую не поймала гистограмма. */
const MISSED_CUT_SAD = 25
/** Кадр «с движением камеры»: грубый сдвиг не меньше (px при 480). */
const MOVING_PX = 1.5

/**
 * Сводка по сохранённым окнам scan: доля надёжных (всего и на кадрах с движением), скорость панорамы, разбор
 * ненадёжных кадров: смена плана (в т. ч. не пойманная гистограммой) → быстрая панорама → полосы газона → прочее.
 */
function report(opt: Map<string, string[]>): void {
  const dir = one(opt, 'scan')
  const summary = JSON.parse(readFileSync(join(dir, 'сводка.json'), 'utf8')) as { t0: number }[]
  const tot = { est: 0, rel: 0, mov: 0, movRel: 0, expRel: 0, expMovRel: 0 }
  const kinds = new Map<string, number>()
  const allPan: number[] = []
  const allMs: number[] = []
  console.log(
    'окно      надёжно% (все/движение)  опыт%   ms/кадр  панорама px/кадр (мед/p90/макс)  ненадёжные: план/быстро/полосы/прочее  углов, отброшено полосами%  самый длинный надёжный участок (кадров, путь камеры)'
  )
  for (const { t0 } of summary) {
    const { rows } = JSON.parse(readFileSync(join(dir, `окно-${t0}.json`), 'utf8')) as {
      rows: FrameRow[]
    }
    const est = rows.filter((r) => r.reliable !== null)
    const mov = est.filter((r) => r.rough && Math.hypot(r.rough.dx, r.rough.dy) >= MOVING_PX)
    const rel = est.filter((r) => r.reliable)
    const pans = est.filter((r) => r.rough).map((r) => Math.hypot(r.rough!.dx, r.rough!.dy))
    const k = { cut: 0, fast: 0, stripes: 0, other: 0 }
    for (const r of est.filter((x) => !x.reliable)) {
      const pan = r.rough ? Math.hypot(r.rough.dx, r.rough.dy) : 0
      const kind =
        (r.rough?.sad ?? 0) > MISSED_CUT_SAD
          ? 'cut'
          : pan > FAST_PAN_PX
            ? 'fast'
            : r.diag && r.diag.amb >= STRIPES_SHARE * r.diag.corners
              ? 'stripes'
              : 'other'
      k[kind] += 1
      if (kind === 'other')
        kinds.set(r.diag?.reason ?? '?', (kinds.get(r.diag?.reason ?? '?') ?? 0) + 1)
    }
    // Самый длинный непрерывный надёжный участок (по нему только и можно перенести разметку) и сдвиг камеры на нём.
    let run = { from: 0, to: -1, pan: 0 }
    let cur = { from: 0, to: -1, pan: 0 }
    for (const r of rows) {
      if (r.reliable) {
        if (cur.to !== r.index - 1) cur = { from: r.index - 1, to: r.index - 1, pan: 0 }
        cur.to = r.index
        cur.pan += r.pan ?? 0
        if (cur.to - cur.from > run.to - run.from) run = { ...cur }
      }
    }
    const runs = `${run.to - run.from} (${run.from}–${run.to}, ${run.pan.toFixed(0)} px)`
    const corners = median(est.map((r) => r.diag?.corners ?? 0))
    const amb = median(est.filter((r) => r.diag?.corners).map((r) => r.diag!.amb / r.diag!.corners))
    const expRel = est.filter((r) => r.exp?.reliable).length
    const expMov = mov.filter((r) => r.exp?.reliable).length
    const hasExp = est.some((r) => r.exp)
    tot.est += est.length
    tot.rel += rel.length
    tot.mov += mov.length
    tot.movRel += mov.filter((r) => r.reliable).length
    tot.expRel += expRel
    tot.expMovRel += expMov
    allPan.push(...pans)
    allMs.push(...est.map((r) => r.ms))
    const pct = (a: number, b: number): string => (b ? `${((100 * a) / b).toFixed(0)}%` : '—')
    console.log(
      `${String(t0).padEnd(9)} ${pct(rel.length, est.length).padStart(5)} / ${pct(mov.filter((r) => r.reliable).length, mov.length).padStart(4)} (${mov.length})`.padEnd(
        36
      ) +
        `${hasExp ? `${pct(expRel, est.length)}/${pct(expMov, mov.length)}` : '—'}`.padEnd(9) +
        `${median(est.map((r) => r.ms))
          .toFixed(1)
          .padStart(6)}  ` +
        `${median(pans).toFixed(1)}/${quantile(pans, 0.9).toFixed(1)}/${Math.max(0, ...pans).toFixed(1)}`.padEnd(
          33
        ) +
        `${k.cut}/${k.fast}/${k.stripes}/${k.other}`.padEnd(38) +
        `${corners}, ${(100 * amb).toFixed(0)}%`.padEnd(10) +
        `  цепь ${runs}`
    )
  }
  const pct = (a: number, b: number): string => `${((100 * a) / Math.max(1, b)).toFixed(1)}%`
  console.log(
    `\nвсего: надёжно ${pct(tot.rel, tot.est)} (${tot.rel}/${tot.est}); на кадрах с движением ≥${MOVING_PX} px: ${pct(tot.movRel, tot.mov)} (${tot.movRel}/${tot.mov})` +
      (tot.expRel ? `; опыт: ${pct(tot.expRel, tot.est)} / ${pct(tot.expMovRel, tot.mov)}` : '') +
      `\nпанорама px/кадр@480: медиана ${median(allPan).toFixed(1)}, p90 ${quantile(allPan, 0.9).toFixed(1)}, p99 ${quantile(allPan, 0.99).toFixed(1)}` +
      `\nms/кадр (toGray + оценка): медиана ${median(allMs).toFixed(1)}, p90 ${quantile(allMs, 0.9).toFixed(1)}` +
      `\n«прочее» по первой несработавшей проверке: ${[...kinds].map(([a, b]) => `${a}:${b}`).join(', ')}`
  )
}

// ───────────────────────── sheet / frames ─────────────────────────

function sheet(opt: Map<string, string[]>): void {
  const video = one(opt, 'video')
  const out = one(opt, 'out')
  const t0 = Number(one(opt, 't0'))
  mkdirSync(out, { recursive: true })
  const r = spawnSync(FFMPEG, [
    ...[
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      String(Math.max(0, t0 - HALF_WINDOW)),
      '-t',
      String(2 * HALF_WINDOW)
    ],
    ...[
      '-i',
      video,
      '-vf',
      'fps=2,scale=320:-2,tile=4x3',
      '-frames:v',
      '1',
      join(out, `лист-${t0}.png`)
    ]
  ])
  if (r.status !== 0) throw new Error(String(r.stderr))
}

/** Кадры окна по номерам: 960 px с подписанной сеткой 50 px; --zoom x:y — куски 64×64 вокруг точек, ×6, сетка 4 px. */
async function dumpFrames(opt: Map<string, string[]>): Promise<void> {
  const video = one(opt, 'video')
  const out = one(opt, 'out')
  const t0 = Number(one(opt, 't0'))
  const want = new Set(one(opt, 'idx').split(',').map(Number))
  const zoom = (opt.get('zoom')?.[0] ?? '')
    .split(',')
    .filter(Boolean)
    .map((s) => s.split(':').map(Number))
  mkdirSync(out, { recursive: true })
  for await (const f of frames(video, t0 - HALF_WINDOW, t0 + HALF_WINDOW)) {
    if (!want.has(f.index)) continue
    const { width: w, height: h } = f
    if (zoom.length) {
      // Куски 64×64 (центр — заданная точка), увеличенные в 6 раз, с сеткой каждые 4 px и подписью смещения.
      const S = 6
      const R = 32
      const cw = 2 * R * S
      const img = new Uint8Array(cw * zoom.length * cw * 4)
      const W = cw * zoom.length
      zoom.forEach(([zx, zy], n) => {
        for (let y = 0; y < cw; y += 1)
          for (let x = 0; x < cw; x += 1) {
            const sx = Math.min(w - 1, Math.max(0, Math.floor(zx - R + x / S)))
            const sy = Math.min(h - 1, Math.max(0, Math.floor(zy - R + y / S)))
            const si = (sy * w + sx) * 4
            const di = (y * W + n * cw + x) * 4
            img[di] = f.rgba[si]
            img[di + 1] = f.rgba[si + 1]
            img[di + 2] = f.rgba[si + 2]
            img[di + 3] = 255
          }
        for (let d = -R; d <= R; d += 4) {
          const c: RGB = d === 0 ? [255, 0, 0] : d % 16 === 0 ? [255, 255, 0] : [90, 90, 90]
          const p = (d + R) * S
          line(img, W, cw, { x: n * cw + p, y: 0 }, { x: n * cw + p, y: cw - 1 }, c)
          line(img, W, cw, { x: n * cw, y: p }, { x: n * cw + cw - 1, y: p }, c)
          if (d % 16 === 0 && d !== 0) {
            text(img, W, cw, String(d), n * cw + p + 2, 2, 3, [255, 255, 0])
            text(img, W, cw, String(d), n * cw + 2, p + 2, 3, [255, 255, 0])
          }
        }
        line(
          img,
          W,
          cw,
          { x: n * cw + cw - 1, y: 0 },
          { x: n * cw + cw - 1, y: cw - 1 },
          [255, 255, 255]
        )
      })
      writePng(img, W, cw, join(out, `кадр-${f.index}-куски.png`))
    } else {
      const img = Uint8Array.from(f.rgba)
      for (let x = 50; x < w; x += 50) {
        for (let y = 0; y < h; y += 3)
          px(img, w, h, x, y, x % 100 === 0 ? [255, 255, 0] : [0, 255, 255])
        if (x % 100 === 0) text(img, w, h, String(x), x + 2, 2, 2, [255, 255, 0])
      }
      for (let y = 50; y < h; y += 50) {
        for (let x = 0; x < w; x += 3)
          px(img, w, h, x, y, y % 100 === 0 ? [255, 255, 0] : [0, 255, 255])
        if (y % 100 === 0) text(img, w, h, String(y), 2, y + 2, 2, [255, 255, 0])
      }
      writePng(img, w, h, join(out, `кадр-${f.index}.png`))
    }
  }
}

/**
 * Точки оценки на кадре idx (пара idx−1 → idx): согласованные — зелёные, несогласованные — красные, смещение ×5 — жёлтым.
 * Показывает, на чём держится найденное движение (поле, трибуны, надписи трансляции, игроки).
 */
async function points(opt: Map<string, string[]>): Promise<void> {
  const video = one(opt, 'video')
  const out = one(opt, 'out')
  const t0 = Number(one(opt, 't0'))
  const want = new Set(one(opt, 'idx').split(',').map(Number))
  mkdirSync(out, { recursive: true })
  const mod = await loadInstrumented({})
  let prev: DecodedFrame | null = null
  for await (const f of frames(video, t0 - HALF_WINDOW, t0 + HALF_WINDOW)) {
    if (want.has(f.index) && prev) {
      const r = mod.estimateMotion(toGray(prev), toGray(f), { masks: [] })
      const d = mod.__S
      const img = Uint8Array.from(f.rgba)
      const k = f.width / (2 * d.half)
      const toPx = (p: Pt): Pt => ({
        x: (p.x * d.half + d.half) * k,
        y: (p.y * d.half + (d.half * f.height) / f.width) * k
      })
      d.src.forEach((p, i) => {
        const a = toPx(p)
        const b = toPx(d.dst[i])
        line(
          img,
          f.width,
          f.height,
          a,
          { x: a.x + 5 * (b.x - a.x), y: a.y + 5 * (b.y - a.y) },
          [255, 255, 0]
        )
        cross(img, f.width, f.height, a, 3, d.inl[i] ? [0, 255, 0] : [255, 0, 0])
      })
      writePng(img, f.width, f.height, join(out, `точки-${f.index}.png`))
      console.log(
        `${f.index}: надёжно ${r.reliable}, углов ${d.corners}, полосы ${d.amb}, потеряно ${d.lost + d.fb}, прослежено ${d.tracked}, согласованных ${d.inliers}`
      )
    }
    prev = f
  }
}

// ───────────────────────── drift ─────────────────────────

interface MarkPoint {
  name: string
  /** Координаты на поле, м (начало — угол поля, x вдоль длины 105, y вдоль ширины 68); null — не знаем. */
  world: [number, number] | null
  /** Отметки на кадрах A и B, px кадра 960 px; a = null — точка видна только на B (нужна лишь для гомографии поля B). */
  a: [number, number] | null
  b: [number, number]
}
interface MarkWindow {
  t0: number
  a: number
  b: number
  note?: string
  points: MarkPoint[]
}

async function drift(opt: Map<string, string[]>): Promise<void> {
  const video = one(opt, 'video')
  const scanDir = one(opt, 'scan')
  const out = one(opt, 'out')
  mkdirSync(out, { recursive: true })
  const marks = JSON.parse(readFileSync(one(opt, 'marks'), 'utf8')) as { windows: MarkWindow[] }
  const allPx: number[] = []
  const allM: number[] = []
  console.log(
    'окно      A→B (кадров)  цепочка  ошибка px@480 (сред/макс)  ошибка м (сред/макс)  невязка разметки B px@480'
  )
  for (const win of marks.windows) {
    const saved = JSON.parse(readFileSync(join(scanDir, `окно-${win.t0}.json`), 'utf8')) as {
      chain: FrameMotion[]
      chainExp: FrameMotion[] | null
    }
    // --exp: цепочка опыта из scan с --set/--mask вместо рабочей.
    const useExp = opt.has('exp')
    if (useExp && !saved.chainExp)
      throw new Error('в замере нет цепочки опыта (scan без --set/--mask)')
    const chain = MotionChain.from(useExp ? saved.chainExp! : saved.chain)
    const H = chain.between(win.a, win.b)
    const W = DECODE_WIDTH
    const Hh = 540
    const frac = (p: [number, number]): Pt => ({ x: p[0] / W, y: p[1] / Hh })
    const pred = win.points.map((p) => (H && p.a ? applyH(H, frac(p.a)) : null))
    const errPx = win.points.map((p, i) => {
      const q = pred[i]
      return q ? Math.hypot((q.x - p.b[0] / W) * REF, ((q.y - p.b[1] / Hh) * (REF * Hh)) / W) : NaN
    })
    // Метры: гомография поля → кадр B по отметкам B; ошибка — расстояние на поле между переносом и отметкой.
    const withWorld = win.points.filter((p) => p.world)
    let errM: number[] = []
    let resid = NaN
    if (withWorld.length >= 4) {
      const fit = fitHomography(
        withWorld.map((p) => ({ world: { x: p.world![0], y: p.world![1] }, image: frac(p.b) })),
        W / Hh
      )
      if (fit.ok) {
        const Hi = inv3(fit.H)
        // Обратная матрица определена с точностью до знака: делим без проверки знака w.
        const toWorld = (q: Pt): Pt | null => {
          if (!Hi) return null
          const w = Hi[6] * q.x + Hi[7] * q.y + Hi[8]
          if (Math.abs(w) < 1e-12) return null
          return {
            x: (Hi[0] * q.x + Hi[1] * q.y + Hi[2]) / w,
            y: (Hi[3] * q.x + Hi[4] * q.y + Hi[5]) / w
          }
        }
        // Метры — только для точек на траве (с координатами поля): штанги сверху, флажки и т. п. не лежат на плоскости поля.
        errM = win.points.map((p, i) => {
          if (!p.world) return NaN
          const a = pred[i] && toWorld(pred[i]!)
          const b = toWorld(frac(p.b))
          return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : NaN
        })
        const rr = withWorld.map((p) => {
          const q = applyH(fit.H, { x: p.world![0], y: p.world![1] })
          return q
            ? Math.hypot((q.x - p.b[0] / W) * REF, ((q.y - p.b[1] / Hh) * (REF * Hh)) / W)
            : NaN
        })
        resid = Math.sqrt(rr.reduce((s, v) => s + v * v, 0) / rr.length)
      }
    }
    const ok = errPx.filter(Number.isFinite)
    const okM = errM.filter(Number.isFinite)
    allPx.push(...ok)
    allM.push(...okM)
    const mean = (v: number[]): number => v.reduce((s, x) => s + x, 0) / Math.max(1, v.length)
    console.log(
      `${String(win.t0).padEnd(9)} ${win.a}→${win.b} (${win.b - win.a})`.padEnd(24) +
        `  ${H ? 'есть' : 'НЕТ'}     ` +
        `${ok.length ? `${mean(ok).toFixed(2)}/${Math.max(...ok).toFixed(2)}` : '—'}`.padEnd(27) +
        `${okM.length ? `${mean(okM).toFixed(2)}/${Math.max(...okM).toFixed(2)}` : '—'}`.padEnd(
          22
        ) +
        (Number.isFinite(resid) ? resid.toFixed(2) : '—')
    )
    console.log(
      '          ' +
        win.points
          .map((p, i) =>
            p.a
              ? `${p.name}: ${errPx[i].toFixed(1)}px${errM[i] !== undefined ? ` ${errM[i].toFixed(2)}м` : ''}`
              : ''
          )
          .filter(Boolean)
          .join('; ')
    )
    // Снимок: A с отметками | B с отметками (зелёные) и переносом (красные).
    const imgs = new Map<number, Uint8Array>()
    for await (const f of frames(video, win.t0 - HALF_WINDOW, win.t0 + HALF_WINDOW))
      if (f.index === win.a || f.index === win.b) imgs.set(f.index, Uint8Array.from(f.rgba))
    const A = imgs.get(win.a)
    const B = imgs.get(win.b)
    if (!A || !B) throw new Error(`нет кадров ${win.a}/${win.b}`)
    const OW = 2 * W + 10
    const img = new Uint8Array(OW * Hh * 4)
    for (let y = 0; y < Hh; y += 1) {
      img.set(A.subarray(y * W * 4, (y + 1) * W * 4), y * OW * 4)
      img.set(B.subarray(y * W * 4, (y + 1) * W * 4), (y * OW + W + 10) * 4)
    }
    win.points.forEach((p, i) => {
      if (!p.a) return
      ring(img, OW, Hh, { x: p.a[0], y: p.a[1] }, 6, [0, 255, 0])
      cross(img, OW, Hh, { x: p.a[0], y: p.a[1] }, 3, [0, 255, 0])
      const bm = { x: W + 10 + p.b[0], y: p.b[1] }
      ring(img, OW, Hh, bm, 6, [0, 255, 0])
      cross(img, OW, Hh, bm, 3, [0, 255, 0])
      const q = pred[i]
      if (q) {
        const qp = { x: W + 10 + q.x * W, y: q.y * Hh }
        line(img, OW, Hh, bm, qp, [255, 255, 0])
        cross(img, OW, Hh, qp, 7, [255, 0, 0])
      }
    })
    text(img, OW, Hh, 'A', 8, 8, 5, [255, 255, 255])
    text(img, OW, Hh, 'B', W + 18, 8, 5, [255, 255, 255])
    writePng(img, OW, Hh, join(out, `перенос-${win.t0}-${win.a}-${win.b}.png`))
  }
  console.log(
    `\nвсего точек ${allPx.length}: px@480 медиана ${median(allPx).toFixed(2)}, p90 ${quantile(allPx, 0.9).toFixed(2)}, макс ${Math.max(...allPx).toFixed(2)}` +
      (allM.length
        ? `; м медиана ${median(allM).toFixed(2)}, p90 ${quantile(allM, 0.9).toFixed(2)}, макс ${Math.max(...allM).toFixed(2)}`
        : '')
  )
}

async function main(): Promise<void> {
  const { cmd, opt } = args()
  if (cmd === 'scan') await scan(opt)
  else if (cmd === 'sheet') sheet(opt)
  else if (cmd === 'frames') await dumpFrames(opt)
  else if (cmd === 'drift') await drift(opt)
  else if (cmd === 'report') report(opt)
  else if (cmd === 'points') await points(opt)
  else {
    console.log('команды: scan | sheet | frames | drift (см. начало файла)')
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
