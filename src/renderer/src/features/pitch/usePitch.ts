// Хуки и помощники: проекторы разметок, активная (ближайшая по времени) разметка.
import { useMemo } from 'react'
import {
  nearestCalibration,
  projectorFor,
  type Calibration,
  type NearestCalibration
} from '../../../../shared/pitch/calibration'
import { fitHomography } from '../../../../shared/pitch/homography'
import { makeProjector, type Projector } from '../../../../shared/pitch/projector'
import { usePlayerStore } from '../../store/playerStore'
import { useCalibrationsStore } from './calibrationsStore'
import type { CalibrationDraft } from './draft'
import { usePitchStore } from './pitchStore'

export type ProjectorMap = ReadonlyMap<string, Projector | null>

/** Проектор по черновику (если из него получается корректная гомография). */
export function projectorOfDraft(d: CalibrationDraft): Projector | null {
  if (d.points.length < 4) return null
  const fit = fitHomography(d.points, d.aspect)
  return fit.ok ? makeProjector(fit.H) : null
}

/** Проекторы всех разметок. Пока идёт правка разметки, её проектор берётся из черновика — рисунки двигаются вживую. */
export function useProjectors(): ProjectorMap {
  const items = useCalibrationsStore((s) => s.items)
  const draft = usePitchStore((s) => s.draft)
  return useMemo(() => {
    const map = new Map<string, Projector | null>()
    for (const c of items) {
      map.set(c.id, draft && draft.editingId === c.id ? projectorOfDraft(draft) : projectorFor(c))
    }
    return map
  }, [items, draft])
}

/** Проекторы без учёта черновика (для экспорта и сохранения). */
export function projectorsOf(items: readonly Calibration[]): ProjectorMap {
  return new Map(items.map((c) => [c.id, projectorFor(c)]))
}

/** Ближайшая по времени разметка, у которой есть корректный проектор. */
export function nearestUsable(
  items: readonly Calibration[],
  time: number
): NearestCalibration | null {
  return nearestCalibration(
    items.filter((c) => projectorFor(c) !== null),
    time
  )
}

/** Активная разметка для текущего момента. Обновляется раз в десятую долю секунды. */
export function useActiveCalibration(): NearestCalibration | null {
  const items = useCalibrationsStore((s) => s.items)
  const tenths = usePlayerStore((s) => Math.round(s.currentTime * 10))
  return useMemo(() => nearestUsable(items, tenths / 10), [items, tenths])
}

/** Активная разметка прямо сейчас (для обработчиков событий). */
export function activeCalibrationNow(time: number): NearestCalibration | null {
  return nearestUsable(useCalibrationsStore.getState().items, time)
}

/** Проекторы всех разметок прямо сейчас (для обработчиков событий); правка разметки учитывается. */
export function projectorMapNow(): ProjectorMap {
  const draft = usePitchStore.getState().draft
  const map = new Map<string, Projector | null>()
  for (const c of useCalibrationsStore.getState().items) {
    map.set(c.id, draft && draft.editingId === c.id ? projectorOfDraft(draft) : projectorFor(c))
  }
  return map
}
