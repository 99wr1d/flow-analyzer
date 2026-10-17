// Раскладка эпизодов по дорожкам таймлайна: пересекающиеся по времени идут на разные строки.
import type { Episode } from '../../../../shared/episodes'

export const MAX_LANES = 4

export interface EpisodeLane {
  id: string
  lane: number
}

/** Жадная раскладка по времени начала. Если строк больше MAX_LANES, лишние ложатся на последнюю. */
export function assignEpisodeLanes(list: readonly Episode[]): EpisodeLane[] {
  const sorted = [...list].sort((a, b) => a.start - b.start || a.end - b.end)
  const laneEnds: number[] = []
  return sorted.map((e) => {
    let lane = laneEnds.findIndex((end) => end <= e.start)
    if (lane === -1) lane = laneEnds.length < MAX_LANES ? laneEnds.length : MAX_LANES - 1
    laneEnds[lane] = Math.max(laneEnds[lane] ?? 0, e.end)
    return { id: e.id, lane }
  })
}
