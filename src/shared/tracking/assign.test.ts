import { describe, expect, it } from 'vitest'
import { minCostAssignment, perfectMatching } from './assign'

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0
    return a / 4294967296
  }
}

/** Перебор всех назначений строк в разные столбцы (эталон для малых матриц). */
function brute(cost: number[][]): number {
  const m = cost[0]?.length ?? 0
  let best = Infinity
  const used = new Array<boolean>(m).fill(false)
  const walk = (r: number, sum: number): void => {
    if (r === cost.length) {
      best = Math.min(best, sum)
      return
    }
    for (let c = 0; c < m; c += 1) {
      if (used[c] || !Number.isFinite(cost[r][c])) continue
      used[c] = true
      walk(r + 1, sum + cost[r][c])
      used[c] = false
    }
  }
  walk(0, 0)
  return cost.length === 0 ? 0 : best
}

describe('назначения', () => {
  it('венгерский алгоритм = перебор на случайных матрицах с запрещёнными рёбрами', () => {
    const R = rng(7)
    for (let t = 0; t < 400; t += 1) {
      const n = 1 + Math.floor(R() * 5)
      const m = n + Math.floor(R() * 4)
      const cost = Array.from({ length: n }, () =>
        Array.from({ length: m }, () => (R() < 0.35 ? Infinity : Math.round(R() * 100) / 37))
      )
      const want = brute(cost)
      const got = minCostAssignment(cost)
      if (Number.isFinite(want)) expect(got).toBeCloseTo(want, 9)
      else expect(got).toBe(Infinity)
      const allowed = cost.map((row) => row.map((c) => Number.isFinite(c)))
      expect(perfectMatching(allowed)).toBe(Number.isFinite(want))
    }
  })

  it('пустая матрица и строк больше, чем столбцов', () => {
    expect(minCostAssignment([])).toBe(0)
    expect(minCostAssignment([[1], [2]])).toBe(Infinity)
    expect(perfectMatching([])).toBe(true)
    expect(perfectMatching([[true], [true]])).toBe(false)
  })
})
