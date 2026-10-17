import { describe, expect, it } from 'vitest'
import { resolve } from 'path'
import { fpsFromStts, probeVideo } from './probe'
import { MEDIA_ERRORS, checkMediaId } from './validate'

const fixture = (name: string): string => resolve('tests/fixtures', name)

describe('probeVideo', () => {
  it('cfr25.mp4: ровно 25 к/с, 100 кадров, частота постоянная', async () => {
    const info = await probeVideo(fixture('cfr25.mp4'))
    expect(info.fps).toBe(25)
    expect(info.variable).toBe(false)
    expect(info.frameCount).toBe(100)
  })
  it('sample.mp4 (MediaRecorder): конечное положительное число', async () => {
    const info = await probeVideo(fixture('sample.mp4'))
    expect(info.fps).not.toBeNull()
    expect(Number.isFinite(info.fps)).toBe(true)
    expect(info.fps).toBeGreaterThan(0)
  })
  it('webm не разбирается: fps = null', async () => {
    expect(await probeVideo(fixture('cfr30.webm'))).toEqual({ fps: null, variable: false })
  })
  it('битый mp4 и отсутствующий файл не бросают исключений', async () => {
    expect(await probeVideo(fixture('broken.mp4'))).toEqual({ fps: null, variable: false })
    expect(await probeVideo(fixture('нет-такого.mp4'))).toEqual({ fps: null, variable: false })
  })
})

describe('fpsFromStts', () => {
  it('постоянная частота: точная дробная', () => {
    const info = fpsFromStts([{ count: 300, delta: 1001 }], 30000)
    expect(info.fps).toBeCloseTo(29.97003, 4)
    expect(info.variable).toBe(false)
    expect(info.frameCount).toBe(300)
  })
  it('другая длительность последнего кадра не делает частоту переменной', () => {
    const info = fpsFromStts(
      [
        { count: 99, delta: 512 },
        { count: 1, delta: 256 }
      ],
      12800
    )
    expect(info.fps).toBe(25)
    expect(info.variable).toBe(false)
  })
  it('переменная частота: среднее и флаг', () => {
    const info = fpsFromStts(
      [
        { count: 50, delta: 40 },
        { count: 50, delta: 20 }
      ],
      1000
    )
    expect(info.variable).toBe(true)
    expect(info.fps).toBeCloseTo(100 / 3, 6)
  })
  it('пустая или нулевая таблица', () => {
    expect(fpsFromStts([], 1000).fps).toBeNull()
    expect(fpsFromStts([{ count: 10, delta: 0 }], 1000).fps).toBeNull()
    expect(fpsFromStts([{ count: 10, delta: 40 }], 0).fps).toBeNull()
  })
})

describe('checkMediaId', () => {
  it('принимает только выданный формат идентификатора', () => {
    expect(checkMediaId('0b1d2c3e-4f50-4a6b-8c7d-9e0f1a2b3c4d')).toBeNull()
    expect(checkMediaId('C:\\video.mp4')).toBe(MEDIA_ERRORS.badId)
    expect(checkMediaId('../../x')).toBe(MEDIA_ERRORS.badId)
    expect(checkMediaId('')).toBe(MEDIA_ERRORS.badId)
    expect(checkMediaId(42)).toBe(MEDIA_ERRORS.badId)
    expect(checkMediaId(undefined)).toBe(MEDIA_ERRORS.badId)
  })
})
