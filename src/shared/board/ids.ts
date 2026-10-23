/** Идентификаторы доски тренера: виды поля, наборы фигур, позы, направления, инвентарь. */

export const PITCH_VIEW_IDS = ['box-front', 'half-angle', 'full-top'] as const
export type PitchViewId = (typeof PITCH_VIEW_IDS)[number]

export const FIGURE_SETS = ['gk', 'player', 'coach'] as const
export type FigureSet = (typeof FIGURE_SETS)[number]

export const FIGURE_POSES: Record<FigureSet, readonly string[]> = {
  gk: ['set', 'step', 'dive-low', 'dive-high', 'high-catch', 'smother'],
  player: ['stand', 'run'],
  coach: ['stand-ball', 'throw']
}
export type FigurePose = string

/** 8 направлений; рисуются 5, `*-left` — зеркало `*-right`. */
export const FACINGS = [
  'front',
  'front-right',
  'right',
  'back-right',
  'back',
  'back-left',
  'left',
  'front-left'
] as const
export type Facing = (typeof FACINGS)[number]

export const EQUIPMENT_IDS = ['ball', 'disc', 'cone', 'mannequin', 'mini-goal'] as const
export type EquipmentId = (typeof EQUIPMENT_IDS)[number]
