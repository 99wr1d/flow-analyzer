// Анимация рисунков (этап 16б): ключевые кадры с линейной или плавной интерполяцией геометрии.
// Чистые функции без зависимостей от интерфейса — их используют экран, сохранение проекта и экспорт.
//
// Правила:
//  * Анимируется только геометрия (положение и форма): точки, центр/радиус, управляющая точка кривой, вершины, якорь
//    подписи, источник/линза лупы. Стиль и свойства (цвет, толщина, затемнение…) одинаковы весь рисунок.
//  * Между соседними ключами геометрия меняется линейно; ease ключа — переход от него к следующему:
//    «ease» (по умолчанию) — сглаженный (smoothstep), «linear» — равномерный. До первого и после последнего ключа
//    геометрия стоит на месте.
//  * В самом рисунке остаётся геометрия первого ключа — так старый код (хит-тесты, статистика) продолжает работать.
//  * Время ключей — середина кадра (frameCenter), ключ в том же кадре, что и новая правка, обновляется.
//  * Показ: рисунок с ключами всегда в режиме «Отрезок». Отрезок сам не сжимается, но растягивается, чтобы
//    охватить все ключи (добавление и сдвиг ключей); «Убрать анимацию» отрезок не меняет.
import {
  DEFAULT_EASE,
  MAX_DURATION,
  MAX_KEYFRAMES,
  MIN_DURATION,
  defaultDuration,
  frameCenter,
  type Annotation,
  type AnnotationType,
  type Ease,
  type Timing
} from './annotations'
import { isTimeVarying } from './styleFx'

export type Geom = Record<string, unknown>
export interface Keyframe {
  t: number
  ease?: Ease
  /** Ключ поставлен слежением за игроком; нет поля — ручной. */
  auto?: true
  geom: Geom
}

/** Поля геометрии по видам рисунков (на экране — доли кадра, на поле — метры). */
export const GEOM_FIELDS: Record<AnnotationType, readonly string[]> = {
  arrow: ['p1', 'p2'],
  line: ['p1', 'p2'],
  circle: ['p1', 'p2'],
  spot: ['p1', 'p2'],
  curve: ['p1', 'p2', 'c'],
  pen: ['points'],
  zone: ['points'],
  chain: ['points'],
  link: ['points'],
  text: ['pos'],
  loupe: ['pos', 'src'],
  ring: ['center', 'radius'],
  parrow: ['p1', 'p2'],
  pline: ['p1', 'p2'],
  ruler: ['p1', 'p2'],
  ptext: ['pos'],
  pspot: ['center', 'radius'],
  pcurve: ['p1', 'p2', 'c'],
  ppen: ['points'],
  pzone: ['points'],
  pchain: ['points'],
  plink: ['points']
}

export function keysOf(a: object): Keyframe[] {
  return (a as { keyframes?: Keyframe[] }).keyframes ?? []
}

/** Есть ли у рисунка ключи (включая единственный: «анимация включена», движения ещё нет). */
export const isAnimated = (a: object): boolean => keysOf(a).length > 0
/** Рисунок действительно движется: ключей не меньше двух. */
export const isMoving = (a: object): boolean => keysOf(a).length >= 2

/** Геометрия рисунка (только нужные поля). */
export function geomOf(a: Annotation): Geom {
  const out: Geom = {}
  const src = a as unknown as Record<string, unknown>
  for (const name of GEOM_FIELDS[a.type]) out[name] = src[name]
  return out
}

/** Ease перехода от ключа. */
export const easeOf = (k: Keyframe): Ease => k.ease ?? DEFAULT_EASE

/** Сглаживание: 0 → 0, 1 → 1, плавный разгон и торможение. */
export const smoothstep = (u: number): number => u * u * (3 - 2 * u)

/** Доля пути u (0..1) с учётом сглаживания. */
export const shapeProgress = (u: number, ease: Ease): number =>
  ease === 'linear' ? u : smoothstep(u)

