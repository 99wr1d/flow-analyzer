// Лупа в экспорте: участок кадра вырезается (crop), увеличивается (scale), обрезается по кругу (прозрачность
// через geq) и накладывается на кадр (overlay) на нужное время. Рамку и соединительную линию лупы рисует
// обычный PNG с рисунками — здесь только содержимое линзы. Чистые функции: ffmpeg не запускают.
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
}

/** Строки графа фильтров: линза из того же потока, наложенная поверх него. */
export function loupeLines(o: LoupeFilterOptions): string[] {
  const { id, geometry: g } = o
  const alpha = circleAlphaExpr(g.d)
  const overlayOptions = [
    `x=${g.ox}`,
    `y=${g.oy}`,
    ...(o.single ? ['eof_action=repeat'] : []),
    ...(o.window ? [`enable=${quoteExpr(windowExpr(o.window.from, o.window.to))}`] : [])
  ].join(':')
  return [
    `${o.input}split=2[${id}a][${id}b]`,
    `[${id}b]crop=w=${g.sw}:h=${g.sw}:x=${g.sx}:y=${g.sy},scale=${g.d}:${g.d}:flags=bicubic,format=rgba,` +
      `geq=r=${quoteExpr('r(X,Y)')}:g=${quoteExpr('g(X,Y)')}:b=${quoteExpr('b(X,Y)')}:a=${quoteExpr(alpha)}[${id}l]`,
    `[${id}a][${id}l]overlay=${overlayOptions}${o.output}`
  ]
}
