// План рисунков для экспорта: на каких отрезках времени какой набор рисунков виден и где нужны стоп-кадры.
// Чистые функции. Один и тот же код считает план и в интерфейсе (какие картинки рисовать), и в main
// (куда их наложить), поэтому набор рисунков описывается ключом — перечнем номеров рисунков («3-7-12»):
// main берёт картинку по ключу и не может перепутать её с другой.
import { isVisible, type Timing } from './annotations'

/** Сколько различных наборов рисунков (картинок-наложений) можно отправить за один экспорт. */
export const MAX_OVERLAY_IMAGES = 300
/** Допуск при сравнении времени кадра с границей отрезка, секунд. */
const TOL = 1e-3
const EPS = 1e-6
/** Сегменты короче этого не нужны: в них не попадёт ни один кадр. */
const MIN_SEGMENT = 1e-4

export interface TimeRange {
  start: number
  end: number
}

/** Отрезок исходного видео, на котором виден один и тот же набор «отрезковых» рисунков. */
export interface OverlaySegment extends TimeRange {
  key: string
}

/** Стоп-кадр: кадр с серединой в момент time замирает на seconds секунд. */
export interface FreezePoint {
  /** Время середины кадра (как у рисунков «только кадр»). */
  time: number
  /** Номер кадра (с 0). */
  frame: number
  seconds: number
  key: string
  /** Номера движущихся (анимированных) рисунков, видимых в этом кадре: их картинка кадра замирает вместе с ним. */
  animated?: number[]
}

/** Кадр, в котором видны движущиеся рисунки: для него рисуется своя картинка. */
export interface AnimFrame {
  /** Номер кадра исходного видео (с 0). */
  frame: number
  /** Номера движущихся рисунков, видимых в кадре. */
  members: number[]
}

/** Непрерывный набор кадров с движущимися рисунками: один входной ряд картинок ffmpeg. */
export interface AnimRun {
  first: number
  last: number
}

/** Кадры с движущимися рисунками: у них картинка на каждый кадр (а не одна на отрезок). */
export interface AnimPlan {
  frames: AnimFrame[]
  runs: AnimRun[]
}

export interface RangePlan extends TimeRange {
  freezes: FreezePoint[]
}

export interface OverlayPlan {
  segments: OverlaySegment[]
  ranges: RangePlan[]
  /** Различные ключи (в порядке появления): по одной картинке на каждый. */
  keys: string[]
  /** Сколько секунд добавляют стоп-кадры ко всем отрезкам. */
  freezeSeconds: number
  /** Движущиеся рисунки: покадровые картинки. */
  animation: AnimPlan
}

export const keyOf = (indices: readonly number[]): string => indices.join('-')

/** Номера рисунков из ключа. null — ключ некорректен. */
export function parseKey(key: string): number[] | null {
  if (!/^\d+(-\d+)*$/.test(key)) return null
  return key.split('-').map(Number)
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6

/** Объединение пересекающихся и соприкасающихся отрезков. */
export function mergeRanges(ranges: readonly TimeRange[]): TimeRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end)
  const out: TimeRange[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r.start <= last.end + EPS) last.end = Math.max(last.end, r.end)
    else out.push({ start: r.start, end: r.end })
  }
  return out
}

/** Номер кадра, в котором лежит момент time (так же, как frameCenter). */
export const frameIndex = (time: number, fps: number): number =>
  Math.floor(Math.max(0, time) * fps + EPS)

/**
 * Сегменты: по отрезкам, которые попадают в экспорт, находим интервалы, где набор видимых рисунков
 * «Отрезок» не меняется и не пуст. Соседние интервалы с одним набором склеиваются.
 */
export function planSegments(
  timings: readonly Timing[],
  ranges: readonly TimeRange[],
  skip?: ReadonlySet<number>
): OverlaySegment[] {
  const items: Array<{ index: number; start: number; end: number }> = []
  timings.forEach((t, index) => {
    if (skip?.has(index)) return
    if (t.mode === 'range') items.push({ index, start: t.start, end: t.start + t.duration })
  })
  if (items.length === 0) return []

  const result: OverlaySegment[] = []
  for (const u of mergeRanges(ranges)) {
    const points = new Set<number>([round6(u.start), round6(u.end)])
    for (const it of items) {
      for (const p of [it.start, it.end]) if (p > u.start && p < u.end) points.add(round6(p))
    }
    const sorted = [...points].sort((a, b) => a - b)
    for (let i = 0; i + 1 < sorted.length; i += 1) {
      const from = sorted[i]
      const to = sorted[i + 1]
      if (to - from < MIN_SEGMENT) continue
      const mid = (from + to) / 2
      const members = items.filter((it) => it.start <= mid && mid < it.end).map((it) => it.index)
      if (members.length === 0) continue
      const key = keyOf(members)
      const last = result[result.length - 1]
      if (last && last.key === key && Math.abs(last.end - from) < MIN_SEGMENT) last.end = to
      else result.push({ start: from, end: to, key })
    }
  }
  return result
}

interface FrameGroup {
  frame: number
  indices: number[]
  seconds: number
}

