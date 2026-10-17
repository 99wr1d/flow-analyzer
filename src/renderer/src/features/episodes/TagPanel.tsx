import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { useFirstKey, useKeyHint, useTagKeys } from '../commands/useKeys'
import { useSettingsStore } from '../settings/settingsStore'
import type { TagDef } from '../../../../shared/settings'
import { useEpisodesStore } from './episodesStore'
import { useFeedbackStore } from './feedbackStore'
import { applyTag, clearMarks, fmt, markIn, markOut } from './tagging'

function TagButton({ tag, disabled }: { tag: TagDef; disabled: boolean }): React.JSX.Element {
  const keys = useTagKeys(tag)
  const flash = useFeedbackStore((s) => (s.flash?.tagId === tag.id ? s.flash.nonce : 0))

  const title = `${tag.name}${keys ? ` (${keys})` : ''}. −${tag.preSeconds} / +${tag.postSeconds} ${ru.episodes.seconds}`
  return (
    <button
      type="button"
      className="tag-btn"
      style={{ '--tag': tag.color } as React.CSSProperties}
      disabled={disabled}
      title={title}
      aria-label={tag.name}
      data-testid="tag-button"
      data-tag-id={tag.id}
      onClick={(e) => {
        applyTag(tag.id)
        e.currentTarget.blur()
      }}
    >
      {flash > 0 && (
        <span key={flash} className="tag-btn__flash" aria-hidden="true" data-testid="tag-flash" />
      )}
      <span className="tag-btn__dot" aria-hidden="true" />
      <span className="tag-btn__name">{tag.name}</span>
      {keys && <kbd className="kbd">{keys}</kbd>}
    </button>
  )
}

function Marks({ disabled }: { disabled: boolean }): React.JSX.Element {
  const inPoint = useEpisodesStore((s) => s.inPoint)
  const outPoint = useEpisodesStore((s) => s.outPoint)
  const inKey = useFirstKey('episodes:in')
  const outKey = useFirstKey('episodes:out')
  const inHint = useKeyHint('episodes:in')
  const outHint = useKeyHint('episodes:out')
  const invalid = inPoint !== null && outPoint !== null && outPoint <= inPoint
  const both = inPoint !== null && outPoint !== null && !invalid
  const has = inPoint !== null || outPoint !== null

  return (
    <div className="marks" role="group" aria-label={ru.tagPanel.marks}>
      <div
        className={invalid ? 'marks__status marks__status--invalid' : 'marks__status'}
        data-testid="marks-status"
        data-in={inPoint ?? ''}
        data-out={outPoint ?? ''}
      >
        {ru.tagPanel.start}{' '}
        <b data-testid="mark-in-value">{inPoint === null ? ru.tagPanel.none : fmt(inPoint)}</b>
        {' · '}
        {ru.tagPanel.end}{' '}
        <b data-testid="mark-out-value">{outPoint === null ? ru.tagPanel.none : fmt(outPoint)}</b>
      </div>
      <div className="marks__buttons">
        <button
          type="button"
          className="btn btn--small"
          disabled={disabled}
          title={`${ru.tagPanel.setInTitle}${inHint}`}
          data-testid="set-in"
          onClick={(e) => {
            markIn()
            e.currentTarget.blur()
          }}
        >
          {ru.tagPanel.setIn}
          {inKey && <kbd className="kbd">{inKey}</kbd>}
        </button>
        <button
          type="button"
          className="btn btn--small"
          disabled={disabled}
          title={`${ru.tagPanel.setOutTitle}${outHint}`}
          data-testid="set-out"
          onClick={(e) => {
            markOut()
            e.currentTarget.blur()
          }}
        >
          {ru.tagPanel.setOut}
          {outKey && <kbd className="kbd">{outKey}</kbd>}
        </button>
        <button
          type="button"
          className="btn btn--small"
          disabled={!has}
          title={ru.tagPanel.clear}
          data-testid="clear-marks"
          onClick={(e) => {
            clearMarks()
            e.currentTarget.blur()
          }}
        >
          {ru.tagPanel.clear}
        </button>
      </div>
      <p
        className={invalid ? 'marks__hint marks__hint--invalid' : 'marks__hint'}
        data-testid="marks-hint"
      >
        {invalid ? ru.tagPanel.hintInvalid : both ? ru.tagPanel.hintPrecise : ru.tagPanel.hintQuick}
      </p>
    </div>
  )
}

/** Раздел «Теги»: метки Начало/Конец и сетка кнопок тегов. */
export function TagPanel(): React.JSX.Element {
  const tags = useSettingsStore((s) => s.settings.tags)
  const ready = usePlayerStore((s) => s.status === 'ready')
  return (
    <section className="tag-panel" aria-label={ru.tagPanel.label} data-testid="tag-panel">
      <div className="panel-header">
        <h2 className="panel-header__title">{ru.tagPanel.title}</h2>
      </div>
      <div className="tag-panel__body">
        <Marks disabled={!ready} />
        {tags.length === 0 ? (
          <p className="side-panel__empty">{ru.tagPanel.noTags}</p>
        ) : (
          <div className="tag-grid">
            {tags.map((tag) => (
              <TagButton key={tag.id} tag={tag} disabled={!ready} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
