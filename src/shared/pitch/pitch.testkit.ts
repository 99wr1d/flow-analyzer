// Синтетическая камера для тестов: проекция плоскости поля настоящей «дырочной» камерой с известными параметрами.
import type { Calibration } from './calibration'
import type { Pt } from './linalg'

/** Детерминированный генератор случайных чисел (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(r(), 1e-12))) * Math.cos(2 * Math.PI * r())
}

export interface Camera {
  /** Точка поля (z = 0) → картинка (0..1). null — за камерой. */
  project: (p: Pt) => Pt | null
  aspect: number
}

export function lookAtCamera(
  position: [number, number, number],
  target: [number, number, number],
  focalWidths: number,
  aspect = 16 / 9
): Camera {
  const sub = (a: number[], b: number[]): number[] => a.map((v, i) => v - b[i])
  const norm = (a: number[]): number[] => {
    const l = Math.hypot(...a)
    return a.map((v) => v / l)
  }
  const crossP = (a: number[], b: number[]): number[] => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ]
  const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const f = norm(sub(target, position))
  const r = norm(crossP(f, [0, 0, 1]))
  const d = crossP(f, r)
  return {
    aspect,
    project: (p) => {
      const X = sub([p.x, p.y, 0], position)
      const z = dot(X, f)
      if (z <= 1e-6) return null
      return {
        x: 0.5 + (focalWidths * dot(X, r)) / z,
        y: 0.5 + (focalWidths * aspect * dot(X, d)) / z
      }
    }
  }
}

/** Случайная камера, которая смотрит на левую штрафную площадь с высоты 8–40 м. */
export function randomCamera(seed: number): Camera {
  const r = rng(seed)
  const target: [number, number, number] = [8 + r() * 10, 30 + r() * 8, 0]
  const position: [number, number, number] = [
    target[0] + (r() - 0.5) * 50,
    68 + 10 + r() * 50,
    8 + r() * 32
  ]
  return lookAtCamera(position, target, 0.9 + r() * 1.4)
}

export function sampleCalibration(over: Partial<Calibration> = {}): Calibration {
  return {
    id: '00000000-0000-4000-8000-0000000000c1',
    time: 12,
    aspect: 16 / 9,
    pitch: { length: 105, width: 68 },
    template: 'penalty-left',
    points: [
      { world: { x: 0, y: 13.84 }, image: { x: 0.1, y: 0.4 } },
      { world: { x: 16.5, y: 13.84 }, image: { x: 0.4, y: 0.42 } },
      { world: { x: 16.5, y: 54.16 }, image: { x: 0.55, y: 0.85 } },
      { world: { x: 0, y: 54.16 }, image: { x: 0.05, y: 0.8 } }
    ],
    createdAt: '2026-03-01T10:00:00.000Z',
    ...over
  }
}
