import { describe, expect, it } from 'vitest'
import {
  applyH,
  fitHomography,
  hullArea,
  reprojectionErrors,
  rms,
  type Correspondence
} from './homography'
import { cond3, det3, inv3, jacobiEigen, mul3, type Mat3 } from './linalg'
import { penaltyAreaRect, goalAreaRect, penaltySpot } from './landmarks'
import { makeProjector, clipPolyline, clipPolygon, W_MIN } from './projector'
import { gauss, lookAtCamera, randomCamera, rng, type Camera } from './pitch.testkit'

const pitch = { length: 105, width: 68 }
const SIZE = { w: 1920, h: 1080 }

/** Пары точек: углы штрафной площади и ещё пара опорных точек, спроецированные камерой. */
function pairsFor(
  seed: number,
  extra = false,
  noisePx = 0
): { cam: Camera; pairs: Correspondence[] } | null {
  const cam = randomCamera(seed)
  const r = rng(seed + 1000)
  const worlds = [...penaltyAreaRect(pitch, 'left')]
  if (extra) worlds.push(...goalAreaRect(pitch, 'left'), penaltySpot(pitch, 'left'))
  const pairs = worlds.map((world) => {
    const image = cam.project(world)
    if (!image) return null
    return {
      world,
      image: {
        x: image.x + (gauss(r) * noisePx) / SIZE.w,
        y: image.y + (gauss(r) * noisePx) / SIZE.h
      }
    }
  })
  if (pairs.some((p) => p === null)) return null
  const valid = pairs as NonNullable<(typeof pairs)[number]>[]
  // Берём только «нормальные» кадры: все точки в разумных границах.
  if (
    valid.some((p) => p.image.x < -0.6 || p.image.x > 1.6 || p.image.y < -0.6 || p.image.y > 1.6)
  ) {
    return null
  }
  return { cam, pairs: valid }
}

describe('linalg', () => {
  it('Якоби находит собственные значения симметричной матрицы', () => {
    const m = [4, 1, 0, 1, 3, 1, 0, 1, 2]
    const { values, vectors } = jacobiEigen(m, 3)
    expect(values[0] + values[1] + values[2]).toBeCloseTo(9, 10)
    // A·v = λ·v
    for (let k = 0; k < 3; k += 1) {
      const v = vectors[k]
      const av = [0, 1, 2].map((i) => m[i * 3] * v[0] + m[i * 3 + 1] * v[1] + m[i * 3 + 2] * v[2])
      for (let i = 0; i < 3; i += 1) expect(av[i]).toBeCloseTo(values[k] * v[i], 10)
    }
  })

  it('обратная матрица и определитель', () => {
    const m: Mat3 = [2, 1, 0, 0, 3, 1, 1, 0, 4]
    const inv = inv3(m)!
    const id = mul3(m, inv)
    ;[1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(id[i]).toBeCloseTo(v, 12))
    expect(det3(m)).toBeCloseTo(25, 12)
    expect(inv3([1, 2, 3, 2, 4, 6, 1, 1, 1])).toBeNull()
    expect(cond3([1, 0, 0, 0, 1, 0, 0, 0, 1])).toBeCloseTo(1, 10)
  })
})

