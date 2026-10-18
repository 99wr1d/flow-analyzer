// Диаграмма 1: горизонтальные столбцы — число эпизодов по тегам. Цвет столбца — цвет тега, значение подписано у конца.
import { useState } from 'react'
import { useRef } from 'react'
import type { TagStat } from '../../../../shared/stats'
import { ru } from '../../i18n/ru'
import {
  CHART_SURFACE,
  needsOutline,
  rightRoundedRect,
  rovingNext,
  truncate,
  useElementWidth
} from './chartKit'
import { pointerIn, useChartTip } from './ChartTip'
import { episodesWord, fmtDuration, fmtPercent } from './format'

const ROW = 30
const BAR = 18
const VALUE_W = 40
const GAP = 8

export function TagBarsChart({ tags }: { tags: readonly TagStat[] }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(hostRef, 360)
  const { setWrap, wrap, showAt, showFor, hide, node } = useChartTip()
  const [active, setActive] = useState(0)

  const labelW = Math.max(84, Math.min(170, Math.round(width * 0.36)))
  const plotW = Math.max(40, width - labelW - VALUE_W - GAP)
  const max = Math.max(1, ...tags.map((t) => t.count))
  const height = Math.max(ROW, tags.length * ROW)

  const content = (t: TagStat): React.ReactNode => (
    <>
      <div className="chart-tip__head">{t.name}</div>
      <div className="chart-tip__row">
        <span className="chart-tip__value">{t.count}</span>
        <span className="chart-tip__label">
          {episodesWord(t.count)} · {fmtPercent(t.shareCount)}
        </span>
      </div>
      <div className="chart-tip__row">
        <span className="chart-tip__value">{fmtDuration(t.total)}</span>
        <span className="chart-tip__label">времени всего</span>
      </div>
    </>
  )

  const focusRow = (from: Element, index: number): void => {
    setActive(index)
    from.parentElement?.querySelectorAll<SVGGElement>('[data-bar]')[index]?.focus()
  }

  return (
    <div className="chart" ref={setWrap} data-testid="stats-bars">
      <div ref={hostRef} className="chart__host">
        <svg
          width={width}
          height={height}
          role="group"
          aria-label={ru.stats.barsTitle}
          onPointerLeave={hide}
        >
          <line x1={labelW + 0.5} x2={labelW + 0.5} y1={0} y2={height} className="chart__axis" />
          {tags.map((t, i) => {
            const y = i * ROW + (ROW - BAR) / 2
            const len = Math.max(4, (t.count / max) * plotW)
            const outline = needsOutline(t.color)
            return (
              <g
                key={t.tagId}
                className="stat-bar"
                role="img"
                tabIndex={i === Math.min(active, tags.length - 1) ? 0 : -1}
                aria-label={ru.stats.barLabel(t.name, t.count, fmtPercent(t.shareCount))}
                data-bar=""
                data-testid="stats-bar"
                data-tag-id={t.tagId}
                data-count={t.count}
                data-color={t.color}
                onFocus={(e) => {
                  setActive(i)
                  showFor(
                    e.currentTarget.querySelector('.stat-bar__mark') ?? e.currentTarget,
                    content(t)
                  )
                }}
                onBlur={hide}
                onPointerMove={(e) => {
                  const p = pointerIn(wrap, e)
                  showAt(p.x + 12, p.y - 40, content(t))
                }}
                onKeyDown={(e) => {
                  const next = rovingNext(e.key, i, tags.length, true)
                  if (next !== null) {
                    e.preventDefault()
                    focusRow(e.currentTarget, next)
                  }
                }}
              >
                <rect className="stat-bar__hit" x={0} y={i * ROW} width={width} height={ROW} />
                <text
                  className="chart__label"
                  x={labelW - 10}
                  y={i * ROW + ROW / 2}
                  textAnchor="end"
                  dominantBaseline="central"
                >
                  {truncate(t.name, Math.floor((labelW - 12) / 6.6))}
                </text>
                <path
                  className="stat-bar__mark"
                  d={rightRoundedRect(labelW + 1, y, len, BAR, 4)}
                  fill={t.color}
                  stroke={outline ? 'var(--text-muted)' : CHART_SURFACE}
                  strokeWidth={outline ? 1 : 0}
                />
                <text
                  className="chart__value"
                  x={labelW + 1 + len + 8}
                  y={i * ROW + ROW / 2}
                  dominantBaseline="central"
                >
                  {t.count}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      {node}
    </div>
  )
}
