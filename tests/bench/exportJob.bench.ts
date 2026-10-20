// Замер скорости экспорта с рисунками на длинном видео (этап 18): без окна приложения, прямо через runExportJob.
//
// Подготовка:  node scripts/make-bench.mjs <папка> long       (bench-1080p-90min.mp4)
// Запуск:      FLOW_BENCH_DIR=<папка> npm run bench:export
// Переменные:  FLOW_BENCH_CASES — через запятую, какие случаи мерить (по умолчанию все из списка ниже);
//              FLOW_BENCH_MINUTES — длина «всего видео» в минутах (по умолчанию 90);
//              FLOW_BENCH_OUT — файл для результатов (JSON, по одной строке на случай).
// Случаи: <что>-<кодер>-<способ>, например whole-cpu-chunks, whole-gpu-chunks, whole-cpu-mono, compilation-gpu-chunks, clips-cpu-mono.
//   что:    whole (всё видео одним файлом), compilation (подборка из 20 эпизодов по 10 с, разнесённых по видео),
//           clips (20 отдельных файлов по 10 с), plain (всё видео БЕЗ рисунков — для сравнения)
//   кодер:  cpu (x264) или gpu (видеокарта, если есть)
//   способ: mono (один процесс ffmpeg, как было до этапа 18) или chunks (параллельные куски)
// Рисунки: 40 на 90 минут — обычные отрезки, «под игроками», стоп-кадры, лупа и движущиеся (с кадрами анимации).
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, it } from 'vitest'
import ffmpegPath from 'ffmpeg-static'
import type { Timing } from '../../src/shared/annotations'
import type { ExportRequest } from '../../src/shared/export'
import { planExport } from '../../src/shared/exportOverlays'
import { DEFAULT_GRASS_BLEND, DEFAULT_GRASS_SIMILARITY } from '../../src/shared/grassKey'
import { runExportJob } from '../../src/main/ffmpeg/job'
import {
  disposeStaged,
  holdStaged,
  stageFrames,
  stageOverlays,
  type Staged
} from '../../src/main/ffmpeg/staging'
import { boxPng, makePng } from '../../src/main/ffmpeg/ffmpeg.testkit'

const DIR = process.env.FLOW_BENCH_DIR ?? ''
const INPUT = join(DIR, 'bench-1080p-90min.mp4')
const MINUTES = Number(process.env.FLOW_BENCH_MINUTES ?? 90)
const OUT = process.env.FLOW_BENCH_OUT
const W = 1920
const H = 1080
const FPS = 25
const ALL_CASES = [
  'plain-cpu-mono',
  'whole-cpu-mono',
  'whole-cpu-chunks',
  'whole-gpu-chunks',
  'compilation-cpu-mono',
  'compilation-cpu-chunks',
  'compilation-gpu-chunks',
  'clips-cpu-mono',
  'clips-cpu-chunks',
  'clips-gpu-chunks'
]
const CASES = (process.env.FLOW_BENCH_CASES?.split(',') ?? ALL_CASES).map((c) => c.trim())

interface Range {
  start: number
  end: number
}

/** Детерминированный генератор случайных чисел. */
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Drawings {
  timings: Timing[]
  animated: number[]
  under: Set<number>
  loupeIndexes: number[]
}

// Для разбора: FLOW_BENCH_KINDS=over|under|freeze|loupe|anim — все рисунки одного вида; FLOW_BENCH_DRAWINGS — сколько их.
const KIND_CODE: Record<string, number> = { over: 2, under: 0, freeze: 1, loupe: 5, anim: 3 }
const ONLY_KIND = process.env.FLOW_BENCH_KINDS
  ? (KIND_CODE[process.env.FLOW_BENCH_KINDS] ?? null)
  : null

