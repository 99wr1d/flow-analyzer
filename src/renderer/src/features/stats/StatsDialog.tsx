// Окно «Статистика»: показатели, таблица по тегам и две диаграммы. Весь расчёт — в shared/stats.ts.
import { useMemo, useRef } from 'react'
import { filterEpisodes } from '../../../../shared/episodes'
import { BIN_CHOICES, resolveBinSeconds, type BinChoice } from '../../../../shared/stats'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { BarChartIcon, CheckCircleIcon, CloseIcon } from '../../ui/icons'
import { useEpisodesStore } from '../episodes/episodesStore'
import { useFocusTrap } from '../export/useFocusTrap'
import { useSettingsStore } from '../settings/settingsStore'
import { needsOutline } from './chartKit'
import { binSizeText, fmtDuration, fmtPercent } from './format'
import { deriveStats } from './statsData'
import { closeStats, exportStatsCsv, revealStatsFile, seekToBin } from './statsActions'
import { useStatsStore } from './statsStore'
import { StatsTable } from './StatsTable'
import { TagBarsChart } from './TagBarsChart'
import { TimeDistChart } from './TimeDistChart'

const BIN_LABELS: Record<BinChoice, string> = {
  auto: ru.stats.binAuto,
  60: ru.stats.bin60,
  300: ru.stats.bin300,
  600: ru.stats.bin600,
  900: ru.stats.bin900
}

function Kpi(props: {
  id: string
  label: string
  value: string
  sub?: string
  title?: string
}): React.JSX.Element {
  return (
    <div className="kpi" title={props.title} data-testid={`stats-kpi-${props.id}`}>
      <span className="kpi__label">{props.label}</span>
      <strong className="kpi__value" data-testid={`stats-kpi-${props.id}-value`}>
        {props.value}
      </strong>
      {props.sub && (
        <span className="kpi__sub" data-testid={`stats-kpi-${props.id}-sub`}>
          {props.sub}
        </span>
      )}
    </div>
  )
}

function BinPicker({ duration }: { duration: number }): React.JSX.Element {
  const bin = useStatsStore((s) => s.bin)
  return (
    <div className="seg" role="radiogroup" aria-label={ru.stats.binLabel}>
      {BIN_CHOICES.map((choice) => (
        <button
          key={choice}
          type="button"
          role="radio"
          aria-checked={bin === choice}
          className={bin === choice ? 'seg__btn seg__btn--active' : 'seg__btn'}
          title={choice === 'auto' ? ru.stats.binAutoHint : undefined}
          data-testid={`stats-bin-${choice}`}
          onClick={() => useStatsStore.setState({ bin: choice })}
        >
          {choice === 'auto'
            ? `${BIN_LABELS.auto} · ${binSizeText(resolveBinSeconds('auto', duration))}`
            : BIN_LABELS[choice]}
        </button>
      ))}
    </div>
  )
}

function SaveStatus(): React.JSX.Element {
  const save = useStatsStore((s) => s.save)
  return (
    <div className="stats__status" role="status" aria-live="polite">
      {save.kind === 'saving' && <span className="stats__muted">{ru.stats.exporting}</span>}
      {save.kind === 'saved' && (
        <>
          <span className="stats__ok" aria-hidden="true">
            <CheckCircleIcon size={16} />
          </span>
          <span className="stats__saved" data-testid="stats-saved" title={save.fileName}>
            {ru.stats.saved(save.fileName)}
          </span>
          <button
            type="button"
            className="btn btn--small"
            data-testid="stats-reveal"
            onClick={revealStatsFile}
          >
            {ru.stats.reveal}
          </button>
        </>
      )}
      {save.kind === 'error' && (
        <span className="stats__error" role="alert" data-testid="stats-save-error">
          {save.message}
        </span>
      )}
    </div>
  )
}

