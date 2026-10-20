// Сбор результатов замеров в JSON-файл (FLOW_BENCH_OUT) и сводка чисел.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { SHOTS } from '../e2e/helpers'

export const OUT = process.env.FLOW_BENCH_OUT ?? `${SHOTS}/bench-results.json`
export const LABEL = process.env.FLOW_BENCH_LABEL ?? 'run'

export interface Summary {
  n: number
  mean: number
  p50: number
  p95: number
  min: number
  max: number
}

export function summarize(values: number[]): Summary {
  const v = [...values].sort((a, b) => a - b)
  const at = (q: number): number =>
    v[Math.min(v.length - 1, Math.max(0, Math.ceil(q * v.length) - 1))]
  const mean = v.reduce((a, b) => a + b, 0) / (v.length || 1)
  const r = (x: number): number => Math.round(x * 10) / 10
  return {
    n: v.length,
    mean: r(mean),
    p50: r(at(0.5)),
    p95: r(at(0.95)),
    min: r(v[0] ?? 0),
    max: r(v[v.length - 1] ?? 0)
  }
}

type Json = Record<string, unknown>

/** Записывает значение по пути «раздел.ключ» в файл результатов (файл дополняется между запусками). */
export function record(section: string, key: string, value: unknown): void {
  const all: Json = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as Json) : {}
  const run = (all[LABEL] ?? {}) as Json
  const sec = (run[section] ?? {}) as Json
  sec[key] = value
  run[section] = sec
  all[LABEL] = run
  mkdirSync(dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(all, null, 2), 'utf8')
  console.log(`[bench:${LABEL}] ${section}.${key} = ${JSON.stringify(value)}`)
}