/** Рисунки «Только кадр» по кадрам; длина стоп-кадра — наибольшая из рисунков кадра. */
export function groupFrameDrawings(timings: readonly Timing[], fps: number): FrameGroup[] {
  const groups = new Map<number, FrameGroup>()
  timings.forEach((t, index) => {
    if (t.mode !== 'frame') return
    const frame = frameIndex(t.start, fps)
    const g = groups.get(frame)
    if (g) {
      g.indices.push(index)
      g.seconds = Math.max(g.seconds, t.freezeSeconds)
    } else {
      groups.set(frame, { frame, indices: [index], seconds: t.freezeSeconds })
    }
  })
  return [...groups.values()].sort((a, b) => a.frame - b.frame)
}

/** Центр кадра с номером frame. */
export const frameTime = (frame: number, fps: number): number => (frame + 0.5) / fps

/**
 * Полный план. timings — рисунки в порядке наложения (первый — самый нижний).
 * ranges — отрезки, которые попадают в экспорт (в порядке вывода; могут пересекаться из-за запаса по краям).
 */
export function planOverlays(
  timings: readonly Timing[],
  ranges: readonly TimeRange[],
  fps: number,
  /** Номера движущихся рисунков: они идут отдельно, покадровыми картинками. */
  animated: ReadonlySet<number> = NO_ANIMATED
): OverlayPlan {
  const safeFps = fps > 0 ? fps : 25
  const segments = planSegments(timings, ranges, animated)
  const groups = groupFrameDrawings(timings, safeFps)
  const rangeItems = timings
    .map((t, index) => ({ t, index }))
    .filter((x) => x.t.mode === 'range' && !animated.has(x.index))
  const movingItems = timings
    .map((t, index) => ({ t, index }))
    .filter((x) => x.t.mode === 'range' && animated.has(x.index))

  const keys: string[] = []
  const seen = new Set<string>()
  const addKey = (key: string): void => {
    if (!seen.has(key)) {
      seen.add(key)
      keys.push(key)
    }
  }
  segments.forEach((s) => addKey(s.key))

  let freezeSeconds = 0
  const rangePlans: RangePlan[] = ranges.map((r) => {
    const freezes: FreezePoint[] = []
    for (const g of groups) {
      const time = frameTime(g.frame, safeFps)
      const frameStart = g.frame / safeFps
      // Кадр целиком в отрезке: его начало не раньше начала отрезка и раньше конца.
      if (frameStart < r.start - TOL || frameStart >= r.end - TOL) continue
      const members = [
        ...g.indices,
        ...rangeItems.filter((x) => isVisible({ timing: x.t }, time, safeFps)).map((x) => x.index)
      ].sort((a, b) => a - b)
      const key = keyOf(members)
      addKey(key)
      const moving = movingItems
        .filter((x) => isVisible({ timing: x.t }, time, safeFps))
        .map((x) => x.index)
      freezes.push({
        time,
        frame: g.frame,
        seconds: g.seconds,
        key,
        ...(moving.length > 0 ? { animated: moving } : {})
      })
      freezeSeconds += g.seconds
    }
    return { start: r.start, end: r.end, freezes }
  })
  const animation = planAnimation(movingItems, ranges, safeFps)
  return { segments, ranges: rangePlans, keys, freezeSeconds, animation }
}

const NO_ANIMATED: ReadonlySet<number> = new Set()

/**
 * Кадры с движущимися рисунками. В экспорт попадают кадры, чьё начало лежит внутри отрезка (так их вырезает ffmpeg);
 * движущийся рисунок виден в кадре, если середина кадра в его отрезке. Соседние кадры собираются в «ряды».
 */
export function planAnimation(
  items: ReadonlyArray<{ t: Timing; index: number }>,
  ranges: readonly TimeRange[],
  fps: number
): AnimPlan {
  const frames: AnimFrame[] = []
  const runs: AnimRun[] = []
  if (items.length === 0) return { frames, runs }
  for (const u of mergeRanges(ranges)) {
    const first = Math.ceil((u.start - TOL) * fps - EPS)
    const last = Math.ceil((u.end - TOL) * fps - EPS) - 1
    for (let f = Math.max(0, first); f <= last; f += 1) {
      const time = frameTime(f, fps)
      const members = items.filter((x) => isVisible({ timing: x.t }, time, fps)).map((x) => x.index)
      if (members.length === 0) continue
      frames.push({ frame: f, members })
      const run = runs[runs.length - 1]
      if (run && run.last === f - 1) run.last = f
      else runs.push({ first: f, last: f })
    }
  }
  return { frames, runs }
}

/** Длительность готового видео из отрезков (без стоп-кадров). */
export const rangesSeconds = (ranges: readonly TimeRange[]): number =>
  ranges.reduce((sum, r) => sum + (r.end - r.start), 0)

/** Длительность готового видео с учётом стоп-кадров. */
export const outputSeconds = (plan: OverlayPlan): number =>
  rangesSeconds(plan.ranges) + plan.freezeSeconds

/** Есть ли в экспортируемых отрезках хоть один рисунок. */
export const hasDrawings = (plan: OverlayPlan): boolean =>
  plan.keys.length > 0 || plan.animation.frames.length > 0

/**
 * Планы для набора готовых отрезков. «Отдельные файлы» — по плану на каждый отрезок (каждый файл со своими
 * рисунками); «Подборка» — один план на все отрезки сразу.
 */
export function planExport(
  clips: readonly TimeRange[],
  mode: 'files' | 'compilation',
  timings: readonly Timing[],
  fps: number,
  animated: ReadonlySet<number> = NO_ANIMATED
): OverlayPlan[] {
  return mode === 'files'
    ? clips.map((c) => planOverlays(timings, [c], fps, animated))
    : [planOverlays(timings, clips, fps, animated)]
}
