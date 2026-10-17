import { describe, expect, it } from 'vitest'
import type { Line } from '../../../../shared/annotations'
import { HISTORY_LIMIT, commit, commitFrom, createHistory, preview, redo, undo } from './history'

const make = (n: number): Line => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  type: 'line',
  p1: { x: 0, y: 0 },
  p2: { x: 1, y: 1 },
  style: { color: '#ffffff', width: 0.008, dash: 'solid' },
  timing: { mode: 'range', start: 0, duration: 3 }
})

describe('история', () => {
  it('отмена и повтор', () => {
    let h = createHistory()
    h = commit(h, [make(1)])
    h = commit(h, [make(1), make(2)])
    expect(h.items).toHaveLength(2)
    h = undo(h)
    expect(h.items).toHaveLength(1)
    h = undo(h)
    expect(h.items).toHaveLength(0)
    expect(undo(h)).toBe(h)
    h = redo(h)
    h = redo(h)
    expect(h.items).toHaveLength(2)
    expect(redo(h)).toBe(h)
  })

  it('новое действие очищает «повтор»', () => {
    let h = commit(createHistory(), [make(1)])
    h = undo(h)
    expect(h.future).toHaveLength(1)
    h = commit(h, [make(3)])
    expect(h.future).toHaveLength(0)
  })

  it('без изменений шаг не создаётся', () => {
    const h = commit(createHistory(), [make(1)])
    expect(commit(h, h.items)).toBe(h)
    expect(commitFrom(h, h.items)).toBe(h)
  })

  it('перетаскивание: промежуточные кадры не пишутся, в историю — состояние до жеста', () => {
    const start = commit(createHistory(), [make(1)])
    const before = start.items
    let h = preview(start, [{ ...make(1), p1: { x: 0.2, y: 0.2 } }])
    h = preview(h, [{ ...make(1), p1: { x: 0.4, y: 0.4 } }])
    expect(h.past).toHaveLength(1)
    h = commitFrom(h, before)
    expect(h.past).toHaveLength(2)
    h = undo(h)
    expect(h.items).toBe(before)
  })

  it('быстрые правки с одним ключом склеиваются', () => {
    let h = commit(createHistory(), [make(1)])
    h = commit(h, [make(2)], { key: 'duration', now: 1000 })
    h = commit(h, [make(3)], { key: 'duration', now: 1200 })
    h = commit(h, [make(4)], { key: 'duration', now: 5000 })
    expect(h.past).toHaveLength(3)
    h = undo(h)
    expect(h.items[0].id.endsWith('3')).toBe(true)
  })

  it('история ограничена', () => {
    let h = createHistory()
    for (let i = 0; i < HISTORY_LIMIT + 30; i++) h = commit(h, [make(i)])
    expect(h.past).toHaveLength(HISTORY_LIMIT)
  })
})
