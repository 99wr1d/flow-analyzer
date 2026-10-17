import { useState } from 'react'
import { MAX_TAG_NAME, tagCommandId } from '../../../../shared/settings'
import { ru } from '../../i18n/ru'
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TrashIcon } from '../../ui/icons'
import type { Binding } from '../commands/binding'
import { HotkeyField } from './HotkeyField'
import { TAG_SWATCHES, canAddTag, validateTagDraft, type TagDraft } from './draft'

export interface KeyApi {
  bindingsOf: (commandId: string) => readonly Binding[]
  conflictsFor: (commandId: string, binding: Binding) => string[]
  assign: (commandId: string, binding: Binding, replace: boolean) => void
  clear: (commandId: string) => void
}

interface RowProps {
  tag: TagDraft
  index: number
  count: number
  keys: KeyApi
  autoFocus: boolean
  onChange: (patch: Partial<TagDraft>) => void
  onMove: (direction: -1 | 1) => void
  onRemove: () => void
}

function TagRow({
  tag,
  index,
  count,
  keys,
  autoFocus,
  onChange,
  onMove,
  onRemove
}: RowProps): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const errors = validateTagDraft(tag)
  const commandId = tagCommandId(tag.id)
  const color = tag.color.trim().toLowerCase()

  return (
    <li className="tag-row" data-testid="tag-row" data-tag-id={tag.id}>
      <div className="tag-row__main">
        <span
          className="tag-row__dot"
          style={{ background: errors.color ? 'transparent' : tag.color }}
          aria-hidden="true"
        />
        <input
          type="text"
          className={errors.name ? 'input input--invalid tag-row__name' : 'input tag-row__name'}
          value={tag.name}
          maxLength={MAX_TAG_NAME + 10}
          aria-label={`${ru.settings.tagName} ${index + 1}`}
          aria-invalid={errors.name !== undefined}
          autoFocus={autoFocus}
          onFocus={(e) => autoFocus && e.currentTarget.select()}
          data-testid="tag-name"
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <HotkeyField
          commandId={commandId}
          label={tag.name || ru.settings.newTag}
          bindings={keys.bindingsOf(commandId)}
          conflictsFor={(b) => keys.conflictsFor(commandId, b)}
          onAssign={(b, replace) => keys.assign(commandId, b, replace)}
          onClear={() => keys.clear(commandId)}
        />
        <div className="tag-row__actions">
          <button
            type="button"
            className="icon-btn icon-btn--small"
            disabled={index === 0}
            title={ru.settings.tagUp}
            aria-label={`${ru.settings.tagUp}: ${tag.name}`}
            data-testid="tag-up"
            onClick={() => onMove(-1)}
          >
            <ArrowUpIcon size={15} />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--small"
            disabled={index === count - 1}
            title={ru.settings.tagDown}
            aria-label={`${ru.settings.tagDown}: ${tag.name}`}
            data-testid="tag-down"
            onClick={() => onMove(1)}
          >
            <ArrowDownIcon size={15} />
          </button>
          {confirming ? (
            <span className="tag-row__confirm" role="group" aria-label={ru.settings.tagRemoveAsk}>
              <span>{ru.settings.tagRemoveAsk}</span>
              <button
                type="button"
                className="btn btn--small btn--danger"
                data-testid="tag-remove-yes"
                onClick={onRemove}
              >
                {ru.settings.tagRemoveYes}
              </button>
              <button
                type="button"
                className="btn btn--small"
                data-testid="tag-remove-no"
                onClick={() => setConfirming(false)}
              >
                {ru.settings.tagRemoveNo}
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="icon-btn icon-btn--small"
              title={ru.settings.tagRemove}
              aria-label={`${ru.settings.tagRemove}: ${tag.name}`}
              data-testid="tag-remove"
              onClick={() => setConfirming(true)}
            >
              <TrashIcon size={15} />
            </button>
          )}
        </div>
      </div>
      <div className="tag-row__sub">
        <div className="tag-row__colors" role="group" aria-label={ru.settings.tagColor}>
          {TAG_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              className={color === c ? 'swatch swatch--active' : 'swatch'}
              style={{ background: c }}
              title={c}
              aria-label={`${ru.settings.tagColor} ${c}`}
              aria-pressed={color === c}
              data-testid="tag-swatch"
              onClick={() => onChange({ color: c })}
            />
          ))}
          <input
            type="text"
            className={errors.color ? 'input input--invalid tag-row__hex' : 'input tag-row__hex'}
            value={tag.color}
            maxLength={7}
            spellCheck={false}
            aria-label={ru.settings.tagHex}
            aria-invalid={errors.color !== undefined}
            data-testid="tag-hex"
            onChange={(e) => onChange({ color: e.target.value })}
          />
        </div>
        <label className="tag-row__sec">
          <span>{ru.settings.tagPre}</span>
          <input
            type="text"
            inputMode="decimal"
            className={errors.pre ? 'input input--invalid' : 'input'}
            value={tag.pre}
            aria-invalid={errors.pre !== undefined}
            data-testid="tag-pre"
            onChange={(e) => onChange({ pre: e.target.value })}
          />
        </label>
        <label className="tag-row__sec">
          <span>{ru.settings.tagPost}</span>
          <input
            type="text"
            inputMode="decimal"
            className={errors.post ? 'input input--invalid' : 'input'}
            value={tag.post}
            aria-invalid={errors.post !== undefined}
            data-testid="tag-post"
            onChange={(e) => onChange({ post: e.target.value })}
          />
        </label>
      </div>
      {(errors.name || errors.color || errors.pre || errors.post) && (
        <div className="field__hint field__hint--error" role="alert" data-testid="tag-errors">
          {[
            errors.name && ru.settings.errorName,
            errors.color && ru.settings.errorColor,
            (errors.pre || errors.post) && ru.settings.errorSeconds
          ]
            .filter(Boolean)
            .join('. ')}
        </div>
      )}
    </li>
  )
}