function lerpValue(a: unknown, b: unknown, u: number): unknown {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * u
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return a
    return a.map((x, i) => lerpValue(x, b[i], u))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out: Record<string, unknown> = {}
    const bb = b as Record<string, unknown>
    for (const [k, v] of Object.entries(a as Record<string, unknown>)) {
      out[k] = k in bb ? lerpValue(v, bb[k], u) : v
    }
    return out
  }
  return a
}

/** Между какими ключами лежит момент t: [i, u] — ключ i и доля пути до i+1 (с учётом ease); null — вне ключей (стоим на месте). */
export function segmentAt(
  keys: ReadonlyArray<{ t: number; ease?: Ease }>,
  t: number
): { index: number; u: number; hold?: boolean } {
  if (keys.length === 0) return { index: -1, u: 0, hold: true }
  if (t <= keys[0].t) return { index: 0, u: 0, hold: true }
  const last = keys.length - 1
  if (t >= keys[last].t) return { index: last, u: 0, hold: true }
  // Двоичный поиск: последний ключ с t_i <= t.
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (keys[mid].t <= t) lo = mid
    else hi = mid
  }
  const span = keys[lo + 1].t - keys[lo].t
  const raw = span > 0 ? (t - keys[lo].t) / span : 0
  return {
    index: lo,
    u: shapeProgress(Math.min(1, Math.max(0, raw)), keys[lo].ease ?? DEFAULT_EASE)
  }
}

/** Геометрия рисунка в момент t (секунды видео). Без ключей — собственная геометрия рисунка. */
export function geomAt(a: Annotation, t: number): Geom {
  const keys = keysOf(a)
  if (keys.length === 0) return geomOf(a)
  const seg = segmentAt(keys, t)
  if (seg.hold) return keys[seg.index].geom
  return lerpValue(keys[seg.index].geom, keys[seg.index + 1].geom, seg.u) as Geom
}

const resolved = new WeakMap<object, { t: number; out: Annotation }>()

/**
 * Рисунок с геометрией на момент t. Рисунок без движения возвращается как есть (та же ссылка), поэтому
 * мемоизация компонентов не ломается; движущийся пересчитывается один раз на момент t.
 */
export function resolveAt<T extends Annotation>(a: T, t: number): T {
  if (!isMoving(a)) return a
  const cached = resolved.get(a)
  if (cached && cached.t === t) return cached.out as T
  const out = { ...a, ...geomAt(a, t) } as T
  resolved.set(a, { t, out })
  return out
}

/** Погрешность сравнения момента с ключом: полкадра. */
export const keyTolerance = (fps: number): number => 0.5 / (fps > 0 ? fps : 25)

/** Номер ключа, находящегося в кадре момента t, или -1. */
export function keyIndexAt(a: object, t: number, fps: number): number {
  const keys = keysOf(a)
  const tol = keyTolerance(fps)
  let best = -1
  let bestDist = Infinity
  keys.forEach((k, i) => {
    const d = Math.abs(k.t - t)
    if (d <= tol + 1e-9 && d < bestDist) {
      best = i
      bestDist = d
    }
  })
  return best
}

/** Соседний ключ: dir = -1 — ближайший раньше момента t (на полкадра и больше), +1 — позже. null — нет. */
export function neighbourKey(a: object, t: number, dir: 1 | -1, fps: number): number | null {
  const keys = keysOf(a)
  const tol = keyTolerance(fps)
  if (dir > 0) {
    const i = keys.findIndex((k) => k.t > t + tol)
    return i >= 0 ? i : null
  }
  for (let i = keys.length - 1; i >= 0; i -= 1) if (keys[i].t < t - tol) return i
  return null
}

