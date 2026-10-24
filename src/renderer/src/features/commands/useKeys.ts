import { useSettingsStore } from '../settings/settingsStore'
import { formatBindings } from './binding'
import { BOARD_COMMANDS, STATIC_COMMANDS, tagCommand } from './definitions'
import { effectiveBindings, type CommandMeta } from './keymap'
import type { TagDef } from '../../../../shared/settings'

/** Подпись клавиш команды, например «Ctrl+O» или «Delete / Backspace». Пусто, если клавиша не назначена. */
export function useKeysLabel(meta: CommandMeta | undefined): string {
  const overrides = useSettingsStore((s) => s.settings.keybindings)
  return meta ? formatBindings(effectiveBindings(meta, overrides)) : ''
}

const staticById = new Map([...STATIC_COMMANDS, ...BOARD_COMMANDS].map((c) => [c.id, c]))

/** Первая клавиша команды: «A», «Ctrl+O». Пусто, если не назначена (учитывает переназначение). */
export function useFirstKey(commandId: string): string {
  const overrides = useSettingsStore((s) => s.settings.keybindings)
  const meta = staticById.get(commandId)
  const first = meta ? effectiveBindings(meta, overrides)[0] : undefined
  return first ? formatBindings([first]) : ''
}

/** Подсказка для title кнопки: « (A)». */
export function useKeyHint(commandId: string): string {
  const key = useFirstKey(commandId)
  return key ? ` (${key})` : ''
}

export function useTagKeys(tag: TagDef): string {
  return useKeysLabel(tagCommand(tag))
}
