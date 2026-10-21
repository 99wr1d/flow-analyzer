import { describe, expect, it } from 'vitest'
import fixture from './fixtures/dfine-synthetic.json'
import {
  PERSON_THRESHOLD,
  type DecodeSpec,
  ROI_HEIGHT,
  ROI_WIDTH,
  decodePersons,
  prepareInput,
  roiCrop
} from './postprocess'

type Recorded = typeof fixture.full

/** Разворачивает записанный (разреженный) выход модели в полные тензоры: у пропущенных запросов person-логит -10. */
function tensors(rec: Recorded): { logits: Float32Array; boxes: Float32Array } {
  const logits = new Float32Array(rec.numQueries * rec.numClasses).fill(-10)
  const boxes = new Float32Array(rec.numQueries * 4)
  for (const [q, logit, box] of rec.queries as [number, number, number[]][]) {
    logits[q * rec.numClasses] = logit
    boxes.set(box, q * 4)
  }
  return { logits, boxes }
}

const specOf = (rec: Recorded, threshold?: number): DecodeSpec => ({
  numQueries: rec.numQueries,
  numClasses: rec.numClasses,
  inputW: rec.inputW,
  inputH: rec.inputH,
  crop: rec.crop,
  threshold
})

describe('decodePersons на записанном выходе модели', () => {
  it('порог 0.4: на силуэтах настоящая модель людей не видит — пусто', () => {
    const { logits, boxes } = tensors(fixture.full)
    expect(PERSON_THRESHOLD).toBe(0.4)
    expect(decodePersons(logits, boxes, specOf(fixture.full))).toEqual([])
  })

  it('более низкий порог: рамки в пикселях кадра, по убыванию уверенности', () => {
    const { logits, boxes } = tensors(fixture.full)
    const found = decodePersons(logits, boxes, specOf(fixture.full, 0.055))
    expect(found.length).toBeGreaterThanOrEqual(3)
    for (let i = 1; i < found.length; i += 1)
      expect(found[i - 1].score).toBeGreaterThanOrEqual(found[i].score)
    for (const d of found) {
      expect(d.score).toBeGreaterThanOrEqual(0.055)
      expect(d.box.x).toBeGreaterThanOrEqual(0)
      expect(d.box.y).toBeGreaterThanOrEqual(0)
      expect(d.box.x + d.box.w).toBeLessThanOrEqual(960)
      expect(d.box.y + d.box.h).toBeLessThanOrEqual(540)
    }
    // Запрос 31: [0.4995, 0.6161, 0.0426, 0.164] на входе 960×544 → рамка вокруг средней фигурки.
    const middle = found.find(
      (d) => Math.abs(d.box.x + d.box.w / 2 - 479.5) < 1 && Math.abs(d.box.y - 290.5) < 1
    )
    expect(middle).toBeDefined()
    expect(middle!.box.w).toBeCloseTo(40.9, 0)
    expect(middle!.box.h).toBeCloseTo(89.2, 0)
    expect(middle!.score).toBeCloseTo(1 / (1 + Math.exp(2.37)), 3)
    // Фигурки стоят в x = 200, 480, 760: рамки находятся у всех трёх.
    for (const cx of [200, 480, 760]) {
      expect(found.some((d) => Math.abs(d.box.x + d.box.w / 2 - cx) < 15)).toBe(true)
    }
  })

  it('вырез: координаты возвращаются в системе целого кадра и не выходят за вырез', () => {
    const { logits, boxes } = tensors(fixture.roi)
    const crop = fixture.roi.crop
    const found = decodePersons(logits, boxes, specOf(fixture.roi, 0.06))
    expect(found.length).toBeGreaterThan(0)
    for (const d of found) {
      expect(d.box.x).toBeGreaterThanOrEqual(crop.x)
      expect(d.box.y).toBeGreaterThanOrEqual(crop.y)
      expect(d.box.x + d.box.w).toBeLessThanOrEqual(crop.x + crop.w + 1e-6)
      expect(d.box.y + d.box.h).toBeLessThanOrEqual(crop.y + crop.h + 1e-6)
    }
    expect(found.some((d) => Math.abs(d.box.x + d.box.w / 2 - 480) < 15)).toBe(true)
  })

  it('слишком маленькие и нулевые рамки отбрасываются', () => {
    const logits = new Float32Array([5, 5])
    const boxes = new Float32Array([0.5, 0.5, 0.001, 0.001, 0.5, 0.5, 0.2, 0.2])
    const spec = {
      numQueries: 2,
      numClasses: 1,
      inputW: 960,
      inputH: 544,
      crop: { x: 0, y: 0, w: 960, h: 540 }
    }
    expect(decodePersons(logits, boxes, spec)).toHaveLength(1)
  })
})

describe('roiCrop', () => {
  it('центр на игроке', () => {
    expect(roiCrop({ x: 450, y: 200, w: 60, h: 180 }, 960, 540)).toEqual({
      x: 160,
      y: 98,
      w: ROI_WIDTH,
      h: ROI_HEIGHT
    })
  })
  it('у краёв вырез сдвигается внутрь кадра', () => {
    expect(roiCrop({ x: 0, y: 0, w: 40, h: 100 }, 960, 540)).toMatchObject({ x: 0, y: 0 })
    expect(roiCrop({ x: 940, y: 520, w: 20, h: 20 }, 960, 540)).toMatchObject({
      x: 960 - ROI_WIDTH,
      y: 540 - ROI_HEIGHT
    })
  })
  it('кадр меньше выреза — берётся весь кадр', () => {
    expect(roiCrop({ x: 10, y: 10, w: 20, h: 20 }, 320, 240)).toEqual({
      x: 0,
      y: 0,
      w: 320,
      h: 240
    })
  })
})

describe('prepareInput', () => {
  it('кадр 960×540 дополняется до 960×544 серым; значения 0..1 в порядке RGB, CHW', () => {
    const w = 960
    const h = 540
    const rgba = new Uint8Array(w * h * 4)
    rgba.set([255, 128, 0, 255], (10 * w + 20) * 4)
    const { data, inputW, inputH } = prepareInput(rgba, w, { x: 0, y: 0, w, h })
    expect([inputW, inputH]).toEqual([960, 544])
    const plane = inputW * inputH
    const at = 10 * inputW + 20
    expect(data[at]).toBe(1)
    expect(data[plane + at]).toBeCloseTo(128 / 255, 6)
    expect(data[2 * plane + at]).toBe(0)
    expect(data[543 * inputW]).toBeCloseTo(114 / 255, 6)
    expect(data[0]).toBe(0)
  })
  it('вырез читается со смещением', () => {
    const w = 960
    const rgba = new Uint8Array(w * 540 * 4)
    rgba.set([10, 20, 30, 255], (100 * w + 200) * 4)
    const { data, inputW, inputH } = prepareInput(rgba, w, { x: 160, y: 98, w: 640, h: 384 })
    expect([inputW, inputH]).toEqual([640, 384])
    const at = 2 * inputW + 40
    expect(data[at] * 255).toBeCloseTo(10, 4)
    expect(data[inputW * inputH + at] * 255).toBeCloseTo(20, 4)
  })
})
