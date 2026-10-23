import { describe, expect, it } from 'vitest'
import { DEFAULT_TAGS } from '../../../../shared/settings'
import { makeBinding } from './binding'
import { STATIC_COMMANDS, allCommands } from './definitions'
import {
  assignBinding,
  buildKeymap,
  compactOverrides,
  effectiveBindings,
  findConflicts,
  isOverridden,
  resetBinding,
  setBindings,
  type CommandMeta
} from './keymap'

const cmd = (id: string, ...codes: string[]): CommandMeta => ({
  id,
  label: id,
  group: 'Общее',
  defaults: codes.map((c) => makeBinding(c))
})

describe('раскладка команд', () => {
  const a = cmd('a', 'KeyA')
  const b = cmd('b', 'KeyB', 'KeyC')
  const list = [a, b]

  it('эффективные сочетания: переопределение главнее стандартных', () => {
    expect(effectiveBindings(a, {})).toEqual([makeBinding('KeyA')])
    expect(effectiveBindings(a, { a: [makeBinding('KeyQ')] })).toEqual([makeBinding('KeyQ')])
    expect(effectiveBindings(a, { a: [] })).toEqual([])
    expect(isOverridden(a, { a: [makeBinding('KeyA')] })).toBe(false)
    expect(isOverridden(a, { a: [makeBinding('KeyQ')] })).toBe(true)
    expect(isOverridden(a, {})).toBe(false)
  })

  it('таблица «сочетание → команда»', () => {
    const map = buildKeymap(list, { a: [makeBinding('KeyQ')] })
    expect(map.get('KeyQ')?.map((c) => c.id)).toEqual(['a'])
    expect(map.has('KeyA')).toBe(false)
    expect(map.get('KeyC')?.map((c) => c.id)).toEqual(['b'])
  })

  it('конфликты: другие команды с тем же сочетанием', () => {
    expect(findConflicts(list, {}, 'a', makeBinding('KeyB')).map((c) => c.id)).toEqual(['b'])
    expect(findConflicts(list, {}, 'a', makeBinding('KeyA'))).toEqual([])
    expect(findConflicts(list, {}, 'a', makeBinding('KeyZ'))).toEqual([])
    // Модификатор делает сочетание другим.
    expect(findConflicts(list, {}, 'a', makeBinding('KeyB', { shift: true }))).toEqual([])
    // Снятая клавиша больше не конфликтует.
    expect(findConflicts(list, { b: [] }, 'a', makeBinding('KeyB'))).toEqual([])
  })

  it('замена: сочетание снимается у других, у них остаются остальные', () => {
    const next = assignBinding(list, {}, 'a', makeBinding('KeyC'))
    expect(next.a).toEqual([makeBinding('KeyC')])
    expect(next.b).toEqual([makeBinding('KeyB')])
    expect(findConflicts(list, next, 'a', makeBinding('KeyC'))).toEqual([])
  })

  it('сброс и компактный вид переопределений', () => {
    const o = setBindings({}, 'a', [makeBinding('KeyQ')])
    expect(resetBinding(o, 'a')).toEqual({})
    const compact = compactOverrides(list, {
      a: [makeBinding('KeyA')], // как стандартное — лишнее
      b: [makeBinding('KeyB')], // отличается (стандартных два) — оставить
      gone: [makeBinding('KeyZ')] // такой команды нет
    })
    expect(Object.keys(compact)).toEqual(['b'])
  })
})

