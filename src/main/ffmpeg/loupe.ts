// Лупа в экспорте: участок кадра вырезается (crop), увеличивается (scale), обрезается по кругу (прозрачность
// через маску-круг: alphamerge) и накладывается на кадр (overlay) на нужное время. Рамку и соединительную линию лупы рисует
// обычный PNG с рисунками — здесь только содержимое линзы. Чистые функции: ffmpeg не запускают.
import type { Ease } from '../../shared/annotations'
import { segmentAt } from '../../shared/animation'
import type { LoupeGeometry } from '../../shared/tools/loupe'

const num = (v: number): string => (Math.round(v * 1e4) / 1e4).toString()

/** Выражение для опции фильтра в одинарных кавычках: кавычки и обратная косая внутри выражения не допускаются. */
export function quoteExpr(expr: string): string {
  if (/['\\\n\r]/.test(expr)) throw new Error('Недопустимый символ в выражении фильтра')
  return `'${expr}'`
}

/** Выражение enable для окна времени [from, to) в секундах входа. */
export function windowExpr(from: number, to: number): string {
  return `gte(t,${num(from)})*lt(t,${num(to)})`
}

/**
 * Прозрачность линзы: 255 внутри круга диаметра d, плавный спад на краю в один пиксель.
 * X и Y — координаты пикселя внутри линзы, центр круга — (d/2, d/2).
 */
export function circleAlphaExpr(d: number): string {
  const r = d / 2
  return `255*clip(${num(r)}-hypot(X+0.5-${num(r)},Y+0.5-${num(r)})+0.5,0,1)`
}

/** Ключ движущейся лупы в пикселях видео: геометрия линзы и источника в момент t (секунды видео). */
export interface LoupeAnimKey {
  t: number
  ease?: Ease
  geometry: LoupeGeometry
}

/** Геометрия движущейся лупы на момент t: поля между ключами меняются линейно (с тем же сглаживанием, что и на экране). */
export function loupeGeometryFromKeys(keys: readonly LoupeAnimKey[], t: number): LoupeGeometry {
  const seg = segmentAt(keys, t)
  const a = keys[seg.index].geometry
  if (seg.hold) return a
  const b = keys[seg.index + 1].geometry
  const mix = (x: number, y: number): number => Math.round(x + (y - x) * seg.u)
  return {
    d: a.d,
    sw: a.sw,
    ox: mix(a.ox, b.ox),
    oy: mix(a.oy, b.oy),
    sx: mix(a.sx, b.sx),
    sy: mix(a.sy, b.sy)
  }
}

/**
 * Выражение ffmpeg для поля геометрии движущейся лупы. shift — сколько секунд нужно прибавить к времени кадра в
 * фильтре (t), чтобы получить время середины кадра в видео. Между ключами значение меняется линейно или со сглаживанием.
 */
export function keyedExpr(
  keys: readonly LoupeAnimKey[],
  pick: (g: LoupeGeometry) => number,
  shift: number
): string {
  const T = `(t+${num(shift)})`
  let expr = num(pick(keys[keys.length - 1].geometry))
  for (let i = keys.length - 2; i >= 0; i -= 1) {
    const a = keys[i]
    const b = keys[i + 1]
    const va = pick(a.geometry)
    const vb = pick(b.geometry)
    const u = `(${T}-${num(a.t)})/${num(b.t - a.t)}`
    const eased =
      (a.ease ?? 'ease') === 'linear' ? `(${u})` : `(st(0,${u})*0+ld(0)*ld(0)*(3-2*ld(0)))`
    const segment = vb === va ? num(va) : `${num(va)}+(${num(vb - va)})*${eased}`
    const body = i === 0 ? `if(lt(${T},${num(a.t)}),${num(va)},${segment})` : segment
    expr = `if(lt(${T},${num(b.t)}),${body},${expr})`
  }
  return expr
}

export interface LoupeFilterOptions {
  /** Уникальный префикс меток внутри графа. */
  id: string
  /** Метка входа и выхода, например «[src]». */
  input: string
  output: string
  geometry: LoupeGeometry
  /** Окно показа в секундах входа; без него лупа видна всегда (стоп-кадр). */
  window?: { from: number; to: number }
  /** Основа — один кадр (стоп-кадр): последний кадр линзы повторяется. */
  single?: boolean
  /** Движущаяся лупа: положение линзы и источника задают выражения по времени. shift — см. keyedExpr. */
  anim?: { keys: readonly LoupeAnimKey[]; shift: number }
}

/** Строки графа фильтров: линза из того же потока, наложенная поверх него. */
export function loupeLines(o: LoupeFilterOptions): string[] {
  const { id, geometry: g } = o
  const alpha = circleAlphaExpr(g.d)
  const anim = o.anim && o.anim.keys.length >= 2 ? o.anim : null
  const expr = (pick: (g: LoupeGeometry) => number): string =>
    quoteExpr(keyedExpr(anim!.keys, pick, anim!.shift))
  const overlayOptions = [
    anim ? `x=${expr((k) => k.ox)}` : `x=${g.ox}`,
    anim ? `y=${expr((k) => k.oy)}` : `y=${g.oy}`,
    ...(o.single ? ['eof_action=repeat'] : []),
    ...(o.window ? [`enable=${quoteExpr(windowExpr(o.window.from, o.window.to))}`] : [])
  ].join(':')
  // Маска круга рисуется один раз на один кадр (geq на целом потоке был самым медленным местом экспорта с лупой:
  // 78 кадров/с против 1100 без него), последний кадр маски фильтр alphamerge продлевает сам, и она накладывается на линзу как прозрачность (alphamerge).
  return [
    `color=c=white:s=${g.d}x${g.d}:r=25:d=0.04,format=gray,geq=lum=${quoteExpr(alpha)}[${id}k]`,
    `${o.input}split=2[${id}a][${id}b]`,
    `[${id}b]crop=w=${g.sw}:h=${g.sw}:x=${anim ? expr((k) => k.sx) : g.sx}:y=${anim ? expr((k) => k.sy) : g.sy},scale=${g.d}:${g.d}:flags=bicubic,format=yuv420p[${id}c]`,
    `[${id}c][${id}k]alphamerge[${id}l]`,
    `[${id}a][${id}l]overlay=${overlayOptions}${o.output}`
  ]
}
