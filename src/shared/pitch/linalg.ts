// Небольшая линейная алгебра для расчёта разметки поля: матрицы 3×3 и собственные векторы симметричных матриц.
// Всё на обычных массивах чисел, без внешних библиотек. Матрица 3×3 хранится строками: [a b c; d e f; g h i].

export type Mat3 = readonly [number, number, number, number, number, number, number, number, number]

export interface Pt {
  x: number
  y: number
}

export const IDENTITY3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

export function mul3(a: Mat3, b: Mat3): Mat3 {
  const r: number[] = new Array(9).fill(0)
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]
    }
  }
  return r as unknown as Mat3
}

export function det3(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  )
}

/** Обратная матрица (через присоединённую). null — матрица вырождена. */
export function inv3(m: Mat3): Mat3 | null {
  const d = det3(m)
  if (!Number.isFinite(d) || d === 0) return null
  const c = [
    m[4] * m[8] - m[5] * m[7],
    m[2] * m[7] - m[1] * m[8],
    m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8],
    m[0] * m[8] - m[2] * m[6],
    m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6],
    m[1] * m[6] - m[0] * m[7],
    m[0] * m[4] - m[1] * m[3]
  ]
  const out = c.map((v) => v / d)
  return out.every(Number.isFinite) ? (out as unknown as Mat3) : null
}

export function transpose3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]]
}

export function frobenius3(m: Mat3): number {
  return Math.sqrt(m.reduce((s, v) => s + v * v, 0))
}

export interface Eigen {
  /** Собственные значения по возрастанию. */
  values: number[]
  /** vectors[k] — собственный вектор для values[k] (единичной длины). */
  vectors: number[][]
}

/**
 * Собственные значения и векторы симметричной матрицы n×n (метод вращений Якоби).
 * Матрица хранится плоским массивом по строкам; исходный массив не меняется.
 */
export function jacobiEigen(matrix: readonly number[], n: number): Eigen {
  const a = matrix.slice()
  const v: number[] = new Array(n * n).fill(0)
  for (let i = 0; i < n; i += 1) v[i * n + i] = 1

  for (let sweep = 0; sweep < 80; sweep += 1) {
    let off = 0
    let diag = 0
    for (let i = 0; i < n; i += 1) {
      diag += a[i * n + i] * a[i * n + i]
      for (let j = i + 1; j < n; j += 1) off += a[i * n + j] * a[i * n + j]
    }
    if (off <= 1e-30 * Math.max(diag, 1e-300) || off === 0) break
    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = a[p * n + q]
        if (Math.abs(apq) < 1e-300) continue
        const theta = (a[q * n + q] - a[p * n + p]) / (2 * apq)
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let k = 0; k < n; k += 1) {
          const akp = a[k * n + p]
          const akq = a[k * n + q]
          a[k * n + p] = c * akp - s * akq
          a[k * n + q] = s * akp + c * akq
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p * n + k]
          const aqk = a[q * n + k]
          a[p * n + k] = c * apk - s * aqk
          a[q * n + k] = s * apk + c * aqk
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = v[k * n + p]
          const vkq = v[k * n + q]
          v[k * n + p] = c * vkp - s * vkq
          v[k * n + q] = s * vkp + c * vkq
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i * n + i] - a[j * n + j])
  return {
    values: order.map((i) => a[i * n + i]),
    vectors: order.map((i) => Array.from({ length: n }, (_, k) => v[k * n + i]))
  }
}

/** Число обусловленности матрицы 3×3 (отношение наибольшего сингулярного числа к наименьшему). */
export function cond3(m: Mat3): number {
  const t = transpose3(m)
  const mtm = mul3(t, m)
  const { values } = jacobiEigen(mtm, 3)
  const lo = Math.max(values[0], 0)
  const hi = values[2]
  if (!(hi > 0)) return Infinity
  if (lo === 0) return Infinity
  return Math.sqrt(hi / lo)
}
