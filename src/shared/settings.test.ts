import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TAGS,
  DEFAULT_TAG_KEYS,
  MAX_TAGS,
  SETTINGS_VERSION,
  TagDefSchema,
  type TagDef,
  defaultSettings,
  parseSettings,
  tagCommandId
} from './settings'

describe('настройки по умолчанию', () => {
  it('проходят собственную проверку', () => {
    const result = parseSettings(defaultSettings())
    expect(result.ok).toBe(true)
  })

  it('девять стандартных тегов с клавишами Digit1–Digit9', () => {
    expect(DEFAULT_TAGS.map((t) => t.name)).toEqual([
      'Атака',
      'Оборона',
      'Переход в атаку',
      'Переход в оборону',
      'Стандарт',
      'Удар',
      'Гол',
      'Потеря',
      'Отбор'
    ])
    expect(DEFAULT_TAGS[0].id && DEFAULT_TAG_KEYS[DEFAULT_TAGS[0].id]).toBe('Digit1')
    expect(DEFAULT_TAG_KEYS[DEFAULT_TAGS[8].id]).toBe('Digit9')
    expect(new Set(DEFAULT_TAGS.map((t) => t.color)).size).toBe(9)
    for (const t of DEFAULT_TAGS) {
      expect(t.preSeconds).toBe(5)
      expect(t.postSeconds).toBe(5)
    }
  })

  it('tagCommandId', () => {
    expect(tagCommandId('goal')).toBe('tag:goal')
  })
})

describe('parseSettings', () => {
  it('принимает корректный файл', () => {
    const result = parseSettings({
      version: 1,
      keybindings: { 'playback:toggle': [{ code: 'KeyK', ctrl: false, alt: false, shift: false }] },
      tags: [{ id: 'a', name: ' Тест ', color: '#AABBCC', preSeconds: 2, postSeconds: 0 }]
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.settings.tags[0].name).toBe('Тест')
  })

  it('миграция: отсутствующие поля заполняются значениями по умолчанию', () => {
    const empty = parseSettings({})
    expect(empty.ok).toBe(true)
    if (empty.ok) {
      expect(empty.settings.version).toBe(SETTINGS_VERSION)
      expect(empty.settings.keybindings).toEqual({})
      expect(empty.settings.tags).toHaveLength(9)
    }
    const onlyKeys = parseSettings({
      version: 1,
      keybindings: { 'draw:arrow': [{ code: 'KeyQ' }] }
    })
    expect(onlyKeys.ok).toBe(true)
    if (onlyKeys.ok) {
      // Модификаторы тоже необязательны.
      expect(onlyKeys.settings.keybindings['draw:arrow'][0]).toEqual({
        code: 'KeyQ',
        ctrl: false,
        alt: false,
        shift: false
      })
      expect(onlyKeys.settings.tags).toHaveLength(9)
    }
  })

  it.each([
    ['не объект', 'строка'],
    ['массив', []],
    ['null', null],
    ['будущая версия', { version: 2 }],
    [
      'пустое имя тега',
      { tags: [{ id: 'a', name: '  ', color: '#112233', preSeconds: 1, postSeconds: 1 }] }
    ],
    [
      'длинное имя',
      { tags: [{ id: 'a', name: 'я'.repeat(41), color: '#112233', preSeconds: 1, postSeconds: 1 }] }
    ],
    [
      'плохой цвет',
      { tags: [{ id: 'a', name: 'A', color: 'red', preSeconds: 1, postSeconds: 1 }] }
    ],
    [
      'секунды больше 60',
      { tags: [{ id: 'a', name: 'A', color: '#112233', preSeconds: 61, postSeconds: 1 }] }
    ],
    [
      'отрицательные секунды',
      { tags: [{ id: 'a', name: 'A', color: '#112233', preSeconds: 1, postSeconds: -1 }] }
    ],
    [
      'плохой id',
      { tags: [{ id: 'a b', name: 'A', color: '#112233', preSeconds: 1, postSeconds: 1 }] }
    ],
    [
      'повтор id',
      {
        tags: [
          { id: 'a', name: 'A', color: '#112233', preSeconds: 1, postSeconds: 1 },
          { id: 'a', name: 'B', color: '#112233', preSeconds: 1, postSeconds: 1 }
        ]
      }
    ],
    ['сочетание без клавиши', { keybindings: { x: [{ code: '' }] } }],
    ['клавиша со спецсимволами', { keybindings: { x: [{ code: 'Key A' }] } }],
    ['keybindings не объект', { keybindings: [] }]
  ])('отклоняет: %s', (_name, input) => {
    expect(parseSettings(input).ok).toBe(false)
  })

  it('не больше 30 тегов', () => {
    const make = (n: number): TagDef[] =>
      Array.from({ length: n }, (_, i) => ({
        id: `t${i}`,
        name: `T${i}`,
        color: '#112233',
        preSeconds: 1,
        postSeconds: 1
      }))
    expect(parseSettings({ tags: make(MAX_TAGS) }).ok).toBe(true)
    expect(parseSettings({ tags: make(MAX_TAGS + 1) }).ok).toBe(false)
  })

  it('TagDefSchema обрезает пробелы в имени', () => {
    const t = TagDefSchema.parse({
      id: 'a',
      name: '  Гол  ',
      color: '#ff0000',
      preSeconds: 0,
      postSeconds: 60
    })
    expect(t.name).toBe('Гол')
  })
})
