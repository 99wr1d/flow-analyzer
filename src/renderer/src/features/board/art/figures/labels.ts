/** Подписи поз фигур. */
import { FIGURE_POSES, type FigurePose, type FigureSet } from '../../../../../../shared/board/ids'

const LABELS: Record<FigureSet, Record<string, string>> = {
  gk: {
    set: 'стойка',
    step: 'шаг',
    'dive-low': 'низкий бросок',
    'dive-high': 'высокий бросок',
    'high-catch': 'высокий мяч',
    smother: 'выход в ноги'
  },
  player: { stand: 'стоит', run: 'бег' },
  coach: { 'stand-ball': 'с мячом', throw: 'бросок рукой' }
}

export function poseLabel(set: FigureSet, pose: FigurePose): string {
  return LABELS[set]?.[pose] ?? LABELS[set]?.[FIGURE_POSES[set][0]] ?? pose
}
