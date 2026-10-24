import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { parseBoardText } from './file'
import { boardToFile, newBoard } from './schema'

const now = new Date('2026-10-23T10:00:00.000Z')
const ID = '11111111-1111-4111-8111-111111111111'

const figure = {
  kind: 'figure',
  set: 'gk',
  pose: 'set',
  facing: 'front',
  pos: { x: 0.5, y: 0.5 },
  scale: 1,
  rotation: 0,
  color: '#ff0000'
}

const textWith = (states: unknown[]): string =>
  JSON.stringify({
    ...newBoard('Бросок', now),
    frameCount: 3,
    items: [{ id: ID, show: { from: 0, to: 2 }, el: figure, states }]
  })

describe('parseBoardText: проверка состояний', () => {
  it('geom с null вместо точки — invalid, текст по-русски', () => {
    const r = parseBoardText(textWith([{ frame: 1, geom: { pos: null } }]))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('invalid')
      expect(r.message).toBe('Файл доски повреждён')
      expect(r.detail).toBeTruthy()
    }
  })

  it('поза чужого набора в состоянии — invalid', () => {
    const r = parseBoardText(textWith([{ frame: 1, pose: 'run' }]))
    expect(r.ok === false && r.error).toBe('invalid')
  })

  it('схема-ошибка тоже даёт фиксированный русский текст', () => {
    const base = JSON.parse(boardToFile(newBoard('x', now)))
    const r = parseBoardText(JSON.stringify({ ...base, frameCount: 0 }))
    expect(r.ok === false && r.message).toBe('Файл доски повреждён')
  })

  it('корректные состояния проходят', () => {
    const r = parseBoardText(
      textWith([{ frame: 1, geom: { pos: { x: 0.2, y: 0.3 } }, pose: 'step', facing: 'left' }])
    )
    expect(r.ok).toBe(true)
  })
})

describe('формат v1 (golden)', () => {
  const text = readFileSync(join(__dirname, '../../../tests/fixtures/board-v1.flowboard'), 'utf8')

  it('разбирается и записывается обратно без изменений', () => {
    const r = parseBoardText(text)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(boardToFile(r.board)).toBe(text.replace(/\r\n/g, '\n').trimEnd())
  })

  it('содержит все виды элементов', () => {
    const r = parseBoardText(text)
    if (!r.ok) throw new Error(r.message)
    const kinds = new Set(r.board.items.map((i) => i.el.kind))
    expect([...kinds].sort()).toEqual(
      ['equip', 'figure', 'hatch', 'number', 'shape', 'token', 'wavy'].sort()
    )
    const anns = new Set(
      r.board.items.flatMap((i) => (i.el.kind === 'shape' ? [i.el.ann.type] : []))
    )
    expect([...anns].sort()).toEqual(
      ['arrow', 'circle', 'curve', 'line', 'pen', 'text', 'zone'].sort()
    )
  })
})
