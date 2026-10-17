import { ru } from '../../i18n/ru'
import type { CommandMeta, Overrides } from '../commands/keymap'
import { COMMAND_GROUPS, isOverridden } from '../commands/keymap'
import { HotkeyField } from './HotkeyField'
import type { KeyApi } from './TagsTab'

interface Props {
  commands: readonly CommandMeta[]
  overrides: Overrides
  keys: KeyApi
  onReset: (commandId: string) => void
  onResetAll: () => void
}

export function KeysTab({
  commands,
  overrides,
  keys,
  onReset,
  onResetAll
}: Props): React.JSX.Element {
  const anyOverride = commands.some((c) => isOverridden(c, overrides))
  return (
    <div className="keys-tab">
      <div className="keys-tab__top">
        <p className="settings__hint">{ru.settings.keysHint}</p>
        <button
          type="button"
          className="btn btn--small"
          disabled={!anyOverride}
          data-testid="keys-reset-all"
          onClick={onResetAll}
        >
          {ru.settings.keyResetAll}
        </button>
      </div>
      {COMMAND_GROUPS.map((group) => {
        const list = commands.filter((c) => c.group === group)
        if (list.length === 0) return null
        return (
          <section key={group} className="keys-group" aria-label={group}>
            <h3 className="keys-group__title">{group}</h3>
            <ul className="keys-list">
              {list.map((c) => (
                <li key={c.id} className="keys-row" data-testid="keys-row" data-command={c.id}>
                  <span className="keys-row__label">{c.label}</span>
                  <HotkeyField
                    commandId={c.id}
                    label={c.label}
                    bindings={keys.bindingsOf(c.id)}
                    conflictsFor={(b) => keys.conflictsFor(c.id, b)}
                    onAssign={(b, replace) => keys.assign(c.id, b, replace)}
                    onClear={() => keys.clear(c.id)}
                  />
                  <button
                    type="button"
                    className="btn btn--small"
                    disabled={!isOverridden(c, overrides)}
                    aria-label={`${ru.settings.keyReset}: ${c.label}`}
                    data-testid="key-reset"
                    onClick={() => onReset(c.id)}
                  >
                    {ru.settings.keyReset}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
