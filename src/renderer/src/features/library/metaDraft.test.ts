import { describe, expect, it } from 'vitest'
import { draftFromMeta, validateDraft } from './metaDraft'

const ok = { title: 'Финал', type: 'match' as const, date: '2026-05-17', notes: '' }

describe('черновик описания проекта', () => {
  it('корректный: название обрезается по краям, пустые дата и заметки не попадают в результат', () => {
    const res = validateDraft({ ...ok, title: '  Финал  ', date: '' })
    expect(res).toEqual({ ok: true, meta: { title: 'Финал', type: 'match' } })
    const full = validateDraft({ ...ok, notes: ' соперник ' })
    expect(full).toEqual({
      ok: true,
      meta: { title: 'Финал', type: 'match', date: '2026-05-17', notes: 'соперник' }
    })
  })

  it('пустое название и слишком длинные поля — понятные ошибки', () => {
    const empty = validateDraft({ ...ok, title: '   ' })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.errors.title).toMatch(/Введите название/)
    const long = validateDraft({ ...ok, title: 'я'.repeat(81) })
    expect(!long.ok && long.errors.title).toMatch(/80/)
    const notes = validateDraft({ ...ok, notes: 'я'.repeat(501) })
    expect(!notes.ok && notes.errors.notes).toMatch(/500/)
  })

  it('несуществующая дата отклоняется', () => {
    const res = validateDraft({ ...ok, date: '2026-02-30' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.errors.date).toBeTruthy()
  })

  it('draftFromMeta: отсутствующие поля становятся пустыми строками', () => {
    expect(draftFromMeta({ title: 'А', type: 'other' })).toEqual({
      title: 'А',
      type: 'other',
      date: '',
      notes: ''
    })
  })
})
