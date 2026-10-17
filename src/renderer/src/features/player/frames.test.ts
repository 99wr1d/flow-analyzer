import { describe, expect, it } from 'vitest'
import {
  currentFrame,
  formatDurationTimecode,
  formatFps,
  formatTimecode,
  frameCenterTime,
  frameCount,
  frameIndexAt,
  secondsToFrames,
  snapFps,
  stepTime,
  targetFrame
} from './frames'

describe('currentFrame', () => {
  it('считает кадр с нуля и не ошибается на границах', () => {
    expect(currentFrame(0, 25)).toBe(0)
    expect(currentFrame(0.039, 25)).toBe(0)
    expect(currentFrame(0.04, 25)).toBe(1)
    expect(currentFrame(0.2, 25)).toBe(5)
    expect(currentFrame(0.6, 25)).toBe(15)
    expect(currentFrame(4.0, 25)).toBe(100)
  })
  it('терпит мусор', () => {
    expect(currentFrame(NaN, 25)).toBe(0)
    expect(currentFrame(-1, 25)).toBe(0)
    expect(currentFrame(1, 0)).toBe(0)
  })
})

describe('frameCount / frameIndexAt', () => {
  it('число кадров и последний кадр', () => {
    expect(frameCount(4, 25)).toBe(100)
    expect(frameCount(0, 25)).toBe(1)
    expect(frameIndexAt(4, 25, 4)).toBe(99)
    expect(frameIndexAt(10, 25, 4)).toBe(99)
  })
})

describe('frameCenterTime', () => {
  it('середина кадра', () => {
    expect(frameCenterTime(0, 25, 4)).toBeCloseTo(0.02, 10)
    expect(frameCenterTime(10, 25, 4)).toBeCloseTo(0.42, 10)
  })
  it('не дальше «длительность - полкадра»', () => {
    expect(frameCenterTime(99, 25, 4)).toBeCloseTo(3.98, 10)
    expect(frameCenterTime(500, 25, 4)).toBeCloseTo(3.98, 10)
    expect(frameCenterTime(-5, 25, 4)).toBe(0)
  })
  it('попадает в тот же кадр при обратном пересчёте', () => {
    for (const fps of [24, 25, 29.97, 30, 59.94]) {
      for (let n = 0; n < 200; n++) expect(currentFrame(frameCenterTime(n, fps, 100), fps)).toBe(n)
    }
  })
})

describe('stepTime', () => {
  const fps = 25
  const dur = 4
  it('шаг вперёд и назад на кадр', () => {
    expect(currentFrame(stepTime(0.42, 1, fps, dur), fps)).toBe(11)
    expect(currentFrame(stepTime(0.42, -1, fps, dur), fps)).toBe(9)
  })
  it('на первом кадре назад - остаёмся на нуле', () => {
    expect(currentFrame(stepTime(0, -1, fps, dur), fps)).toBe(0)
    expect(currentFrame(stepTime(0.02, -50, fps, dur), fps)).toBe(0)
  })
  it('на последнем кадре вперёд - остаёмся на последнем', () => {
    const last = stepTime(3.98, 1, fps, dur)
    expect(currentFrame(last, fps)).toBe(99)
    expect(last).toBeLessThanOrEqual(dur - 0.5 / fps + 1e-9)
    expect(currentFrame(stepTime(dur, 1, fps, dur), fps)).toBe(99)
  })
  it('с конца (currentTime = duration) шаг назад даёт предпоследний кадр', () => {
    expect(currentFrame(stepTime(dur, -1, fps, dur), fps)).toBe(98)
  })
  it('секунда = fps кадров', () => {
    expect(secondsToFrames(1, 25)).toBe(25)
    expect(secondsToFrames(1, 29.97)).toBe(30)
    expect(currentFrame(stepTime(0.42, secondsToFrames(1, fps), fps, dur), fps)).toBe(35)
  })
})

describe('targetFrame', () => {
  it('ограничивает диапазон', () => {
    expect(targetFrame(5, -10, 100)).toBe(0)
    expect(targetFrame(98, 5, 100)).toBe(99)
    expect(targetFrame(5, 1, 100)).toBe(6)
  })
})

describe('formatTimecode', () => {
  it('ЧЧ:ММ:СС:КК', () => {
    expect(formatTimecode(0, 25)).toBe('00:00:00:00')
    expect(formatTimecode(frameCenterTime(10, 25, 4), 25)).toBe('00:00:00:10')
    expect(formatTimecode(frameCenterTime(35, 25, 4), 25)).toBe('00:00:01:10')
    expect(formatTimecode(3661.5, 30)).toBe('01:01:01:15')
  })
  it('длительность', () => {
    expect(formatDurationTimecode(4, 25)).toBe('00:00:04:00')
    expect(formatDurationTimecode(0, 25)).toBe('00:00:00:00')
  })
})

describe('formatFps / snapFps', () => {
  it('форматирует частоту', () => {
    expect(formatFps(25)).toBe('25')
    expect(formatFps(30000 / 1001)).toBe('29.97')
  })
  it('притягивает оценку к стандартной частоте', () => {
    expect(snapFps(29.94)).toBe(29.97)
    expect(snapFps(30.1)).toBe(30)
    expect(snapFps(37.3)).toBe(37.3)
  })
})
