// Слежение за игроком: чистая часть. План (откуда и докуда), перевод траектории в ключи рисунка, сообщения.
// Без интерфейса и IPC: всё проверяется юнит-тестами (trackingActions.test.ts).
import {
  KEY_EPS,
  MAX_KEYFRAMES,
  type Annotation,
  type AnnotationType
} from '../../../../shared/annotations'
import {
  geomAt,
  keyIndexAt,
  keysOf,
  withKeys,
  type Geom,
  type Keyframe
} from '../../../../shared/animation'
import type { Calibration } from '../../../../shared/pitch/calibration'
import {
  DEFAULT_THIN_TOLERANCE,
  mergeTrackedKeys,
  pitchToScreenForTracking,
  thinTrack,
  trackToKeys,
  type TrackSample
} from '../../../../shared/tracking/keys'
import type { DetectorBackend } from '../../../../shared/tracking/detectorIpc'
import {
  estimateSeconds,
  FALLBACK_FPS,
  type StopReason
} from '../../../../shared/tracking/trackingIpc'
import { ru } from '../../i18n/ru'
import { formatTime } from '../player/format'

/** Рисунки, у которых есть кнопка «Следить за игроком». */
const TRACKABLE: ReadonlySet<AnnotationType> = new Set(['circle', 'spot', 'text', 'ring', 'pspot'])

/** Есть ли у рисунка кнопка слежения: подходящий вид и отрезок («Только кадр» — нет). */
export function canTrack(a: Annotation): boolean {
  return TRACKABLE.has(a.type) && a.timing.mode === 'range'
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))

interface Pt {
  x: number
  y: number
}

/** Точка рисунка, по которой ищется «его» игрок на стартовом кадре. */
export function anchorOfGeom(a: Annotation, geom: Geom): Pt {
  const g = geom as Record<string, Pt | undefined>
  if (a.type === 'text') {
    const pos = g.pos ?? { x: 0.5, y: 0.5 }
    // Подпись стоит над головой: опускаем точку на высоту строки с запасом — к фигуре под подписью.
    const size = (a as { style: { size: number } }).style.size
    return { x: clamp01(pos.x), y: clamp01(pos.y + size * 1.5) }
  }
  const p1 = g.p1 ?? { x: 0.5, y: 0.5 }
  const p2 = g.p2 ?? p1
  return { x: clamp01((p1.x + p2.x) / 2), y: clamp01((p1.y + p2.y) / 2) }
}

export interface PlanContext {
  /** Середина текущего кадра. */
  now: number
  fps: number
  videoDuration: number
  /** Разметка поля, на которую ссылается рисунок «на поле» (иначе null). */
  calibration: Calibration | null
}

export type PlanFailure = 'not-trackable' | 'outside' | 'too-short' | 'no-calibration'

export interface TrackPlan {
  ok: true
  /** start — с текущего кадра; continue — с последнего ключа до конца растянутого отрезка. */
  mode: 'start' | 'continue'
  /** Начало первого кадра задачи (секунды видео): с него декодер отдаёт кадры. */
  from: number
  /** Середина этого кадра: момент, в который рисунок стоит относительно игрока. */
  at: number
  to: number
  anchor: Pt
  /** Сколько ручных ключей после места слежение заменит (вопрос тренеру). */
  replaceCount: number
  /** Рисунок для слежения (рисунок «на поле» уже переведён в экранный). */
  base: Annotation
  convertedFromPitch: boolean
}

/** Длина отрезка, которую слежение должно покрыть, минимум в кадрах. */
const MIN_FRAMES = 1.5

/**
 * Если у рисунка есть ключи слежения, а отрезок растянут дальше последнего ключа, — момент последнего ключа
 * (с него начинается «Продолжить слежение»). Иначе null. Если текущий кадр (now) стоит на ручном ключе —
 * тренер поправил рисунок и хочет следить именно отсюда: продолжения нет, слежение пойдёт с текущего кадра.
 */
export function continueFrom(a: Annotation, fps: number, now?: number): number | null {
  if (a.timing.mode !== 'range') return null
  const keys = keysOf(a)
  if (!keys.some((k) => k.auto)) return null
  if (now !== undefined) {
    const here = keyIndexAt(a, now, fps > 0 ? fps : FALLBACK_FPS)
    if (here >= 0 && !keys[here].auto) return null
  }
  const last = keys[keys.length - 1]
  const end = a.timing.start + a.timing.duration
  return end - last.t > MIN_FRAMES / (fps > 0 ? fps : FALLBACK_FPS) ? last.t : null
}

