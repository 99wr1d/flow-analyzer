import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_TAGS, tagCommandId, type TagDef } from '../../../../shared/settings'
import { ru } from '../../i18n/ru'
import { CloseIcon } from '../../ui/icons'
import type { Binding } from '../commands/binding'
import { allCommands } from '../commands/definitions'
import {
  assignBinding,
  effectiveBindings,
  findConflicts,
  resetBinding,
  setBindings,
  type Overrides
} from '../commands/keymap'
import { KeysTab } from './KeysTab'
import { TagsTab, type KeyApi } from './TagsTab'
import {
  buildSettings,
  hasErrors,
  moveItem,
  newTagDraft,
  tagToDraft,
  validateTagDraft,
  type TagDraft
} from './draft'
import { useSettingsStore } from './settingsStore'

type Tab = 'tags' | 'keys'

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'

/** Приближённое описание тега для списка команд: нужны только id и название. */
function looseTag(d: TagDraft): TagDef {
  return {
    id: d.id,
    name: d.name.trim() || ru.settings.newTag,
    color: d.color,
    preSeconds: 0,
    postSeconds: 0
  }
}

/** Окно настроек: теги и горячие клавиши. Изменения применяются по «Сохранить», «Отмена» их отбрасывает. */
export function SettingsDialog(): React.JSX.Element {
  const initial = useSettingsStore.getState().settings
  const close = useSettingsStore((s) => s.closeDialog)
  const apply = useSettingsStore((s) => s.apply)

  const [tab, setTab] = useState<Tab>('tags')
  const [tags, setTags] = useState<TagDraft[]>(() => initial.tags.map(tagToDraft))
  const [overrides, setOverrides] = useState<Overrides>(initial.keybindings)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [resetDone, setResetDone] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  const commands = useMemo(() => allCommands(tags.map(looseTag)), [tags])
  const invalid = tags.some((t) => hasErrors(validateTagDraft(t)))

  // Фокус внутрь при открытии и обратно при закрытии.
  useEffect(() => {
    const previous = document.activeElement
    dialogRef.current?.querySelector<HTMLElement>('[role="tab"]')?.focus()
    return () => {
      if (previous instanceof HTMLElement && document.contains(previous)) previous.focus()
    }
  }, [])

  // Esc закрывает окно, Tab не выпускает фокус наружу. Запись клавиши останавливает событие раньше.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      if (e.key !== 'Tab') return
      const root = dialogRef.current
      if (!root) return
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!root.contains(active)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  const keys: KeyApi = useMemo(
    () => ({
      bindingsOf: (id) => {
        const meta = commands.find((c) => c.id === id)
        return meta ? effectiveBindings(meta, overrides) : []
      },
      conflictsFor: (id, binding: Binding) =>
        findConflicts(commands, overrides, id, binding).map((c) => c.label),
      assign: (id, binding, replace) =>
        setOverrides((current) =>
          replace
            ? assignBinding(commands, current, id, binding)
            : setBindings(current, id, [binding])
        ),
      clear: (id) => setOverrides((current) => setBindings(current, id, []))
    }),
    [commands, overrides]
  )

  const patchTag = useCallback((id: string, patch: Partial<TagDraft>): void => {
    setTags((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const removeTag = (id: string): void => {
    setTags((list) => list.filter((t) => t.id !== id))
    setOverrides((current) => resetBinding(current, tagCommandId(id)))
  }

  const addTag = (): void => {
    const draft = newTagDraft(tags, ru.settings.newTag)
    setTags((list) => [...list, draft])
    setFocusId(draft.id)
  }

  const resetTags = (): void => {
    setTags(DEFAULT_TAGS.map(tagToDraft))
    setOverrides((current) => {
      const next: Record<string, readonly Binding[]> = {}
      for (const [id, list] of Object.entries(current)) if (!id.startsWith('tag:')) next[id] = list
      return next
    })
    setResetDone(true)
  }

  const save = async (): Promise<void> => {
    const built = buildSettings(tags, overrides)
    if (!built.ok) {
      setTab('tags')
      return
    }
    setSaving(true)
    setError(null)
    try {
      apply(await window.api.saveSettings(built.settings))
      close()
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : ru.settings.saveFailed)
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" data-testid="settings-backdrop">
      <div
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        data-testid="settings-dialog"
      >
        <header className="modal__head">
          <h2 id="settings-title" className="modal__title">
            {ru.settings.title}
          </h2>
          <button
            type="button"
            className="icon-btn"
            onClick={close}
            title={`${ru.settings.close} (Esc)`}
            aria-label={ru.settings.close}
            data-testid="settings-close"
          >
            <CloseIcon size={16} />
          </button>
        </header>
        <div className="tabs" role="tablist" aria-label={ru.settings.tabs}>
          {(['tags', 'keys'] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={tab === id}
              aria-controls="settings-panel"
              className={tab === id ? 'tabs__btn tabs__btn--active' : 'tabs__btn'}
              data-testid={`settings-tab-${id}`}
              onClick={() => setTab(id)}
            >
              {id === 'tags' ? ru.settings.tabTags : ru.settings.tabKeys}
            </button>
          ))}
        </div>
        <div
          className="modal__body"
          role="tabpanel"
          id="settings-panel"
          aria-labelledby={`settings-tab-${tab}`}
        >
          {tab === 'tags' ? (
            <TagsTab
              tags={tags}
              keys={keys}
              focusId={focusId}
              onChange={patchTag}
              onMove={(i, d) => setTags((list) => moveItem(list, i, d))}
              onRemove={removeTag}
              onAdd={addTag}
              onReset={resetTags}
              resetDone={resetDone}
            />
          ) : (
            <KeysTab
              commands={commands}
              overrides={overrides}
              keys={keys}
              onReset={(id) => setOverrides((current) => resetBinding(current, id))}
              onResetAll={() => setOverrides({})}
            />
          )}
        </div>
        <footer className="modal__foot">
          <span
            className="modal__error"
            role={error || invalid ? 'alert' : undefined}
            data-testid="settings-error"
          >
            {error ?? (invalid ? ru.settings.fixFields : '')}
          </span>
          <button type="button" className="btn" onClick={close} data-testid="settings-cancel">
            {ru.settings.cancel}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={saving || invalid}
            onClick={() => void save()}
            data-testid="settings-save"
          >
            {saving ? ru.settings.saving : ru.settings.save}
          </button>
        </footer>
      </div>
    </div>
  )
}
