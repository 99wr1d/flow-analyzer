// Слежение за игроком: перевод траектории ног игрока в ключи рисунка (чистые функции, без интерфейса).
//
// Правила:
//  * TrackSample — положение ног игрока и высота его рамки на кадре (доли кадра); t — середина кадра (frameCenter).
//  * При старте запоминается смещение и масштаб рисунка относительно рамки игрока на кадре «at»: кольцо у ног
//    остаётся у ног, подпись над головой — над головой. Размер следует за высотой рамки (скользящее среднее
//    по 5 кадрам — без дрожания).
//  * Ключи слежения помечены auto: true, ease — linear. Ручные ключи (без auto) слежение не трогает:
//    пересчитываются только авто-ключи после текущего момента.
//  * Рисунки на поле для слежения переводятся в экранные (метры и привязка к разметке теряются).
import {
  KEY_EPS,
  LEGACY_RING_FILL,
  isUnderPlayers,
  type Annotation,
  type Circle,
  type Link,
  type Spotlight
} from '../annotations'
import { geomAt, type Geom, type Keyframe } from '../animation'
import type { Calibration } from '../pitch/calibration'
import { projectorFor } from '../pitch/calibration'
import { groundEllipseRatio } from '../pitch/ground'
import type { Pt } from '../pitch/linalg'

export interface TrackSample {
  /** Середина кадра, секунды видео. */
  t: number
  /** Точка между ногами игрока, доли кадра. */
  foot: { x: number; y: number }
  /** Высота рамки игрока, доли высоты кадра. */
  height: number
}

/** Допуск прореживания по умолчанию: 2,5 пикселя при высоте кадра 720. */
export const DEFAULT_THIN_TOLERANCE = 2.5 / 720
/**
 * Подъём центра кольца и точки связки над низом рамки (доли высоты рамки): рамка детектора заходит ниже подошв.
 * Кольцо (fitRing) и точки связки встают на одно и то же место.
 */
export const FOOT_LIFT = 0.07
/** Окно сглаживания высоты рамки, кадров. */
const SMOOTH_WINDOW = 5
/** Во сколько раз ошибка высоты рамки весит меньше ошибки положения ног (высота влияет на размер рисунка слабее). */
const HEIGHT_WEIGHT = 0.5

/**
 * Прореживание нескольких траекторий сразу (Дугласа–Пёкера по времени): кадр остаётся у ВСЕХ траекторий, если хотя бы у одной
 * положение ног (или рост рамки) иначе уходит от линейной интерполяции по времени дальше tolerance (доли кадра). Траектории
 * идут по одним и тем же кадрам (длина — по самой короткой); связка получает общий набор моментов для всех точек.
 */
export function thinTracks(
  tracks: readonly (readonly TrackSample[])[],
  tolerance: number = DEFAULT_THIN_TOLERANCE
): TrackSample[][] {
  if (tracks.length === 0) return []
  const n = Math.min(...tracks.map((t) => t.length))
  if (n <= 2) return tracks.map((t) => t.slice(0, n))
  const keep = new Array<boolean>(n).fill(false)
  keep[0] = true
  keep[n - 1] = true
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length > 0) {
    const [lo, hi] = stack.pop() as [number, number]
    if (hi - lo < 2) continue
    let worst = -1
    let worstErr = 0
    for (let i = lo + 1; i < hi; i += 1) {
      let err = 0
      for (const samples of tracks) {
        const a = samples[lo]
        const b = samples[hi]
        const p = samples[i]
        const span = b.t - a.t
        const u = span > 0 ? (p.t - a.t) / span : 0
        const dx = a.foot.x + (b.foot.x - a.foot.x) * u - p.foot.x
        const dy = a.foot.y + (b.foot.y - a.foot.y) * u - p.foot.y
        const dh = a.height + (b.height - a.height) * u - p.height
        err = Math.max(err, Math.hypot(dx, dy), Math.abs(dh) * HEIGHT_WEIGHT)
      }
      if (err > worstErr) {
        worstErr = err
        worst = i
      }
    }
    if (worst >= 0 && worstErr > tolerance) {
      keep[worst] = true
      stack.push([lo, worst], [worst, hi])
    }
  }
  return tracks.map((t) => t.slice(0, n).filter((_, i) => keep[i]))
}

/**
 * Прореживание траектории одного игрока: точка остаётся, если положение ног (и рост рамки) иначе уходит от линейной
 * интерполяции по времени дальше tolerance (доли кадра).
 */
export function thinTrack(
  samples: readonly TrackSample[],
  tolerance: number = DEFAULT_THIN_TOLERANCE
): TrackSample[] {
  return thinTracks([samples], tolerance)[0]
}