describe('команды приложения', () => {
  it('стандартные клавиши не конфликтуют друг с другом', () => {
    const commands = allCommands(DEFAULT_TAGS)
    const map = buildKeymap(commands, {})
    for (const [key, owners] of map) {
      expect(
        owners.map((c) => c.id),
        `сочетание ${key}`
      ).toHaveLength(1)
    }
  })

  it('все прежние горячие клавиши на месте', () => {
    const keys = (id: string): string[] =>
      effectiveBindings(
        STATIC_COMMANDS.find((c) => c.id === id)!,
        {}
      ).map((b) => `${b.ctrl ? 'C+' : ''}${b.shift ? 'S+' : ''}${b.code}`)
    expect(keys('playback:toggle')).toEqual(['Space'])
    expect(keys('playback:frame-back')).toEqual(['ArrowLeft'])
    expect(keys('playback:second-forward')).toEqual(['S+ArrowRight'])
    expect(keys('playback:slower')).toEqual(['BracketLeft'])
    expect(keys('playback:faster')).toEqual(['BracketRight'])
    expect(keys('playback:mute')).toEqual(['KeyM'])
    expect(keys('general:open-video')).toEqual(['C+KeyO'])
    expect(keys('general:undo')).toEqual(['C+KeyZ'])
    expect(keys('general:redo')).toEqual(['C+KeyY', 'C+S+KeyZ'])
    expect(keys('general:delete')).toEqual(['Delete', 'Backspace'])
    expect(keys('general:escape')).toEqual(['Escape'])
    expect(['select', 'arrow', 'line', 'circle', 'text'].map((t) => keys(`draw:${t}`)[0])).toEqual([
      'KeyV',
      'KeyA',
      'KeyL',
      'KeyC',
      'KeyT'
    ])
  })

  it('клавиши новых инструментов: группа «Рисование», свободные клавиши, Enter завершает зону', () => {
    const expected: Record<string, string> = {
      'draw:spot': 'KeyS',
      'draw:curve': 'KeyB',
      'draw:pen': 'KeyD',
      'draw:zone': 'KeyZ',
      'draw:chain': 'KeyN',
      'draw:link': 'KeyK',
      'draw:loupe': 'KeyG',
      'draw:finish': 'Enter'
    }
    for (const [id, code] of Object.entries(expected)) {
      const command = STATIC_COMMANDS.find((c) => c.id === id)!
      expect(command, id).toBeTruthy()
      expect(command.group).toBe('Рисование')
      expect(command.defaults.map((b) => b.code)).toEqual([code])
      expect(command.defaults[0].ctrl).toBe(false)
    }
  })

  it('клавиша пользователя сильнее новой стандартной: «Связка» (K) не перехватывает чужое назначение', () => {
    const all = allCommands(DEFAULT_TAGS)
    // Пользователь повесил на K «Лупу» (она в списке после «Связки»): нажатие K должно запускать лупу.
    const map = buildKeymap(all, { 'draw:loupe': [makeBinding('KeyK')] })
    expect(map.get('KeyK')?.map((c) => c.id)).toEqual(['draw:loupe', 'draw:link'])
    // Без назначений K — «Связка».
    expect(
      buildKeymap(all, {})
        .get('KeyK')
        ?.map((c) => c.id)
    ).toEqual(['draw:link'])
    // Пользователь снял K со «Связки» — клавиша свободна.
    expect(buildKeymap(all, { 'draw:link': [] }).has('KeyK')).toBe(false)
  })

  it('автоповтор разрешён только для покадрового шага', () => {
    const repeating = STATIC_COMMANDS.filter((c) => c.repeat).map((c) => c.id)
    expect(repeating.sort()).toEqual([
      'playback:frame-back',
      'playback:frame-forward',
      'playback:second-back',
      'playback:second-forward'
    ])
  })

  it('теги 1–9 привязаны к Digit1–Digit9', () => {
    const commands = allCommands(DEFAULT_TAGS).filter((c) => c.group === 'Теги')
    expect(commands.map((c) => c.defaults[0].code)).toEqual(
      Array.from({ length: 9 }, (_, i) => `Digit${i + 1}`)
    )
  })

  it('у нового тега клавиши нет', () => {
    const extra = allCommands([
      ...DEFAULT_TAGS,
      { id: 'mine', name: 'Мой', color: '#112233', preSeconds: 1, postSeconds: 1 }
    ]).find((c) => c.id === 'tag:mine')
    expect(extra?.defaults).toEqual([])
  })
})
