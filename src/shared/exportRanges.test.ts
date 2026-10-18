import { describe, expect, it } from 'vitest'
import { ExportRequestSchema } from './export'
import { RANGE_ERRORS, prepareClips, totalDuration } from './exportRanges'

const clip = (
  start: number,
  end: number,
  label = 'Гол'
): { start: number; end: number; label: string } => ({ start, end, label })

describe('prepareClips', () => {
  it('сортирует по времени и нумерует', () => {
    const r = prepareClips([clip(10, 12, 'Б'), clip(1, 2, 'А')], 60, 0)
    expect(r.ok && r.clips.map((c) => [c.number, c.label, c.start, c.end])).toEqual([
      [1, 'А', 1, 2],
      [2, 'Б', 10, 12]
    ])
  })
  it('запас по краям обрезается границами видео', () => {
    const r = prepareClips([clip(1, 2), clip(58, 59.8)], 60, 3)
    expect(r.ok && r.clips.map((c) => [c.start, c.end])).toEqual([
      [0, 5],
      [55, 60]
    ])
    expect(r.ok && r.clips[0].episodeStart).toBe(1)
  })
  it('допускает небольшой выход за длительность и обрезает до неё', () => {
    const r = prepareClips([clip(59, 60.3)], 60, 0)
    expect(r.ok && r.clips[0].end).toBe(60)
  })
  it('отклоняет выход за видео, обратные и пустые отрезки', () => {
    expect(prepareClips([clip(59, 61)], 60, 0)).toEqual({ ok: false, error: RANGE_ERRORS.outside })
    expect(prepareClips([clip(70, 71)], 60, 0)).toEqual({ ok: false, error: RANGE_ERRORS.outside })
    expect(prepareClips([clip(5, 5)], 60, 0)).toEqual({ ok: false, error: RANGE_ERRORS.badRange })
    expect(prepareClips([clip(6, 5)], 60, 0)).toEqual({ ok: false, error: RANGE_ERRORS.badRange })
    expect(prepareClips([clip(-1, 5)], 60, 0)).toEqual({ ok: false, error: RANGE_ERRORS.badRange })
    expect(prepareClips([clip(1, NaN)], 60, 0)).toEqual({ ok: false, error: RANGE_ERRORS.badRange })
    expect(prepareClips([clip(1, 1.05)], 60, 0)).toEqual({
      ok: false,
      error: RANGE_ERRORS.badRange
    })
  })
  it('пустой список, много эпизодов и плохой запас', () => {
    expect(prepareClips([], 60, 0)).toEqual({ ok: false, error: RANGE_ERRORS.empty })
    const many = Array.from({ length: 501 }, (_, i) => clip(i * 0.1, i * 0.1 + 0.2))
    expect(prepareClips(many, 600, 0)).toEqual({ ok: false, error: RANGE_ERRORS.tooMany })
    expect(prepareClips([clip(1, 2)], 60, 11)).toEqual({
      ok: false,
      error: RANGE_ERRORS.badPadding
    })
    expect(prepareClips([clip(1, 2)], 60, -1)).toEqual({
      ok: false,
      error: RANGE_ERRORS.badPadding
    })
  })
  it('если длительность неизвестна, верхняя граница не проверяется', () => {
    const r = prepareClips([clip(100, 200)], null, 5)
    expect(r.ok && [r.clips[0].start, r.clips[0].end]).toEqual([95, 205])
  })
  it('totalDuration', () => {
    const r = prepareClips([clip(1, 3), clip(10, 11.5)], 60, 0)
    expect(r.ok && totalDuration(r.clips)).toBeCloseTo(3.5)
  })
})

describe('ExportRequestSchema', () => {
  const base = {
    videoId: 'abc',
    clips: [clip(1, 2)],
    mode: 'files',
    precision: 'precise',
    padding: 0,
    projectName: null
  }
  it('принимает корректный запрос', () => {
    expect(ExportRequestSchema.safeParse(base).success).toBe(true)
  })
  it('отклоняет лишнее и некорректное', () => {
    expect(ExportRequestSchema.safeParse({ ...base, mode: 'zip' }).success).toBe(false)
    expect(ExportRequestSchema.safeParse({ ...base, padding: 11 }).success).toBe(false)
    expect(ExportRequestSchema.safeParse({ ...base, clips: [] }).success).toBe(false)
    expect(ExportRequestSchema.safeParse({ ...base, clips: [clip(Infinity, 3)] }).success).toBe(
      false
    )
    expect(ExportRequestSchema.safeParse({ ...base, clips: [{ start: 1, end: 2 }] }).success).toBe(
      false
    )
    expect(ExportRequestSchema.safeParse({ ...base, videoId: 5 }).success).toBe(false)
  })
})
