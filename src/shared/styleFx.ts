// Время-зависимые эффекты рисунков (0.18): пульс «мишени» и проявление линии.
// Зависят только от времени видео, поэтому экран, перемотка и экспорт дают одну и ту же картинку для одного кадра.
import { DOT_STEP, dotLayout } from './tools/curve'
import type { Annotation } from './annotations'

/** Период пульса, секунд. */
export const PULSE_PERIOD = 1.5
/** Если отрезок короче времени проявления, линия прорисовывается за эту долю отрезка. */
export const REVEAL_MAX_SHARE = 0.8

/** Рисунок с пульсом: кольцо/круг, у которых пульс включён и есть отрезок показа («только кадр» — стоп-кадр без волны). */
export function pulseActive(a: Annotation): boolean {
  return (a.type === 'circle' || a.type === 'ring') && a.pulse === true && a.timing.mode === 'range'
}

/** Рисунок меняется со временем без ключей: пульсирует или проявляется (экспорт рисует такие покадрово). */
export function isTimeVarying(a: Annotation): boolean {
  if (pulseActive(a)) return true
  return 'reveal' in a && a.reveal !== undefined && a.timing.mode === 'range'
}

/**
 * Доля пути, уже прорисованная в момент t (0..1). Нет поля reveal — 1 (целиком).
 * Отсчёт от начала отрезка; если отрезок короче N, N ужимается до 80% отрезка.
 * В режиме «кадр» рисунок виден одним кадром — проявления нет, линия целиком.
 */
export function revealFraction(a: Annotation, t: number): number {
  if (!('reveal' in a) || a.reveal === undefined || a.timing.mode !== 'range') return 1
  const n = Math.min(a.reveal, REVEAL_MAX_SHARE * a.timing.duration)
  if (!(n > 0)) return 1
  return Math.min(1, Math.max(0, (t - a.timing.start) / n))
}

/**
 * Число ступеней фазы пульса за период. Фаза округляется вниз до ступени, поэтому картинок пульса за период не больше
 * PULSE_STEPS при любой частоте кадров (29,97 и 59,94 тоже): экспорт рисует каждую один раз и берёт из кэша. Волна
 * идёт ~27 ступеней в секунду — глазом не отличить от плавной.
 */
export const PULSE_STEPS = 40

/** Фаза пульса в момент t: 0 (волна у центра) .. 1 (у края), период PULSE_PERIOD, ступенями по 1/PULSE_STEPS. Всегда в [0, 1). */
export function pulsePhase(t: number): number {
  const x = (((t % PULSE_PERIOD) + PULSE_PERIOD) % PULSE_PERIOD) / PULSE_PERIOD
  return x >= 1 ? 0 : Math.floor(x * PULSE_STEPS) / PULSE_STEPS
}

/** Ореол: во сколько раз его вылет за край обводки больше толщины обводки. */
export const GLOW_REACH = 2
/** Слоёв в стопке ореола. */
export const GLOW_LAYERS = 8
/** Непрозрачность одного слоя: у самой обводки накапливается около 15%, к краю ореола спадает до 2%. */
export const GLOW_ALPHA = 0.02
/** Толщина обводки, меньше которой ореол не считается (иначе у тончайшей линии ореол был бы незаметен). */
const GLOW_MIN_CORE = 2

export interface GlowLayer {
  /** Толщина линии слоя, пиксели. */
  width: number
  opacity: number
}

/**
 * Ореол свечения «стопкой» полупрозрачных линий того же цвета (вместо SVG-размытия: быстро и одинаково на экране и в экспорте).
 * Слои от внешнего (самый широкий) к внутреннему. base — толщина линии, вдоль которой кладётся ореол
 * (для обводки по оси — её толщина, для кромки контура — 0); corePx — толщина видимой обводки.
 */
export function glowStack(base: number, corePx: number, boost = 1): GlowLayer[] {
  const reach = GLOW_REACH * Math.max(corePx, GLOW_MIN_CORE)
  const layers: GlowLayer[] = []
  for (let i = GLOW_LAYERS; i >= 1; i -= 1) {
    layers.push({ width: base + (2 * reach * i) / GLOW_LAYERS, opacity: GLOW_ALPHA * boost })
  }
  return layers
}

export interface TextShadowLayer {
  /** Сдвиг вниз, пиксели. */
  dy: number
  /** Толщина тёмной каймы вокруг букв, пиксели. */
  width: number
  opacity: number
}

/**
 * Тень подписи без плашки «стопкой» тёмных копий текста (без SVG-фильтра: одинаково на экране и в экспорте).
 * От широкой мягкой к узкой плотной; вместе дают тонкую тёмную кайму, чуть смещённую вниз.
 */
export function textShadowLayers(fontPx: number): TextShadowLayer[] {
  return [
    { dy: fontPx * 0.07, width: fontPx * 0.2, opacity: 0.22 },
    { dy: fontPx * 0.05, width: fontPx * 0.12, opacity: 0.35 },
    { dy: fontPx * 0.03, width: fontPx * 0.05, opacity: 0.55 }
  ]
}