export function planTracking(
  a: Annotation,
  ctx: PlanContext
): TrackPlan | { ok: false; reason: PlanFailure } {
  if (!canTrack(a) || a.timing.mode !== 'range') return { ok: false, reason: 'not-trackable' }
  const fps = ctx.fps > 0 ? ctx.fps : FALLBACK_FPS
  const end = a.timing.start + a.timing.duration
  const frame = 1 / fps

  let base = a
  let converted = false
  if (a.space === 'pitch') {
    if (!ctx.calibration) return { ok: false, reason: 'no-calibration' }
    base = pitchToScreenForTracking(a, ctx.calibration, ctx.now)
    if (base.space === 'pitch') return { ok: false, reason: 'no-calibration' }
    converted = true
  }

  const resume = continueFrom(base, fps, ctx.now)
  let at: number
  let mode: 'start' | 'continue'
  if (resume !== null) {
    mode = 'continue'
    at = resume
  } else {
    mode = 'start'
    at = ctx.now
    if (at < a.timing.start - 0.5 * frame || at >= end) return { ok: false, reason: 'outside' }
  }
  const from = Math.max(0, at - 0.5 * frame)
  const to = ctx.videoDuration > 0 ? Math.min(end, ctx.videoDuration) : end
  if (to - from < MIN_FRAMES * frame) return { ok: false, reason: 'too-short' }

  const anchor = anchorOfGeom(base, geomAt(base, at))
  const replaceCount = mergeTrackedKeys(keysOf(base), [], at).replacedManual
  return { ok: true, mode, from, at, to, anchor, replaceCount, base, convertedFromPitch: converted }
}

/** Бэкенд последнего законченного слежения в этом сеансе программы (до первого запуска неизвестен). */
let lastBackend: DetectorBackend | null = null
export function rememberBackend(backend: DetectorBackend | null): void {
  lastBackend = backend
}

/** Оценка времени расчёта, секунд: по бэкенду прошлого запуска, до первого запуска — худший случай (процессор). */
export function planSeconds(plan: TrackPlan, fps: number): number {
  return Math.round(estimateSeconds(plan.to - plan.from, lastBackend ?? 'wasm', fps))
}

/** Сообщение об остановке слежения. */
export function stopMessage(stop: { t: number; reason: StopReason }): string {
  return ru.tracking.lost(formatTime(stop.t, { tenths: true }), ru.tracking.reasons[stop.reason])
}

export interface ApplyOptions {
  fps: number
  /** Ширина кадра / высота кадра (для овала прожектора). */
  aspect?: number
}

export type ApplyResult =
  | { ok: true; annotation: Annotation; diverged?: { t: number } }
  | { ok: false; reason: 'empty' | 'too-many' | 'diverged'; diverged?: { t: number } }

/** Ширина фигуры игрока в долях его высоты (в пикселях): запас с учётом рук. */
const FIGURE_ASPECT = 0.45
/** Запас овала прожектора вокруг фигуры. */
const COVER_MARGIN = 1.08
/** Расхождение с ручным ключом, при котором слежение останавливается: доля роста игрока. */
const DIVERGE_HEIGHT_FRACTION = 0.5

type Box2 = { p1: Pt; p2: Pt }

/**
 * Прожектор накрывает всю фигуру игрока, а не только ноги: если овал, как его нарисовал тренер, не накрывает фигуру
 * на стартовом кадре, он заменяется овалом вокруг фигуры. Прожектор с лучом (с поля) не трогаем: луч поднимается сам.
 */
function coverFigure(a: Annotation, ref: TrackSample, at: number, aspect: number): Annotation {
  if (a.type !== 'spot' || a.beam) return a
  const g = geomAt(a, at) as unknown as Box2
  const cx = (g.p1.x + g.p2.x) / 2
  const cy = (g.p1.y + g.p2.y) / 2
  const rx = Math.max(Math.abs(g.p2.x - g.p1.x) / 2, 1e-6)
  const ry = Math.max(Math.abs(g.p2.y - g.p1.y) / 2, 1e-6)
  const halfW = (ref.height * FIGURE_ASPECT) / (2 * aspect)
  const top = ref.foot.y - ref.height
  const bottom = ref.foot.y
  const corners = [
    { x: ref.foot.x - halfW, y: top },
    { x: ref.foot.x + halfW, y: top },
    { x: ref.foot.x - halfW, y: bottom },
    { x: ref.foot.x + halfW, y: bottom }
  ]
  const covered = corners.every((c) => ((c.x - cx) / rx) ** 2 + ((c.y - cy) / ry) ** 2 <= 1 + 1e-9)
  if (covered) return a
  // Овал вокруг прямоугольника фигуры: полуоси в √2 раз больше полусторон.
  const mx = ref.foot.x
  const my = (top + bottom) / 2
  const nx = halfW * Math.SQRT2 * COVER_MARGIN
  const ny = ((bottom - top) / 2) * Math.SQRT2 * COVER_MARGIN
  const next = {
    ...a,
    p1: { x: mx - nx, y: my - ny },
    p2: { x: mx + nx, y: my + ny }
  } as Annotation
  const keys = keysOf(a)
  // У рисунка ещё нет ключей слежения на этом месте: новая форма — геометрия рисунка и всех его ключей до слежения.
  return keys.length === 0 ? next : a
}

/** Ширина кольца у ног в долях высоты рамки игрока: кольцо плотно охватывает ноги. */
export const RING_WIDTH_OF_HEIGHT = 0.9