describe('fitHomography: восстановление известной гомографии', () => {
  it('без шума: по 4 точкам проекция любой точки поля совпадает до 1e-6', () => {
    let checked = 0
    for (let seed = 1; seed <= 60 && checked < 25; seed += 1) {
      const s = pairsFor(seed)
      if (!s) continue
      const fit = fitHomography(s.pairs, s.cam.aspect)
      expect(fit.ok).toBe(true)
      if (!fit.ok) continue
      checked += 1
      const r = rng(seed)
      for (let i = 0; i < 50; i += 1) {
        const p = { x: r() * 105, y: r() * 68 }
        const truth = s.cam.project(p)
        const got = applyH(fit.H, p)
        if (!truth || !got) continue
        expect(Math.abs(got.x - truth.x)).toBeLessThan(1e-6)
        expect(Math.abs(got.y - truth.y)).toBeLessThan(1e-6)
      }
    }
    expect(checked).toBeGreaterThanOrEqual(15)
  })

  it('ошибка перепроекции по 4 точкам нулевая', () => {
    const s = pairsFor(3)!
    const fit = fitHomography(s.pairs, s.cam.aspect)
    expect(fit.ok).toBe(true)
    if (!fit.ok) return
    expect(rms(reprojectionErrors(fit.H, s.pairs, SIZE))).toBeLessThan(1e-4)
  })

  it('N > 4 без шума: точный результат (метод наименьших квадратов)', () => {
    const s = pairsFor(5, true)!
    const fit = fitHomography(s.pairs, s.cam.aspect)
    expect(fit.ok).toBe(true)
    if (!fit.ok) return
    expect(rms(reprojectionErrors(fit.H, s.pairs, SIZE))).toBeLessThan(1e-4)
  })

  it('с шумом 0.5 px и 9 точками: RMS около ожидаемого, а модель ближе к истине, чем шум', () => {
    const rmsList: number[] = []
    const truthErr: number[] = []
    for (let seed = 1; seed <= 80 && rmsList.length < 30; seed += 1) {
      const s = pairsFor(seed, true, 0.5)
      if (!s) continue
      const fit = fitHomography(s.pairs, s.cam.aspect)
      if (!fit.ok) continue
      rmsList.push(rms(reprojectionErrors(fit.H, s.pairs, SIZE)))
      // Ошибка модели на независимых точках поля (в пикселях).
      const r = rng(seed * 7)
      for (let i = 0; i < 20; i += 1) {
        const p = { x: r() * 30, y: 14 + r() * 40 }
        const t = s.cam.project(p)
        const g = applyH(fit.H, p)
        if (t && g) truthErr.push(Math.hypot((g.x - t.x) * SIZE.w, (g.y - t.y) * SIZE.h))
      }
    }
    expect(rmsList.length).toBeGreaterThanOrEqual(10)
    const mean = rmsList.reduce((a, b) => a + b, 0) / rmsList.length
    // 9 точек, 8 степеней свободы модели из 18 измерений: ожидаемая радиальная RMS остатков ≈ 0.5·√(10/18)·√2 ≈ 0.53.
    expect(mean).toBeGreaterThan(0.3)
    expect(mean).toBeLessThan(0.8)
    const meanTruth = truthErr.reduce((a, b) => a + b, 0) / truthErr.length
    expect(meanTruth).toBeLessThan(3)
  })
})

describe('fitHomography: вырожденные случаи', () => {
  const world = penaltyAreaRect(pitch, 'left')
  const good = [
    { x: 0.1, y: 0.4 },
    { x: 0.4, y: 0.42 },
    { x: 0.55, y: 0.85 },
    { x: 0.05, y: 0.8 }
  ]
  const make = (img: { x: number; y: number }[], w = world): Correspondence[] =>
    img.map((image, i) => ({ world: w[i], image }))

  it('нормальная конфигурация проходит', () => {
    expect(fitHomography(make(good), 16 / 9).ok).toBe(true)
  })

  it('меньше 4 точек', () => {
    const r = fitHomography(make(good).slice(0, 3), 16 / 9)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('too-few-points')
  })

  it('три из четырёх точек на одной прямой', () => {
    const img = [good[0], { x: 0.25, y: 0.41 }, { x: 0.4, y: 0.42 }, good[3]]
    const r = fitHomography(make(img), 16 / 9)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('collinear')
  })

  it('все точки на одной прямой при N = 6', () => {
    const w = [0, 1, 2, 3, 4, 5].map((i) => ({ x: i * 3, y: 10 }))
    const img = [0, 1, 2, 3, 4, 5].map((i) => ({ x: 0.1 + i * 0.1, y: 0.5 }))
    const r = fitHomography(
      w.map((world, i) => ({ world, image: img[i] })),
      16 / 9
    )
    expect(r.ok).toBe(false)
  })

  it('точки слишком близко друг к другу', () => {
    const img = good.map((p) => ({ x: 0.5 + (p.x - 0.3) * 0.05, y: 0.5 + (p.y - 0.6) * 0.05 }))
    const r = fitHomography(make(img), 16 / 9)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('tiny-area')
  })

  it('две точки в одном месте', () => {
    const img = [good[0], good[0], good[2], good[3]]
    const r = fitHomography(make(img), 16 / 9)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('duplicate-points')
  })

  it('точки отмечены крест-накрест (перевёрнутый порядок)', () => {
    const img = [good[0], good[2], good[1], good[3]]
    const r = fitHomography(make(img), 16 / 9)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('twisted-order')
  })

  it('зеркальная камера (другая сторона поля) допустима', () => {
    // Те же точки с зеркально отражённой картинкой — настоящая камера с другой стороны.
    const img = good.map((p) => ({ x: 1 - p.x, y: p.y }))
    expect(fitHomography(make(img), 16 / 9).ok).toBe(true)
  })

  it('нечисловые координаты', () => {
    const r = fitHomography(make([{ x: NaN, y: 0 }, good[1], good[2], good[3]]), 16 / 9)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('bad-number')
  })

  it('площадь выпуклой оболочки', () => {
    expect(
      hullArea([
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 3 },
        { x: 0, y: 3 },
        { x: 1, y: 1 }
      ])
    ).toBeCloseTo(6, 12)
  })
})

