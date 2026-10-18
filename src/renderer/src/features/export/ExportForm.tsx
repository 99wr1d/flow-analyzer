import { useMemo } from 'react'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { episodeDuration } from '../../../../shared/episodes'
import { sortEpisodes, useEpisodesStore } from '../episodes/episodesStore'
import { fmtRange } from '../episodes/tagging'
import {
  closeExportDialog,
  currentExportPlan,
  drawingsEnabled,
  isFastMode,
  selectedForExport,
  startExport
} from './exportActions'
import { useExportStore } from './exportStore'
import {
  formatClock,
  parsePadding,
  episodesGenitive,
  pluralFiles,
  summarize,
  visibleEpisodes,
  type Scope
} from './selection'

function Radio(props: {
  name: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
  testId: string
  title: string
  hint?: string
}): React.JSX.Element {
  return (
    <label
      className={props.disabled ? 'opt opt--disabled' : props.checked ? 'opt opt--checked' : 'opt'}
    >
      <input
        type="radio"
        className="opt__input"
        name={props.name}
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onChange}
        data-testid={props.testId}
      />
      <span className="opt__radio" aria-hidden="true" />
      <span className="opt__text">
        <span className="opt__title">{props.title}</span>
        {props.hint && <span className="opt__hint">{props.hint}</span>}
      </span>
    </label>
  )
}

function Check(props: {
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  testId: string
  title: string
  hint?: string
}): React.JSX.Element {
  return (
    <label
      className={props.disabled ? 'opt opt--disabled' : props.checked ? 'opt opt--checked' : 'opt'}
    >
      <input
        type="checkbox"
        className="opt__input"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
        data-testid={props.testId}
      />
      <span className="opt__box" aria-hidden="true" />
      <span className="opt__text">
        <span className="opt__title">{props.title}</span>
        {props.hint && <span className="opt__hint">{props.hint}</span>}
      </span>
    </label>
  )
}