/** «Мишень»: радиусы колец относительно внешнего. */
export const TARGET_RADII = [1, 0.66, 0.33] as const
/** «Мишень»: непрозрачность заливки в центре (к краю спадает до 0). Заливка — главное в мишени, линии еле заметны. */
export const TARGET_CENTER_ALPHA = 0.55
/** «Мишень»: толщина линий колец относительно обычного кольца (тонкие, как граница зон). */
export const TARGET_LINE_SCALE = 0.35
/** «Мишень»: непрозрачность колец от внешнего к центру. */
export const TARGET_RING_OPACITY = [0.3, 0.45, 0.6] as const
/**
 * «Мишень»: профиль заливки — мягкие зоны между кольцами (ступеньки у радиусов 0.33 и 0.66): центр светлее всего,
 * к краю тает до нуля (смещение от центра к краю, доля непрозрачности центра).
 */
export const TARGET_FILL_STOPS = [
  { offset: 0, alpha: 1 },
  { offset: 0.28, alpha: 0.95 },
  { offset: 0.38, alpha: 0.6 },
  { offset: 0.6, alpha: 0.55 },
  { offset: 0.72, alpha: 0.3 },
  { offset: 0.94, alpha: 0.25 },
  { offset: 1, alpha: 0 }
] as const
/** Волна пульса: радиус относительно внешнего кольца в фазе phase (0..1). */
export const waveScale = (phase: number): number => Math.min(1, Math.max(0, phase))
/** Волна пульса: непрозрачность линии в фазе phase — мягкая, тает к краю. */
export const waveOpacity = (phase: number): number => 0.65 * (1 - Math.min(1, Math.max(0, phase)))
/** Волна пульса: толщина линии относительно обычного кольца. */
export const WAVE_LINE_SCALE = 1.2

/** Рисунок — «мишень» (а не кольцо). */
export const isTarget = (a: { look?: string }): boolean => a.look === 'target'

export type DashKind = 'solid' | 'dashed' | 'dotted'

/**
 * Штриховка экранной линии: strokeDasharray и форма концов. «Штрих» — 2.4 и 1.8 толщины, обрубленные концы;
 * «Точки» — круглые точки толщиной с линию (нулевой штрих с круглыми концами), шаг ≈ 2.5 толщины, подогнанный так,
 * чтобы точка лежала на обоих концах (у короткой линии их не меньше двух; предела числа точек нет — это лишь два числа). Это обычная штриховка: проявление обрезает путь
 * по длине, а не через неё. length — длина линии в пикселях (нужна только точкам).
 */
export function dashStyle(
  dash: DashKind,
  width: number,
  length: number,
  closed = false
): { array: string | undefined; cap: 'butt' | 'round' } {
  if (dash === 'solid') return { array: undefined, cap: 'round' }
  if (dash === 'dashed') return { array: `${width * 2.4} ${width * 1.8}`, cap: 'butt' }
  if (!(length > 0)) return { array: undefined, cap: 'round' }
  const { gaps, spacing } = dotLayout(length, width * DOT_STEP, closed, Infinity)
  // Последняя точка сдвинута на 0.02 px внутрь линии: нулевой штрих ровно на её конце иногда не рисуется.
  const period = closed ? spacing : (length - 0.02) / gaps
  return { array: `0.001 ${Math.max(0.001, period - 0.001)}`, cap: 'round' }
}

/** Светящаяся линия: толщина светлого ядра относительно толщины линии. */
export const LINE_CORE_SCALE = 0.45
/** Светящаяся линия: насколько ядро светлее цвета (доля пути к белому). */
export const LINE_CORE_LIGHTEN = 0.55

/** Цвет #rrggbb, подмешанный к белому на долю k (0 — исходный, 1 — белый). Не #rrggbb возвращается как есть. */
export function lighten(color: string, k: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color)
  if (!m) return color
  const n = parseInt(m[1], 16)
  const mix = (c: number): string =>
    Math.round(c + (255 - c) * k)
      .toString(16)
      .padStart(2, '0')
  return `#${mix((n >> 16) & 255)}${mix((n >> 8) & 255)}${mix(n & 255)}`
}

/** Светящаяся линия: ореол шире, чем у кольца (во сколько раз), и плотнее (во сколько раз): тонкая линия иначе почти не светится. */
export const LINE_GLOW_REACH = 1.7
export const LINE_GLOW_BOOST = 2.4

/** Ореол светящейся линии толщиной w пикселей (ось — вдоль линии). */
export const lineGlowStack = (w: number): GlowLayer[] =>
  glowStack(w, w * LINE_GLOW_REACH, LINE_GLOW_BOOST)

/** Цвет светлого ядра светящейся линии. */
export const lineCoreColor = (color: string): string => lighten(color, LINE_CORE_LIGHTEN)

/**
 * Сколько точек пунктира на поле видно при доле проявления frac: первые floor(frac·count), по порядку вдоль линии.
 * Целиком (frac ≥ 1) — все.
 */
export const revealedDotCount = (count: number, frac: number): number =>
  frac >= 1 ? count : Math.max(0, Math.min(count, Math.floor(frac * count)))
