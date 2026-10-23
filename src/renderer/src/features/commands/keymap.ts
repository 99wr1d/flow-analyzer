// Раскладка команд: какие сочетания действуют, конфликты, замена. Чистые функции — их легко проверять тестами.
import { bindingsEqual, serializeBinding, type Binding } from './binding'

export const COMMAND_GROUPS = [
  'Воспроизведение',
  'Рисование',
  'Эпизоды',
  'Теги',
  'Анализ',
  'Проект',
  'Экспорт',
  'Общее'
] as const
export type CommandGroup = (typeof COMMAND_GROUPS)[number]

/** Описание команды без действия: для настроек и проверок достаточно его. */
export interface CommandMeta {
  id: string
  label: string
  group: CommandGroup
  defaults: Binding[]
  /** Разрешён автоповтор при удержании клавиши (покадровый шаг). */
  repeat?: boolean
}

/** Переопределения из настроек: id команды → сочетания. Пустой список — клавиша снята. */
export type Overrides = Readonly<Record<string, readonly Binding[]>>

export function effectiveBindings(meta: CommandMeta, overrides: Overrides): readonly Binding[] {
  return overrides[meta.id] ?? meta.defaults
}

export function isOverridden(meta: CommandMeta, overrides: Overrides): boolean {
  const own = overrides[meta.id]
  if (!own) return false
  return !sameList(own, meta.defaults)
}

function sameList(a: readonly Binding[], b: readonly Binding[]): boolean {
  return a.length === b.length && a.every((x, i) => bindingsEqual(x, b[i]))
}

/** Таблица «сочетание → команды». Для одного сочетания команд может быть несколько только при конфликте. */
export function buildKeymap<T extends CommandMeta>(
  commands: readonly T[],
  overrides: Overrides
): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const command of commands) {
    for (const binding of effectiveBindings(command, overrides)) {
      const key = serializeBinding(binding)
      const list = map.get(key)
      if (list) list.push(command)
      else map.set(key, [command])
    }
  }
  // Клавиша, которую пользователь назначил сам, сильнее стандартной клавиши другой команды (в том числе новой в обновлении):
  // иначе новая команда с той же стандартной клавишей молча перехватила бы его назначение.
  for (const list of map.values()) {
    if (list.length > 1) list.sort((a, b) => Number(!overrides[a.id]) - Number(!overrides[b.id]))
  }
  return map
}

/** Другие команды, у которых уже есть это сочетание. */
export function findConflicts<T extends CommandMeta>(
  commands: readonly T[],
  overrides: Overrides,
  commandId: string,
  binding: Binding
): T[] {
  return commands.filter(
    (c) =>
      c.id !== commandId && effectiveBindings(c, overrides).some((b) => bindingsEqual(b, binding))
  )
}

export function setBindings(
  overrides: Overrides,
  commandId: string,
  bindings: readonly Binding[]
): Overrides {
  return { ...overrides, [commandId]: [...bindings] }
}

/** Назначает сочетание команде и снимает его у остальных (кнопка «Заменить» при конфликте). */
export function assignBinding<T extends CommandMeta>(
  commands: readonly T[],
  overrides: Overrides,
  commandId: string,
  binding: Binding
): Overrides {
  let next: Overrides = overrides
  for (const other of findConflicts(commands, overrides, commandId, binding)) {
    const rest = effectiveBindings(other, next).filter((b) => !bindingsEqual(b, binding))
    next = setBindings(next, other.id, rest)
  }
  return setBindings(next, commandId, [binding])
}

export function resetBinding(overrides: Overrides, commandId: string): Overrides {
  const next = { ...overrides }
  delete next[commandId]
  return next
}

/** Оставляет только настоящие переопределения: без совпадающих со стандартными и без неизвестных команд. */
export function compactOverrides(
  commands: readonly CommandMeta[],
  overrides: Overrides
): Overrides {
  const byId = new Map(commands.map((c) => [c.id, c]))
  const out: Record<string, readonly Binding[]> = {}
  for (const [id, list] of Object.entries(overrides)) {
    const meta = byId.get(id)
    if (meta && !sameList(list, meta.defaults)) out[id] = list
  }
  return out
}
