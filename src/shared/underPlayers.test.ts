// «Под игроками»: значения по умолчанию по виду рисунка, старые проекты, настройки газона в проекте.
import { describe, expect, it } from 'vitest'
import {
  AnnotationSchema,
  canBeUnder,
  defaultUnderPlayers,
  isUnderPlayers,
  type AnnotationType
} from './annotations'
import { parseProjectText } from './project'
import { sampleAnnotation, sampleProject, uuid } from './project.testkit'

const timing = { mode: 'range', start: 1, duration: 2 }
const style = { color: '#ffffff', width: 0.01, dash: 'solid' }
const ground = { space: 'pitch', calibrationId: uuid(77) }
const world = { x: 10, y: 20 }
const wp = [
  { x: 1, y: 1 },
  { x: 8, y: 1 },
  { x: 8, y: 7 }
]
const pts = [
  { x: 0.1, y: 0.1 },
  { x: 0.5, y: 0.1 },
  { x: 0.5, y: 0.5 }
]
const base = { id: uuid(1), style, timing }

/** Рисунок каждого вида в самом простом виде (как в файле старого проекта: без поля underPlayers). */
const OLD: Record<AnnotationType, Record<string, unknown>> = {
  arrow: { ...base, space: 'screen', type: 'arrow', p1: pts[0], p2: pts[1] },
  line: { ...base, space: 'screen', type: 'line', p1: pts[0], p2: pts[1] },
  circle: { ...base, space: 'screen', type: 'circle', p1: pts[0], p2: pts[1] },
  text: {
    ...base,
    space: 'screen',
    type: 'text',
    pos: pts[0],
    text: 'Пас',
    style: { color: '#fff000', size: 0.05, background: true }
  },
  spot: { ...base, space: 'screen', type: 'spot', p1: pts[0], p2: pts[1] },
  curve: { ...base, space: 'screen', type: 'curve', p1: pts[0], p2: pts[1], c: pts[2] },
  pen: { ...base, space: 'screen', type: 'pen', points: pts },
  zone: { ...base, space: 'screen', type: 'zone', points: pts },
  loupe: {
    ...base,
    space: 'screen',
    type: 'loupe',
    pos: pts[0],
    src: pts[1],
    radius: 0.1
  },
  chain: { ...base, space: 'screen', type: 'chain', points: pts },
  ring: { ...base, ...ground, type: 'ring', center: world, radius: 1 },
  parrow: { ...base, ...ground, type: 'parrow', p1: world, p2: { x: 15, y: 20 } },
  pline: { ...base, ...ground, type: 'pline', p1: world, p2: { x: 15, y: 20 } },
  ptext: {
    ...base,
    ...ground,
    type: 'ptext',
    pos: world,
    text: 'Игрок',
    style: { color: '#ffffff', size: 0.05, background: true }
  },
  ruler: { ...base, ...ground, type: 'ruler', p1: world, p2: { x: 15, y: 20 } },
  pspot: { ...base, ...ground, type: 'pspot', center: world, radius: 2 },
  pcurve: { ...base, ...ground, type: 'pcurve', p1: world, p2: { x: 15, y: 20 }, c: wp[2] },
  ppen: { ...base, ...ground, type: 'ppen', points: wp },
  pzone: { ...base, ...ground, type: 'pzone', points: wp },
  pchain: { ...base, ...ground, type: 'pchain', points: wp }
}

const GROUND_TYPES: AnnotationType[] = [
  'ring',
  'parrow',
  'pline',
  'pcurve',
  'ppen',
  'pzone',
  'pchain',
  'pspot',
  'ruler'
]

describe('underPlayers: значения по умолчанию по виду рисунка', () => {
  it('все 20 видов рисунков читаются без поля underPlayers (старые проекты)', () => {
    for (const [type, raw] of Object.entries(OLD)) {
      const parsed = AnnotationSchema.safeParse(raw)
      expect(parsed.success, type).toBe(true)
    }
    expect(Object.keys(OLD)).toHaveLength(20)
  })

  it('на траве под игроками по умолчанию: кольцо, стрелки, линии, перо, зона, связи, прожектор, линейка', () => {
    for (const [type, raw] of Object.entries(OLD)) {
      const a = AnnotationSchema.parse(raw)
      const want = GROUND_TYPES.includes(type as AnnotationType)
      expect(isUnderPlayers(a), type).toBe(want)
      expect(defaultUnderPlayers(type)).toBe(want)
    }
  })

  it('рисунки на экране и подписи по умолчанию поверх; подписи, лупа и затемнение — никогда под игроками', () => {
    for (const type of ['arrow', 'line', 'circle', 'curve', 'pen', 'zone', 'chain'] as const) {
      expect(isUnderPlayers(AnnotationSchema.parse(OLD[type])), type).toBe(false)
      // Рисунок на экране можно положить под игроков вручную.
      expect(isUnderPlayers({ type, underPlayers: true }), type).toBe(true)
    }
    for (const type of ['text', 'ptext', 'loupe', 'spot']) {
      expect(canBeUnder(type), type).toBe(false)
      expect(isUnderPlayers({ type, underPlayers: true }), type).toBe(false)
    }
  })

  it('явное значение сильнее умолчания и сохраняется схемой', () => {
    const off = AnnotationSchema.parse({ ...OLD.pzone, underPlayers: false })
    expect(isUnderPlayers(off)).toBe(false)
    expect((off as { underPlayers?: boolean }).underPlayers).toBe(false)
    const on = AnnotationSchema.parse({ ...OLD.circle, underPlayers: true })
    expect(isUnderPlayers(on)).toBe(true)
    expect(AnnotationSchema.safeParse({ ...OLD.zone, underPlayers: 'yes' }).success).toBe(false)
  })
})

describe('grassKey в проекте', () => {
  const key = { color: '#2a7d3e', similarity: 0.1, blend: 0.05, auto: false }

  it('необязателен: старый проект читается и без него, с ним — сохраняется как есть', () => {
    const project = sampleProject()
    expect('grassKey' in project).toBe(false)
    const old = parseProjectText(JSON.stringify(project))
    expect(old.ok).toBe(true)
    if (old.ok) expect(old.project.grassKey).toBeUndefined()
    const next = parseProjectText(JSON.stringify({ ...project, grassKey: key }))
    expect(next.ok).toBe(true)
    if (next.ok) expect(next.project.grassKey).toEqual(key)
  })

  it('неверные значения отклоняются с понятной ошибкой', () => {
    const project = sampleProject()
    for (const bad of [
      { ...key, similarity: 2 },
      { ...key, blend: -1 },
      { ...key, color: '#12' },
      { ...key, auto: 'да' },
      { color: key.color }
    ]) {
      const r = parseProjectText(JSON.stringify({ ...project, grassKey: bad }))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toContain('повреждён')
    }
  })

  it('проект с рисунками «под игроками» хранит флаг', () => {
    const project = sampleProject()
    const annotations = [{ ...sampleAnnotation(1), underPlayers: true }]
    const r = parseProjectText(JSON.stringify({ ...project, annotations }))
    expect(r.ok).toBe(true)
    if (r.ok)
      expect((r.project.annotations[0] as { underPlayers?: boolean }).underPlayers).toBe(true)
  })
})
