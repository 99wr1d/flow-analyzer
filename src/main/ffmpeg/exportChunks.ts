// Куски выходного видео для параллельного экспорта (этап 18). Выходная лента делится на куски; каждый кодирует
// отдельный процесс ffmpeg со своим входом (-ss/-t), поэтому:
//   - куски кодируются одновременно на всех ядрах;
//   - в кусках без рисунков нет ни наложений, ни ключа «газон», ни лупы: тяжёлые фильтры работают только там, где они нужны;
//   - у подборки не декодируется то, что в неё не вошло: каждый кусок читает только свои секунды.
//
// Всё считается в НОМЕРАХ КАДРОВ исходника (ровная частота кадров). Отрезок экспорта приводится к целым кадрам по тому же
// правилу, по которому планируются кадры анимации (planAnimation), а границы между кусками ставятся на середины кадров:
// T(k) = (k − 0.5)/fps — граница между кадрами k−1 и k, до начала кадра k − полкадра. Кадр не может «попасть в оба куска»
// или «ни в один» из-за погрешности: до ближайшего кадра с обеих сторон ровно полкадра.
// Чистые функции без запуска ffmpeg — проверяются юнит-тестами.
import type { OverlayPlan, OverlaySegment, RangePlan, AnimRun } from '../../shared/exportOverlays'

/** Допуск при переводе времени в номер кадра (как в planAnimation). */
const TOL = 1e-3
const EPS = 1e-6

/** Пропуск в исходнике, который проще продекодировать, чем открывать второй вход (как в chunks.ts). */
export const CHUNK_MAX_GAP_SECONDS = 12

/** Номер первого кадра, начало которого не раньше момента t (с допуском). */
export const firstFrameAtOrAfter = (t: number, fps: number): number =>
  Math.max(0, Math.ceil((t - TOL) * fps - EPS))

/** Граница между кадрами k−1 и k по серединам: полкадра до начала кадра k. */
export const boundaryBefore = (k: number, fps: number): number => (k - 0.5) / fps

/** Обычные кадры короче этого между двумя кусками с рисунками остаются в общем куске (см. planChunks). */
export const CHUNK_BRIDGE_SECONDS = 4

/** Окно показа (лупы и т. п.) в секундах исходного видео. */
export interface TimeWindow {
  from: number
  to: number
}

export interface ChunkPlanInput {
  plan: OverlayPlan
  fps: number
  /** Окна лупы «Отрезок»: в них нужна линза (тяжёлый фильтр), поэтому куски делятся по их краям. */
  loupeWindows?: readonly TimeWindow[]
  /** Сколько секунд результата в куске (больше не бывает, кроме куска из одной неделимой части). */
  targetSeconds: number
  /** Куски короче этого сливаются с соседними того же отрезка. По умолчанию 1.5 с, но не больше targetSeconds. */
  minSeconds?: number
  /** Пропуск в исходнике, при котором ещё читаем одним входом. */
  maxGap?: number
  /** Обычные кадры между двумя кусками с рисунками короче этого (секунды) не выделяются в отдельный кусок. */
  bridgeSeconds?: number
}

export interface PlannedChunk {
  index: number
  /** Подотрезки в порядке вывода (каждый — целое число кадров между серединами кадров) со своими стоп-кадрами. */
  ranges: RangePlan[]
  /** Сегменты рисунков, затрагивающие этот кусок. Границы, совпавшие с краем отрезка экспорта, приведены к краю подотрезка. */
  segments: OverlaySegment[]
  /** Ряды кадров анимации, обрезанные по куску. */
  runs: AnimRun[]
  /** Есть ли в куске что-то кроме обычных кадров: рисунки, лупа, анимация, стоп-кадр. */
  drawn: boolean
  /** Кадров исходника в куске (без повторов стоп-кадров). */
  sourceFrames: number
  /** Сколько секунд будет в готовом куске (с учётом стоп-кадров). */
  outputSeconds: number
}