/** Рисунки, разложенные по отрезкам экспорта: тип зависит от номера (0 — под игроками, 1 — стоп-кадр, 5 — лупа, 3 — движущийся). */
function makeDrawings(ranges: Range[], count: number): Drawings {
  const r = rng(7)
  const timings: Timing[] = []
  const animated: number[] = []
  const under = new Set<number>()
  const loupeIndexes: number[] = []
  for (let i = 0; i < count; i += 1) {
    const range = ranges[i % ranges.length]
    const room = Math.max(0.5, range.end - range.start - 5)
    const start = Math.round((range.start + r() * room) * 1000) / 1000
    const kind = ONLY_KIND === null ? i % 10 : ONLY_KIND
    if (kind === 1) {
      timings.push({ mode: 'frame', start: Math.floor(start * FPS) / FPS + 0.02, freezeSeconds: 2 })
    } else if (kind === 5 && (loupeIndexes.length === 0 || ONLY_KIND !== null)) {
      loupeIndexes.push(i)
      timings.push({ mode: 'range', start, duration: 4 })
    } else {
      timings.push({ mode: 'range', start, duration: 3 })
      if (kind === 0) under.add(i)
      if (kind === 3 && (ONLY_KIND !== null || animated.length < 3)) animated.push(i)
    }
  }
  return { timings, animated, under, loupeIndexes }
}

const GRASS = {
  color: '#2f8a3f',
  similarity: DEFAULT_GRASS_SIMILARITY,
  blend: DEFAULT_GRASS_BLEND
}

interface Scenario {
  name: string
  mode: 'files' | 'compilation'
  clips: Range[]
  drawn: boolean
}

function scenarioFor(what: string): Scenario {
  const total = MINUTES * 60
  if (what === 'whole' || what === 'plain') {
    return {
      name: what,
      mode: 'files',
      clips: [{ start: 0, end: total - 1 }],
      drawn: what === 'whole'
    }
  }
  // 20 эпизодов по 10 секунд, равномерно по всему видео (как в замерах экспорта этапа 17).
  const step = (total - 240) / 20
  const clips = Array.from({ length: 20 }, (_, i) => ({
    start: 120 + Math.floor(i * step),
    end: 130 + Math.floor(i * step)
  }))
  return { name: what, mode: what === 'clips' ? 'files' : 'compilation', clips, drawn: true }
}

const tempRoot = DIR ? mkdtempSync(join(tmpdir(), 'flow-bench-job-')) : ''
afterAll(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
})

