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
  FOOT_LIFT,
  linkTrackToKeys,
  mergeTrackedKeys,
  pitchToScreenForTracking,
  thinTrack,
  thinTracks,
  trackToKeys,
  type TrackSample
} from '../../../../shared/tracking/keys'
import type { DetectorBackend } from '../../../../shared/tracking/detectorIpc'
import {
  estimateSeconds,
  FALLBACK_FPS,
  type FractionBox,
  type StopReason
} from '../../../../shared/tracking/trackingIpc'
import { PILLAR_WIDTH_SHARE } from '../../../../shared/tools/pillar'
import { ru } from '../../i18n/ru'
import { formatTime } from '../player/format'

/** Рисунки, у которых есть кнопка «Следить за игроком» (у связки — «Следить за игроками»). */
const TRACKABLE: ReadonlySet<AnnotationType> = new Set([
  'circle',
  'spot',
  'text',
  'ring',
  'pspot',
  'link',
  'plink'
])

/** Связка (на экране или на поле): слежение ведёт сразу все её точки. */
export const isLinkType = (a: Pick<Annotation, 'type'>): boolean =>
  a.type === 'link' || a.type === 'plink'

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

/** Точки рисунка, по которым ищутся «его» игроки на стартовом кадре: у связки — все её точки, у остальных — одна. */
export function anchorsOfGeom(a: Annotation, geom: Geom): Pt[] {
  if (isLinkType(a)) {
    const points = (geom as { points?: Pt[] }).points ?? []
    return points.map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }))
  }
  return [anchorOfGeom(a, geom)]
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
  /** Якоря по целям: у связки — все точки на кадре «at», иначе один. */
  anchors: Pt[]
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

  const anchors = anchorsOfGeom(base, geomAt(base, at))
  if (anchors.length === 0) return { ok: false, reason: 'not-trackable' }
  const replaceCount = mergeTrackedKeys(keysOf(base), [], at).replacedManual
  return {
    ok: true,
    mode,
    from,
    at,
    to,
    anchors,
    replaceCount,
    base,
    convertedFromPitch: converted
  }
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

/**
 * Сообщение об остановке слежения. У связки (link) называет точку (target с нуля → «Точка N»); «моего игрока тут нет» —
 * отдельный текст: остановка по ответу тренера, а не потеря.
 */
export function stopMessage(
  stop: { t: number; reason: StopReason; target?: number },
  link = false
): string {
  const point = (stop.target ?? 0) + 1
  if (stop.reason === 'not-here') return link ? ru.tracking.notHereLink(point) : ru.tracking.notHere
  const time = formatTime(stop.t, { tenths: true })
  const reason = ru.tracking.reasons[stop.reason]
  return link ? ru.tracking.lostLink(point, time, reason) : ru.tracking.lost(time, reason)
}

/**
 * Вопрос после неудачного старта (ambiguous-start): выбор из нескольких рамок или «две точки на одном игроке» (cause
 * same-player от задачи): выбирать нечего, надо развести точки. Меньше двух рамок без причины тоже выбирать не из чего.
 */
export function startAskKind(failure: {
  cause?: 'same-player'
  candidates?: readonly FractionBox[]
}): 'pick' | 'same-player' {
  if (failure.cause === 'same-player') return 'same-player'
  return failure.candidates && failure.candidates.length >= 2 ? 'pick' : 'same-player'
}

/** Метка точки в вопросе на ходу: у ног цели (низ её текущей рамки с тем же подъёмом, что у точек связки). */
export function footMarker(box: FractionBox): Pt {
  return { x: clamp01(box.x + box.w / 2), y: clamp01(box.y + box.h - FOOT_LIFT * box.h) }
}

/**
 * «Продолжить слежение» связки от ручной правки: правилась одна точка, а остальные в этом ключе стоят там, где были на
 * предыдущем (старом) ключе. Тогда перед продолжением стоит их проверить.
 */