export interface ChunkPlan {
  chunks: PlannedChunk[]
  /** Весь экспорт, приведённый к целым кадрам (для звука): те же отрезки и стоп-кадры, что в кусках, без деления. */
  ranges: RangePlan[]
  /** Секунд в результате целиком. */
  outputSeconds: number
}

interface FrameRange {
  /** Исходный отрезок плана. */
  source: RangePlan
  k0: number
  k1: number
}

interface Atom {
  range: number
  k0: number
  k1: number
  drawn: boolean
}

const frameCount = (a: { k0: number; k1: number }): number => a.k1 - a.k0

/** Объединение пересекающихся целочисленных интервалов [a, b). */
function mergeIntervals(items: Array<[number, number]>): Array<[number, number]> {
  const sorted = [...items].sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const out: Array<[number, number]> = []
  for (const [a, b] of sorted) {
    const last = out[out.length - 1]
    if (last && a <= last[1]) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** Отрезки плана, приведённые к целым кадрам: границы стоят на серединах кадров. Отрезки без кадров отбрасываются. */
export function normalizeRanges(plan: OverlayPlan, fps: number): FrameRange[] {
  const result: FrameRange[] = []
  for (const r of plan.ranges) {
    const k0 = Math.max(0, firstFrameAtOrAfter(r.start, fps))
    const k1 = firstFrameAtOrAfter(r.end, fps)
    if (k1 > k0) result.push({ source: r, k0, k1 })
  }
  return result
}

/** RangePlan для кадров [k0, k1) отрезка: стоп-кадры, чьи кадры внутри. */
function subRange(r: FrameRange, k0: number, k1: number, fps: number): RangePlan {
  return {
    start: boundaryBefore(k0, fps),
    end: boundaryBefore(k1, fps),
    freezes: r.source.freezes.filter((f) => f.frame >= k0 && f.frame < k1)
  }
}

/** Отрезки экспорта целиком, приведённые к целым кадрам (звук считается по ним же). */
export function wholeRanges(plan: OverlayPlan, fps: number): RangePlan[] {
  return normalizeRanges(plan, fps).map((r) => subRange(r, r.k0, r.k1, fps))
}

export function planChunks(input: ChunkPlanInput): ChunkPlan {
  const { plan, fps } = input
  const target = Math.max(1, Math.round(input.targetSeconds * fps))
  // Не меньше трёх кадров: кусок из одного кадра склейке (concat) не по зубам — у неё нулевая длительность.
  const minFrames = Math.max(
    3,
    Math.min(Math.round((input.minSeconds ?? 1.5) * fps), Math.ceil(target / 2))
  )
  const bridgeFrames = Math.round(
    Math.min(input.bridgeSeconds ?? CHUNK_BRIDGE_SECONDS, input.targetSeconds) * fps
  )
  const maxGap = input.maxGap ?? CHUNK_MAX_GAP_SECONDS
  const ranges = normalizeRanges(plan, fps)

  // Края сегментов, совпавшие с краем отрезка экспорта, переносятся на край приведённого отрезка
  // (иначе окно показа кончалось бы раньше последнего кадра — см. windowEnd в drawGraph.ts).
  const normalizedSegments: OverlaySegment[] = plan.segments.map((s) => {
    let { start, end } = s
    for (const r of ranges) {
      if (Math.abs(r.source.end - s.end) < 1e-6) end = boundaryBefore(r.k1, fps)
      if (Math.abs(r.source.start - s.start) < 1e-6) start = boundaryBefore(r.k0, fps)
    }
    return { ...s, start, end }
  })

  // Где нужны тяжёлые фильтры: интервалы кадров с запасом в кадр.
  const featureItems: Array<[number, number]> = []
  const pad = (a: number, b: number): [number, number] => [
    Math.floor(a * fps) - 1,
    Math.ceil(b * fps) + 1
  ]
  for (const s of normalizedSegments) featureItems.push(pad(s.start, s.end))
  for (const w of input.loupeWindows ?? []) featureItems.push(pad(w.from, w.to))
  for (const run of plan.animation.runs) featureItems.push([run.first - 1, run.last + 2])
  // Стоп-кадр окружается обычными кадрами не меньше minFrames с каждой стороны: одиночный кадр между границей куска
  // и стоп-кадром склейка потеряла бы (см. комментарий выше).
  for (const r of ranges)
    for (const f of r.source.freezes)
      featureItems.push([f.frame - minFrames, f.frame + 1 + minFrames])
  const features = mergeIntervals(featureItems)
  const isDrawn = (k0: number, k1: number): boolean => {
    const mid = (k0 + k1) / 2
    return features.some(([a, b]) => mid >= a && mid < b)
  }

  // Атомы: части отрезков между краями рисунков.
  let atoms: Atom[] = []
  ranges.forEach((r, ri) => {
    const cuts = new Set<number>([r.k0, r.k1])
    for (const [a, b] of features) {
      if (a > r.k0 && a < r.k1) cuts.add(a)
      if (b > r.k0 && b < r.k1) cuts.add(b)
    }
    const sorted = [...cuts].sort((x, y) => x - y)
    for (let i = 0; i + 1 < sorted.length; i += 1) {
      const k0 = sorted[i]
      const k1 = sorted[i + 1]
      atoms.push({ range: ri, k0, k1, drawn: isDrawn(k0, k1) })
    }
  })

  // Длинные атомы делятся на ровные части не длиннее цели. Границу не ставим за кадр до стоп-кадра: у куска остался бы
  // один обычный кадр перед стоп-кадром, а такой кусок склейка (concat) теряет (см. комментарий к minFrames).
  const freezeFrames = new Set<number>()
  for (const r of ranges) for (const f of r.source.freezes) freezeFrames.add(f.frame)
  atoms = atoms.flatMap((a) => {
    const n = frameCount(a)
    const parts = Math.ceil(n / target)
    if (parts <= 1) return [a]
    const size = Math.ceil(n / parts)
    const bounds = [a.k0]
    for (let k = a.k0 + size; k < a.k1; k += size) {
      const p = freezeFrames.has(k + 1) ? k + 1 : k
      if (p > bounds[bounds.length - 1] && p < a.k1) bounds.push(p)
    }
    bounds.push(a.k1)
    return bounds.slice(0, -1).map((k0, i) => ({ ...a, k0, k1: bounds[i + 1] }))
  })

  // Слишком короткие атомы сливаются с соседом из того же отрезка (с более похожим, а если оба такие — с более коротким).
  for (;;) {
    let idx = -1
    for (let i = 0; i < atoms.length; i += 1) {
      const prev = atoms[i - 1]?.range === atoms[i].range ? atoms[i - 1] : null
      const next = atoms[i + 1]?.range === atoms[i].range ? atoms[i + 1] : null
      // Обычные кадры между двумя кусками с рисунками дешевле пронести через общий граф, чем запускать ради них ещё
      // один процесс ffmpeg (запуск, перемотка, инициализация кодера — порядка секунды), поэтому «мостики» короче
      // bridgeFrames сливаются с рисунками.
      const bridged = !atoms[i].drawn && prev?.drawn && next?.drawn
      if (frameCount(atoms[i]) >= (bridged ? Math.max(minFrames, bridgeFrames) : minFrames))
        continue
      if (prev || next) {
        idx = i
        break
      }
    }
    if (idx < 0) break
    const a = atoms[idx]
    const prev = atoms[idx - 1]?.range === a.range ? atoms[idx - 1] : null
    const next = atoms[idx + 1]?.range === a.range ? atoms[idx + 1] : null
    let into: 'prev' | 'next'
    if (prev && next) {
      const sameP = prev.drawn === a.drawn
      const sameN = next.drawn === a.drawn
      if (sameP !== sameN) into = sameP ? 'prev' : 'next'
      else into = frameCount(prev) <= frameCount(next) ? 'prev' : 'next'
    } else into = prev ? 'prev' : 'next'
    if (into === 'prev' && prev) {
      prev.k1 = a.k1
      prev.drawn = prev.drawn || a.drawn
    } else if (next) {
      next.k0 = a.k0
      next.drawn = next.drawn || a.drawn
    }
    atoms.splice(idx, 1)
  }

  // Упаковка атомов в куски: один вид (с рисунками / без), не длиннее цели, пропуск в исходнике небольшой.
  const groups: Atom[][] = []
  let current: Atom[] = []
  let currentFrames = 0
  let lastEnd = 0 // секунды исходника, где кончился последний атом
  for (const a of atoms) {
    const start = boundaryBefore(a.k0, fps)
    const first = current[0]
    const fits =
      first !== undefined &&
      first.drawn === a.drawn &&
      currentFrames + frameCount(a) <= target &&
      start - lastEnd <= maxGap &&
      start >= lastEnd - 1e-9
    if (!fits && current.length > 0) {
      groups.push(current)
      current = []
      currentFrames = 0
    }
    current.push(a)
    currentFrames += frameCount(a)
    lastEnd = boundaryBefore(a.k1, fps)
  }
  if (current.length > 0) groups.push(current)

  const chunks: PlannedChunk[] = groups.map((group, index) => {
    // Подряд идущие атомы одного отрезка сливаются в один подотрезок.
    const subs: Array<{ range: number; k0: number; k1: number }> = []
    for (const a of group) {
      const last = subs[subs.length - 1]
      if (last && last.range === a.range && last.k1 === a.k0) last.k1 = a.k1
      else subs.push({ range: a.range, k0: a.k0, k1: a.k1 })
    }
    const rangePlans = subs.map((s) => subRange(ranges[s.range], s.k0, s.k1, fps))
    const sourceFrames = subs.reduce((n, s) => n + s.k1 - s.k0, 0)
    // Сегмент нужен куску, если окно показа накрывает середину хотя бы одного его кадра: середина первого кадра —
    // start + 1/fps, последнего — end (граница на полкадра раньше начала следующего кадра). Допуск — миллисекунда.
    const eps = 1e-3
    const segments = normalizedSegments.filter((s) =>
      rangePlans.some((r) => s.start <= r.end + eps && s.end > r.start + 1 / fps - eps)
    )
    const runs = mergeIntervals(
      subs.flatMap((s) =>
        plan.animation.runs
          .map((run): [number, number] => [
            Math.max(run.first, s.k0),
            Math.min(run.last, s.k1 - 1) + 1
          ])
          .filter(([a, b]) => b > a)
      )
    ).map(([a, b]): AnimRun => ({ first: a, last: b - 1 }))
    const freezeSeconds = rangePlans.reduce(
      (sum, r) => sum + r.freezes.reduce((s, f) => s + f.seconds, 0),
      0
    )
    const hasLoupe = (input.loupeWindows ?? []).some((w) =>
      rangePlans.some((r) => w.from < r.end && w.to > r.start)
    )
    return {
      index,
      ranges: rangePlans,
      segments,
      runs,
      drawn:
        group.some((a) => a.drawn) ||
        runs.length > 0 ||
        hasLoupe ||
        freezeSeconds > 0 ||
        rangePlans.some((r) => r.freezes.length > 0),
      sourceFrames,
      outputSeconds: sourceFrames / fps + freezeSeconds
    }
  })

  const whole = ranges.map((r) => subRange(r, r.k0, r.k1, fps))
  return {
    chunks,
    ranges: whole,
    outputSeconds:
      whole.reduce((s, r) => s + (r.end - r.start), 0) +
      whole.reduce((s, r) => s + r.freezes.reduce((q, f) => q + f.seconds, 0), 0)
  }
}

/** Сколько секунд исходника прочитают и декодируют куски вместе (для сравнения с обычным запуском и для отчётов). */
export function decodedSecondsOf(chunks: readonly PlannedChunk[]): number {
  return chunks.reduce((sum, c) => {
    const start = Math.min(...c.ranges.map((r) => r.start))
    const end = Math.max(...c.ranges.map((r) => r.end))
    return sum + (end - start)
  }, 0)
}
