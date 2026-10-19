// Режим «Разметить поле»: поверх видео отмечаются точки поля, слева — схема с подсказкой, какую точку отметить.
import { useEffect, useRef, useState } from 'react'
import type { CalibrationFitResult } from '../../../../shared/pitch/calibration'
import { RECT_LIMITS, TEMPLATE_IDS, type TemplateId } from '../../../../shared/pitch/templates'
import { PITCH_LIMITS } from '../../../../shared/pitch/landmarks'
import { reprojectionErrors } from '../../../../shared/pitch/homography'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { usePictureRect } from '../annotations/usePictureRect'
import { formatTime } from '../player/format'
import { seekTo } from '../player/videoElement'
import { cancelCalibration, saveCalibration, videoSize } from './pitchActions'
import {
  evaluateDraft,
  nextRequired,
  nextToPlace,
  placedRequired,
  qualityOf,
  templateOf,
  type CalibrationDraft
} from './draft'
import { gridPath, gridPrimitives } from './gridPaths'
import { Loupe } from './Loupe'
import { MiniMap } from './MiniMap'
import { usePitchStore } from './pitchStore'

const GRAB_RADIUS = 13

/** Число с вводом текстом: значение принимается по Enter или при уходе из поля (иначе «105» в процессе набора ломалось бы). */
function NumField({
  value,
  min,
  max,
  label,
  testId,
  onCommit
}: {
  value: number
  min: number
  max: number
  label: string
  testId: string
  onCommit: (v: number) => void
}): React.JSX.Element {
  const [text, setText] = useState(String(value))
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (document.activeElement !== ref.current) setText(String(value))
  }, [value])
  const commit = (): void => {
    const n = Number(text.replace(',', '.'))
    if (Number.isFinite(n)) onCommit(Math.min(max, Math.max(min, n)))
    else setText(String(value))
  }
  return (
    <label className="cal-field">
      <span>{label}</span>
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        className="input"
        value={text}
        data-testid={testId}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          commit()
          setText(String(Math.min(max, Math.max(min, Number(text.replace(',', '.')) || value))))
        }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') {
            commit()
            e.currentTarget.blur()
          }
        }}
      />
    </label>
  )
}

/** Предупреждение «видео ушло с кадра разметки»: появляется, если так продолжается заметное время. */
function MovedNotice({ time }: { time: number }): React.JSX.Element | null {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 450)
    return () => window.clearTimeout(t)
  }, [])
  if (!shown) return null
  return (
    <div className="cal-moved" data-testid="cal-moved">
      <span>{ru.pitch.mode.moved}</span>
      <button type="button" className="btn" onClick={() => seekTo(time)}>
        {ru.pitch.mode.back}
      </button>
    </div>
  )
}

