import { describe, expect, it } from 'vitest'
import { episodesWord, fmtDuration, fmtPercent } from './format'

describe('форматирование статистики', () => {
  it('проценты', () => {
    expect(fmtPercent(0)).toBe('0%')
    expect(fmtPercent(3.44)).toBe('3.4%')
    expect(fmtPercent(38.4)).toBe('38%')
    expect(fmtPercent(100)).toBe('100%')
    expect(fmtPercent(Number.NaN)).toBe('0%')
  })
  it('длительности', () => {
    expect(fmtDuration(0)).toBe('0.0 с')
    expect(fmtDuration(12.34)).toBe('12.3 с')
    expect(fmtDuration(65)).toBe('01:05')
    expect(fmtDuration(3725)).toBe('1:02:05')
  })
})

describe('склонение', () => {
  it('эпизод', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111].map(episodesWord)).toEqual([
      'эпизод',
      'эпизода',
      'эпизодов',
      'эпизодов',
      'эпизодов',
      'эпизод',
      'эпизода',
      'эпизодов',
      'эпизодов'
    ])
  })
})
