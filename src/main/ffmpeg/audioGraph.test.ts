import { describe, expect, it } from 'vitest'
import type { Timing } from '../../shared/annotations'
import { planExport } from '../../shared/exportOverlays'
import { planAudioOnly } from './audioGraph'
import { wholeRanges } from './exportChunks'

const FPS = 25
const AUDIO = { sampleRate: 48000, mono: false }
const freeze = (start: number, seconds: number): Timing => ({
  mode: 'frame',
  start,
  freezeSeconds: seconds
})

/** Длины всех atrim в графе, секунды. */
function trimLengths(script: string): number[] {
  return [...script.matchAll(/atrim=start=([\d.]+):end=([\d.]+)/g)].map(
    (m) => Number(m[2]) - Number(m[1])
  )
}

describe('граф звука для параллельного экспорта', () => {
  it('один отрезок: звук начинается с начала первого кадра и длится ровно столько, сколько кадров', () => {
    const [plan] = planExport([{ start: 12.345, end: 22.345 }], 'files', [], FPS)
    const g = planAudioOnly({ ranges: wholeRanges(plan, FPS), fps: FPS, audio: AUDIO })
    // Кадры 309…558 — 250 кадров = 10 с; начало первого кадра 12.36.
    expect(g.offset).toBeCloseTo(12.36, 3)
    expect(trimLengths(g.script)).toHaveLength(1)
    expect(trimLengths(g.script)[0]).toBeCloseTo(10, 6)
    expect(g.outputSeconds).toBeCloseTo(10, 9)
    expect(g.script).toContain('concat=n=1:v=0:a=1[outa]')
    expect(g.script).toContain('aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo')
  })
  it('смещение входа — целое число миллисекунд вниз, а времена графа считаются от него', () => {
    const [plan] = planExport([{ start: 5, end: 7 }], 'files', [], 29.97)
    const g = planAudioOnly({ ranges: wholeRanges(plan, 29.97), fps: 29.97, audio: AUDIO })
    expect(Math.round(g.offset * 1000)).toBeCloseTo(g.offset * 1000, 9)
    const first = /atrim=start=([\d.]+)/.exec(g.script)
    expect(Number(first?.[1])).toBeGreaterThanOrEqual(0)
    expect(Number(first?.[1])).toBeLessThan(0.0334)
  })
  it('стоп-кадр: звук своего кадра и тишина, вместе 1 + seconds·fps кадров', () => {
    const [plan] = planExport([{ start: 1, end: 3 }], 'files', [freeze(2.02, 2)], FPS)
    const g = planAudioOnly({ ranges: wholeRanges(plan, FPS), fps: FPS, audio: AUDIO })
    // Обычный кусок до стоп-кадра, звук кадра, остальное.
    expect(g.script).toContain('anullsrc=r=48000:cl=stereo:d=2.000000')
    expect(g.outputSeconds).toBeCloseTo(2 + 2, 6)
    const lengths = trimLengths(g.script)
    expect(lengths.reduce((a, b) => a + b, 0)).toBeCloseTo(2, 6)
    expect(lengths[1]).toBeCloseTo(0.04, 6)
  })
  it('стоп-кадр без добавленных секунд: тишины нет, граф не ломается', () => {
    const [plan] = planExport([{ start: 1, end: 3 }], 'files', [freeze(2.02, 0)], FPS)
    const g = planAudioOnly({ ranges: wholeRanges(plan, FPS), fps: FPS, audio: AUDIO })
    expect(g.script).not.toContain('anullsrc')
    expect(g.script).toContain('anull[')
  })
  it('подборка: длины кусков звука равны длинам кусков видео в кадрах, сумма — длина результата', () => {
    const clips = [
      { start: 10.013, end: 15.027 },
      { start: 100.5, end: 104.007 },
      { start: 300, end: 301 }
    ]
    const [plan] = planExport(clips, 'compilation', [], FPS)
    const whole = wholeRanges(plan, FPS)
    const g = planAudioOnly({ ranges: whole, fps: FPS, audio: { sampleRate: 44100, mono: true } })
    const lengths = trimLengths(g.script)
    expect(lengths).toHaveLength(3)
    whole.forEach((r, i) => {
      const frames = Math.round((r.end - r.start) * FPS)
      expect(lengths[i]).toBeCloseTo(frames / FPS, 6)
    })
    expect(g.script).toContain('channel_layouts=mono')
    expect(g.script).toContain('asplit=3')
  })
})
