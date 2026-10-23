// Слежение: задача о назначениях за полиномиальное время (для совместного сопоставления целей и детекций, multi.ts).

/**
 * Наименьшая сумма назначения строк в разные столбцы (строк не больше, чем столбцов). Запрещённое ребро — Infinity.
 * Венгерский алгоритм с потенциалами, O(n²·m). Если полного назначения без запрещённых рёбер нет — Infinity.
 */
export function minCostAssignment(cost: number[][]): number {
  const n = cost.length
  if (n === 0) return 0
  const m = cost[0].length
  if (m < n) return Infinity
  // Запрещённые рёбра — большой конечный штраф, чтобы алгоритм работал; затем проверяем, не попал ли он в ответ.
  let big = 1
  for (const row of cost) for (const c of row) if (Number.isFinite(c)) big += Math.abs(c)
  big *= n + 1
  const a = (r: number, c: number): number => {
    const v = cost[r][c]
    return Number.isFinite(v) ? v : big
  }
  // 1-индексация, как в классической записи: p[j] — строка, назначенная столбцу j.
  const u = new Float64Array(n + 1)
  const v = new Float64Array(m + 1)
  const p = new Int32Array(m + 1)
  const way = new Int32Array(m + 1)
  const minv = new Float64Array(m + 1)
  const used = new Uint8Array(m + 1)
  for (let i = 1; i <= n; i += 1) {
    p[0] = i
    let j0 = 0
    minv.fill(Infinity)
    used.fill(0)
    do {
      used[j0] = 1
      const i0 = p[j0]
      let delta = Infinity
      let j1 = 0
      for (let j = 1; j <= m; j += 1) {
        if (used[j]) continue
        const cur = a(i0 - 1, j - 1) - u[i0] - v[j]
        if (cur < minv[j]) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      for (let j = 0; j <= m; j += 1) {
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else {
          minv[j] -= delta
        }
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0 !== 0)
  }
  let sum = 0
  for (let j = 1; j <= m; j += 1) {
    if (p[j] === 0) continue
    const c = cost[p[j] - 1][j - 1]
    if (!Number.isFinite(c)) return Infinity
    sum += c
  }
  return sum
}

/** Есть ли назначение каждой строке своего разрешённого столбца (наибольшее паросочетание, Кун). */
export function perfectMatching(allowed: boolean[][]): boolean {
  const n = allowed.length
  if (n === 0) return true
  const m = allowed[0].length
  const owner = new Int32Array(m).fill(-1)
  const tryRow = (r: number, seen: Uint8Array): boolean => {
    for (let c = 0; c < m; c += 1) {
      if (!allowed[r][c] || seen[c]) continue
      seen[c] = 1
      if (owner[c] < 0 || tryRow(owner[c], seen)) {
        owner[c] = r
        return true
      }
    }
    return false
  }
  for (let r = 0; r < n; r += 1) if (!tryRow(r, new Uint8Array(m))) return false
  return true
}