/** Отрезок, расширенный так, чтобы охватить все ключи (никогда не сжимается). Рисунок «Кадр» не меняется. */
export function extendRange(timing: Timing, keys: readonly Keyframe[]): Timing {
  if (timing.mode !== 'range' || keys.length === 0) return timing
  const start = Math.min(timing.start, keys[0].t)
  const end = Math.max(timing.start + timing.duration, keys[keys.length - 1].t)
  if (start >= timing.start - 1e-9 && end <= timing.start + timing.duration + 1e-9) return timing
  const duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, end - start))
  return { mode: 'range', start, duration }
}

/** Записывает ключи: геометрия рисунка = геометрия первого ключа, отрезок охватывает ключи. */
export function withKeys<T extends Annotation>(a: T, keys: Keyframe[]): T {
  if (keys.length === 0) {
    const { keyframes: _removed, ...rest } = a as T & { keyframes?: unknown }
    void _removed
    return rest as T
  }
  return {
    ...a,
    ...keys[0].geom,
    keyframes: keys,
    timing: extendRange(a.timing, keys)
  } as T
}

/** «Анимировать»: первый ключ в момент t из текущей геометрии. «Кадр» становится отрезком от этого момента. */
export function startAnimation<T extends Annotation>(
  a: T,
  t: number,
  fps: number,
  videoDuration: number
): T {
  if (isAnimated(a)) return a
  const kt = frameCenter(t, fps)
  let timing = a.timing
  if (timing.mode === 'frame') {
    const start = timing.start
    timing = { mode: 'range', start, duration: defaultDuration(start, videoDuration) }
  }
  return withKeys({ ...a, timing } as T, [{ t: kt, geom: geomOf(a) }])
}

/** Ключ с геометрией geom в кадре момента t: обновляет существующий или создаёт новый (по порядку времени). */
export function upsertKey<T extends Annotation>(a: T, t: number, geom: Geom, fps: number): T {
  const keys = [...keysOf(a)]
  const at = keyIndexAt(a, t, fps)
  if (at >= 0) {
    // Ключ, который поправил тренер, больше не «слежение»: пересчёт его не заменит.
    const { auto: _auto, ...manual } = keys[at]
    void _auto
    keys[at] = { ...manual, geom }
    return withKeys(a, keys)
  }
  if (keys.length >= MAX_KEYFRAMES) return a
  const kt = frameCenter(t, fps)
  const next: Keyframe = { t: kt, geom }
  const pos = keys.findIndex((k) => k.t > kt)
  if (pos < 0) keys.push(next)
  else keys.splice(pos, 0, next)
  return withKeys(a, keys)
}

/** «Ключ здесь»: новый ключ в кадре момента t с текущей (интерполированной) геометрией. Если ключ там уже есть — без изменений. */
export function addKeyHere<T extends Annotation>(a: T, t: number, fps: number): T {
  if (!isAnimated(a) || keyIndexAt(a, t, fps) >= 0) return a
  return upsertKey(a, t, geomAt(a, t), fps)
}

/** Удаляет ключ с номером index. Последний ключ убирает анимацию (геометрия остаётся как была у него). */
export function removeKey<T extends Annotation>(a: T, index: number): T {
  const keys = keysOf(a)
  if (index < 0 || index >= keys.length) return a
  if (keys.length === 1) return withKeys({ ...a, ...keys[0].geom } as T, [])
  return withKeys(
    a,
    keys.filter((_, i) => i !== index)
  )
}

/** Сдвигает ключ index на момент t (кадр середины), не пересекая соседей: между ними остаётся хотя бы кадр. */
export function retimeKey<T extends Annotation>(a: T, index: number, t: number, fps: number): T {
  const keys = keysOf(a)
  if (index < 0 || index >= keys.length) return a
  const frame = 1 / (fps > 0 ? fps : 25)
  const lo = index > 0 ? keys[index - 1].t + frame - 1e-9 : 0
  const hi = index < keys.length - 1 ? keys[index + 1].t - frame + 1e-9 : Infinity
  if (lo > hi) return a
  let kt = frameCenter(Math.max(0, t), fps)
  if (kt < lo) kt = lo
  if (kt > hi) kt = hi
  // Не вышли за соседей из-за округления до кадра.
  if (kt < lo - 1e-9 || kt > hi + 1e-9) return a
  if (Math.abs(kt - keys[index].t) < 1e-9) return a
  // Сдвинутый руками ключ теряет auto (см. upsertKey).
  const next = keys.map((k, i) => {
    if (i !== index) return k
    const { auto: _auto, ...manual } = k
    void _auto
    return { ...manual, t: kt }
  })
  return withKeys(a, next)
}

