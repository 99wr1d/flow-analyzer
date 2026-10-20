import { describe, expect, it } from 'vitest'
import { createProgressTracker, defaultWeights } from './chunkProgress'

describe('общий ход параллельного экспорта', () => {
  it('складывается из кусков пропорционально их длине', () => {
    const t = createProgressTracker({ chunks: [10, 30], audio: 0, mux: 0 })
    t.setChunk(0, 5)
    expect(t.fraction()).toBeCloseTo(5 / 40, 9)
    t.doneChunk(0)
    t.setChunk(1, 15)
    expect(t.fraction()).toBeCloseTo(25 / 40, 9)
    t.doneChunk(1)
    expect(t.fraction()).toBe(1)
  })
  it('кусок не может «записать» больше своей длины и меньше нуля', () => {
    const t = createProgressTracker({ chunks: [10], audio: 0, mux: 0 })
    t.setChunk(0, 999)
    expect(t.fraction()).toBe(1)
    const u = createProgressTracker({ chunks: [10, 10], audio: 0, mux: 0 })
    u.setChunk(0, -5)
    expect(u.fraction()).toBe(0)
  })
  it('повтор куска не откатывает полосу назад', () => {
    const t = createProgressTracker({ chunks: [10, 10], audio: 0, mux: 0 })
    t.setChunk(0, 8)
    t.setChunk(1, 8)
    const before = t.fraction()
    t.setChunk(1, 0) // кусок перезапущен
    expect(t.fraction()).toBe(before)
    t.setChunk(1, 10)
    expect(t.fraction()).toBeGreaterThan(before)
  })
  it('звук и склейка — по 3 % от длины результата; готово только когда сделано всё', () => {
    const w = defaultWeights([50, 50], true)
    expect(w.audio).toBeCloseTo(3, 9)
    expect(w.mux).toBeCloseTo(3, 9)
    const t = createProgressTracker(w)
    t.doneChunk(0)
    t.doneChunk(1)
    expect(t.fraction()).toBeCloseTo(100 / 106, 9)
    t.setAudio(0.5)
    expect(t.fraction()).toBeCloseTo(101.5 / 106, 9)
    t.doneAudio()
    t.setMux(1)
    expect(t.fraction()).toBe(1)
  })
  it('без звука его веса нет', () => {
    expect(defaultWeights([10], false).audio).toBe(0)
  })
  it('нулевая работа — ноль, без деления на нуль', () => {
    const t = createProgressTracker({ chunks: [], audio: 0, mux: 0 })
    expect(t.fraction()).toBe(0)
  })
  it('неизвестный номер куска игнорируется', () => {
    const t = createProgressTracker({ chunks: [10], audio: 0, mux: 0 })
    t.setChunk(7, 5)
    t.doneChunk(-1)
    expect(t.fraction()).toBe(0)
  })
})
