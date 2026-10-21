// Черновик разметки поля: чистые функции (без интерфейса), чтобы их можно было проверить тестами.
import {
  fitCalibration,
  type Calibration,
  type CalibrationFitResult
} from '../../../../shared/pitch/calibration'
import { DEFAULT_PITCH, PITCH_LIMITS, type PitchSize } from '../../../../shared/pitch/landmarks'
import type { Pt } from '../../../../shared/pitch/linalg'
import {
  DEFAULT_RECT,
  RECT_LIMITS,
  TEMPLATE_REQUIRED_COUNT,
  buildTemplate,
  type RectSize,
  type Template,
  type TemplateId,
  type TemplatePoint
} from '../../../../shared/pitch/templates'

export interface DraftPoint {
  /** Какая точка шаблона (см. TemplatePoint.id) или custom-N для чужих точек из файла. */
  key: string
  world: Pt
  image: Pt
}

export interface CalibrationDraft {
  /** Правка существующей разметки: её id. null — новая. */
  editingId: string | null
  time: number
  aspect: number
  template: TemplateId
  pitch: PitchSize
  rect: RectSize
  points: DraftPoint[]
  /** Выбранная точка (индекс) — для сдвига стрелками. */
  selected: number | null
  /** Нажато «+ точка»: на схеме можно выбрать дополнительную точку. */
  addingExtra: boolean
  /** Дополнительная точка, выбранная на схеме и ожидающая клика по видео. */
  pendingExtra: TemplatePoint | null
  createdAt: string | null
}

/** Допустимое положение точки на картинке (доли кадра): за краем можно (до целого кадра) — угол поля бывает за кадром. */
export const IMAGE_BOUNDS = { min: -1, max: 2 } as const
/** Во время разметки картинка занимает эту долю области (по каждой оси): вокруг остаётся поле для точек за кадром. Совпадает с pitch.css. */
export const CAL_PICTURE_SCALE = 0.7

/** Шаг сдвига выбранной точки клавишами: Alt+стрелки 1 px, с Shift 5 px, с Ctrl 50 px. */
export function nudgeStep(mods: { shiftKey: boolean; ctrlKey: boolean }): number {
  return mods.ctrlKey ? 50 : mods.shiftKey ? 5 : 1
}

export const clampImage = (p: Pt): Pt => ({
  x: Math.min(IMAGE_BOUNDS.max, Math.max(IMAGE_BOUNDS.min, p.x)),
  y: Math.min(IMAGE_BOUNDS.max, Math.max(IMAGE_BOUNDS.min, p.y))
})

export function newDraft(
  time: number,
  aspect: number,
  template: TemplateId = 'penalty-left',
  pitch: PitchSize = DEFAULT_PITCH
): CalibrationDraft {
  return {
    editingId: null,
    time,
    aspect,
    template,
    pitch: { ...pitch },
    rect: { ...DEFAULT_RECT },
    points: [],
    selected: null,
    addingExtra: false,
    pendingExtra: null,
    createdAt: null
  }
}

export const templateOf = (d: CalibrationDraft): Template =>
  buildTemplate(d.template, d.pitch, d.rect)

/** Черновик из сохранённой разметки (для правки). Точки сопоставляются с шаблоном по координатам. */
export function draftFromCalibration(c: Calibration): CalibrationDraft {
  const rect = c.rect ?? DEFAULT_RECT
  const draft: CalibrationDraft = {
    editingId: c.id,
    time: c.time,
    aspect: c.aspect,
    template: c.template,
    pitch: { ...c.pitch },
    rect: { ...rect },
    points: [],
    selected: null,
    addingExtra: false,
    pendingExtra: null,
    createdAt: c.createdAt
  }
  const t = templateOf(draft)
  const all = [...t.required, ...t.extras]
  draft.points = c.points.map((p, i) => {
    const match = all.find((q) => Math.hypot(q.world.x - p.world.x, q.world.y - p.world.y) < 1e-6)
    return { key: match?.id ?? `custom-${i}`, world: p.world, image: p.image }
  })
  return draft
}

/** Сколько обязательных точек уже отмечено. */
export function placedRequired(d: CalibrationDraft): number {
  const ids = new Set(templateOf(d).required.map((p) => p.id))
  return d.points.filter((p) => ids.has(p.key)).length
}

/** Следующая обязательная точка или null, если все отмечены. */
export function nextRequired(d: CalibrationDraft): TemplatePoint | null {
  return templateOf(d).required[placedRequired(d)] ?? null
}

/** Какую точку шаблона поставит следующий клик по видео. */
export function nextToPlace(d: CalibrationDraft): TemplatePoint | null {
  return d.pendingExtra ?? nextRequired(d)
}

export function addPoint(d: CalibrationDraft, image: Pt): CalibrationDraft {
  const target = nextToPlace(d)
  if (!target) return d
  const point: DraftPoint = { key: target.id, world: target.world, image: clampImage(image) }
  return {
    ...d,
    points: [...d.points, point],
    selected: d.points.length,
    addingExtra: false,
    pendingExtra: null
  }
}