/** Переход от ключа index к следующему: плавно / равномерно. */
export function setKeyEase<T extends Annotation>(a: T, index: number, ease: Ease): T {
  const keys = keysOf(a)
  if (index < 0 || index >= keys.length || easeOf(keys[index]) === ease) return a
  return withKeys(
    a,
    keys.map((k, i) => (i === index ? { ...k, ease } : k))
  )
}

/** «Убрать анимацию»: рисунок застывает в геометрии момента t. */
export function flatten<T extends Annotation>(a: T, t: number): T {
  if (!isAnimated(a)) return a
  return withKeys({ ...a, ...geomAt(a, t) } as T, [])
}

const sameGeom = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/**
 * Правка рисунка в момент t. edited — рисунок после правки (его геометрия посчитана от рисунка на момент t).
 * Без ключей — просто edited. С ключами: ключ в кадре t обновляется, а если ключа нет — создаётся (автоключ).
 * Если геометрия не изменилась, рисунок остаётся прежним.
 */
export function applyGeomEdit<T extends Annotation>(
  stored: T,
  edited: T,
  t: number,
  fps: number
): T {
  if (!isAnimated(stored)) return edited
  const geom = geomOf(edited)
  if (sameGeom(geom, geomAt(stored, t))) return stored
  return upsertKey(stored, t, geom, fps)
}

type VertexList = Array<{ x: number; y: number }>

function mapPoints<T extends Annotation>(a: T, fn: (points: VertexList) => VertexList): T {
  const base = (a as unknown as { points?: VertexList }).points
  if (!base) return a
  const keys = keysOf(a).map((k) => ({
    ...k,
    geom: { ...k.geom, points: fn(k.geom.points as VertexList) }
  }))
  const out = { ...a, points: fn(base) } as T
  return keys.length > 0 ? ({ ...out, keyframes: keys } as T) : out
}

/**
 * Вставляет вершину перед номером index во все ключи (и в сам рисунок): в каждом ключе она лежит на звене между
 * соседними вершинами на доле f пути — так вершина «едет» вместе с остальными.
 */
export function insertVertexAllKeys<T extends Annotation>(a: T, index: number, f: number): T {
  return mapPoints(a, (points) => {
    const n = points.length
    const prev = points[(index - 1 + n) % n]
    const next = points[index % n]
    const p = { x: prev.x + (next.x - prev.x) * f, y: prev.y + (next.y - prev.y) * f }
    const copy = [...points]
    copy.splice(index, 0, p)
    return copy
  })
}

/** Убирает вершину index из всех ключей (и из самого рисунка). */
export function removeVertexAllKeys<T extends Annotation>(a: T, index: number): T {
  return mapPoints(a, (points) => points.filter((_, i) => i !== index))
}

/** Времена ключей рисунка (пусто — рисунок не анимирован). */
export const keyTimes = (a: object): number[] => keysOf(a).map((k) => k.t)

/**
 * Номера рисунков, которые меняются от кадра к кадру (для экспорта: у них своя дорожка кадров):
 * движутся по ключам или зависят от времени (пульс, проявление).
 */
export function movingIndices(items: readonly Annotation[]): number[] {
  const out: number[] = []
  items.forEach((a, i) => {
    if (isMoving(a) || isTimeVarying(a)) out.push(i)
  })
  return out
}
