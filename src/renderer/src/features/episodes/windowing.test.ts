import { describe, expect, it } from 'vitest'
import { buildOffsets, indexAt, scrollToReveal, windowRange } from './windowing'

const uniform = (n: number, h = 50): Float64Array =>
  buildOffsets(Array.from({ length: n }, () => h))

describe('накопленные высоты', () => {
  it('верх каждой строки и общая высота', () => {
    expect(Array.from(buildOffsets([10, 20, 30]))).toEqual([0, 10, 30, 60])
    expect(Array.from(buildOffsets([]))).toEqual([0])
  })
})

describe('поиск строки по координате', () => {
  const o = buildOffsets([10, 20, 30])
  it('внутри строк и на границах', () => {
    expect(indexAt(o, 0)).toBe(0)
    expect(indexAt(o, 9.9)).toBe(0)
    expect(indexAt(o, 10)).toBe(1)
    expect(indexAt(o, 29.9)).toBe(1)
    expect(indexAt(o, 30)).toBe(2)
  })
  it('за краями — крайние строки; пустой список — 0', () => {
    expect(indexAt(o, -5)).toBe(0)
    expect(indexAt(o, 1000)).toBe(2)
    expect(indexAt(buildOffsets([]), 5)).toBe(0)
  })
})

describe('окно прокрутки', () => {
  it('в начале: видимые строки плюс запас снизу, пустое место только внизу', () => {
    const w = windowRange(uniform(1000), 0, 500, 5)
    expect(w.start).toBe(0)
    expect(w.end).toBe(10 + 1 + 5)
    expect(w.before).toBe(0)
    expect(w.after).toBe((1000 - w.end) * 50)
  })

  it('в середине: запас с обеих сторон, высота всегда сходится', () => {
    const offsets = uniform(1000)
    const w = windowRange(offsets, 20_000, 500, 4)
    expect(w.start).toBe(400 - 4)
    expect(w.end).toBe(410 + 1 + 4)
    expect(w.before + (w.end - w.start) * 50 + w.after).toBe(offsets[1000])
  })

  it('в конце: не выходит за последнюю строку', () => {
    const offsets = uniform(1000)
    const w = windowRange(offsets, offsets[1000] - 500, 500, 3)
    expect(w.end).toBe(1000)
    expect(w.after).toBe(0)
  })

  it('число показанных строк не зависит от длины списка', () => {
    const small = windowRange(uniform(500), 5000, 600)
    const big = windowRange(uniform(10_000), 5000, 600)
    expect(big.end - big.start).toBe(small.end - small.start)
    expect(big.end - big.start).toBeLessThan(40)
  })

  it('строки разной высоты', () => {
    const o = buildOffsets([100, 10, 10, 10, 100])
    const w = windowRange(o, 105, 20, 0)
    expect(w.start).toBe(1)
    expect(w.end).toBe(4)
    expect(w.before).toBe(100)
    expect(w.after).toBe(100)
  })

  it('пустой список', () => {
    expect(windowRange(buildOffsets([]), 0, 100)).toEqual({ start: 0, end: 0, before: 0, after: 0 })
  })
})

describe('прокрутка к строке', () => {
  const o = uniform(100)
  it('видна — не двигаемся', () => {
    expect(scrollToReveal(o, 12, 500, 400)).toBeNull()
  })
  it('выше области — к её верху', () => {
    expect(scrollToReveal(o, 3, 500, 400)).toBe(150)
  })
  it('ниже области — чтобы строка оказалась у нижнего края', () => {
    expect(scrollToReveal(o, 30, 0, 400)).toBe(1550 - 400)
  })
  it('строка выше окна и выше самой области — к её верху', () => {
    const tall = buildOffsets([1000, 50])
    expect(scrollToReveal(tall, 0, 300, 200)).toBe(0)
    expect(scrollToReveal(tall, 0, 0, 200)).toBeNull()
  })
  it('несуществующая строка', () => {
    expect(scrollToReveal(o, -1, 0, 100)).toBeNull()
    expect(scrollToReveal(o, 100, 0, 100)).toBeNull()
  })
})
