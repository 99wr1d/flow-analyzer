import { beforeEach, describe, expect, it } from 'vitest'
import { projectorFor } from '../../../../shared/pitch/calibration'
import { penaltyAreaRect } from '../../../../shared/pitch/landmarks'
import { lookAtCamera, sampleCalibration } from '../../../../shared/pitch/pitch.testkit'
import { makeProjector } from '../../../../shared/pitch/projector'
import { fitHomography } from '../../../../shared/pitch/homography'
import {
  CAL_PICTURE_SCALE,
  IMAGE_BOUNDS,
  addPoint,
  beginExtra,
  canSaveDraft,
  draftFromCalibration,
  evaluateDraft,
  movePoint,
  newDraft,
  nextRequired,
  nextToPlace,
  nudgeStep,
  placedRequired,
  qualityOf,
  removeLast,
  setAddingExtra,
  setPitchSize,
  setTemplate,
  toCalibration,
  type CalibrationDraft
} from './draft'
import { useCalibrationsStore } from './calibrationsStore'
import { gridPath, gridPrimitives } from './gridPaths'
import { hitPaint, pointInPolygon } from './hitPitch'
import { paintPitch } from '../../../../shared/pitch/shapes'
import type { Ring } from '../../../../shared/annotations'

const SIZE = { w: 1280, h: 720 }
const cam = lookAtCamera([24, 100, 22], [14, 36, 0], 1.2)

/** Черновик с четырьмя обязательными точками, снятыми «камерой». */
function placedDraft(): CalibrationDraft {
  let d = newDraft(1, 16 / 9)
  for (const p of penaltyAreaRect(d.pitch, 'left')) d = addPoint(d, cam.project(p)!)
  return d
}

describe('черновик разметки: точки по порядку', () => {
  it('обязательные точки ставятся по очереди, потом клик ничего не добавляет', () => {
    let d = newDraft(1, 16 / 9)
    expect(placedRequired(d)).toBe(0)
    expect(nextRequired(d)?.id).toBe('pa-l1')
    d = addPoint(d, { x: 0.3, y: 0.3 })
    expect(placedRequired(d)).toBe(1)
    expect(nextRequired(d)?.id).toBe('pa-l2')
    d = placedDraft()
    expect(placedRequired(d)).toBe(4)
    expect(nextRequired(d)).toBeNull()
    expect(addPoint(d, { x: 0.5, y: 0.5 })).toBe(d)
  })

  it('Backspace убирает последнюю точку; пустой черновик не ломается', () => {
    let d = placedDraft()
    d = removeLast(d)
    expect(d.points).toHaveLength(3)
    expect(nextRequired(d)?.id).toBe('pa-l4')
    expect(removeLast(newDraft(1, 1.7))).toMatchObject({ points: [] })
  })

  it('дополнительная точка: сначала «+ точка», затем выбор на схеме, затем клик', () => {
    let d = newDraft(1, 16 / 9)
    // До обязательных точек дополнительные недоступны.
    expect(setAddingExtra(d, true).addingExtra).toBe(false)
    expect(beginExtra(d, 'ga-l1').pendingExtra).toBeNull()
    d = placedDraft()
    d = setAddingExtra(d, true)
    expect(d.addingExtra).toBe(true)
    d = beginExtra(d, 'ga-l1')
    expect(d.pendingExtra?.id).toBe('ga-l1')
    expect(d.addingExtra).toBe(false)
    expect(nextToPlace(d)?.id).toBe('ga-l1')
    d = addPoint(d, { x: 0.4, y: 0.45 })
    expect(d.points).toHaveLength(5)
    expect(d.points[4].key).toBe('ga-l1')
    expect(d.pendingExtra).toBeNull()
    // Уже отмеченную точку второй раз выбрать нельзя.
    expect(beginExtra(d, 'ga-l1').pendingExtra).toBeNull()
    // Отмена выбора.
    expect(removeLast(beginExtra(setAddingExtra(d, true), 'ga-l2')).pendingExtra).toBeNull()
  })

  it('смена размеров поля пересчитывает метры у отмеченных точек, смена шаблона — сбрасывает точки', () => {
    let d = placedDraft()
    d = setPitchSize(d, { width: 60 })
    const y0 = (60 - 40.32) / 2
    expect(d.points[0].world.y).toBeCloseTo(y0, 9)
    expect(d.points[3].world.y).toBeCloseTo(y0 + 40.32, 9)
    expect(setPitchSize(d, { length: 500 }).pitch.length).toBe(120)
    expect(setTemplate(d, 'goal-left').points).toHaveLength(0)
    expect(setTemplate(d, 'penalty-left')).toBe(d)
  })

  it('перемещение точки не выходит за разумные границы', () => {
    const d = movePoint(placedDraft(), 0, { x: 9, y: -9 })
    expect(d.points[0].image).toEqual({ x: 2, y: -1 })
    // Точка далеко за краем кадра, но в границах: не обрезается.
    expect(movePoint(placedDraft(), 0, { x: -0.8, y: 1.7 }).points[0].image).toEqual({
      x: -0.8,
      y: 1.7
    })
  })
})