async function measure(caseName: string): Promise<void> {
  const [what, enc, how] = caseName.split('-')
  const sc = scenarioFor(what)
  const req: ExportRequest = {
    videoId: 'bench',
    clips: sc.clips.map((c) => ({ ...c, label: 'Эпизод' })),
    mode: sc.mode,
    precision: 'precise',
    padding: 0,
    projectName: null,
    encoder: enc === 'gpu' ? 'auto' : 'cpu'
  }
  let staged: Staged | null = null
  if (sc.drawn) {
    const count = Math.max(
      8,
      Math.round((40 * sc.clips.reduce((s, c) => s + c.end - c.start, 0)) / 5400)
    )
    // Для «всего видео» рисунки раскладываются по всей длине, для подборки и клипов — внутри эпизодов.
    const d = makeDrawings(
      sc.clips,
      sc.mode === 'files' && sc.clips.length === 1
        ? Number(process.env.FLOW_BENCH_DRAWINGS ?? Math.max(40, Math.round((40 * MINUTES) / 90)))
        : Math.max(count, 40)
    )
    const plans = planExport(sc.clips, sc.mode, d.timings, FPS, new Set(d.animated))
    const keys = new Set<string>()
    for (const p of plans) for (const k of p.keys) keys.add(k)
    const over = boxPng(W, H, { x0: 300, y0: 300, x1: 700, y1: 500 }, [255, 210, 0])
    const underPng = boxPng(W, H, { x0: 900, y0: 500, x1: 1300, y1: 700 }, [255, 0, 255])
    const images: Array<{ key: string; data: Uint8Array; layer: 'over' | 'under' }> = []
    for (const key of keys) {
      images.push({ key, data: over, layer: 'over' })
      if (key.split('-').some((n) => d.under.has(Number(n)))) {
        images.push({ key, data: underPng, layer: 'under' })
      }
    }
    const res = await stageOverlays({ width: W, height: H, images }, tempRoot)
    if (!res.ok) throw new Error(res.error)
    staged = res.staged
    await holdStaged(res.staged)
    const token = res.staged.token
    const frames = new Map<number, number[]>()
    for (const p of plans) for (const f of p.animation.frames) frames.set(f.frame, f.members)
    const anim = makePng(W, H, (x, y) =>
      x > 600 && x < 640 && y > 400 && y < 440 ? [0, 255, 255, 255] : [0, 0, 0, 0]
    )
    const list = [...frames.keys()].map((frame) => ({ frame, data: anim }))
    for (const layer of ['over', 'under'] as const) {
      for (let i = 0; i < list.length; i += 100) {
        const r = await stageFrames({ token, layer, frames: list.slice(i, i + 100) })
        if (!r.ok) throw new Error(r.error)
      }
    }
    req.drawings = {
      token,
      fps: FPS,
      timings: d.timings,
      loupes: d.loupeIndexes.map((index) => ({
        index,
        pos: { x: 0.7, y: 0.3 },
        src: { x: 0.4, y: 0.5 },
        radius: 0.12,
        zoom: 2 as const
      })),
      animated: d.animated,
      animLayers: { over: true, under: true },
      grass: GRASS
    }
    console.log(
      `[${caseName}] рисунков ${d.timings.length}, наборов ${keys.size}, кадров анимации ${frames.size}, под игроками ${d.under.size}, стоп-кадров ${
        d.timings.filter((t) => t.mode === 'frame').length
      }`
    )
  }
  const outDir = mkdtempSync(join(tempRoot, 'out-'))
  const logs: string[] = []
  const t0 = Date.now()
  const result = await runExportJob({
    ffmpegPath: ffmpegPath as string,
    inputPath: INPUT,
    request: req,
    target: sc.mode === 'compilation' ? join(outDir, 'подборка.mp4') : outDir,
    overlays: staged ?? undefined,
    tempRoot,
    stallMs: 600_000,
    log: (m) => logs.push(m),
    tuning:
      how === 'mono'
        ? { noChunks: true }
        : process.env.FLOW_BENCH_WORKERS
          ? {
              workers: Number(process.env.FLOW_BENCH_WORKERS),
              plainLimit: process.env.FLOW_BENCH_PLAIN
                ? Number(process.env.FLOW_BENCH_PLAIN)
                : undefined,
              encoderThreads: process.env.FLOW_BENCH_THREADS
                ? Number(process.env.FLOW_BENCH_THREADS)
                : undefined
            }
          : undefined
  })
  const seconds = (Date.now() - t0) / 1000
  const outSeconds = sc.clips.reduce((s, c) => s + c.end - c.start, 0)
  let bytes = 0
  for (const p of result.paths) bytes += statSync(p).size
  const row = {
    case: caseName,
    status: result.result.status,
    seconds: Math.round(seconds * 10) / 10,
    outputSeconds: outSeconds,
    fps: Math.round((outSeconds * FPS) / seconds),
    minutesFor90: Math.round(((seconds * 5400) / outSeconds / 60) * 10) / 10,
    mbytes: Math.round(bytes / 1048576),
    failures: result.result.failures.map((f) => f.message),
    log: logs.filter((l) => /кусками|Куски|не сработал|кодер/.test(l)).slice(0, 4)
  }
  console.log('RESULT ' + JSON.stringify(row))
  if (OUT) appendFileSync(OUT, JSON.stringify(row) + '\n')
  if (staged) await disposeStaged(staged)
  rmSync(outDir, { recursive: true, force: true })
}

describe.skipIf(!DIR || !existsSync(INPUT))('замер экспорта с рисунками', () => {
  if (OUT) mkdirSync(join(OUT, '..'), { recursive: true })
  for (const c of CASES) {
    it(
      c,
      async () => {
        await measure(c)
      },
      3 * 3600_000
    )
  }
})
