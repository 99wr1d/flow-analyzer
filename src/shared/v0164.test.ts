// Версия 0.16.4: заливка круга и кольца, умолчание «под игроками» для новых подсветок, обложка проекта.
import { describe, expect, it } from 'vitest'
import {
  AnnotationSchema,
  DEFAULT_RING_FILL,
  LEGACY_CIRCLE_FILL,
  MAX_RING_FILL,
  isUnderPlayers,
  newUnderDefault
} from './annotations'
import { parseProjectText } from './project'
import { sampleProject, uuid } from './project.testkit'

const style = { color: '#ffd60a', width: 0.011, dash: 'solid' }
const timing = { mode: 'range', start: 1, duration: 2 }
const circle = {
  id: uuid(1),
  space: 'screen',
  type: 'circle',
  p1: { x: 0.1, y: 0.1 },
  p2: { x: 0.3, y: 0.4 },
  style,
  timing
}
const ring = {
  id: uuid(2),
  space: 'pitch',
  calibrationId: uuid(77),
  type: 'ring',
  center: { x: 10, y: 20 },
  radius: 1,
  style,
  timing
}

describe('новые подсветки: «под игроками» по умолчанию', () => {
  it('на поле — всё, на экране — круг и зона; стрелки, линии и подписи — нет', () => {
    for (const type of ['circle', 'zone']) expect(newUnderDefault(type, 'screen'), type).toBe(true)
    for (const type of ['arrow', 'line', 'curve', 'pen', 'chain', 'text', 'loupe', 'spot']) {
      expect(newUnderDefault(type, 'screen'), type).toBe(false)
    }
    for (const type of ['ring', 'pspot', 'pzone', 'parrow']) {
      expect(newUnderDefault(type, 'pitch'), type).toBe(true)
    }
    expect(newUnderDefault('ptext', 'pitch')).toBe(false)
  })

  it('старые рисунки без поля не меняются: круг и зона на экране остаются поверх игроков', () => {
    expect(isUnderPlayers({ type: 'circle' })).toBe(false)
    expect(isUnderPlayers({ type: 'zone' })).toBe(false)
    expect(isUnderPlayers({ type: 'circle', underPlayers: true })).toBe(true)
    expect(isUnderPlayers({ type: 'ring' })).toBe(true)
  })
})

describe('fillOpacity круга и кольца', () => {
  it('старые рисунки читаются без поля', () => {
    expect(AnnotationSchema.safeParse(circle).success).toBe(true)
    expect(AnnotationSchema.safeParse(ring).success).toBe(true)
  })

  it('значение от 0 до предела; больше предела и отрицательное отклоняются', () => {
    for (const v of [0, DEFAULT_RING_FILL, MAX_RING_FILL]) {
      expect(AnnotationSchema.safeParse({ ...circle, fillOpacity: v }).success).toBe(true)
      expect(AnnotationSchema.safeParse({ ...ring, fillOpacity: v }).success).toBe(true)
    }
    expect(AnnotationSchema.safeParse({ ...ring, fillOpacity: MAX_RING_FILL + 0.01 }).success).toBe(
      false
    )
    expect(AnnotationSchema.safeParse({ ...circle, fillOpacity: -0.1 }).success).toBe(false)
  })

  it('заливка по умолчанию лёгкая (не больше 15 %), прежняя заливка старых кругов не менялась', () => {
    expect(DEFAULT_RING_FILL).toBeLessThanOrEqual(0.15)
    expect(LEGACY_CIRCLE_FILL).toBe(0.16)
  })
})

describe('обложка проекта (ui.coverTime)', () => {
  it('старые файлы без обложки читаются', () => {
    const project = sampleProject()
    const r = parseProjectText(JSON.stringify({ ...project, ui: { lastTime: 5 } }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.project.ui?.coverTime).toBeUndefined()
  })

  it('обложка сохраняется; отрицательное время отклоняется', () => {
    const project = sampleProject()
    const ok = parseProjectText(
      JSON.stringify({ ...project, ui: { lastTime: 5, coverTime: 249.5 } })
    )
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.project.ui?.coverTime).toBe(249.5)
    const bad = parseProjectText(JSON.stringify({ ...project, ui: { lastTime: 5, coverTime: -1 } }))
    expect(bad.ok).toBe(false)
  })
})
