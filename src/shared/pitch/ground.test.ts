import { describe, expect, it } from 'vitest'
import { GROUND_RATIO_FALLBACK, groundEllipseRatio } from './ground'
import { penaltyAreaRect } from './landmarks'
import { lookAtCamera, sampleCalibration, type Camera } from './pitch.testkit'
import { projectorFor, type Calibration } from './calibration'

// Камера у боковой линии, высоко над левой штрафной.
const cam = lookAtCamera([25, 95, 22], [14, 34, 0], 1.25)

function calibrationOf(camera: Camera): Calibration {
  const world = penaltyAreaRect({ length: 105, width: 68 }, 'left')
  return sampleCalibration({
    aspect: camera.aspect,
    points: world.map((w) => ({ world: w, image: camera.project(w)! }))
  })
}

/** Эталон: настоящая проекция круга радиуса 1 м вокруг точки поля, отношение высоты к ширине на экране (в пикселях). */
function truthRatio(camera: Camera, center: { x: number; y: number }): number {
  const xs: number[] = []
  const ys: number[] = []
  for (let i = 0; i < 90; i += 1) {
    const t = (2 * Math.PI * i) / 90
    const p = camera.project({ x: center.x + Math.cos(t), y: center.y + Math.sin(t) })!
    xs.push(p.x)
    ys.push(p.y)
  }
  const w = (Math.max(...xs) - Math.min(...xs)) * camera.aspect
  const h = Math.max(...ys) - Math.min(...ys)
  return h / w
}

describe('groundEllipseRatio', () => {
  it('без разметки — 0.35', () => {
    expect(groundEllipseRatio(undefined, { x: 0.5, y: 0.5 })).toBe(GROUND_RATIO_FALLBACK)
    expect(GROUND_RATIO_FALLBACK).toBe(0.35)
  })

  it('совпадает с проекцией круга на поле (±5%) в разных точках кадра', () => {
    const cal = calibrationOf(cam)
    const proj = projectorFor(cal)!
    for (const world of [
      { x: 8, y: 34 },
      { x: 14, y: 20 },
      { x: 4, y: 50 },
      { x: 20, y: 40 }
    ]) {
      const at = cam.project(world)!
      const got = groundEllipseRatio(cal, at)
      const want = truthRatio(cam, world)
      expect(Math.abs(got - want) / want, `${world.x},${world.y}: ${got} vs ${want}`).toBeLessThan(
        0.05
      )
      expect(proj.toWorld(at)).not.toBeNull()
    }
  })

  it('вдали (у горизонта) эллипс площе, чем вблизи', () => {
    const cal = calibrationOf(cam)
    const far = groundEllipseRatio(cal, cam.project({ x: 4, y: 20 })!)
    const near = groundEllipseRatio(cal, cam.project({ x: 14, y: 50 })!)
    expect(far).toBeGreaterThan(0)
    expect(near).toBeGreaterThan(far)
  })

  it('точка выше горизонта — запасное значение', () => {
    const cal = calibrationOf(cam)
    expect(groundEllipseRatio(cal, { x: 0.5, y: -0.9 })).toBe(GROUND_RATIO_FALLBACK)
  })
})
