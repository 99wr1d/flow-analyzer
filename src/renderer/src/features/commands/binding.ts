// Сочетания клавиш: разбор, сравнение и подписи. Чистые функции без доступа к DOM-состоянию.
// Клавиша задаётся физическим кодом (KeyboardEvent.code), поэтому всё работает и в русской раскладке.
import type { Binding } from '../../../../shared/settings'

export type { Binding }

const MODIFIER_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'AltGraph',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Fn',
  'Unidentified',
  ''
])

export const isModifierCode = (code: string): boolean => MODIFIER_CODES.has(code)

export function makeBinding(
  code: string,
  mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}
): Binding {
  return { code, ctrl: !!mods.ctrl, alt: !!mods.alt, shift: !!mods.shift }
}

type EventLike = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>

/** Сочетание из нажатия. null — нажат только модификатор или клавиша неопознана. Cmd приравнивается к Ctrl. */
export function bindingFromEvent(e: EventLike): Binding | null {
  if (isModifierCode(e.code)) return null
  return makeBinding(e.code, { ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey })
}

export function bindingsEqual(a: Binding, b: Binding): boolean {
  return a.code === b.code && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift
}

/** Точное совпадение: лишние модификаторы не допускаются (Shift+A не срабатывает как A). */
export function matchesBinding(binding: Binding, e: EventLike): boolean {
  const pressed = bindingFromEvent(e)
  return pressed !== null && bindingsEqual(binding, pressed)
}

/** Строка для хранения и сравнения: «Ctrl+Shift+KeyZ». */
export function serializeBinding(b: Binding): string {
  return [b.ctrl ? 'Ctrl' : '', b.alt ? 'Alt' : '', b.shift ? 'Shift' : '', b.code]
    .filter(Boolean)
    .join('+')
}

/** Обратная операция к serializeBinding. null — строка не похожа на сочетание. */
export function parseBinding(text: string): Binding | null {
  const parts = text.split('+')
  const code = parts.pop()
  if (!code || !/^[A-Za-z0-9]{1,24}$/.test(code) || isModifierCode(code)) return null
  const mods = { ctrl: false, alt: false, shift: false }
  for (const part of parts) {
    if (part === 'Ctrl') mods.ctrl = true
    else if (part === 'Alt') mods.alt = true
    else if (part === 'Shift') mods.shift = true
    else return null
  }
  return makeBinding(code, mods)
}

const NAMED: Record<string, string> = {
  Space: 'Пробел',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Enter: 'Enter',
  NumpadEnter: 'Num Enter',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Insert: 'Insert',
  BracketLeft: '[',
  BracketRight: ']',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num −',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .'
}

/** Человеческое имя клавиши: KeyZ → «Z», Digit1 → «1», Space → «Пробел». */
export function codeLabel(code: string): string {
  const named = NAMED[code]
  if (named) return named
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1]
  m = /^Digit(\d)$/.exec(code)
  if (m) return m[1]
  m = /^Numpad(\d)$/.exec(code)
  if (m) return `Num ${m[1]}`
  m = /^F(\d{1,2})$/.exec(code)
  if (m) return `F${m[1]}`
  return code
}

/** «Ctrl+Shift+Z», «Пробел», «←». */
export function formatBinding(b: Binding): string {
  return [b.ctrl ? 'Ctrl' : '', b.alt ? 'Alt' : '', b.shift ? 'Shift' : '', codeLabel(b.code)]
    .filter(Boolean)
    .join('+')
}

export function formatBindings(list: readonly Binding[]): string {
  return list.map(formatBinding).join(' / ')
}

/** Клавиши, которые нельзя назначать: они нужны для перемещения по интерфейсу. */
const RESERVED_CODES = new Set(['Tab', 'ContextMenu'])

export function isAssignable(b: Binding): boolean {
  return !RESERVED_CODES.has(b.code)
}
