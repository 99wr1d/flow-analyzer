// Единый обработчик нажатий: ищет команду по сочетанию клавиш и запускает её.
import { useEffect } from 'react'
import type { Settings } from '../../../../shared/settings'
import { useExportStore } from '../export/exportStore'
import { useProjectStore } from '../project/projectStore'
import { useUnsavedStore } from '../project/unsavedStore'
import { useSettingsStore } from '../settings/settingsStore'
import { bindingFromEvent, serializeBinding } from './binding'
import { allCommands, type Command } from './definitions'
import { buildKeymap } from './keymap'
import { useKeymapStore } from './keymapStore'

/** Поля, где печатают текст: горячие клавиши там не срабатывают (ползунки — не в счёт). */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  return target instanceof HTMLInputElement && target.type !== 'range'
}

const SLIDER_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown'
])

/** Нажатия, которые элемент в фокусе обрабатывает сам: Пробел/Enter на кнопке, стрелки на ползунке. */
function handledNatively(e: KeyboardEvent): boolean {
  if (e.target instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) {
    return true
  }
  return e.target instanceof HTMLInputElement && SLIDER_KEYS.has(e.code)
}

let cache: { settings: Settings; map: Map<string, Command[]> } | null = null

function keymapFor(settings: Settings): Map<string, Command[]> {
  if (cache?.settings !== settings) {
    cache = { settings, map: buildKeymap(allCommands(settings.tags), settings.keybindings) }
  }
  return cache.map
}

export function handleKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing) return
  if (useKeymapStore.getState().capturing) return
  const state = useSettingsStore.getState()
  if (state.dialogOpen) return
  if (useExportStore.getState().open) return
  // Вопросы о проекте — модальные окна: пока они открыты, клавиши команд молчат.
  if (useUnsavedStore.getState().open || useProjectStore.getState().relink) return
  if (isTyping(e.target)) return
  const binding = bindingFromEvent(e)
  if (!binding) return
  const candidates = keymapFor(state.settings).get(serializeBinding(binding))
  if (!candidates || handledNatively(e)) return
  const command = candidates.find((c) => c.enabled?.() ?? true)
  if (!command) return
  e.preventDefault()
  // Автоповтор при удержании — только у команд, которые это разрешают (шаг по кадрам).
  if (e.repeat && !command.repeat) return
  command.run()
}

export function useCommandDispatcher(): void {
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
}
