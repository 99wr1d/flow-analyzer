// Таблица по тегам: сортировка по заголовкам, клик по строке — показать эпизоды тега в списке.
import { useMemo } from 'react'
import type { TagStat } from '../../../../shared/stats'
import { ru } from '../../i18n/ru'
import { ArrowDownIcon, ArrowUpIcon, ReviewIcon, ThumbDownIcon, ThumbUpIcon } from '../../ui/icons'
import { needsOutline } from './chartKit'
import { fmtDuration, fmtPercent } from './format'
import { showTagEpisodes } from './statsActions'
import { useStatsStore } from './statsStore'
import { nextSort, sortTags, type SortKey } from './tableSort'

const COLUMNS: {
  key: SortKey
  label: string
  title?: string
  numeric: boolean
  icon?: React.JSX.Element
}[] = [
  { key: 'name', label: ru.stats.colTag, numeric: false },
  { key: 'count', label: ru.stats.colCount, numeric: true },
  { key: 'total', label: ru.stats.colTotal, numeric: true },
  { key: 'avg', label: ru.stats.colAvg, numeric: true },
  { key: 'shareCount', label: ru.stats.colShareCount, numeric: true },
  {
    key: 'shareTime',
    label: ru.stats.colShareTime,
    title: ru.stats.colShareTimeTitle,
    numeric: true
  },
  { key: 'good', label: ru.stats.colGood, numeric: true, icon: <ThumbUpIcon size={14} /> },
  { key: 'bad', label: ru.stats.colBad, numeric: true, icon: <ThumbDownIcon size={14} /> },
  { key: 'review', label: ru.stats.colReview, numeric: true, icon: <ReviewIcon size={14} /> },
  {
    key: 'goodPercent',
    label: ru.stats.colGoodPercent,
    title: ru.stats.colGoodPercentTitle,
    numeric: true
  }
]

export function StatsTable({ tags }: { tags: readonly TagStat[] }): React.JSX.Element {
  const sort = useStatsStore((s) => s.sort)
  const rows = useMemo(() => sortTags(tags, sort), [tags, sort])

  return (
    <table className="stats-table" aria-label={ru.stats.tableLabel} data-testid="stats-table">
      <thead>
        <tr>
          {COLUMNS.map((c) => {
            const active = sort.key === c.key
            return (
              <th
                key={c.key}
                scope="col"
                className={c.numeric ? 'is-num' : undefined}
                aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
              >
                <button
                  type="button"
                  className={active ? 'stats-sort stats-sort--active' : 'stats-sort'}
                  title={c.title ?? ru.stats.sortBy(c.label)}
                  data-testid={`stats-sort-${c.key}`}
                  onClick={() => useStatsStore.setState({ sort: nextSort(sort, c.key) })}
                >
                  {c.icon ? (
                    <>
                      {c.icon}
                      <span className="sr-only">{c.label}</span>
                    </>
                  ) : (
                    c.label
                  )}
                  {active &&
                    (sort.dir === 'asc' ? <ArrowUpIcon size={12} /> : <ArrowDownIcon size={12} />)}
                </button>
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr
            key={t.tagId}
            className="stats-row"
            data-testid="stats-row"
            data-tag-id={t.tagId}
            onClick={() => showTagEpisodes(t.tagId)}
          >
            <td>
              <button
                type="button"
                className="stats-tag"
                title={ru.stats.rowTitle(t.name)}
                data-testid="stats-row-open"
                onClick={(e) => {
                  e.stopPropagation()
                  showTagEpisodes(t.tagId)
                }}
              >
                <span
                  className={needsOutline(t.color) ? 'stats-dot stats-dot--outline' : 'stats-dot'}
                  style={{ background: t.color }}
                  aria-hidden="true"
                />
                <span className="stats-tag__name">{t.name}</span>
              </button>
            </td>
            <td className="is-num" data-col="count">
              {t.count}
            </td>
            <td className="is-num" data-col="total">
              {fmtDuration(t.total)}
            </td>
            <td className="is-num" data-col="avg">
              {fmtDuration(t.avg)}
            </td>
            <td className="is-num" data-col="shareCount">
              {fmtPercent(t.shareCount)}
            </td>
            <td className="is-num" data-col="shareTime">
              {fmtPercent(t.shareTime)}
            </td>
            <td className="is-num" data-col="good">
              {t.good}
            </td>
            <td className="is-num" data-col="bad">
              {t.bad}
            </td>
            <td className="is-num" data-col="review">
              {t.review}
            </td>
            <td className="is-num" data-col="goodPercent">
              {t.goodPercent === null ? '—' : fmtPercent(t.goodPercent)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
