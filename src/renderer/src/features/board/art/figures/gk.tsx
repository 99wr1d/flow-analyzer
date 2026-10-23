/**
 * Позы вратаря. Каждая поза — суставы в объёме (см. rig.tsx), рисунки направлений строятся из них.
 * Броски и выход в ноги рисуются только лицом, боком и спиной — остальные направления берутся
 * из таблицы замен `GK_SUBSTITUTE`.
 */
import {
  drawings,
  rollSkeleton,
  type Dress,
  type DrawnFacing,
  type FigureDrawing,
  type Skeleton
} from './rig'

export const GK_DRESS: Dress = {
  sleeves: 'long',
  legs: 'shorts',
  gloves: true,
  hair: '#2b1d14',
  number: '1'
}

/** Основная стойка: ноги на ширине плеч, колени согнуты, корпус вперёд, руки перед собой. */
const SET: Skeleton = {
  head: [0, -175, 11],
  chest: [0, -149, 6],
  pelvis: [0, -97, -6],
  armL: { elbow: [30, -116, 12], hand: [29, -92, 34], palm: [-0.25, -0.15, 1] },
  armR: { elbow: [-30, -116, 12], hand: [-29, -92, 34], palm: [0.25, -0.15, 1] },
  legL: { knee: [20, -53, 13], ankle: [22, -9, -1], toe: [26, -4, 13] },
  legR: { knee: [-20, -53, 13], ankle: [-22, -9, -1], toe: [-26, -4, 13] }
}

/** Приставной шаг влево (по экрану — вправо): опорная нога, шагающая в воздухе, корпус ниже. */
const STEP: Skeleton = {
  head: [13, -166, 10],
  chest: [10, -140, 6],
  pelvis: [4, -89, -6],
  armL: { elbow: [42, -110, 10], hand: [45, -88, 30], palm: [-0.35, -0.1, 1] },
  armR: { elbow: [-22, -108, 14], hand: [-16, -86, 34], palm: [0.35, -0.1, 1] },
  legL: { knee: [38, -58, 12], ankle: [54, -26, 2], toe: [58, -24, 16] },
  legR: { knee: [-20, -48, 12], ankle: [-32, -9, -1], toe: [-36, -4, 12] }
}

/** Высокий мяч: прыжок с толчковой ноги, колено вверх, руки над головой, мяч в «окошке». */
const HIGH_CATCH: Skeleton = {
  head: [1, -186, 4],
  headUp: [0, -0.93, -0.36],
  headFwd: [0, -0.36, 0.93],
  chest: [0, -158, 2],
  pelvis: [0, -104, 0],
  armL: { elbow: [24, -190, 12], hand: [12, -214, 20], palm: [-0.35, -0.45, 0.82] },
  armR: { elbow: [-24, -190, 12], hand: [-12, -214, 20], palm: [0.35, -0.45, 0.82] },
  legL: { knee: [13, -96, 30], ankle: [15, -58, 22], toe: [17, -55, 35] },
  legR: { knee: [-9, -58, 3], ankle: [-10, -14, -4], toe: [-11, -9, 9] },
  ball: [0, -226, 30]
}

/** Вытянутое тело для бросков: руки над головой к мячу, нижняя нога прямая, верхняя согнута. */
const STRETCH: Skeleton = {
  head: [4, -178, 6],
  chest: [1, -152, 2],
  pelvis: [0, -98, 0],
  armL: { elbow: [27, -182, 8], hand: [27, -212, 14], palm: [0.15, -0.1, 1] },
  armR: { elbow: [-12, -186, 10], hand: [2, -214, 16], palm: [0.15, -0.1, 1] },
  legL: { knee: [10, -52, 3], ankle: [11, -8, 0], toe: [12, -4, 13] },
  legR: { knee: [-20, -56, 12], ankle: [-30, -18, -6], toe: [-31, -12, 6] }
}

/** Низкий бросок: тело почти горизонтально у самой земли, на левом боку, руки к мячу у газона. */
const DIVE_LOW = rollSkeleton(STRETCH, 86, [0, -100, 0], [8, 74, 0])

/** Высокий бросок: тело в полёте, руки вверх-вперёд к мячу под перекладиной. */
const DIVE_HIGH = rollSkeleton(STRETCH, 68, [0, -100, 0], [2, -12, 0])

/** Выход в ноги: вратарь на боку перед мячом, руки вперёд к мячу, верхняя нога прикрывает. */
const SMOTHER = rollSkeleton(
  {
    head: [6, -176, 14],
    headFwd: [0.45, 0, 0.9],
    chest: [2, -150, 6],
    pelvis: [0, -98, 0],
    armL: { elbow: [30, -166, 26], hand: [30, -190, 36], palm: [0, -1, 0.3] },
    armR: { elbow: [-10, -170, 30], hand: [6, -194, 42], palm: [0.2, -1, 0.3] },
    legL: { knee: [14, -56, 22], ankle: [15, -16, 10], toe: [16, -12, 23] },
    legR: { knee: [-12, -62, 34], ankle: [-22, -26, 20], toe: [-23, -20, 33] },
    ball: [26, -206, 34]
  },
  90,
  [0, -100, 0],
  [20, 78, 0]
)

const LYING: readonly DrawnFacing[] = ['front', 'right', 'back']
/**
 * Лежащее тело «строго боком» (90°) смотрит на нас головой или ногами и не читается,
 * поэтому «боком» у бросков — поворот на 50°: тело ещё видно во всю длину.
 */
const LYING_YAW: Partial<Record<DrawnFacing, number>> = { right: (50 * Math.PI) / 180 }

export const GK_ART: Record<string, Partial<Record<DrawnFacing, FigureDrawing>>> = {
  set: drawings(SET, GK_DRESS),
  step: drawings(STEP, GK_DRESS),
  'dive-low': drawings(DIVE_LOW, GK_DRESS, LYING, LYING_YAW),
  'dive-high': drawings(DIVE_HIGH, GK_DRESS, LYING, LYING_YAW),
  'high-catch': drawings(HIGH_CATCH, GK_DRESS),
  smother: drawings(SMOTHER, GK_DRESS, LYING, LYING_YAW)
}

/** Замены направлений для поз, где сторона почти не важна. */
export const GK_SUBSTITUTE: Record<string, Partial<Record<DrawnFacing, DrawnFacing>>> = {
  'dive-low': { 'front-right': 'front', 'back-right': 'back' },
  'dive-high': { 'front-right': 'front', 'back-right': 'back' },
  smother: { 'front-right': 'front', 'back-right': 'back' }
}