describe('сохранение разметки', () => {
  it('canSaveDraft: нужны все 4 точки и корректная гомография', () => {
    expect(canSaveDraft(newDraft(1, 16 / 9), SIZE)).toBe(false)
    const d = placedDraft()
    expect(canSaveDraft(d, SIZE)).toBe(true)
    // Точки в неверном порядке — расчёт не проходит.
    const swapped: CalibrationDraft = {
      ...d,
      points: [d.points[0], d.points[2], d.points[1], d.points[3]].map((p, i) => ({
        ...p,
        world: d.points[i].world,
        key: d.points[i].key
      }))
    }
    const res = evaluateDraft(swapped, SIZE)
    expect(res?.ok).toBe(false)
    expect(canSaveDraft(swapped, SIZE)).toBe(false)
  })

  it('toCalibration и обратно: правка существующей разметки возвращает те же точки', () => {
    let d = placedDraft()
    d = addPoint(beginExtra(setAddingExtra(d, true), 'ps-l'), { x: 0.46, y: 0.48 })
    const c = toCalibration(
      d,
      '00000000-0000-4000-8000-0000000000c9',
      new Date('2026-03-01T10:00:00Z')
    )
    expect(c.points).toHaveLength(5)
    expect(c.createdAt).toBe('2026-03-01T10:00:00.000Z')
    expect(c.rect).toBeUndefined()
    const back = draftFromCalibration(c)
    expect(back.editingId).toBe(c.id)
    expect(back.points.map((p) => p.key)).toEqual(['pa-l1', 'pa-l2', 'pa-l3', 'pa-l4', 'ps-l'])
    expect(toCalibration(back, c.id, new Date()).points).toEqual(c.points)
    expect(projectorFor(c)).not.toBeNull()
  })

  it('шаблон «прямоугольник» хранит размер', () => {
    let d = setTemplate(newDraft(2, 16 / 9), 'rect')
    expect(d.template).toBe('rect')
    for (const p of [
      { x: 0.2, y: 0.3 },
      { x: 0.7, y: 0.32 },
      { x: 0.8, y: 0.8 },
      { x: 0.1, y: 0.75 }
    ]) {
      d = addPoint(d, p)
    }
    const c = toCalibration(d, '00000000-0000-4000-8000-0000000000c8', new Date())
    expect(c.rect).toEqual({ w: 40.32, h: 16.5 })
    expect(c.template).toBe('rect')
  })

  it('оценка точности: 4 точки — не проверить, затем по порогам', () => {
    expect(qualityOf(0, 4, 1080)).toBe('few')
    expect(qualityOf(1.8, 6, 1080)).toBe('good')
    expect(qualityOf(5, 6, 1080)).toBe('ok')
    expect(qualityOf(12, 6, 1080)).toBe('bad')
    // На кадре 4K пороги шире.
    expect(qualityOf(5, 6, 2160)).toBe('good')
  })
})

