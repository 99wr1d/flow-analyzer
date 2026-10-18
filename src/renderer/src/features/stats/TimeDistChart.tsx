// Диаграмма 2: столбики по отрезкам матча, внутри — слои по тегам (цвет тега, порядок слоёв один и тот же везде).
import { useRef, useState } from 'react'
import type { TagStat, TimeBin, TimeDistribution } from '../../../../shared/stats'
import { ru } from '../../i18n/ru'
import { needsOutline, niceTicks, rovingNext, topRoundedRect, useElementWidth } from './chartKit'
import { pointerIn, useChartTip } from './ChartTip'
import { episodesWord, fmtAxis } from './format'

const HEIGHT = 230
const M = { top: 22, right: 12, bottom: 28, left: 36 }
const MAX_COLUMN = 24
const GAP = 2
const RADIUS = 4
const LABEL_SPACING = 64

interface Props {
  distribution: TimeDistribution
  /** Теги в порядке слоёв (снизу вверх) и легенды. */
  tags: readonly TagStat[]
  onSeek: (start: number) => void
}

interface Layer {
  tag: TagStat
  count: number
}

const layersOf = (bin: TimeBin, tags: readonly TagStat[]): Layer[] =>
  tags.map((tag) => ({ tag, count: bin.counts[tag.tagId] ?? 0 })).filter((l) => l.count > 0)

export function TimeDistChart({ distribution, tags, onSeek }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const width = useElementWidth(hostRef, 800)
  const { setWrap, wrap, showAt, showFor, hide, node } = useChartTip()
  const [active, setActive] = useState(0)
  const [hover, setHover] = useState<number | null>(null)

  const { bins, max } = distribution
  const { ticks, top } = niceTicks(max)
  const plotW = Math.max(40, width - M.left - M.right)
  const plotH = HEIGHT - M.top - M.bottom
  const slot = plotW / bins.length
  const colW = Math.max(2, Math.min(MAX_COLUMN, slot - 4))
  const y = (v: number): number => M.top + plotH - (v / top) * plotH
  const every = Math.max(1, Math.ceil(LABEL_SPACING / slot))
  const peak = max > 0 ? bins.findIndex((b) => b.total === max) : -1

  const rangeText = (b: TimeBin): string => ru.stats.binRange(fmtAxis(b.start), fmtAxis(b.end))

  const content = (b: TimeBin): React.ReactNode => (
    <>
      <div className="chart-tip__head">{rangeText(b)}</div>
      <div className="chart-tip__row chart-tip__row--total">
        <span className="chart-tip__value">{b.total}</span>
        <span className="chart-tip__label">{episodesWord(b.total)}</span>
      </div>
      {layersOf(b, tags)
        .reverse()
        .map((l) => (
          <div className="chart-tip__row" key={l.tag.tagId}>
            <span
              className="chart-tip__key"
              style={{ background: l.tag.color }}
              aria-hidden="true"
            />
            <span className="chart-tip__value">{l.count}</span>
            <span className="chart-tip__label">{l.tag.name}</span>
          </div>
        ))}
    </>
  )

  const focusBin = (from: Element, index: number): void => {
    setActive(index)
    from.parentElement?.querySelectorAll<SVGGElement>('[data-bin]')[index]?.focus()
  }

  return (
    <div className="chart" ref={setWrap} data-testid="stats-dist">
      <div ref={hostRef} className="chart__host">
        <svg
          width={width}
          height={HEIGHT}
          role="group"
          aria-label={ru.stats.distTitle}
          onPointerLeave={() => {
            setHover(null)
            hide()
          }}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line
                x1={M.left}
                x2={M.left + plotW}
                y1={y(v) + 0.5}
                y2={y(v) + 0.5}
                className={v === 0 ? 'chart__axis' : 'chart__grid'}
              />
              <text
                className="chart__tick"
                x={M.left - 8}
                y={y(v)}
                textAnchor="end"
                dominantBaseline="central"
              >
                {v}
              </text>
            </g>
          ))}
          {bins.map((b, i) => {
            if (i % every !== 0) return null
            const x = M.left + i * slot
            return (
              <g key={b.index}>
                <line
                  x1={x + 0.5}
                  x2={x + 0.5}
                  y1={M.top + plotH}
                  y2={M.top + plotH + 4}
                  className="chart__axis"
                />
                <text
                  className="chart__tick"
                  x={x}
                  y={M.top + plotH + 17}
                  textAnchor="middle"
                  data-testid="stats-xtick"
                >
                  {fmtAxis(b.start)}
                </text>
              </g>
            )
          })}
          {bins.map((b, i) => {
            const x0 = M.left + i * slot
            const x = x0 + (slot - colW) / 2
            let acc = 0
            const layers = layersOf(b, tags)
            return (
              <g
                key={b.index}
                className={hover === i ? 'bin bin--hover' : 'bin'}
                role="button"
                tabIndex={i === Math.min(active, bins.length - 1) ? 0 : -1}
                aria-label={ru.stats.binAria(
                  rangeText(b),
                  b.total,
                  ru.stats.binAction(fmtAxis(b.start))
                )}
                data-bin=""
                data-testid="stats-bin"
                data-index={i}
                data-start={b.start}
                data-total={b.total}
                onClick={() => onSeek(b.start)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onSeek(b.start)
                    return
                  }
                  const next = rovingNext(e.key, i, bins.length, false)
                  if (next !== null) {
                    e.preventDefault()
                    focusBin(e.currentTarget, next)
                  }
                }}
                onFocus={(e) => {
                  setActive(i)
                  setHover(i)
                  showFor(
                    e.currentTarget.querySelector('.bin__hit') ?? e.currentTarget,
                    content(b),
                    4
                  )
                }}
                onBlur={() => {
                  setHover(null)
                  hide()
                }}
                onPointerMove={(e) => {
                  setHover(i)
                  const p = pointerIn(wrap, e)
                  showAt(p.x + 14, 4, content(b))
                }}
              >
                <rect className="bin__hit" x={x0} y={M.top} width={slot} height={plotH} />
                {layers.map((l, k) => {
                  const h = (l.count / top) * plotH
                  const yTop = y(acc + l.count)
                  acc += l.count
                  const isTop = k === layers.length - 1
                  // Зазор 2 px между слоями: каждый слой, кроме нижнего, чуть короче снизу.
                  const gap = k === 0 ? 0 : Math.min(GAP, Math.max(0, h - 1))
                  const outline = needsOutline(l.tag.color)
                  const hh = h - gap
                  return (
                    <path
                      key={l.tag.tagId}
                      d={
                        isTop
                          ? topRoundedRect(x, yTop, colW, hh, RADIUS)
                          : `M${x} ${yTop}h${colW}v${hh}h${-colW}Z`
                      }
                      fill={l.tag.color}
                      stroke={outline ? 'var(--text-muted)' : 'none'}
                      strokeWidth={outline ? 1 : 0}
                      data-testid="stats-segment"
                      data-tag-id={l.tag.tagId}
                      data-color={l.tag.color}
                    />
                  )
                })}
                {i === peak && (
                  <text
                    className="chart__value chart__value--cap"
                    x={x0 + slot / 2}
                    y={y(b.total) - 6}
                    textAnchor="middle"
                  >
                    {b.total}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      {node}
    </div>
  )
}
