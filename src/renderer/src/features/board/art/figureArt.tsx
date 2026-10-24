/**
 * Рисунок фигуры доски: набор (вратарь, игрок, тренер) × поза × направление × цвет формы.
 * Нарисованы направления `DRAWN_FACINGS`; `*-left` — зеркало `*-right`.
 * Начало координат — между ступнями, рост стоящей фигуры ≈ `FIGURE_ART_HEIGHT` вверх.
 */
import type { JSX } from 'react'
import {
  FIGURE_POSES,
  type Facing,
  type FigurePose,
  type FigureSet
} from '../../../../../shared/board/ids'
import { COACH_ART } from './figures/coach'
import { GK_ART, GK_SUBSTITUTE } from './figures/gk'
import { kitFor } from './figures/kit'
// подписи — часть интерфейса рисунков по плану; сама функция живёт в figures/labels.ts
// eslint-disable-next-line react-refresh/only-export-components
export { poseLabel } from './figures/labels'
import { PLAYER_ART } from './figures/player'
import type { DrawnFacing, FigureDrawing } from './figures/rig'

export const FIGURE_ART_HEIGHT = 200

const ART: Record<FigureSet, Record<string, Partial<Record<DrawnFacing, FigureDrawing>>>> = {
  gk: GK_ART,
  player: PLAYER_ART,
  coach: COACH_ART
}

const SUBSTITUTE: Record<FigureSet, Record<string, Partial<Record<DrawnFacing, DrawnFacing>>>> = {
  gk: GK_SUBSTITUTE,
  player: {},
  coach: {}
}

const MIRROR: Partial<Record<Facing, DrawnFacing>> = {
  'front-left': 'front-right',
  left: 'right',
  'back-left': 'back-right'
}

export interface FigureArtProps {
  set: FigureSet
  pose: FigurePose
  facing: Facing
  color: string
}

export function FigureArt({ set, pose, facing, color }: FigureArtProps): JSX.Element {
  const table = ART[set] ?? ART.gk
  const poseKey = pose in table ? pose : FIGURE_POSES[set][0]
  const views = table[poseKey]
  const mirrored = facing in MIRROR
  const base: DrawnFacing = MIRROR[facing] ?? (facing as DrawnFacing)
  const drawn: DrawnFacing = views[base] ? base : (SUBSTITUTE[set][poseKey]?.[base] ?? 'front')
  const Drawing = views[drawn] ?? views.front
  const kit = kitFor(set, color)
  if (!Drawing) return <g />
  return mirrored ? (
    <g transform="scale(-1 1)">
      <Drawing kit={kit} mirrored />
    </g>
  ) : (
    <Drawing kit={kit} />
  )
}