describe('хранилище разметок: история и выбор', () => {
  beforeEach(() => useCalibrationsStore.getState().reset())

  it('добавить, заменить, удалить и отменить', () => {
    const s = useCalibrationsStore.getState
    const a = sampleCalibration({ id: '00000000-0000-4000-8000-0000000000a1', time: 3 })
    s().add(a)
    expect(s().items).toHaveLength(1)
    expect(s().selectedId).toBe(a.id)
    s().replace({ ...a, time: 4 })
    expect(s().items[0].time).toBe(4)
    s().remove(a.id)
    expect(s().items).toHaveLength(0)
    expect(s().selectedId).toBeNull()
    s().undo()
    expect(s().items).toHaveLength(1)
    s().undo()
    expect(s().items[0].time).toBe(3)
    s().redo()
    expect(s().items[0].time).toBe(4)
    // Замена несуществующей разметки ничего не делает.
    const before = s().items
    s().replace(sampleCalibration({ id: '00000000-0000-4000-8000-0000000000ff' }))
    expect(s().items).toBe(before)
  })

  it('load очищает историю', () => {
    const s = useCalibrationsStore.getState
    s().add(sampleCalibration())
    s().load([sampleCalibration({ time: 9 })])
    expect(s().past).toHaveLength(0)
    expect(s().items[0].time).toBe(9)
  })
})

describe('сетка поля и попадание курсором', () => {
  const fit = fitHomography(
    penaltyAreaRect({ length: 105, width: 68 }, 'left').map((w) => ({
      world: w,
      image: cam.project(w)!
    })),
    16 / 9
  )
  if (!fit.ok) throw new Error('нет гомографии')
  const proj = makeProjector(fit.H)!

  it('путь сетки не пустой, а у прямоугольника — рамка и две средние линии', () => {
    const full = gridPath(
      proj,
      gridPrimitives('penalty-left', { length: 105, width: 68 }, { w: 1, h: 1 }),
      SIZE
    )
    expect(full.startsWith('M')).toBe(true)
    expect(full.length).toBeGreaterThan(1000)
    expect(gridPrimitives('rect', { length: 105, width: 68 }, { w: 40, h: 16 })).toHaveLength(3)
  })

  const ring: Ring = {
    id: '00000000-0000-4000-8000-000000000a01',
    space: 'pitch',
    calibrationId: '00000000-0000-4000-8000-0000000000c1',
    type: 'ring',
    center: { x: 9, y: 34 },
    radius: 2,
    style: { color: '#ffffff', width: 0.011, dash: 'solid' },
    timing: { mode: 'frame', start: 1, freezeSeconds: 3 }
  }
  const measure = (t: string, px: number): number => t.length * px * 0.5

  it('попадание в кольцо: внутри и у края — да, далеко — нет', () => {
    const paint = paintPitch(ring, proj, SIZE, measure)
    const c = proj.toImage({ x: 9, y: 34 })!
    const inside = { x: c.x * SIZE.w, y: c.y * SIZE.h }
    expect(hitPaint(paint, inside)).toBe(true)
    const edge = proj.toImage({ x: 11, y: 34 })!
    expect(hitPaint(paint, { x: edge.x * SIZE.w + 3, y: edge.y * SIZE.h })).toBe(true)
    expect(hitPaint(paint, { x: 5, y: 5 })).toBe(false)
  })

  it('pointInPolygon', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 }
    ]
    expect(pointInPolygon({ x: 5, y: 5 }, sq)).toBe(true)
    expect(pointInPolygon({ x: 15, y: 5 }, sq)).toBe(false)
  })
})

describe('nudgeStep и размер картинки в разметке', () => {
  it('Alt+стрелки: 1 px, с Shift 5, с Ctrl 50 (Ctrl сильнее Shift)', () => {
    expect(nudgeStep({ shiftKey: false, ctrlKey: false })).toBe(1)
    expect(nudgeStep({ shiftKey: true, ctrlKey: false })).toBe(5)
    expect(nudgeStep({ shiftKey: false, ctrlKey: true })).toBe(50)
    expect(nudgeStep({ shiftKey: true, ctrlKey: true })).toBe(50)
  })
  it('точка до целого кадра за краем ставится и двигается, дальше ограничивается', () => {
    let d = newDraft(1, 16 / 9)
    d = addPoint(d, { x: -0.9, y: 1.9 })
    expect(d.points[0].image).toEqual({ x: -0.9, y: 1.9 })
    d = movePoint(d, 0, { x: -5, y: 7 })
    expect(d.points[0].image).toEqual({ x: IMAGE_BOUNDS.min, y: IMAGE_BOUNDS.max })
  })
  it('вокруг уменьшенной картинки есть поле для точек за кадром', () => {
    expect(CAL_PICTURE_SCALE).toBeGreaterThan(0.5)
    expect(CAL_PICTURE_SCALE).toBeLessThanOrEqual(0.75)
  })
})