export function staleOtherPoints(a: Annotation, fps: number): boolean {
  if (!isLinkType(a)) return false
  const keys = keysOf(a)
  if (keys.length < 2) return false
  const last = keys[keys.length - 1]
  const prev = keys[keys.length - 2]
  if (last.auto || last.t - prev.t < 3 / (fps > 0 ? fps : FALLBACK_FPS)) return false
  const now = (last.geom as { points?: Pt[] }).points ?? []
  const old = (prev.geom as { points?: Pt[] }).points ?? []
  if (now.length !== old.length) return false
  const same = now.map((p, i) => Math.hypot(p.x - old[i].x, p.y - old[i].y) < 1e-6)
  return same.some(Boolean) && !same.every(Boolean)
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

/** Плоскость следа столба относительно его ширины (высота/ширина в пикселях). */
const PILLAR_FOOTING_RATIO = 0.35

/**
 * Столб стоит на ногах игрока: низ овала — точка ног (с тем же подъёмом FOOT_LIFT, что у кольца и точек связки: рамка детектора
 * заходит ниже подошв), ширина столба ≈ ширине фигуры. Если столб, как его поставил тренер, уже стоит у ног игрока и по ширине
 * подходит, размер остаётся, а низ-середина встаёт точно к ногам (смещение щелчка не тянется за игроком всё слежение);
 * иначе овал заменяется следом под ногами. Только пока нет ключей.
 */
function footPillar(a: Annotation, ref: TrackSample, at: number, aspect: number): Annotation {
  if (a.type !== 'spot' || keysOf(a).length > 0) return a
  const g = geomAt(a, at) as unknown as Box2
  const figureW = (ref.height * FIGURE_ASPECT) / aspect
  const footY = ref.foot.y - FOOT_LIFT * ref.height
  const cx = (g.p1.x + g.p2.x) / 2
  const rx0 = Math.abs(g.p2.x - g.p1.x) / 2
  const bottom = Math.max(g.p1.y, g.p2.y)
  const width = 2 * rx0 * PILLAR_WIDTH_SHARE
  const placed =
    Math.abs(bottom - footY) <= 0.15 * ref.height &&
    Math.abs(cx - ref.foot.x) <= 0.5 * figureW &&
    width >= 0.6 * figureW &&
    width <= 1.6 * figureW
  const rx = placed ? rx0 : figureW / 2 / PILLAR_WIDTH_SHARE
  const h = placed ? Math.abs(g.p2.y - g.p1.y) : 2 * rx * aspect * PILLAR_FOOTING_RATIO
  return {
    ...a,
    p1: { x: ref.foot.x - rx, y: footY - h },
    p2: { x: ref.foot.x + rx, y: footY }
  } as Annotation
}

/**
 * Прожектор накрывает всю фигуру игрока, а не только ноги: если овал, как его нарисовал тренер, не накрывает фигуру
 * на стартовом кадре, он заменяется овалом вокруг фигуры. Прожектор с лучом (с поля) не трогаем: луч поднимается сам.
 */
function coverFigure(a: Annotation, ref: TrackSample, at: number, aspect: number): Annotation {
  if (a.type === 'spot' && a.form === 'pillar') return footPillar(a, ref, at, aspect)
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

/**
 * Ширина кольца у ног в долях высоты рамки игрока: кольцо плотно охватывает ноги. Рамка детектора с запасом выше самой фигуры
 * (по проверке на трансляции — ~1.3 роста), поэтому 0.72 рамки ≈ 0.9 видимого роста.
 */
export const RING_WIDTH_OF_HEIGHT = 0.72
/** Подъём центра кольца над низом рамки (доли высоты рамки): рамка заходит ниже подошв. */
export const RING_LIFT = FOOT_LIFT

/**
 * Кольцо (экранный круг без ключей), от которого начинают слежение: центр — точка ног игрока (низ рамки), ширина ≈ 0.9 роста
 * игрока, сплющивание (высота/ширина в пикселях) остаётся как у кольца. Перецентрируется ТОЛЬКО новое кольцо у ног: экранный круг,
 * не переведённый с поля, со свойством glow (создан в 0.18) и шириной не больше 1.5 высоты рамки. Остальное (кольцо с поля,
 * старый круг 0.17, большой круг на группу, уже анимированный руками) остаётся как нарисовал тренер (смещение и масштаб).
 */
export function fitRing(
  a: Annotation,
  ref: TrackSample,
  at: number,
  aspect: number,
  convertedFromPitch: boolean
): Annotation {
  if (a.type !== 'circle' || a.glow === undefined || convertedFromPitch || keysOf(a).length > 0)
    return a
  const g = geomAt(a, at) as unknown as Box2
  const w = Math.abs(g.p2.x - g.p1.x) * aspect
  const h = Math.abs(g.p2.y - g.p1.y)
  if (!(w > 0) || !(ref.height > 0) || w > 1.5 * ref.height) return a
  const ratio = h / w
  const rx = (RING_WIDTH_OF_HEIGHT * ref.height) / 2 / aspect
  const ry = rx * aspect * ratio
  const cy = ref.foot.y - RING_LIFT * ref.height
  return {
    ...a,
    p1: { x: ref.foot.x - rx, y: cy - ry },
    p2: { x: ref.foot.x + rx, y: cy + ry }
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
 * Траектории → ключи рисунка. current — рисунок сейчас (его ручные ключи сохраняются), plan — как был запущен расчёт,
 * tracks — траектории по целям (у кольца одна, у связки по одной на точку). Для рисунка «на поле» вместо current берётся
 * plan.base (рисунок уже переведён в экранный). Число ключей гарантированно не больше MAX_KEYFRAMES: допуск прореживания
 * растёт, пока не уложимся (у связки прореживание идёт по всем точкам сразу — моменты ключей общие).
 */
export function applyTrackResult(
  current: Annotation,
  tracks: readonly (readonly TrackSample[])[],
  plan: TrackPlan,
  opts: ApplyOptions
): ApplyResult {
  if (tracks.length === 0 || tracks.some((t) => t.length === 0))
    return { ok: false, reason: 'empty' }
  const aspect = opts.aspect && opts.aspect > 0 ? opts.aspect : 16 / 9
  const src0 = plan.convertedFromPitch ? plan.base : current
  const link = isLinkType(src0)
  const lead = tracks[0]
  const ref = nearestSample(lead, plan.at)
  // Связка: точки сами встают к ногам (в первом ключе); кольцо и прожектор подгоняются под фигуру.
  const src = link
    ? src0
    : fitRing(
        coverFigure(src0, ref, plan.at, aspect),
        ref,
        plan.at,
        aspect,
        plan.convertedFromPitch
      )
  const existing = keysOf(src)
  const keysOfTracks = (ts: readonly (readonly TrackSample[])[], tolerance?: number): Keyframe[] =>
    link
      ? linkTrackToKeys(tolerance === undefined ? ts : thinTracks(ts, tolerance))
      : trackToKeys(src, tolerance === undefined ? ts[0] : thinTrack(ts[0], tolerance), plan.at)

  // Ручные ключи-опоры после места: если игрок там далеко от ручного положения (по любой точке) — останавливаемся перед ними.
  let usable: readonly (readonly TrackSample[])[] = tracks
  let diverged: { t: number } | undefined
  if (existing.some((k) => k.auto)) {
    const probe = { ...src, keyframes: keysOfTracks(tracks) } as Annotation
    for (const m of existing) {
      if (m.auto || m.t <= plan.at + KEY_EPS) continue
      if (m.t > lead[lead.length - 1].t + KEY_EPS) break
      const tracked = anchorsOfGeom(src, geomAt(probe, m.t))
      const manual = anchorsOfGeom(src, m.geom)
      const off = manual.some((q, i) => {
        const p = tracked[i]
        const track = tracks[Math.min(i, tracks.length - 1)]
        return (
          p !== undefined &&
          dist(p, q, aspect) > nearestSample(track, m.t).height * DIVERGE_HEIGHT_FRACTION
        )
      })
      if (off) {
        diverged = { t: m.t }
        usable = tracks.map((t) => t.filter((s) => s.t < m.t - KEY_EPS))
        break
      }
    }
  }
  if (usable.some((t) => t.length === 0)) return { ok: false, reason: 'diverged', diverged }

  let tolerance = DEFAULT_THIN_TOLERANCE
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const tracked: Keyframe[] = keysOfTracks(usable, tolerance)
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
