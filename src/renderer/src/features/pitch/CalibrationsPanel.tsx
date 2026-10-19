// Список разметок поля в правой панели: перейти к кадру, поправить точки, удалить; переключатель сетки.
import { useMemo } from 'react'
import { projectorFor } from '../../../../shared/pitch/calibration'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { EditIcon, TrashIcon } from '../../ui/icons'
import { formatTime } from '../player/format'
import { useCalibrationsStore } from './calibrationsStore'
import { editCalibration, gotoCalibration, removeCalibration, videoSize } from './pitchActions'
import { usePitchStore } from './pitchStore'
import { fitCalibration } from '../../../../shared/pitch/calibration'

export function CalibrationsPanel(): React.JSX.Element | null {
  const ready = usePlayerStore((s) => s.status === 'ready')
  const items = useCalibrationsStore((s) => s.items)
  const selectedId = useCalibrationsStore((s) => s.selectedId)
  const showGrid = usePitchStore((s) => s.showGrid)
  const setShowGrid = usePitchStore((s) => s.setShowGrid)
  const calibrating = usePitchStore((s) => s.draft !== null)
  const size = ready ? videoSize() : { w: 0, h: 0 }

  const rows = useMemo(
    () =>
      items.map((c) => {
        const ok = projectorFor(c) !== null
        const fit = size.w > 0 ? fitCalibration(c.points, c.aspect, size) : null
        return { c, ok, rms: fit && fit.ok ? fit.rms : null }
      }),
    [items, size.w, size.h] // eslint-disable-line react-hooks/exhaustive-deps
  )

  if (!ready || items.length === 0) return null

  return (
    <section
      className="inspector cal-list"
      aria-label={ru.pitch.list.title}
      data-testid="calibrations-panel"
    >
      <div className="inspector__head">
        <span className="inspector__title">{ru.pitch.list.title}</span>
        <label className="cal-grid-toggle" title={ru.pitch.list.gridHint}>
          <input
            type="checkbox"
            checked={showGrid}
            data-testid="pitch-grid-toggle"
            onChange={(e) => {
              setShowGrid(e.target.checked)
              e.currentTarget.blur()
            }}
          />
          <span>{ru.pitch.list.grid}</span>
        </label>
      </div>
      <ul className="cal-items">
        {rows.map(({ c, ok, rms }) => (
          <li
            key={c.id}
            className={c.id === selectedId ? 'cal-item cal-item--selected' : 'cal-item'}
            data-testid="calibration-item"
            data-id={c.id}
          >
            <button
              type="button"
              className="cal-item__main"
              title={ru.pitch.list.goto}
              data-testid="calibration-goto"
              onClick={(e) => {
                gotoCalibration(c.id)
                e.currentTarget.blur()
              }}
            >
              <span className="cal-item__time">{formatTime(c.time, { tenths: true })}</span>
              <span className="cal-item__meta">
                {ru.pitch.mode.templates[c.template]}
                {' · '}
                {ok
                  ? rms !== null && c.points.length > 4
                    ? `${rms.toFixed(1)} px`
                    : ru.pitch.list.points(c.points.length)
                  : ru.pitch.list.broken}
              </span>
            </button>
            <button
              type="button"
              className="icon-btn icon-btn--small"
              disabled={calibrating}
              title={ru.pitch.list.edit}
              aria-label={ru.pitch.list.edit}
              data-testid="calibration-edit"
              onClick={(e) => {
                editCalibration(c.id)
                e.currentTarget.blur()
              }}
            >
              <EditIcon size={15} />
            </button>
            <button
              type="button"
              className="icon-btn icon-btn--small"
              disabled={calibrating}
              title={ru.pitch.list.remove}
              aria-label={ru.pitch.list.remove}
              data-testid="calibration-delete"
              onClick={(e) => {
                removeCalibration(c.id)
                e.currentTarget.blur()
              }}
            >
              <TrashIcon size={15} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