export function movePoint(d: CalibrationDraft, index: number, image: Pt): CalibrationDraft {
  if (index < 0 || index >= d.points.length) return d
  return {
    ...d,
    points: d.points.map((p, i) => (i === index ? { ...p, image: clampImage(image) } : p))
  }
}

export function removeLast(d: CalibrationDraft): CalibrationDraft {
  if (d.pendingExtra || d.addingExtra) return { ...d, pendingExtra: null, addingExtra: false }
  if (d.points.length === 0) return d
  const points = d.points.slice(0, -1)
  return { ...d, points, selected: points.length > 0 ? points.length - 1 : null }
}

export function selectPoint(d: CalibrationDraft, index: number | null): CalibrationDraft {
  return { ...d, selected: index }
}

/** «+ точка»: включает выбор дополнительной точки на схеме (после всех обязательных). */
export function setAddingExtra(d: CalibrationDraft, on: boolean): CalibrationDraft {
  if (on && nextRequired(d)) return d
  return { ...d, addingExtra: on, pendingExtra: null }
}

/** Выбрать дополнительную точку на схеме. Допускается только после всех обязательных. */
export function beginExtra(d: CalibrationDraft, pointId: string | null): CalibrationDraft {
  if (pointId === null) return { ...d, pendingExtra: null, addingExtra: false }
  if (nextRequired(d)) return d
  const t = templateOf(d)
  const point = t.extras.find((p) => p.id === pointId)
  if (!point || d.points.some((p) => p.key === point.id)) return d
  return { ...d, pendingExtra: point, addingExtra: false }
}

/** Пересчёт мировых координат точек по шаблону (после смены размеров поля). */
function refreshWorld(d: CalibrationDraft): CalibrationDraft {
  const t = templateOf(d)
  const all = new Map([...t.required, ...t.extras].map((p) => [p.id, p.world]))
  return {
    ...d,
    points: d.points.map((p) => ({ ...p, world: all.get(p.key) ?? p.world })),
    pendingExtra: d.pendingExtra
      ? (t.extras.find((p) => p.id === d.pendingExtra?.id) ?? null)
      : null
  }
}

const clampTo = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

export function setPitchSize(d: CalibrationDraft, size: Partial<PitchSize>): CalibrationDraft {
  return refreshWorld({
    ...d,
    pitch: {
      length: clampTo(
        size.length ?? d.pitch.length,
        PITCH_LIMITS.minLength,
        PITCH_LIMITS.maxLength
      ),
      width: clampTo(size.width ?? d.pitch.width, PITCH_LIMITS.minWidth, PITCH_LIMITS.maxWidth)
    }
  })
}

export function setRectSize(d: CalibrationDraft, size: Partial<RectSize>): CalibrationDraft {
  return refreshWorld({
    ...d,
    rect: {
      w: clampTo(size.w ?? d.rect.w, RECT_LIMITS.min, RECT_LIMITS.maxW),
      h: clampTo(size.h ?? d.rect.h, RECT_LIMITS.min, RECT_LIMITS.maxH)
    }
  })
}

/** Другой шаблон: точки начинаются заново (они относятся к другим местам поля). */
export function setTemplate(d: CalibrationDraft, template: TemplateId): CalibrationDraft {
  if (template === d.template) return d
  return { ...d, template, points: [], selected: null, addingExtra: false, pendingExtra: null }
}

/** Результат расчёта по черновику (если точек хватает). size — размер кадра в пикселях. */
export function evaluateDraft(
  d: CalibrationDraft,
  size: { w: number; h: number }
): CalibrationFitResult | null {
  if (d.points.length < TEMPLATE_REQUIRED_COUNT) return null
  return fitCalibration(d.points, d.aspect, size)
}

/** Готова ли разметка к сохранению: все обязательные точки отмечены и расчёт прошёл. */
export function canSaveDraft(d: CalibrationDraft, size: { w: number; h: number }): boolean {
  if (nextRequired(d)) return false
  return evaluateDraft(d, size)?.ok === true
}

export function toCalibration(d: CalibrationDraft, id: string, now: Date): Calibration {
  return {
    id,
    time: d.time,
    aspect: d.aspect,
    pitch: { ...d.pitch },
    template: d.template,
    ...(d.template === 'rect' ? { rect: { ...d.rect } } : {}),
    points: d.points.map((p) => ({ world: p.world, image: p.image })),
    createdAt: d.createdAt ?? now.toISOString()
  }
}

export type Quality = 'few' | 'good' | 'ok' | 'bad'

/** Оценка точности по RMS (пиксели кадра). С четырьмя точками ошибка всегда нулевая — проверить нечем. */
export function qualityOf(rms: number, pointCount: number, frameHeight: number): Quality {
  if (pointCount <= TEMPLATE_REQUIRED_COUNT) return 'few'
  const k = Math.max(1, frameHeight / 1080)
  if (rms <= 3 * k) return 'good'
  if (rms <= 7 * k) return 'ok'
  return 'bad'
}
