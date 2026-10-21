// Слежение за игроком: все пороги трекера в одном месте. Значения стартовые — подстройка в Task 7.

/** Смена плана: сумма |Δ| по трём каналам RGB-гистограммы кадра, делённая на 6 (0..1), больше порога. */
export const CUT_THRESHOLD = 0.15

/** Сколько секунд кольцо едет по прогнозу (скорость затем гасится). */
export const COAST_SECONDS = 1.0
/** Через сколько секунд без находки слежение считается потерянным (occluded). */
export const LOST_SECONDS = 1.0

/** Вес приметы в сопоставлении при обычном ведении (остальное — IoU и расстояние до прогноза). */
export const ASSOC_APPEARANCE_WEIGHT = 0.4
/** Выход из пережидания: 0.6·примета + 0.4·расстояние. */
export const RECOVER_APPEARANCE_WEIGHT = 0.6
export const RECOVER_DISTANCE_WEIGHT = 0.4
/** Выше этой цены (0..1) кандидат при обычном ведении не принимается — пережидание. */
export const TRACK_MAX_COST = 0.7
/** Выше этой цены (0..1) единственный кандидат при выходе из пережидания не принимается. */
export const RECOVER_MAX_COST = 0.7
/** Если отрыв лучшего кандидата от второго меньше — спрашиваем «Кто из них ваш?». */
export const ASK_GAP = 0.15

/** Рамка перекрыта соседней: IoU больше порога. */
export const OVERLAP_IOU = 0.3
/** Рамка выросла по ширине больше чем во столько раз — слияние двух игроков. */
export const MERGE_WIDTH_RATIO = 1.6

/** Допустимое отношение высоты кандидата к высоте игрока. */
export const SIZE_RATIO_MIN = 0.6
export const SIZE_RATIO_MAX = 1.7
/** Ворота поиска: радиус в высотах рамки = BASE + GROW·(пропущенных кадров), не больше MAX. Либо IoU с прогнозом ≥ GATE_IOU. */
export const GATE_BASE = 0.6
export const GATE_GROW = 0.2
export const GATE_MAX = 3
export const GATE_IOU = 0.1
/** Минимальная высота в пикселях для нормировки расстояния (чтобы мелкие рамки не раздували). */
export const MIN_NORM_HEIGHT = 24

/** Скользящее среднее приметы: новая доля. */
export const APPEARANCE_BLEND = 0.1
/** Скользящее среднее размера рамки: новая доля. */
export const SIZE_BLEND = 0.3

/** Шум фильтра Калмана (пиксели, кадры). */
export const KALMAN_Q = 0.5
export const KALMAN_R = 4
/** После скольки кадров пережидания скорость гасится (доля в кадр). */
export const COAST_DAMPING = 0.95

/** «Ушёл за край»: рамка ближе к краю кадра, чем эта доля ширины. */
export const EDGE_MARGIN = 0.05

/** pickStart: неоднозначно, если вторая рамка ближе чем во столько раз дальше первой. */
export const START_AMBIGUOUS_RATIO = 1.5
export const START_AMBIGUOUS_IOU = 0.1
/** pickStart: рамка расширяется на долю высоты, чтобы щелчок у ног считался попаданием. */
export const START_ANCHOR_SLACK = 0.15
