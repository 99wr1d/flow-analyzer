import { describe, expect, it } from 'vitest'
import { CHUNK_GAP_SECONDS, MAX_READ_CHUNKS, decodedSeconds, planReadChunks } from './chunks'

describe('куски чтения для подборки', () => {
  it('близкие эпизоды читаются одним куском', () => {
    const chunks = planReadChunks([
      { start: 10, end: 12 },
      { start: 20, end: 25 }
    ])
    expect(chunks).toEqual([{ offset: 10, span: 15, clips: [0, 1] }])
  })

  it('далёкие эпизоды — разными кусками: пропущенное не декодируется', () => {
    const clips = [
      { start: 100, end: 110 },
      { start: 2000, end: 2010 },
      { start: 5000, end: 5010 }
    ]
    const chunks = planReadChunks(clips)
    expect(chunks).toHaveLength(3)
    expect(chunks.map((c) => c.offset)).toEqual([100, 2000, 5000])
    expect(decodedSeconds(chunks)).toBe(30)
  })

  it('граница пропуска: ровно CHUNK_GAP_SECONDS ещё склеивается, больше — нет', () => {
    const joined = planReadChunks([
      { start: 0, end: 10 },
      { start: 10 + CHUNK_GAP_SECONDS, end: 30 }
    ])
    expect(joined).toHaveLength(1)
    const split = planReadChunks([
      { start: 0, end: 10 },
      { start: 10 + CHUNK_GAP_SECONDS + 0.5, end: 30 }
    ])
    expect(split).toHaveLength(2)
  })

  it('пересекающиеся эпизоды (запас по краям) не теряют конец', () => {
    const chunks = planReadChunks([
      { start: 10, end: 40 },
      { start: 20, end: 25 }
    ])
    expect(chunks).toEqual([{ offset: 10, span: 30, clips: [0, 1] }])
  })

  it('порядок эпизодов в подборке сохраняется внутри кусков', () => {
    const chunks = planReadChunks(
      Array.from({ length: 6 }, (_, i) => ({ start: i * 1000, end: i * 1000 + 10 })),
      12,
      100
    )
    expect(chunks.flatMap((c) => c.clips)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('ограничение числа входов: склеиваются самые близкие соседи', () => {
    const clips = [
      { start: 0, end: 10 },
      { start: 100, end: 110 }, // пропуск 90
      { start: 150, end: 160 }, // пропуск 40 — самый маленький
      { start: 1000, end: 1010 } // пропуск 840
    ]
    const chunks = planReadChunks(clips, 12, 3)
    expect(chunks).toHaveLength(3)
    expect(chunks[1]).toEqual({ offset: 100, span: 60, clips: [1, 2] })
  })

  it('сотни эпизодов по всему видео не открывают больше MAX_READ_CHUNKS входов', () => {
    const clips = Array.from({ length: 500 }, (_, i) => ({ start: i * 60, end: i * 60 + 10 }))
    const chunks = planReadChunks(clips)
    expect(chunks.length).toBeLessThanOrEqual(MAX_READ_CHUNKS)
    expect(chunks.flatMap((c) => c.clips)).toHaveLength(500)
    // Каждый эпизод целиком лежит внутри своего куска.
    for (const chunk of chunks) {
      for (const i of chunk.clips) {
        expect(clips[i].start).toBeGreaterThanOrEqual(chunk.offset)
        expect(clips[i].end).toBeLessThanOrEqual(chunk.offset + chunk.span + 1e-9)
      }
    }
  })

  it('20 эпизодов по 10 с, разбросанных по 90 минутам: читаем ~200 с вместо ~85 минут', () => {
    const clips = Array.from({ length: 20 }, (_, i) => ({
      start: 120 + i * 255,
      end: 130 + i * 255
    }))
    const chunks = planReadChunks(clips)
    expect(chunks).toHaveLength(20)
    expect(decodedSeconds(chunks)).toBe(200)
    const oldSpan = clips[19].end - clips[0].start
    expect(oldSpan).toBeGreaterThan(4800)
  })

  it('один эпизод', () => {
    expect(planReadChunks([{ start: 5, end: 6 }])).toEqual([{ offset: 5, span: 1, clips: [0] }])
  })
})