describe('проектор', () => {
  const s = pairsFor(11)!
  const fit = fitHomography(s.pairs, s.cam.aspect)
  if (!fit.ok) throw new Error('нет гомографии')
  const proj = makeProjector(fit.H)!

  it('круговой обход поле → картинка → поле', () => {
    const r = rng(5)
    let n = 0
    for (let i = 0; i < 200; i += 1) {
      const p = { x: r() * 105, y: r() * 68 }
      const img = proj.toImage(p)
      if (!img) continue
      const back = proj.toWorld(img)
      expect(back).not.toBeNull()
      expect(Math.hypot(back!.x - p.x, back!.y - p.y)).toBeLessThan(1e-6)
      n += 1
    }
    expect(n).toBeGreaterThan(100)
  })

  it('точка выше горизонта не имеет проекции на землю', () => {
    // Горизонт на картинке: ниже него — земля. Берём точку заведомо над горизонтом.
    const { a, b, c } = proj.horizon
    // Точка u=0.5: v на горизонте = -(a·u + c)/b
    const vh = -(a * 0.5 + c) / b
    expect(proj.toWorld({ x: 0.5, y: vh - 0.2 })).toBeNull()
  })

  it('ломаная, уходящая за камеру (w ≤ 0), обрезается: все точки конечны и ограничены', () => {
    // Камера почти горизонтальная: горизонт попадает в кадр.
    const cam = lookAtCamera([30, 90, 6], [30, 20, 0], 1.2)
    const world = [
      { x: 0, y: 0 },
      { x: 105, y: 0 },
      { x: 105, y: 68 },
      { x: 0, y: 68 }
    ]
    const f = fitHomography(
      world.map((w) => ({ world: w, image: cam.project(w)! })),
      cam.aspect
    )
    expect(f.ok).toBe(true)
    if (!f.ok) return
    const p = makeProjector(f.H)!
    // Линия от середины поля уходит назад, под камеру и за неё: там w ≤ 0 и проецировать нельзя.
    const line = [
      { x: 52, y: 60 },
      { x: 52, y: 400 }
    ]
    expect(p.w(line[1])).toBeLessThan(W_MIN)
    const pieces = p.projectPolyline(line)
    expect(pieces).toHaveLength(1)
    for (const pt of pieces[0]) {
      expect(Number.isFinite(pt.x) && Number.isFinite(pt.y)).toBe(true)
      expect(Math.abs(pt.x)).toBeLessThan(100)
      expect(Math.abs(pt.y)).toBeLessThan(100)
    }
    // Конец куска лежит там, где w = W_MIN (то есть у самой границы безопасной зоны).
    const clipped = clipPolyline(line, p.halfPlane)[0]
    expect(p.w(clipped[clipped.length - 1])).toBeCloseTo(W_MIN, 6)
  })

  it('многоугольник в запретной зоне пропадает целиком', () => {
    const hp = { a: 1, b: 0, c: 0 }
    expect(
      clipPolygon(
        [
          { x: -3, y: 0 },
          { x: -1, y: 0 },
          { x: -2, y: 4 }
        ],
        hp
      )
    ).toEqual([])
    expect(
      clipPolyline(
        [
          { x: -3, y: 0 },
          { x: -1, y: 5 }
        ],
        hp
      )
    ).toEqual([])
  })

  it('отсечение многоугольника по полуплоскости оставляет часть', () => {
    const hp = { a: 1, b: 0, c: 0 }
    const out = clipPolygon(
      [
        { x: -1, y: 0 },
        { x: 3, y: 0 },
        { x: 3, y: 2 },
        { x: -1, y: 2 }
      ],
      hp
    )
    expect(out.every((p) => p.x >= 0)).toBe(true)
    expect(out.length).toBe(4)
  })
})