function StatsContent(): React.JSX.Element {
  const items = useEpisodesStore((s) => s.items)
  const filter = useEpisodesStore((s) => s.filter)
  const ratingFilter = useEpisodesStore((s) => s.ratingFilter)
  const duration = usePlayerStore((s) => s.duration)
  const tagSettings = useSettingsStore((s) => s.settings.tags)
  const bin = useStatsStore((s) => s.bin)
  const respectFilter = useStatsStore((s) => s.respectFilter)

  const { stats, episodes } = useMemo(
    () =>
      deriveStats({ items, filter, ratingFilter, respectFilter, duration, tags: tagSettings, bin }),
    [items, filter, ratingFilter, respectFilter, duration, tagSettings, bin]
  )

  if (episodes.length === 0) {
    return (
      <div className="stats__empty" data-testid="stats-empty">
        <span className="stats__empty-icon" aria-hidden="true">
          <BarChartIcon size={32} />
        </span>
        <p>{items.length === 0 ? ru.stats.empty : ru.stats.emptyFiltered}</p>
      </div>
    )
  }

  const { overall, distribution, tags } = stats
  return (
    <>
      <div className="kpis" data-testid="stats-kpis">
        <Kpi id="episodes" label={ru.stats.kpiEpisodes} value={String(overall.episodes)} />
        <Kpi
          id="time"
          label={ru.stats.kpiTime}
          value={fmtDuration(overall.taggedTime)}
          sub={ru.stats.kpiTimeSub(fmtPercent(overall.taggedPercent))}
          title={ru.stats.kpiTimeHint}
        />
        <Kpi id="tags" label={ru.stats.kpiTags} value={String(overall.tags)} />
        <Kpi id="avg" label={ru.stats.kpiAvg} value={fmtDuration(overall.avg)} />
        <Kpi
          id="good"
          label={ru.stats.kpiGood}
          value={overall.goodPercent === null ? '—' : fmtPercent(overall.goodPercent)}
          sub={
            overall.goodPercent === null
              ? ru.stats.kpiGoodNone
              : ru.stats.kpiGoodSub(overall.good, overall.bad)
          }
        />
      </div>

      <div className="stats__pair">
        <section className="card" aria-labelledby="stats-table-title">
          <header className="card__head">
            <h3 id="stats-table-title" className="card__title">
              {ru.stats.tableTitle}
            </h3>
            <span className="card__hint">{ru.stats.tableHint}</span>
          </header>
          <div className="stats__table-wrap">
            <StatsTable tags={tags} />
          </div>
        </section>
        <section className="card" aria-labelledby="stats-bars-title">
          <header className="card__head">
            <h3 id="stats-bars-title" className="card__title">
              {ru.stats.barsTitle}
            </h3>
          </header>
          <TagBarsChart tags={tags} />
        </section>
      </div>

      <section className="card" aria-labelledby="stats-dist-title">
        <header className="card__head card__head--wrap">
          <div>
            <h3 id="stats-dist-title" className="card__title">
              {ru.stats.distTitle}
            </h3>
            <p className="card__hint" data-testid="stats-dist-info">
              {ru.stats.binInfo(binSizeText(distribution.size))}. {ru.stats.distHint}
            </p>
          </div>
          <BinPicker duration={duration} />
        </header>
        <TimeDistChart distribution={distribution} tags={tags} onSeek={seekToBin} />
        <ul className="legend" aria-label={ru.stats.legend} data-testid="stats-legend">
          {tags.map((t) => (
            <li key={t.tagId} className="legend__item" data-tag-id={t.tagId}>
              <span
                className={
                  needsOutline(t.color)
                    ? 'legend__swatch legend__swatch--outline'
                    : 'legend__swatch'
                }
                style={{ background: t.color }}
                aria-hidden="true"
              />
              {t.name}
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

/** Большое окно «Статистика». Esc закрывает, фокус остаётся внутри. */
export function StatsDialog(): React.JSX.Element | null {
  const open = useStatsStore((s) => s.open)
  if (!open) return null
  return <StatsDialogInner />
}

function StatsDialogInner(): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const hasFilter = useEpisodesStore((s) => s.filter.length > 0 || s.ratingFilter.length > 0)
  const respectFilter = useStatsStore((s) => s.respectFilter)
  const saving = useStatsStore((s) => s.save.kind === 'saving')
  const hasEpisodes = useEpisodesStore((s) => s.items.length > 0)
  const empty = useEpisodesStore(
    (s) =>
      s.items.length === 0 ||
      (respectFilter && filterEpisodes(s.items, s.filter, s.ratingFilter).length === 0)
  )
  useFocusTrap(ref, true, closeStats)

  return (
    <div className="modal-backdrop" data-testid="stats-backdrop">
      <div
        ref={ref}
        className="modal stats"
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="stats-title"
        data-testid="stats-dialog"
      >
        <header className="modal__head">
          <h2 id="stats-title" className="modal__title">
            {ru.stats.title}
          </h2>
          <div className="stats__head-tools">
            {hasFilter && hasEpisodes && (
              <label className="check" title={ru.stats.respectFilterTitle}>
                <input
                  type="checkbox"
                  checked={respectFilter}
                  data-testid="stats-respect-filter"
                  onChange={(e) => useStatsStore.setState({ respectFilter: e.target.checked })}
                />
                {ru.stats.respectFilter}
              </label>
            )}
            <button
              type="button"
              className="icon-btn"
              onClick={closeStats}
              title={`${ru.stats.close} (Esc)`}
              aria-label={ru.stats.close}
              data-testid="stats-close"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        </header>
        <div className="modal__body stats__body">
          <StatsContent />
        </div>
        <footer className="modal__foot">
          <SaveStatus />
          <button
            type="button"
            className="btn"
            disabled={empty || saving}
            title={empty ? ru.stats.empty : ru.stats.exportCsvTitle}
            data-testid="stats-export-csv"
            onClick={() => void exportStatsCsv()}
          >
            {ru.stats.exportCsv}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            data-autofocus
            data-testid="stats-done"
            onClick={closeStats}
          >
            {ru.stats.close}
          </button>
        </footer>
      </div>
    </div>
  )
}
