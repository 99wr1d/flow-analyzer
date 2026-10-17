import { useEffect, useState } from 'react'
import { ru } from '../../i18n/ru'
import { bindingFromEvent, formatBinding, isAssignable, type Binding } from '../commands/binding'
import { useKeymapStore } from '../commands/keymapStore'

interface Props {
  commandId: string
  /** Название команды — для подписей и доступности. */
  label: string
  bindings: readonly Binding[]
  /** Имена других команд, у которых уже есть такое сочетание. */
  conflictsFor: (binding: Binding) => string[]
  /** replace = true — снять сочетание у других команд. */
  onAssign: (binding: Binding, replace: boolean) => void
  onClear: () => void
}

interface Pending {
  binding: Binding
  names: string[]
}

/**
 * Поле «горячая клавиша»: кнопка «Изменить» включает запись, следующее сочетание назначается команде.
 * Esc — отмена, Backspace — снять клавишу. Занятое сочетание не назначается молча: показываем, кем оно занято.
 */
export function HotkeyField(props: Props): React.JSX.Element {
  const { commandId, label, bindings, conflictsFor, onAssign, onClear } = props
  const [capturing, setCapturing] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const setGlobalCapture = useKeymapStore((s) => s.setCapturing)

  useEffect(() => {
    if (!capturing) return
    setGlobalCapture(true)
    const onKey = (e: KeyboardEvent): void => {
      // Всё, что нажато во время записи, принадлежит полю: ни диалог, ни команды этого не увидят.
      e.preventDefault()
      e.stopPropagation()
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey
      if (e.code === 'Escape') {
        setCapturing(false)
        return
      }
      if (e.code === 'Backspace' && plain) {
        setCapturing(false)
        setPending(null)
        onClear()
        return
      }
      const binding = bindingFromEvent(e)
      if (!binding) return // нажат только модификатор — ждём остальное
      if (!isAssignable(binding)) {
        setNote(ru.settings.keyReserved)
        return
      }
      setCapturing(false)
      // Пробел на кнопке «нажимает» её при отпускании — гасим, иначе запись включится снова.
      window.addEventListener('keyup', (ev) => ev.preventDefault(), { capture: true, once: true })
      const names = conflictsFor(binding)
      if (names.length > 0) setPending({ binding, names })
      else onAssign(binding, false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      setGlobalCapture(false)
    }
  }, [capturing, conflictsFor, onAssign, onClear, setGlobalCapture])

  return (
    <div className="hotkey" data-testid="hotkey-field" data-command={commandId}>
      <div className="hotkey__row">
        <span className="hotkey__keys" data-testid="hotkey-value">
          {capturing ? (
            <span className="hotkey__capture" data-testid="hotkey-capturing">
              {ru.settings.keyCapture}
            </span>
          ) : bindings.length === 0 ? (
            <span className="hotkey__none">{ru.settings.keyNone}</span>
          ) : (
            bindings.map((b) => (
              <kbd className="kbd" key={formatBinding(b)}>
                {formatBinding(b)}
              </kbd>
            ))
          )}
        </span>
        <button
          type="button"
          className={capturing ? 'btn btn--small btn--capturing' : 'btn btn--small'}
          aria-label={`${ru.settings.keyEdit}: ${label}`}
          data-testid="hotkey-edit"
          data-command={commandId}
          onClick={() => {
            setPending(null)
            setNote(null)
            setCapturing((c) => !c)
          }}
          onBlur={() => setCapturing(false)}
        >
          {ru.settings.keyEdit}
        </button>
      </div>
      {capturing && (
        <div className="hotkey__hint" data-testid="hotkey-hint">
          {note ?? ru.settings.keyCaptureHint}
        </div>
      )}
      {pending && (
        <div className="hotkey__conflict" role="alert" data-testid="hotkey-conflict">
          <span>
            <kbd className="kbd">{formatBinding(pending.binding)}</kbd>{' '}
            {ru.settings.keyConflict(pending.names.join('», «'))}
          </span>
          <span className="hotkey__conflict-actions">
            <button
              type="button"
              className="btn btn--small"
              data-testid="hotkey-replace"
              onClick={() => {
                onAssign(pending.binding, true)
                setPending(null)
              }}
            >
              {ru.settings.keyReplace}
            </button>
            <button
              type="button"
              className="btn btn--small"
              data-testid="hotkey-conflict-cancel"
              onClick={() => setPending(null)}
            >
              {ru.settings.keyCancel}
            </button>
          </span>
        </div>
      )}
    </div>
  )
}