/** Шаг 1: что и как экспортировать. */
export function ExportForm(): React.JSX.Element {
  const state = useExportStore()
  const items = useEpisodesStore((s) => s.items)
  const filter = useEpisodesStore((s) => s.filter)
  const ratingFilter = useEpisodesStore((s) => s.ratingFilter)
  const duration = usePlayerStore((s) => s.duration)
  const set = useExportStore.setState

  const sorted = useMemo(() => sortEpisodes(items), [items])
  const visibleCount = useMemo(
    () => visibleEpisodes(sorted, filter, ratingFilter).length,
    [sorted, filter, ratingFilter]
  )
  const filtered = filter.length > 0 || ratingFilter.length > 0

  const padding = parsePadding(state.padding)
  const chosen = selectedForExport()
  const whole = state.scope === 'whole'
  const compilation = !whole && state.mode === 'compilation'
  const canStart = (whole ? duration > 0 : chosen.length > 0) && padding.ok
  const plan = currentExportPlan(state, chosen)
  const fast = isFastMode(state)
  const drawingsOn = drawingsEnabled(state, plan)
  const summary = summarize(
    chosen,
    padding.ok ? padding.value : 0,
    duration,
    drawingsOn ? plan.freezeSeconds : 0
  )
  const total = whole ? duration + (drawingsOn ? plan.freezeSeconds : 0) : summary.seconds
  const withFreezes = drawingsOn && plan.freezeSeconds > 0

  const pickSet = new Set(state.picked)
  const togglePick = (id: string): void =>
    set({ picked: pickSet.has(id) ? state.picked.filter((x) => x !== id) : [...state.picked, id] })
  const setScope = (scope: Scope): void => set({ scope, error: null })

  return (
    <>
      <div className="modal__body export__body">
        <fieldset className="export__group">
          <legend className="export__legend">{ru.export.scopeLabel}</legend>
          {filtered && (
            <Radio
              name="export-scope"
              checked={state.scope === 'visible'}
              onChange={() => setScope('visible')}
              testId="export-scope-visible"
              title={ru.export.scopeVisible(visibleCount)}
            />
          )}
          <Radio
            name="export-scope"
            checked={state.scope === 'all'}
            onChange={() => setScope('all')}
            testId="export-scope-all"
            disabled={sorted.length === 0}
            title={ru.export.scopeAll(sorted.length)}
          />
          <Radio
            name="export-scope"
            checked={state.scope === 'pick'}
            onChange={() => setScope('pick')}
            testId="export-scope-pick"
            disabled={sorted.length === 0}
            title={ru.export.scopePick}
          />
          <Radio
            name="export-scope"
            checked={whole}
            onChange={() => setScope('whole')}
            testId="export-scope-whole"
            title={ru.export.scopeWhole}
            hint={ru.export.scopeWholeHint}
          />
          {state.scope === 'pick' && (
            <div className="export__pick">
              <div className="export__pick-tools">
                <button
                  type="button"
                  className="btn btn--small"
                  data-testid="export-pick-all"
                  onClick={() => set({ picked: sorted.map((e) => e.id) })}
                >
                  {ru.export.pickAll}
                </button>
                <button
                  type="button"
                  className="btn btn--small"
                  data-testid="export-pick-none"
                  onClick={() => set({ picked: [] })}
                >
                  {ru.export.pickNone}
                </button>
              </div>
              <ul className="export__list" aria-label={ru.export.pickList}>
                {sorted.map((e) => (
                  <li key={e.id}>
                    <label
                      className="export__row"
                      style={{ '--tag': e.tagColor } as React.CSSProperties}
                    >
                      <input
                        type="checkbox"
                        checked={pickSet.has(e.id)}
                        onChange={() => togglePick(e.id)}
                        data-testid="export-pick-row"
                        data-id={e.id}
                      />
                      <span className="export__dot" aria-hidden="true" />
                      <span className="export__row-name">{e.tagName}</span>
                      <span className="export__row-time">{fmtRange(e.start, e.end)}</span>
                      <span className="export__row-dur">{episodeDuration(e).toFixed(1)} с</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </fieldset>

        {!whole && (
          <fieldset className="export__group">
            <legend className="export__legend">{ru.export.modeLabel}</legend>
            <div className="export__pair">
              <Radio
                name="export-mode"
                checked={state.mode === 'files'}
                onChange={() => set({ mode: 'files' })}
                testId="export-mode-files"
                title={ru.export.modeFiles}
                hint={ru.export.modeFilesHint}
              />
              <Radio
                name="export-mode"
                checked={compilation}
                onChange={() => set({ mode: 'compilation' })}
                testId="export-mode-compilation"
                title={ru.export.modeCompilation}
                hint={ru.export.modeCompilationHint}
              />
            </div>
          </fieldset>
        )}

        <fieldset className="export__group">
          <legend className="export__legend">{ru.export.precisionLabel}</legend>
          <Radio
            name="export-precision"
            checked={compilation || state.precision === 'precise'}
            onChange={() => set({ precision: 'precise' })}
            testId="export-precision-precise"
            title={ru.export.precisePrecise}
            hint={ru.export.preciseHint}
          />
          <Radio
            name="export-precision"
            checked={!compilation && state.precision === 'fast'}
            disabled={compilation}
            onChange={() => set({ precision: 'fast' })}
            testId="export-precision-fast"
            title={ru.export.precisionFast}
            hint={compilation ? ru.export.fastNotForCompilation : ru.export.fastHint}
          />
        </fieldset>

        <fieldset className="export__group">
          <legend className="export__legend">{ru.export.drawingsLabel}</legend>
          <Check
            checked={drawingsOn}
            disabled={fast || !plan.hasDrawings}
            onChange={(checked) => set({ withDrawings: checked, error: null })}
            testId="export-drawings"
            title={ru.export.drawingsTitle}
            hint={
              fast
                ? ru.export.drawingsFast
                : plan.hasDrawings
                  ? ru.export.drawingsHint
                  : ru.export.drawingsNone
            }
          />
        </fieldset>

        {!whole && (
          <div className="export__padding">
            <label className="export__padding-label" htmlFor="export-padding">
              {ru.export.paddingLabel}
            </label>
            <input
              id="export-padding"
              className={padding.ok ? 'input export__num' : 'input input--invalid export__num'}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={state.padding}
              aria-invalid={!padding.ok}
              aria-describedby="export-padding-hint"
              data-testid="export-padding"
              onChange={(e) => set({ padding: e.target.value, error: null })}
            />
            <span
              id="export-padding-hint"
              className={padding.ok ? 'export__hint' : 'export__hint export__hint--error'}
              role={padding.ok ? undefined : 'alert'}
              data-testid="export-padding-hint"
            >
              {padding.ok ? ru.export.paddingHint : padding.error}
            </span>
          </div>
        )}
      </div>

      <div className="export__summary" data-testid="export-summary" aria-live="polite">
        {whole
          ? ru.export.summaryWhole(formatClock(total))
          : chosen.length === 0
            ? ru.export.summaryNone
            : compilation
              ? ru.export.summaryCompilation(episodesGenitive(summary.count), formatClock(total))
              : ru.export.summaryFiles(pluralFiles(summary.count), formatClock(total))}
        {withFreezes && ` ${ru.export.summaryFreezes}`}
      </div>

      <footer className="modal__foot">
        <span
          className="modal__error"
          role={state.error ? 'alert' : undefined}
          data-testid="export-error"
        >
          {state.error ?? ''}
        </span>
        <button
          type="button"
          className="btn"
          data-testid="export-cancel-form"
          onClick={closeExportDialog}
        >
          {ru.export.cancel}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canStart}
          data-autofocus
          data-testid="export-start"
          onClick={() => void startExport()}
        >
          {ru.export.start}
        </button>
      </footer>
    </>
  )
}
