import { describe, expect, it } from 'vitest'
import {
  bindingFromEvent,
  bindingsEqual,
  codeLabel,
  formatBinding,
  formatBindings,
  isAssignable,
  makeBinding,
  matchesBinding,
  parseBinding,
  serializeBinding
} from './binding'

const ev = (
  code: string,
  mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {}
): KeyboardEvent =>
  ({
    code,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...mods
  }) as KeyboardEvent

describe('сочетания клавиш', () => {
  it('из нажатия: код клавиши и модификаторы', () => {
    expect(bindingFromEvent(ev('KeyZ', { ctrlKey: true, shiftKey: true }))).toEqual({
      code: 'KeyZ',
      ctrl: true,
      alt: false,
      shift: true
    })
    expect(bindingFromEvent(ev('Digit1'))).toEqual(makeBinding('Digit1'))
  })

  it('Cmd (meta) считается как Ctrl', () => {
    expect(bindingFromEvent(ev('KeyO', { metaKey: true }))).toEqual(
      makeBinding('KeyO', { ctrl: true })
    )
  })

  it('только модификатор или неопознанная клавиша — null', () => {
    expect(bindingFromEvent(ev('ShiftLeft', { shiftKey: true }))).toBeNull()
    expect(bindingFromEvent(ev('ControlRight', { ctrlKey: true }))).toBeNull()
    expect(bindingFromEvent(ev('AltLeft', { altKey: true }))).toBeNull()
    expect(bindingFromEvent(ev('MetaLeft', { metaKey: true }))).toBeNull()
    expect(bindingFromEvent(ev('Unidentified'))).toBeNull()
    expect(bindingFromEvent(ev(''))).toBeNull()
  })

  it('совпадение точное: лишний или недостающий модификатор не подходит', () => {
    const undo = makeBinding('KeyZ', { ctrl: true })
    expect(matchesBinding(undo, ev('KeyZ', { ctrlKey: true }))).toBe(true)
    expect(matchesBinding(undo, ev('KeyZ', { ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(matchesBinding(undo, ev('KeyZ'))).toBe(false)
    expect(matchesBinding(makeBinding('KeyM'), ev('KeyM', { shiftKey: true }))).toBe(false)
    expect(matchesBinding(makeBinding('KeyM'), ev('KeyM', { altKey: true }))).toBe(false)
  })

  it('не зависит от раскладки: сравнивается физический код, а не символ', () => {
    // В русской раскладке клавиша V даёт «м», но code остаётся KeyV.
    expect(matchesBinding(makeBinding('KeyV'), ev('KeyV'))).toBe(true)
    expect(matchesBinding(makeBinding('BracketLeft'), ev('BracketLeft'))).toBe(true)
  })

  it('serialize ↔ parse', () => {
    const b = makeBinding('KeyZ', { ctrl: true, alt: true, shift: true })
    expect(serializeBinding(b)).toBe('Ctrl+Alt+Shift+KeyZ')
    expect(parseBinding('Ctrl+Alt+Shift+KeyZ')).toEqual(b)
    expect(parseBinding('Space')).toEqual(makeBinding('Space'))
    expect(parseBinding('Shift+ArrowLeft')).toEqual(makeBinding('ArrowLeft', { shift: true }))
    for (const text of ['', 'Ctrl+', 'Foo+KeyA', 'Ctrl+ShiftLeft', 'Key A', '+KeyA']) {
      expect(parseBinding(text)).toBeNull()
    }
  })

  it('bindingsEqual', () => {
    expect(bindingsEqual(makeBinding('KeyA'), makeBinding('KeyA'))).toBe(true)
    expect(bindingsEqual(makeBinding('KeyA'), makeBinding('KeyA', { shift: true }))).toBe(false)
    expect(bindingsEqual(makeBinding('KeyA'), makeBinding('KeyB'))).toBe(false)
  })

  it('человеческие названия', () => {
    expect(formatBinding(makeBinding('Space'))).toBe('Пробел')
    expect(formatBinding(makeBinding('ArrowLeft'))).toBe('←')
    expect(formatBinding(makeBinding('ArrowRight', { shift: true }))).toBe('Shift+→')
    expect(formatBinding(makeBinding('KeyZ', { ctrl: true }))).toBe('Ctrl+Z')
    expect(formatBinding(makeBinding('KeyZ', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+Z')
    expect(formatBinding(makeBinding('Digit1'))).toBe('1')
    expect(formatBinding(makeBinding('BracketLeft'))).toBe('[')
    expect(formatBinding(makeBinding('Comma', { ctrl: true }))).toBe('Ctrl+,')
    expect(formatBinding(makeBinding('Escape'))).toBe('Esc')
    expect(formatBinding(makeBinding('Numpad5'))).toBe('Num 5')
    expect(formatBinding(makeBinding('F5'))).toBe('F5')
    expect(codeLabel('SomethingNew')).toBe('SomethingNew')
    expect(formatBindings([makeBinding('Delete'), makeBinding('Backspace')])).toBe(
      'Delete / Backspace'
    )
  })

  it('Tab назначить нельзя', () => {
    expect(isAssignable(makeBinding('Tab'))).toBe(false)
    expect(isAssignable(makeBinding('KeyQ'))).toBe(true)
  })
})
