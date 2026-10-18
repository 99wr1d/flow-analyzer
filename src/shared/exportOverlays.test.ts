import { describe, expect, it } from 'vitest'
import type { Timing } from './annotations'
import {
  groupFrameDrawings,
  hasDrawings,
  keyOf,
  mergeRanges,
  outputSeconds,
  parseKey,
  planOverlays,
  planSegments
} from './exportOverlays'

const range = (start: number, duration: number): Timing => ({ mode: 'range', start, duration })
const frame = (start: number, freezeSeconds = 3): Timing => ({
  mode: 'frame',
  start,
  freezeSeconds
})

describe('mergeRanges', () => {
  it('склеивает пересекающиеся и соприкасающиеся отрезки', () => {
    expect(
      mergeRanges([
        { start: 5, end: 8 },
        { start: 0, end: 2 },
        { start: 2, end: 3 },
        { start: 7, end: 9 }
      ])
    ).toEqual([
      { start: 0, end: 3 },
      { start: 5, end: 9 }
    ])
  })
})

describe('ключи', () => {
  it('keyOf / parseKey', () => {
    expect(keyOf([3, 7, 12])).toBe('3-7-12')
    expect(parseKey('3-7-12')).toEqual([3, 7, 12])
    expect(parseKey('')).toBeNull()
    expect(parseKey('3--7')).toBeNull()
    expect(parseKey('a')).toBeNull()
  })
})

describe('planSegments: интервалы с одним набором рисунков', () => {
  it('нет рисунков или только «кадр» — сегментов нет', () => {
    expect(planSegments([], [{ start: 0, end: 10 }])).toEqual([])
    expect(planSegments([frame(2)], [{ start: 0, end: 10 }])).toEqual([])
  })

  it('перекрывающиеся рисунки делят время на три набора', () => {
    // 0: [1, 5), 1: [3, 7) → {0} 1–3, {0,1} 3–5, {1} 5–7
    const s = planSegments([range(1, 4), range(3, 4)], [{ start: 0, end: 10 }])
    expect(s).toEqual([
      { start: 1, end: 3, key: '0' },
      { start: 3, end: 5, key: '0-1' },
      { start: 5, end: 7, key: '1' }
    ])
  })

  it('вложенные: внутренний рисунок вырезает середину наружного', () => {
    const s = planSegments([range(0, 10), range(4, 2)], [{ start: 0, end: 10 }])
    expect(s).toEqual([
      { start: 0, end: 4, key: '0' },
      { start: 4, end: 6, key: '0-1' },
      { start: 6, end: 10, key: '0' }
    ])
  })

  it('соседние (конец одного = начало другого) не склеиваются, если наборы разные', () => {
    const s = planSegments([range(1, 2), range(3, 2)], [{ start: 0, end: 10 }])
    expect(s).toEqual([
      { start: 1, end: 3, key: '0' },
      { start: 3, end: 5, key: '1' }
    ])
  })

  it('одинаковые соседние интервалы склеиваются', () => {
    // Точка 2 — граница отрезка экспорта: до неё и после один и тот же набор.
    const s = planSegments(
      [range(0, 5)],
      [
        { start: 0, end: 2 },
        { start: 2, end: 4 }
      ]
    )
    expect(s).toEqual([{ start: 0, end: 4, key: '0' }])
  })

  it('рисунок частично за пределами экспорта обрезается по отрезку', () => {
    const s = planSegments([range(0, 10)], [{ start: 3, end: 6 }])
    expect(s).toEqual([{ start: 3, end: 6, key: '0' }])
    // Рисунок целиком вне отрезка — сегментов нет.
    expect(planSegments([range(8, 1)], [{ start: 3, end: 6 }])).toEqual([])
  })

  it('несколько отрезков экспорта: промежутки между ними не считаются', () => {
    const s = planSegments(
      [range(0, 20)],
      [
        { start: 1, end: 2 },
        { start: 10, end: 11 }
      ]
    )
    expect(s).toEqual([
      { start: 1, end: 2, key: '0' },
      { start: 10, end: 11, key: '0' }
    ])
  })

  it('пересекающиеся отрезки экспорта (запас по краям) не дублируют сегменты', () => {
    const s = planSegments(
      [range(0, 20)],
      [
        { start: 1, end: 5 },
        { start: 4, end: 8 }
      ]
    )
    expect(s).toEqual([{ start: 1, end: 8, key: '0' }])
  })
})

describe('стоп-кадры', () => {
  it('рисунки на одном кадре — один стоп-кадр, длина — наибольшая', () => {
    const groups = groupFrameDrawings([frame(2.02, 1), frame(2.03, 2.5), frame(4.02, 3)], 25)
    expect(groups).toEqual([
      { frame: 50, indices: [0, 1], seconds: 2.5 },
      { frame: 100, indices: [2], seconds: 3 }
    ])
  })

  it('в стоп-кадре видны его рисунки и рисунки-отрезки, видимые в этот момент', () => {
    // 0: отрезок 1–3 (виден в 2.02), 1: кадр на 2.02, 2: отрезок 5–6 (не виден)
    const plan = planOverlays(
      [range(1, 2), frame(2.02, 1.5), range(5, 1)],
      [{ start: 0, end: 4 }],
      25
    )
    expect(plan.ranges[0].freezes).toEqual([{ time: 2.02, frame: 50, seconds: 1.5, key: '0-1' }])
    expect(plan.freezeSeconds).toBe(1.5)
    expect(plan.keys).toContain('0-1')
    expect(plan.keys).toContain('0')
  })

  it('стоп-кадр вне отрезка экспорта не учитывается', () => {
    const plan = planOverlays([frame(8.02, 2)], [{ start: 0, end: 4 }], 25)
    expect(plan.ranges[0].freezes).toEqual([])
    expect(plan.freezeSeconds).toBe(0)
    expect(hasDrawings(plan)).toBe(false)
  })

  it('кадр на границах: начало отрезка включено, конец — нет', () => {
    const at = (t: number, r: { start: number; end: number }): number =>
      planOverlays([frame(t)], [r], 25).ranges[0].freezes.length
    // Кадр 25 (начало 1.00, середина 1.02).
    expect(at(1.02, { start: 1, end: 3 })).toBe(1)
    expect(at(1.02, { start: 1.04, end: 3 })).toBe(0)
    // Кадр 75 (начало 3.00): в отрезок [1, 3) не входит.
    expect(at(3.02, { start: 1, end: 3 })).toBe(0)
    expect(at(2.98, { start: 1, end: 3 })).toBe(1)
  })

  it('длительность результата включает стоп-кадры; в «подборке» из пересекающихся отрезков — для каждого вхождения', () => {
    const one = planOverlays([frame(2.02, 1.5)], [{ start: 1, end: 3 }], 25)
    expect(outputSeconds(one)).toBeCloseTo(2 + 1.5, 6)
    const two = planOverlays(
      [frame(2.02, 1)],
      [
        { start: 1, end: 3 },
        { start: 2, end: 4 }
      ],
      25
    )
    expect(two.freezeSeconds).toBe(2)
    expect(outputSeconds(two)).toBeCloseTo(4 + 2, 6)
  })

  it('ключи уникальны и идут в порядке появления', () => {
    const plan = planOverlays(
      [range(0, 2), range(1, 2), frame(1.02, 1)],
      [{ start: 0, end: 4 }],
      25
    )
    expect(new Set(plan.keys).size).toBe(plan.keys.length)
    expect(plan.keys[0]).toBe('0')
  })
})
