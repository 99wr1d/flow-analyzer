import { describe, expect, it } from 'vitest'
import { formatTime } from './format'

describe('formatTime', () => {
  it('ММ:СС', () => {
    expect(formatTime(0)).toBe('00:00')
    expect(formatTime(5.9)).toBe('00:05')
    expect(formatTime(65)).toBe('01:05')
    expect(formatTime(3599)).toBe('59:59')
  })
  it('Ч:ММ:СС от часа', () => {
    expect(formatTime(3600)).toBe('1:00:00')
    expect(formatTime(3725)).toBe('1:02:05')
  })
  it('десятые доли', () => {
    expect(formatTime(5.34, { tenths: true })).toBe('00:05.3')
    expect(formatTime(59.99, { tenths: true })).toBe('00:59.9')
    expect(formatTime(6, { tenths: true })).toBe('00:06.0')
  })
  it('принудительные часы', () => {
    expect(formatTime(75, { hours: true })).toBe('0:01:15')
  })
  it('мусор превращается в ноль', () => {
    expect(formatTime(NaN)).toBe('00:00')
    expect(formatTime(-3)).toBe('00:00')
    expect(formatTime(Infinity)).toBe('00:00')
  })
})
