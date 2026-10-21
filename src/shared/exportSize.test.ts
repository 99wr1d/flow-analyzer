import { describe, expect, it } from 'vitest'
import { estimateMaxBytes, maxrateKbps, videoBpsOfTotal } from './exportSize'

describe('exportSize', () => {
  it('потолок: 2x у «Обычного», 1.2x у «Меньше размер», не ниже границы', () => {
    expect(maxrateKbps(1_230_000, 'normal')).toBe(2460)
    expect(maxrateKbps(1_230_000, 'small')).toBe(1476)
    expect(maxrateKbps(100_000, 'normal')).toBe(1200)
  })
  it('видео-битрейт по общему: вычитается звук, но не больше 20 %', () => {
    expect(videoBpsOfTotal(1_000_000)).toBe(872_000)
    expect(videoBpsOfTotal(300_000)).toBe(240_000)
  })
  it('оценка: потолок видео плюс звук, «Быстро» — по размеру исходника, пустое — 0', () => {
    const bytes = estimateMaxBytes({
      seconds: 60,
      sourceTotalBps: 1_000_000,
      quality: 'normal',
      fast: false
    })
    expect(bytes).toBeCloseTo((60 * (maxrateKbps(872_000, 'normal') * 1000 + 160_000)) / 8, 0)
    expect(
      estimateMaxBytes({ seconds: 60, sourceTotalBps: 1_000_000, quality: 'normal', fast: true })
    ).toBe(7_500_000)
    expect(
      estimateMaxBytes({ seconds: 0, sourceTotalBps: 1_000_000, quality: 'normal', fast: false })
    ).toBe(0)
    expect(estimateMaxBytes({ seconds: 5, sourceTotalBps: 0, quality: 'small', fast: false })).toBe(
      0
    )
  })
})
