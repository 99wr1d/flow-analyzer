/** Позы тренера: с мячом, бросок рукой. Тренер в спортивном костюме, без номера. */
import { drawings, type Dress, type DrawnFacing, type FigureDrawing, type Skeleton } from './rig'

export const COACH_DRESS: Dress = {
  sleeves: 'long',
  legs: 'trousers',
  gloves: false,
  hair: '#4b433d',
  jacket: true
}

/** Стоит с мячом в руках перед собой. */
const STAND_BALL: Skeleton = {
  head: [0, -186, 1],
  chest: [0, -160, 0],
  pelvis: [0, -104, 0],
  armL: { elbow: [25, -128, 6], hand: [13, -114, 22], palm: [-1, 0, 0.2] },
  armR: { elbow: [-25, -128, 6], hand: [-13, -114, 22], palm: [1, 0, 0.2] },
  legL: { knee: [11, -56, 3], ankle: [12, -9, -1], toe: [16, -4, 13] },
  legR: { knee: [-11, -56, 3], ankle: [-12, -9, -1], toe: [-16, -4, 13] },
  ball: [0, -114, 26]
}

/** Бросок рукой из-за головы: правая рука с мячом отведена назад, левая вперёд, шаг левой. */
const THROW: Skeleton = {
  head: [-2, -183, -3],
  headFwd: [0.1, 0, 1],
  chest: [-2, -157, -5],
  pelvis: [0, -102, 0],
  shoulderAxis: [1, 0, 0.5],
  hipAxis: [1, 0, 0.25],
  armL: { elbow: [24, -146, 22], hand: [27, -146, 49], palm: [0, 0.3, 1] },
  armR: { elbow: [-33, -180, -6], hand: [-27, -190, -32], palm: [0.3, -0.3, 1] },
  legL: { knee: [11, -55, 22], ankle: [12, -9, 25], toe: [13, -4, 39] },
  legR: { knee: [-11, -52, -12], ankle: [-12, -10, -24], toe: [-12, -4, -11] },
  ball: [-25, -199, -43]
}

export const COACH_ART: Record<string, Partial<Record<DrawnFacing, FigureDrawing>>> = {
  'stand-ball': drawings(STAND_BALL, COACH_DRESS),
  throw: drawings(THROW, COACH_DRESS)
}
