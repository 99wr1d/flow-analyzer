import { describe, expect, it } from 'vitest'
import { DEFAULT_TAGS } from '../../../../shared/settings'
import { makeBinding } from '../commands/binding'
import {
  TAG_SWATCHES,
  buildSettings,
  canAddTag,
  hasErrors,
  moveItem,
  newTagDraft,
  parseSeconds,
  tagToDraft,
  validateTagDraft,
  type TagDraft
} from './draft'

const draft = (patch = {}): TagDraft => ({ ...tagToDraft(DEFAULT_TAGS[0]), ...patch })

describe('черновик тегов', () => {
  it('секунды: числа, запятая, границы 0…60', () => {
    expect(parseSeconds('5')).toBe(5)
    expect(parseSeconds(' 2,5 ')).toBe(2.5)
    expect(parseSeconds('0')).toBe(0)
    expect(parseSeconds('60')).toBe(60)
    for (const bad of ['', 'abc', '-1', '60.1', '1e2', '1.', '.5', '5 с']) {
      expect(parseSeconds(bad), bad).toBeNull()
    }
  })

  it('проверка полей', () => {
    expect(hasErrors(validateTagDraft(draft()))).toBe(false)
    expect(validateTagDraft(draft({ name: '   ' })).name).toBeDefined()
    expect(validateTagDraft(draft({ name: 'я'.repeat(41) })).name).toBeDefined()
    expect(validateTagDraft(draft({ name: 'я'.repeat(40) })).name).toBeUndefined()
    expect(validateTagDraft(draft({ color: '#12345' })).color).toBeDefined()
    expect(validateTagDraft(draft({ color: 'red' })).color).toBeDefined()
    expect(validateTagDraft(draft({ color: '#AbCdEf' })).color).toBeUndefined()
    expect(validateTagDraft(draft({ pre: '61' })).pre).toBeDefined()
    expect(validateTagDraft(draft({ post: 'x' })).post).toBeDefined()
  })

  it('сборка настроек: обрезка имени, цвет в нижнем регистре, числа', () => {
    const result = buildSettings(
      [draft({ name: '  Моя  ', color: '#AABBCC', pre: '2,5', post: '0' })],
      {}
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.settings.tags[0]).toMatchObject({
        name: 'Моя',
        color: '#aabbcc',
        preSeconds: 2.5,
        postSeconds: 0
      })
    }
  })

  it('сборка отказывает при ошибках в полях', () => {
    expect(buildSettings([draft({ name: '' })], {}).ok).toBe(false)
  })

  it('в файл попадают только настоящие переопределения клавиш', () => {
    const tags = DEFAULT_TAGS.map(tagToDraft)
    const result = buildSettings(tags, {
      'tag:attack': [makeBinding('Digit1')], // как стандартная — лишнее
      'tag:defense': [makeBinding('KeyQ')], // переопределение
      'tag:deleted': [makeBinding('KeyW')], // тега нет
      'playback:toggle': [makeBinding('KeyK')],
      'general:undo': [makeBinding('KeyZ', { ctrl: true })] // как стандартная
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Object.keys(result.settings.keybindings).sort()).toEqual([
        'playback:toggle',
        'tag:defense'
      ])
      expect(result.settings.keybindings['tag:defense']).toEqual([makeBinding('KeyQ')])
    }
  })

  it('порядок: сдвиг вверх и вниз, границы не нарушаются', () => {
    expect(moveItem([1, 2, 3], 1, -1)).toEqual([2, 1, 3])
    expect(moveItem([1, 2, 3], 1, 1)).toEqual([1, 3, 2])
    expect(moveItem([1, 2, 3], 0, -1)).toEqual([1, 2, 3])
    expect(moveItem([1, 2, 3], 2, 1)).toEqual([1, 2, 3])
  })

  it('новый тег: свободный цвет, уникальный id; предел 30 тегов', () => {
    const existing = DEFAULT_TAGS.map(tagToDraft)
    const created = newTagDraft(existing, 'Новый')
    expect(existing.some((t) => t.id === created.id)).toBe(false)
    expect(TAG_SWATCHES).toContain(created.color)
    expect(existing.some((t) => t.color === created.color)).toBe(false)
    expect(canAddTag(29)).toBe(true)
    expect(canAddTag(30)).toBe(false)
  })
})
