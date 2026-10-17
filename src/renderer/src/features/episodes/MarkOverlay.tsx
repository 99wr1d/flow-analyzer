import { usePlayerStore } from '../../store/playerStore'
import { useEpisodesStore } from './episodesStore'

/** Метки «Начало» и «Конец» на линейке таймлайна (внутри линейки; клики проходят сквозь них). */
export function MarkOverlay(): React.JSX.Element | null {
  const inPoint = useEpisodesStore((s) => s.inPoint)
  const outPoint = useEpisodesStore((s) => s.outPoint)
  const duration = usePlayerStore((s) => s.duration)
  if (!(duration > 0) || (inPoint === null && outPoint === null)) return null

  const pct = (t: number): number => Math.max(0, Math.min(100, (t / duration) * 100))
  const both = inPoint !== null && outPoint !== null
  const invalid = both && outPoint <= inPoint
  return (
    <>
      {both && !invalid && (
        <div
          className="mark-range"
          style={{ left: `${pct(inPoint)}%`, width: `${pct(outPoint) - pct(inPoint)}%` }}
          data-testid="mark-range"
        />
      )}
      {inPoint !== null && (
        <div
          className={invalid ? 'mark mark--in mark--invalid' : 'mark mark--in'}
          style={{ left: `${pct(inPoint)}%` }}
          data-testid="mark-in"
        />
      )}
      {outPoint !== null && (
        <div
          className={invalid ? 'mark mark--out mark--invalid' : 'mark mark--out'}
          style={{ left: `${pct(outPoint)}%` }}
          data-testid="mark-out"
        />
      )}
    </>
  )
}