function Panel({
  draft,
  size,
  fit,
  off
}: {
  draft: CalibrationDraft
  size: { w: number; h: number }
  fit: CalibrationFitResult | null
  off: boolean
}): React.JSX.Element {
  const s = usePitchStore.getState()
  const side = usePitchStore((st) => st.panelSide)
  const template = templateOf(draft)
  const next = nextRequired(draft)
  const target = nextToPlace(draft)
  const placed = placedRequired(draft)
  const canSave = next === null && fit?.ok === true
  const extraMode = draft.pendingExtra !== null || draft.addingExtra

  let status: React.ReactNode
  if (next) {
    status = ru.pitch.mode.next(placed + 1, template.required.length, next.label)
  } else if (draft.pendingExtra && target) {
    status = ru.pitch.mode.pickExtra(target.label)
  } else if (draft.addingExtra) {
    status = ru.pitch.mode.extraHint
  } else {
    status = ru.pitch.mode.allPlaced
  }

  let accuracy: React.ReactNode = ru.pitch.mode.minPoints
  let accuracyKind = 'info'
  if (fit && fit.ok) {
    const q = qualityOf(fit.rms, draft.points.length, size.h)
    accuracy = ru.pitch.mode.accuracy(fit.rms.toFixed(1), ru.pitch.mode.verdicts[q])
    accuracyKind = q
  } else if (fit && !fit.ok) {
    accuracy = ru.pitch.mode.errors[fit.code] ?? ru.pitch.mode.errors.singular
    accuracyKind = 'error'
  }

  return (
    <aside
      className={side === 'left' ? 'cal-panel' : 'cal-panel cal-panel--right'}
      data-testid="cal-panel"
      title={ru.pitch.mode.nudge}
      aria-label={ru.pitch.mode.title}
    >
      <div className="cal-panel__head">
        <span className="cal-panel__title">{ru.pitch.mode.title}</span>
        <button
          type="button"
          className="icon-btn icon-btn--small"
          title={ru.pitch.mode.swap}
          aria-label={ru.pitch.mode.swap}
          data-testid="cal-swap"
          onClick={(e) => {
            s.setPanelSide(side === 'left' ? 'right' : 'left')
            e.currentTarget.blur()
          }}
        >
          ⇄
        </button>
      </div>

      <label className="cal-field cal-field--wide">
        <span>{ru.pitch.mode.template}</span>
        <select
          className="input"
          value={draft.template}
          data-testid="cal-template"
          onChange={(e) => {
            s.setTemplate(e.target.value as TemplateId)
            e.currentTarget.blur()
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {TEMPLATE_IDS.map((id) => (
            <option key={id} value={id}>
              {ru.pitch.mode.templates[id]}
            </option>
          ))}
        </select>
      </label>

      {draft.template === 'rect' ? (
        <div className="cal-row">
          <NumField
            label={ru.pitch.mode.rectW}
            value={draft.rect.w}
            min={RECT_LIMITS.min}
            max={RECT_LIMITS.maxW}
            testId="cal-rect-w"
            onCommit={(w) => s.setRectSize({ w })}
          />
          <NumField
            label={ru.pitch.mode.rectH}
            value={draft.rect.h}
            min={RECT_LIMITS.min}
            max={RECT_LIMITS.maxH}
            testId="cal-rect-h"
            onCommit={(h) => s.setRectSize({ h })}
          />
        </div>
      ) : (
        <div className="cal-row">
          <NumField
            label={ru.pitch.mode.length}
            value={draft.pitch.length}
            min={PITCH_LIMITS.minLength}
            max={PITCH_LIMITS.maxLength}
            testId="cal-length"
            onCommit={(length) => s.setPitchSize({ length })}
          />
          <NumField
            label={ru.pitch.mode.width}
            value={draft.pitch.width}
            min={PITCH_LIMITS.minWidth}
            max={PITCH_LIMITS.maxWidth}
            testId="cal-width"
            onCommit={(width) => s.setPitchSize({ width })}
          />
        </div>
      )}

      <MiniMap draft={draft} onPickExtra={(id) => s.beginExtra(id)} />

      <p className="cal-status" data-testid="cal-status">
        {status}
      </p>

      <div className="cal-row">
        <button
          type="button"
          className={extraMode ? 'btn btn--active' : 'btn'}
          disabled={next !== null}
          title={ru.pitch.mode.addPointHint}
          data-testid="cal-add-point"
          onClick={(e) => {
            s.setAddingExtra(!extraMode)
            e.currentTarget.blur()
          }}
        >
          {extraMode ? ru.pitch.mode.addPointCancel : ru.pitch.mode.addPoint}
        </button>
        <button
          type="button"
          className="btn"
          disabled={draft.points.length === 0 && !extraMode}
          title={ru.pitch.mode.removeLastHint}
          data-testid="cal-remove-last"
          onClick={(e) => {
            s.removeLast()
            e.currentTarget.blur()
          }}
        >
          {ru.pitch.mode.removeLast}
        </button>
      </div>

      <p
        className={`cal-accuracy cal-accuracy--${accuracyKind}`}
        data-testid="cal-accuracy"
        data-quality={accuracyKind}
        role={accuracyKind === 'error' ? 'alert' : undefined}
      >
        {accuracy}
      </p>

      {off && <MovedNotice time={draft.time} />}

      <div className="cal-row cal-row--end">
        <button
          type="button"
          className="btn"
          data-testid="cal-cancel"
          onClick={() => cancelCalibration()}
        >
          {ru.pitch.mode.cancel}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canSave}
          data-testid="cal-save"
          onClick={() => saveCalibration()}
        >
          {ru.pitch.mode.save}
        </button>
      </div>
    </aside>
  )
}

function Mode({ draft }: { draft: CalibrationDraft }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<{ index: number } | null>(null)
  const videoId = usePlayerStore((s) => s.source?.id)
  const rect = usePictureRect(hostRef, true, videoId)
  const fps = usePlayerStore((s) => s.fps)
  const side = usePitchStore((s) => s.panelSide)
  const currentTime = usePlayerStore((s) => s.currentTime)
  const [loupe, setLoupe] = useState<{
    x: number
    y: number
    image: { x: number; y: number }
    bounds: { w: number; h: number }
  } | null>(null)
  const size = videoSize()

  // Кадр, на котором размечаем, не должен меняться незаметно: если видео ушло, предлагаем вернуться.
  const off = Math.abs(currentTime - draft.time) > 0.75 / (fps > 0 ? fps : 25)

  const fit = evaluateDraft(draft, size)
  const projector = fit && fit.ok ? fit.projector : null
  const template = templateOf(draft)

  const preview =
    projector && rect
      ? {
          lines: gridPath(projector, gridPrimitives(draft.template, draft.pitch, draft.rect), {
            w: rect.w,
            h: rect.h
          }),
          area: projector
            .projectPolygon(template.required.map((p) => p.world))
            .map((p) => `${(p.x * rect.w).toFixed(1)},${(p.y * rect.h).toFixed(1)}`)
            .join(' ')
        }
      : null
  const errors = projector ? reprojectionErrors(projector.H, draft.points, size) : []

  // Клавиши режима: перехватываются раньше общих команд.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLSelectElement ||
        t instanceof HTMLTextAreaElement
      ) {
        return
      }
      const st = usePitchStore.getState()
      const d = st.draft
      if (!d) return
      const stop = (): void => {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
      if (e.code === 'Escape') {
        stop()
        if (d.pendingExtra || d.addingExtra) st.beginExtra(null)
        else cancelCalibration()
      } else if (e.code === 'Backspace' || e.code === 'Delete') {
        stop()
        st.removeLast()
      } else if (e.code === 'Enter' && !e.repeat) {
        stop()
        saveCalibration()
      } else if (e.altKey && e.code.startsWith('Arrow') && d.selected !== null && rect) {
        stop()
        const step = e.shiftKey ? 5 : 1
        const dx = e.code === 'ArrowLeft' ? -step : e.code === 'ArrowRight' ? step : 0
        const dy = e.code === 'ArrowUp' ? -step : e.code === 'ArrowDown' ? step : 0
        const p = d.points[d.selected]
        const vs = videoSize()
        if (p && vs.w > 0)
          st.movePoint(d.selected, { x: p.image.x + dx / vs.w, y: p.image.y + dy / vs.h })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [rect])

  const hostSize = (): { w: number; h: number } => ({
    w: hostRef.current?.clientWidth ?? 0,
    h: hostRef.current?.clientHeight ?? 0
  })
  const toPx = (p: { x: number; y: number }): { x: number; y: number } =>
    rect ? { x: rect.x + p.x * rect.w, y: rect.y + p.y * rect.h } : { x: 0, y: 0 }

  const eventPos = (e: React.PointerEvent<SVGSVGElement>): { x: number; y: number } => {
    const b = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - b.left, y: e.clientY - b.top }
  }
  const toImage = (pos: { x: number; y: number }): { x: number; y: number } =>
    rect ? { x: (pos.x - rect.x) / rect.w, y: (pos.y - rect.y) / rect.h } : { x: 0, y: 0 }

  const onDown = (e: React.PointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0 || !rect) return
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    const pos = eventPos(e)
    const st = usePitchStore.getState()
    const d = st.draft
    if (!d) return
    let hit = -1
    let best = GRAB_RADIUS
    d.points.forEach((p, i) => {
      const q = toPx(p.image)
      const dist = Math.hypot(q.x - pos.x, q.y - pos.y)
      if (dist <= best) {
        best = dist
        hit = i
      }
    })
    if (hit >= 0) {
      st.selectPoint(hit)
      drag.current = { index: hit }
    } else if (nextToPlace(d)) {
      st.addPoint(toImage(pos))
      drag.current = { index: d.points.length }
    } else {
      st.selectPoint(null)
      return
    }
    svgRef.current?.setPointerCapture(e.pointerId)
    setLoupe({ x: pos.x, y: pos.y, image: toImage(pos), bounds: hostSize() })
  }

  const onMove = (e: React.PointerEvent<SVGSVGElement>): void => {
    const g = drag.current
    if (!g) return
    const pos = eventPos(e)
    const image = toImage(pos)
    usePitchStore.getState().movePoint(g.index, image)
    setLoupe({ x: pos.x, y: pos.y, image, bounds: hostSize() })
  }

  const onUp = (e: React.PointerEvent<SVGSVGElement>): void => {
    drag.current = null
    setLoupe(null)
    if (svgRef.current?.hasPointerCapture(e.pointerId))
      svgRef.current.releasePointerCapture(e.pointerId)
  }

  const canPlace = nextToPlace(draft) !== null

  return (
    <div className="cal-host" data-testid="calibration-mode">
      <div ref={hostRef} className={`cal-area cal-area--${side}`}>
        <svg
          ref={svgRef}
          className="cal-surface"
          data-testid="cal-surface"
          data-placing={canPlace ? 'true' : 'false'}
          style={{ cursor: canPlace ? 'crosshair' : 'default' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onMouseDown={(e) => e.preventDefault()}
        >
          <rect x={0} y={0} width="100%" height="100%" fill="rgba(5,7,10,0.18)" />
          {rect && preview && (
            <g transform={`translate(${rect.x} ${rect.y})`} pointerEvents="none">
              {preview.area && (
                <polygon
                  points={preview.area}
                  fill="rgba(43,214,123,0.14)"
                  data-testid="cal-area"
                />
              )}
              <g fill="none" strokeLinejoin="round" strokeLinecap="round">
                <path
                  d={preview.lines}
                  stroke="rgba(0,0,0,0.38)"
                  strokeWidth={Math.max(1.4, rect.h / 420) + 2.2}
                />
                <path
                  d={preview.lines}
                  data-testid="cal-preview"
                  stroke="rgba(255,255,255,0.85)"
                  strokeWidth={Math.max(1.4, rect.h / 420)}
                />
              </g>
            </g>
          )}
          {rect &&
            draft.points.map((p, i) => {
              const q = toPx(p.image)
              const selected = draft.selected === i
              const err = errors[i] ?? 0
              const bad = Number.isFinite(err) && err > Math.max(2, size.h / 250)
              const projected = projector ? projector.toImage(p.world) : null
              const target = projected ? toPx(projected) : null
              return (
                <g key={`${p.key}-${i}`} data-testid="cal-pt" data-index={i} data-key={p.key}>
                  {target && bad && (
                    <>
                      <line
                        x1={q.x}
                        y1={q.y}
                        x2={target.x}
                        y2={target.y}
                        stroke="#ff5a4d"
                        strokeWidth={1.5}
                        pointerEvents="none"
                      />
                      <circle
                        cx={target.x}
                        cy={target.y}
                        r={3}
                        fill="#ff5a4d"
                        pointerEvents="none"
                      />
                    </>
                  )}
                  <circle
                    cx={q.x}
                    cy={q.y}
                    r={selected ? 9 : 7}
                    fill={selected ? 'rgba(255,214,10,0.28)' : 'rgba(43,214,123,0.22)'}
                    stroke={bad ? '#ff5a4d' : selected ? '#ffd60a' : '#ffffff'}
                    strokeWidth={2}
                  />
                  <circle cx={q.x} cy={q.y} r={1.6} fill="#ffffff" pointerEvents="none" />
                  <text
                    x={q.x + 11}
                    y={q.y - 9}
                    fontSize={12}
                    fontWeight={700}
                    fill="#ffffff"
                    stroke="rgba(0,0,0,0.85)"
                    strokeWidth={3}
                    paintOrder="stroke"
                    pointerEvents="none"
                  >
                    {i + 1}
                  </text>
                </g>
              )
            })}
        </svg>
        {loupe && <Loupe x={loupe.x} y={loupe.y} image={loupe.image} bounds={loupe.bounds} />}
        <div className="cal-badge" aria-hidden="true">
          {formatTime(draft.time, { tenths: true })}
        </div>
      </div>
      <Panel draft={draft} size={size} fit={fit} off={off} />
    </div>
  )
}

export function CalibrationMode(): React.JSX.Element | null {
  const draft = usePitchStore((s) => s.draft)
  if (!draft) return null
  return <Mode draft={draft} />
}
