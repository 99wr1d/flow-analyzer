// Лупа в экспорте: строки графа фильтров (экранирование, окно времени, точная геометрия).
import { describe, expect, it } from 'vitest'
import type { RangePlan } from '../../shared/exportOverlays'
import { loupeGeometry } from '../../shared/tools/loupe'
import { planDrawn } from './drawGraph'
import { circleAlphaExpr, loupeLines, quoteExpr, windowExpr } from './loupe'

const geometry = loupeGeometry(
  { pos: { x: 0.75, y: 0.4 }, src: { x: 0.3, y: 0.5 }, radius: 0.1, zoom: 2 },
  640,
  360
)

describe('выражения фильтра', () => {
  it('окно времени: границы с четырьмя знаками, без экспоненты', () => {
    expect(windowExpr(0.48, 0.98)).toBe('gte(t,0.48)*lt(t,0.98)')
    expect(windowExpr(1e-7, 12.34567)).toBe('gte(t,0)*lt(t,12.3457)')
  })

  it('кавычки: выражение берётся в одинарные; одинарная кавычка и обратная косая запрещены', () => {
    expect(quoteExpr('r(X,Y)')).toBe("'r(X,Y)'")
    expect(() => quoteExpr("a'b")).toThrow()
    expect(() => quoteExpr(`a${String.fromCharCode(92)}b`)).toThrow()
    expect(() => quoteExpr('a\nb')).toThrow()
  })

  it('прозрачность линзы: центр круга — радиус диаметра/2, мягкий край в один пиксель', () => {
    expect(circleAlphaExpr(72)).toBe('255*clip(36-hypot(X+0.5-36,Y+0.5-36)+0.5,0,1)')
    expect(circleAlphaExpr(0.5 * 4 + 1)).toContain('hypot')
  })
})

describe('loupeLines', () => {
  const lines = loupeLines({
    id: 'lm0',
    input: '[src]',
    output: '[lm0o]',
    geometry,
    window: { from: 0.4799, to: 0.9799 }
  })

  it('три строки: split, вырезка с увеличением и круглой маской, наложение', () => {
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('[src]split=2[lm0a][lm0b]')
    expect(lines[1]).toBe(
      `[lm0b]crop=w=${geometry.sw}:h=${geometry.sw}:x=${geometry.sx}:y=${geometry.sy},` +
        `scale=${geometry.d}:${geometry.d}:flags=bicubic,format=rgba,` +
        `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${circleAlphaExpr(geometry.d)}'[lm0l]`
    )
    expect(lines[2]).toBe(
      `[lm0a][lm0l]overlay=x=${geometry.ox}:y=${geometry.oy}:enable='gte(t,0.4799)*lt(t,0.9799)'[lm0o]`
    )
  })

  it('геометрия: линза 64 px, участок 32 px (увеличение ×2), позиция по центру линзы', () => {
    expect(geometry.d).toBe(72)
    expect(geometry.sw).toBe(36)
    expect(geometry.ox).toBe(480 - 36)
    expect(geometry.oy).toBe(144 - 36)
  })

  it('без окна — лупа видна всегда; на одном кадре повторяется последний кадр', () => {
    const single = loupeLines({
      id: 'lz0_0',
      input: '[fz0]',
      output: '[o]',
      geometry,
      single: true
    })
    expect(single[2]).toContain('eof_action=repeat')
    expect(single[2]).not.toContain('enable')
    const none = loupeLines({ id: 'a', input: '[x]', output: '[y]', geometry })
    expect(none[2]).not.toContain('enable')
    expect(none[2]).not.toContain('eof_action')
  })

  it('метки уникальны для разных луп: префиксы не пересекаются', () => {
    const second = loupeLines({ id: 'lm1', input: '[lm0o]', output: '[lm1o]', geometry })
    const all = [...lines, ...second].join('\n')
    expect(all.match(/\[lm0a\]/g)).toHaveLength(2)
    expect(all.match(/\[lm1a\]/g)).toHaveLength(2)
  })
})

describe('planDrawn: лупы в графе', () => {
  const FPS = 25
  const R = (start: number, end: number, freezes: RangePlan['freezes'] = []): RangePlan => ({
    start,
    end,
    freezes
  })
  const loupe = {
    index: 0,
    geometry,
    timing: { mode: 'range' as const, start: 1.5, duration: 0.5 }
  }

  it('лупа «Отрезок»: окно сдвинуто на полкадра и отсчитывается от смещения, раньше картинок с рисунками', () => {
    const g = planDrawn({
      ranges: [R(1, 3)],
      segments: [{ start: 1.5, end: 2, key: '0' }],
      fps: FPS,
      audio: null,
      loupes: [loupe]
    })
    expect(g.script).toContain('[src]split=2[lm0a][lm0b]')
    expect(g.script).toContain("enable='gte(t,0.4799)*lt(t,0.9799)'")
    // Лупа накладывается раньше PNG: вход наложения PNG — выход лупы.
    expect(g.script.indexOf('[lm0a][lm0l]overlay')).toBeLessThan(g.script.indexOf('[pc0]overlay'))
    expect(g.script).toMatch(/\[lm0\]\[pc0\]overlay=x=0:y=0:eof_action=repeat/)
  })

  it('лупа вне экспортируемых отрезков в граф не попадает', () => {
    const g = planDrawn({
      ranges: [R(5, 6)],
      segments: [],
      fps: FPS,
      audio: null,
      loupes: [loupe]
    })
    expect(g.script).not.toContain('geq')
  })

  it('лупа «Только кадр»: линза накладывается на стоп-кадр до картинки с рисунками', () => {
    const f = { time: (50 + 0.5) / FPS, frame: 50, seconds: 1, key: '0' }
    const g = planDrawn({
      ranges: [R(1, 3, [f])],
      segments: [],
      fps: FPS,
      audio: null,
      loupes: [{ index: 0, geometry, timing: { mode: 'frame', start: f.time, freezeSeconds: 1 } }]
    })
    expect(g.script).toContain('[fz0]split=2[lz0_0a][lz0_0b]')
    expect(g.script).toMatch(/\[lz0_0a\]\[lz0_0l\]overlay=x=\d+:y=\d+:eof_action=repeat\[lz0_0o\]/)
    expect(g.script).toContain('[lz0_0o][pf0_0]overlay')
    // На обычных кусках лупы «Только кадр» нет.
    expect(g.script).not.toContain('[src]split=2[lm')
  })

  it('лупа не мешает графу без лупы: тот же результат при пустом списке', () => {
    const input = {
      ranges: [R(1, 3)],
      segments: [{ start: 1.5, end: 2, key: '0' }],
      fps: FPS,
      audio: null
    }
    expect(planDrawn({ ...input, loupes: [] }).script).toBe(planDrawn(input).script)
  })

  it('номера рисунков в стоп-кадре берутся из ключа набора: лупа с другим номером не участвует', () => {
    const f = { time: (50 + 0.5) / FPS, frame: 50, seconds: 1, key: '1' }
    const g = planDrawn({
      ranges: [R(1, 3, [f])],
      segments: [],
      fps: FPS,
      audio: null,
      loupes: [
        { index: 0, geometry, timing: { mode: 'frame', start: f.time, freezeSeconds: 1 } },
        { index: 1, geometry, timing: { mode: 'frame', start: f.time, freezeSeconds: 1 } }
      ]
    })
    expect(g.script.match(/geq=/g)).toHaveLength(1)
  })
})