interface TabProps {
  tags: TagDraft[]
  keys: KeyApi
  focusId: string | null
  onChange: (id: string, patch: Partial<TagDraft>) => void
  onMove: (index: number, direction: -1 | 1) => void
  onRemove: (id: string) => void
  onAdd: () => void
  onReset: () => void
  resetDone: boolean
}

export function TagsTab(props: TabProps): React.JSX.Element {
  const { tags, keys, focusId, onChange, onMove, onRemove, onAdd, onReset, resetDone } = props
  const canAdd = canAddTag(tags.length)
  return (
    <div className="tags-tab">
      <p className="settings__hint">{ru.settings.tagsHint}</p>
      <ul className="tag-list" data-testid="tag-list">
        {tags.map((tag, i) => (
          <TagRow
            key={tag.id}
            tag={tag}
            index={i}
            count={tags.length}
            keys={keys}
            autoFocus={tag.id === focusId}
            onChange={(patch) => onChange(tag.id, patch)}
            onMove={(d) => onMove(i, d)}
            onRemove={() => onRemove(tag.id)}
          />
        ))}
      </ul>
      <div className="tags-tab__footer">
        <button
          type="button"
          className="btn"
          disabled={!canAdd}
          title={canAdd ? undefined : ru.settings.tagsLimit}
          data-testid="tag-add"
          onClick={onAdd}
        >
          <PlusIcon size={14} />
          {ru.settings.tagAdd}
        </button>
        <button type="button" className="btn" data-testid="tags-reset" onClick={onReset}>
          {ru.settings.tagsReset}
        </button>
        {resetDone && (
          <span className="settings__hint" role="status" data-testid="tags-reset-done">
            {ru.settings.tagsResetDone}
          </span>
        )}
      </div>
    </div>
  )
}