/** Скользящее среднее высоты рамки по окну SMOOTH_WINDOW (у краёв окно сужается). */
function smoothHeights(samples: readonly TrackSample[]): number[] {
  const half = (SMOOTH_WINDOW - 1) / 2
  return samples.map((_, i) => {
    const from = Math.max(0, i - half)
    const to = Math.min(samples.length - 1, i + half)
    let sum = 0
    for (let j = from; j <= to; j += 1) sum += samples[j].height
    return sum / (to - from + 1)
  })
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Точка геометрии: смещение от ног сохраняется и масштабируется; результат остаётся в допустимых для поля пределах. */
function placePoint(
  p: { x: number; y: number },
  foot0: { x: number; y: number },
  foot: { x: number; y: number },
  scale: number,
  loose: boolean
): { x: number; y: number } {
  const lo = loose ? -1 : 0
  const hi = loose ? 2 : 1
  return {
    x: clamp(foot.x + (p.x - foot0.x) * scale, lo, hi),
    y: clamp(foot.y + (p.y - foot0.y) * scale, lo, hi)
  }
}

const isPoint = (v: unknown): v is { x: number; y: number } =>
  !!v && typeof v === 'object' && typeof (v as Pt).x === 'number' && typeof (v as Pt).y === 'number'

function placeValue(
  v: unknown,
  foot0: { x: number; y: number },
  foot: { x: number; y: number },
  scale: number,
  loose: boolean
): unknown {
  if (isPoint(v)) return placePoint(v, foot0, foot, scale, loose)
  if (Array.isArray(v)) return v.map((x) => placeValue(x, foot0, foot, scale, loose))
  return v
}

/**
 * Ключи слежения для экранного рисунка. at — момент, в который рисунок нарисован относительно игрока
 * (берётся ближайший к нему сэмпл). Ключ — на каждом сэмпле; прореживание — отдельно (thinTrack).
 * Рисунки на поле сюда не попадают (сначала pitchToScreenForTracking): для них — пустой список.
 */
export function trackToKeys(
  a: Annotation,
  samples: readonly TrackSample[],
  at: number
): Keyframe[] {
  if (samples.length === 0 || a.space === 'pitch') return []
  const smooth = smoothHeights(samples)
  let ref = 0
  for (let i = 1; i < samples.length; i += 1) {
    if (Math.abs(samples[i].t - at) < Math.abs(samples[ref].t - at)) ref = i
  }
  const foot0 = samples[ref].foot
  const h0 = smooth[ref]
  const base = geomAt(a, at)
  const keys: Keyframe[] = []
  samples.forEach((s, i) => {
    if (keys.length > 0 && !(s.t - keys[keys.length - 1].t > KEY_EPS)) return
    const scale = h0 > 0 ? smooth[i] / h0 : 1
    const geom: Geom = {}
    for (const [name, value] of Object.entries(base)) {
      geom[name] = placeValue(value, foot0, s.foot, scale, name === 'c')
    }
    keys.push({ t: s.t, ease: 'linear', auto: true, geom })
  })
  return keys
}

/**
 * Ключи связки из N траекторий (по одной на точку): на каждом кадре каждая точка стоит у ног своего игрока — низ рамки,
 * поднятый на FOOT_LIFT сглаженной высоты, как у кольца (fitRing). Исходное смещение щелчка не сохраняется. Траектории идут
 * по одним и тем же кадрам; ключ — на каждом кадре (прореживание — отдельно, thinTracks).
 */
export function linkTrackToKeys(tracks: readonly (readonly TrackSample[])[]): Keyframe[] {
  if (tracks.length === 0) return []
  const n = Math.min(...tracks.map((t) => t.length))
  if (n === 0) return []
  const smooth = tracks.map((t) => smoothHeights(t.slice(0, n)))
  const keys: Keyframe[] = []
  for (let i = 0; i < n; i += 1) {
    const t = tracks[0][i].t
    if (keys.length > 0 && !(t - keys[keys.length - 1].t > KEY_EPS)) continue
    const points = tracks.map((samples, k) => ({
      x: clamp(samples[i].foot.x, 0, 1),
      y: clamp(samples[i].foot.y - FOOT_LIFT * smooth[k][i], 0, 1)
    }))
    keys.push({ t, ease: 'linear', auto: true, geom: { points } })
  }
  return keys
}

/**
 * Склейка ключей слежения с уже стоящими: авто-ключи с момента from заменяются новыми, ручные ключи остаются
 * (в одном и том же моменте побеждает ручной). Если у рисунка нет ни одного авто-ключа (до этого он анимирован
 * только руками), ручные ключи после from слежение заменяет — их число replacedManual интерфейс показывает в вопросе
 * «Заменить N ключей после этого места?».
 */
export function mergeTrackedKeys(
  existing: readonly Keyframe[],
  tracked: readonly Keyframe[],
  from: number
): { keys: Keyframe[]; replacedManual: number } {
  const hadAuto = existing.some((k) => k.auto)
  let replacedManual = 0
  const kept: Keyframe[] = []
  for (const k of existing) {
    if (k.t < from - KEY_EPS) {
      kept.push(k)
    } else if (k.auto) {
      // Авто-ключ с момента from и позже — старое слежение, заменяется.
    } else if (k.t > from + KEY_EPS && !hadAuto) {
      replacedManual += 1
    } else {
      kept.push(k)
    }
  }
  const fresh = tracked.filter(
    (k) => k.t >= from - KEY_EPS && !kept.some((m) => Math.abs(m.t - k.t) <= KEY_EPS)
  )
  const keys = [...kept, ...fresh].sort((x, y) => x.t - y.t)
  return { keys, replacedManual }
}

/** Точек на окружности при переводе кольца в эллипс на экране. */
const ELLIPSE_STEPS = 48

/**
 * Рисунок «На поле» → экранный рисунок для слежения (метры и привязка к разметке теряются):
 * кольцо → эллипс «под игроками» (вид на кадре по разметке), прожектор → экранный прожектор с лучом,
 * связка на поле → экранная связка (точки по разметке на момент t; подписи длин в метрах пропадают).
 * Геометрия берётся на момент t. Остальные рисунки (и если разметка не даёт вида) возвращаются как есть.
 */
export function pitchToScreenForTracking(a: Annotation, cal: Calibration, t: number): Annotation {
  if (a.type !== 'ring' && a.type !== 'pspot' && a.type !== 'plink') return a
  const proj = projectorFor(cal)
  if (!proj) return a
  if (a.type === 'plink') {
    const g = geomAt(a, t) as { points: Pt[] }
    const points: Pt[] = []
    for (const w of g.points) {
      const p = proj.toImage(w)
      if (!p) return a
      points.push({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, 1) })
    }
    const out: Link = {
      id: a.id,
      space: 'screen',
      type: 'link',
      points,
      closed: a.closed,
      fillOpacity: a.fillOpacity,
      rings: a.rings,
      style: a.style,
      ...(a.glow !== undefined ? { glow: a.glow } : {}),
      ...(a.underPlayers !== undefined ? { underPlayers: a.underPlayers } : {}),
      timing: a.timing
    }
    return out
  }
  const g = geomAt(a, t) as { center: Pt; radius: number }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < ELLIPSE_STEPS; i += 1) {
    const ang = (2 * Math.PI * i) / ELLIPSE_STEPS
    const p = proj.toImage({
      x: g.center.x + g.radius * Math.cos(ang),
      y: g.center.y + g.radius * Math.sin(ang)
    })
    if (!p) return a
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  let p1 = { x: clamp(minX, 0, 1), y: clamp(minY, 0, 1) }
  let p2 = { x: clamp(maxX, 0, 1), y: clamp(maxY, 0, 1) }
  const clipped = minX < 0 || minY < 0 || maxX > 1 || maxY > 1
  if (a.type === 'ring' && clipped && p2.x > p1.x) {
    // Кольцо на краю кадра: обрезка исказила бы эллипс. Ширину оставляем, высоту берём по разметке «как на траве» в центре.
    const cx = (p1.x + p2.x) / 2
    const cy = clamp((minY + maxY) / 2, 0, 1)
    const half = (groundEllipseRatio(cal, { x: cx, y: cy }) * (p2.x - p1.x) * cal.aspect) / 2
    p1 = { x: p1.x, y: clamp(cy - half, 0, 1) }
    p2 = { x: p2.x, y: clamp(cy + half, 0, 1) }
  }
  if (a.type === 'ring') {
    const out: Circle = {
      id: a.id,
      space: 'screen',
      type: 'circle',
      p1,
      p2,
      style: a.style,
      fillOpacity: a.fillOpacity ?? LEGACY_RING_FILL,
      ...(a.glow !== undefined ? { glow: a.glow } : {}),
      ...(a.look !== undefined ? { look: a.look } : {}),
      ...(a.pulse !== undefined ? { pulse: a.pulse } : {}),
      underPlayers: true,
      timing: a.timing
    }
    return out
  }
  const out: Spotlight = {
    id: a.id,
    space: 'screen',
    type: 'spot',
    p1,
    p2,
    dim: a.dim,
    ...(a.dimmed !== undefined ? { dimmed: a.dimmed } : {}),
    beam: a.beam,
    ...(a.form !== undefined ? { form: a.form } : {}),
    // Столб с поля остаётся под игроками, если лежал под ними.
    ...(a.form === 'pillar' ? { underPlayers: isUnderPlayers(a) } : {}),
    style: a.style,
    timing: a.timing
  }
  return out
}
