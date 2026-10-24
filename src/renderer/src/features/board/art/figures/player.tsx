/** Позы полевого игрока: стоит, бег. Суставы в объёме (см. rig.tsx). */
import { drawings, type Dress, type DrawnFacing, type FigureDrawing, type Skeleton } from './rig'

export const PLAYER_DRESS: Dress = {
  sleeves: 'short',
  legs: 'shorts',
  gloves: false,
  hair: '#3a2617',
  number: '9'
}

/** Стоит спокойно: руки вдоль тела, чуть согнуты. */
const STAND: Skeleton = {
  head: [1, -186, 1],
  chest: [0, -160, 0],
  pelvis: [-1, -104, 0],
  shoulderAxis: [1, 0.04, 0],
  hipAxis: [1, -0.06, 0],
  armL: { elbow: [25, -127, -2], hand: [24, -99, 6], palm: [-1, 0, 0.2] },
  armR: { elbow: [-25, -128, -3], hand: [-23, -100, 5], palm: [1, 0, 0.2] },
  legL: { knee: [10, -56, 4], ankle: [12, -9, -1], toe: [16, -4, 13] },
  legR: { knee: [-12, -55, 3], ankle: [-15, -9, -3], toe: [-20, -4, 10] }
}

/** Бег: шаг правой назад-толчок, левое колено вперёд, руки согнуты навстречу ногам. */
const RUN: Skeleton = {
  head: [0, -183, 18],
  chest: [0, -157, 11],
  pelvis: [0, -103, 0],
  shoulderAxis: [1, 0, -0.12],
  armL: { elbow: [22, -134, -20], hand: [21, -114, -12], palm: [-1, 0, 0] },
  armR: { elbow: [-22, -134, 18], hand: [-17, -152, 34], palm: [1, 0, 0] },
  legL: { knee: [9, -82, 34], ankle: [10, -46, 24], toe: [11, -40, 37] },
  legR: { knee: [-10, -58, -10], ankle: [-11, -22, -34], toe: [-11, -10, -30] }
}

export const PLAYER_ART: Record<string, Partial<Record<DrawnFacing, FigureDrawing>>> = {
  stand: drawings(STAND, PLAYER_DRESS),
  run: drawings(RUN, PLAYER_DRESS)
}