/**
 * Кольцо (экранный круг без ключей), от которого начинают слежение: центр — точка ног игрока (низ рамки), ширина ≈ 0.9 роста
 * игрока, сплющивание (высота/ширина в пикселях) остаётся как у кольца. Кольцо, уже анимированное руками, не трогаем.
 */
function fitRing(a: Annotation, ref: TrackSample, at: number, aspect: number): Annotation {
  if (a.type !== 'circle' || keysOf(a).length > 0) return a
  const g = geomAt(a, at) as unknown as Box2
  const w = Math.abs(g.p2.x - g.p1.x) * aspect
  const h = Math.abs(g.p2.y - g.p1.y)
  if (!(w > 0) || !(ref.height > 0)) return a
  const ratio = h / w
  const rx = (RING_WIDTH_OF_HEIGHT * ref.height) / 2 / aspect
  const ry = rx * aspect * ratio
  return {
    ...a,
    p1: { x: ref.foot.x - rx, y: ref.foot.y - ry },
    p2: { x: ref.foot.x + rx, y: ref.foot.y + ry }
  } as Annotation
}

/**
 * Ключ, поставленный руками (по умолчанию его переход «плавный»), перед ключами слежения идёт равномерно: иначе на длинном
 * прореженном участке рисунок отстаёт от игрока в начале перехода и обгоняет в конце.
 */
function straightenFromPlace(keys: Keyframe[], at: number): Keyframe[] {
  return keys.map((k, i) =>
    !k.auto && k.t >= at - KEY_EPS && keys[i + 1]?.auto && k.ease !== 'linear'
      ? { ...k, ease: 'linear' as const }
      : k
  )
}

/** Расстояние в долях высоты кадра с поправкой на пропорции (x — доли ширины). */
const dist = (p: Pt, q: Pt, aspect: number): number => Math.hypot((p.x - q.x) * aspect, p.y - q.y)

const nearestSample = (samples: readonly TrackSample[], t: number): TrackSample => {
  let best = samples[0]
  for (const s of samples) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s
  return best
}

/**
 * Траектория → ключи рисунка. current — рисунок сейчас (его ручные ключи сохраняются), plan — как был запущен расчёт.
 * Для рисунка «на поле» вместо current берётся plan.base (рисунок уже переведён в экранный).
 * Число ключей гарантированно не больше MAX_KEYFRAMES: допуск прореживания растёт, пока не уложимся.
 */
export function applyTrackResult(
  current: Annotation,
  samples: readonly TrackSample[],
  plan: TrackPlan,
  opts: ApplyOptions
): ApplyResult {
  if (samples.length === 0) return { ok: false, reason: 'empty' }
  const aspect = opts.aspect && opts.aspect > 0 ? opts.aspect : 16 / 9
  const src0 = plan.convertedFromPitch ? plan.base : current
  const ref = nearestSample(samples, plan.at)
  const src = fitRing(coverFigure(src0, ref, plan.at, aspect), ref, plan.at, aspect)
  const existing = keysOf(src)

  // Ручные ключи-опоры после места: если игрок там далеко от ручного положения — останавливаемся перед ними.
  let usable = samples
  let diverged: { t: number } | undefined
  if (existing.some((k) => k.auto)) {
    const full = trackToKeys(src, samples, plan.at)
    const probe = { ...src, keyframes: full } as Annotation
    for (const m of existing) {
      if (m.auto || m.t <= plan.at + KEY_EPS) continue
      if (m.t > samples[samples.length - 1].t + KEY_EPS) break
      const tracked = anchorOfGeom(src, geomAt(probe, m.t))
      const manual = anchorOfGeom(src, m.geom)
      const height = nearestSample(samples, m.t).height
      if (dist(tracked, manual, aspect) > height * DIVERGE_HEIGHT_FRACTION) {
        diverged = { t: m.t }
        usable = samples.filter((s) => s.t < m.t - KEY_EPS)
        break
      }
    }
  }
  if (usable.length === 0) return { ok: false, reason: 'diverged', diverged }

  let tolerance = DEFAULT_THIN_TOLERANCE
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const tracked: Keyframe[] = trackToKeys(src, thinTrack(usable, tolerance), plan.at)
    const merged = mergeTrackedKeys(existing, tracked, plan.at)
    if (merged.keys.length <= MAX_KEYFRAMES) {
      let all = merged.keys
      if (diverged) {
        // Старое слежение после ручной опоры не трогаем: пересчитано только до неё.
        const anchor = diverged.t
        const kept = existing.filter((k) => k.auto && k.t > anchor + KEY_EPS)
        all = [...merged.keys, ...kept].sort((x, y) => x.t - y.t)
        if (all.length > MAX_KEYFRAMES) {
          tolerance *= 1.5
          continue
        }
      }
      const keys = straightenFromPlace(all, plan.at)
      return { ok: true, annotation: withKeys(src, keys), ...(diverged ? { diverged } : {}) }
    }
    tolerance *= 1.5
  }
  return { ok: false, reason: 'too-many' }
}
