// Параллельный экспорт по кускам: куски видео кодируются одновременно отдельными процессами ffmpeg, звук собирается
// одним отдельным процессом, затем куски склеиваются (concat без перекодирования) и к ним подмешивается звук.
// Не знает, как устроены графы фильтров: задачи приходят готовыми (см. job.ts). Не зависит от Electron.
import { mkdir, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { head } from './args'
import { createProgressTracker, defaultWeights } from './chunkProgress'
import { CPU_ENCODER, parallelWorkers, type EncoderProfile } from './encoders'
import { runFfmpeg, type RunResult } from './runner'

/** Подготовленный запуск ffmpeg: аргументы и уборка временных файлов запуска (после завершения, любого). */
export interface PreparedRun {
  args: string[]
  cleanup?: () => Promise<void>
}

export interface ChunkTask {
  /** Номер куска (с 0, по порядку вывода). */
  index: number
  /** Секунд результата в куске (вес в общем прогрессе). */
  weight: number
  /**
   * Кусок с тяжёлыми фильтрами (рисунки, ключ «газон», анимация). Они работают в одном потоке и не загружают все ядра,
   * поэтому таких кусков можно кодировать несколько сразу, а обычные куски — по одному: кодер сам занимает все ядра,
   * и несколько процессов только мешают друг другу (замер: 334 кадра/с против 254).
   */
  heavy?: boolean
  /** Аргументы ffmpeg для кодирования куска в файл output (только видео). Вызывается и при повторе. */
  prepare(encoder: EncoderProfile, output: string): Promise<PreparedRun>
}

export interface AudioTask {
  /** Аргументы ffmpeg: звук всего результата в файл output (только звук). */
  prepare(output: string): Promise<PreparedRun>
}

export interface ChunkedOptions {
  ffmpegPath: string
  /** Пустая рабочая папка для кусков (создаётся, если её нет). Убирает вызывающий. */
  workDir: string
  /** Куда пишется готовый файл (недописанный, с суффиксом .part). */
  output: string
  tasks: readonly ChunkTask[]
  audio: AudioTask | null
  /** Кодер первой попытки. Если это кодер видеокарты и что-то не вышло, всё делается заново на процессоре. */
  encoder: EncoderProfile
  logicalCores: number
  /** Сколько кусков одновременно (по умолчанию — по кодеру и числу ядер). */
  workers?: number
  /** Сколько обычных (не тяжёлых) кусков одновременно. По умолчанию два. */
  plainLimit?: number
  signal?: AbortSignal
  stallMs?: number
  /** Общая доля готовности 0..1 (не убывает). */
  onProgress?: (fraction: number) => void
  log?: (message: string) => void
}

export type ChunkedOutcome =
  | { status: 'done'; encoder: EncoderProfile; fellBack: boolean }
  | { status: 'cancelled'; encoder: EncoderProfile; fellBack: boolean }
  | { status: 'failed'; run: RunResult; encoder: EncoderProfile; fellBack: boolean }

const pad = (n: number): string => String(n).padStart(5, '0')
const ok = (run: RunResult): boolean =>
  run.code === 0 && !run.spawnError && !run.stalled && !run.cancelled

function spawnFailure(error: unknown): RunResult {
  return {
    code: null,
    cancelled: false,
    stalled: false,
    spawnError: error instanceof Error ? error.message : String(error),
    stderrTail: [],
    stderr: ''
  }
}

/** Файл-список для concat: имена относительные (рядом со списком) — пути с кириллицей и пробелами не мешают. */
export function concatList(files: readonly string[]): string {
  const esc = (name: string): string => name.replace(/'/g, `'\\''`)
  return 'ffconcat version 1.0\n' + files.map((f) => `file '${esc(f)}'`).join('\n') + '\n'
}

interface AttemptResult {
  status: 'done' | 'cancelled' | 'failed'
  run?: RunResult
}

async function attempt(o: ChunkedOptions, encoder: EncoderProfile): Promise<AttemptResult> {
  const { ffmpegPath, workDir, tasks, signal } = o
  await mkdir(workDir, { recursive: true })
  const inner = new AbortController()
  const forward = (): void => inner.abort()
  if (signal?.aborted) inner.abort()
  else signal?.addEventListener('abort', forward, { once: true })

  const tracker = createProgressTracker({
    ...defaultWeights(
      tasks.map((t) => t.weight),
      o.audio !== null
    )
  })
  let lastReported = -1
  const report = (): void => {
    const f = tracker.fraction()
    if (f !== lastReported) {
      lastReported = f
      o.onProgress?.(f)
    }
  }

  let failure: RunResult | null = null
  const fail = (run: RunResult): void => {
    if (!failure) failure = run
    inner.abort()
  }
  const segments = tasks.map((t) => `seg_${pad(t.index)}.mp4`)

  /** Один процесс: подготовка, запуск, уборка. */
  const exec = async (
    prepare: () => Promise<PreparedRun>,
    onTime: (s: number) => void
  ): Promise<RunResult> => {
    let prepared: PreparedRun | null = null
    try {
      prepared = await prepare()
      return await runFfmpeg({
        ffmpegPath,
        args: prepared.args,
        signal: inner.signal,
        stallMs: o.stallMs,
        onTime
      })
    } catch (error) {
      return spawnFailure(error)
    } finally {
      await prepared?.cleanup?.().catch(() => undefined)
    }
  }

  const timings: Array<{ index: number; seconds: number; wall: number }> = []
  const queue = [...tasks]
  // Кодер видеокарты не повторяем: при любой неудаче весь экспорт переделывается на процессоре.
  const triesAllowed = encoder.id === 'cpu' ? 2 : 1
  let plainRunning = 0
  const plainLimit = Math.max(1, o.plainLimit ?? 2)
  const waiters: Array<() => void> = []
  const wake = (): void => {
    for (const w of waiters.splice(0)) w()
  }
  inner.signal.addEventListener('abort', wake, { once: true })
  /** Следующий кусок по порядку, который сейчас можно запускать (обычных — не больше plainLimit сразу). */
  const nextTask = async (): Promise<ChunkTask | null> => {
    for (;;) {
      if (inner.signal.aborted || queue.length === 0) return null
      const i = queue.findIndex((t) => t.heavy || plainRunning < plainLimit)
      if (i >= 0) {
        const [task] = queue.splice(i, 1)
        if (!task.heavy) plainRunning += 1
        return task
      }
      await new Promise<void>((resolve) => waiters.push(resolve))
    }
  }
  const worker = async (): Promise<void> => {
    for (;;) {
      const task = await nextTask()
      if (!task) return
      try {
        if (!(await encodeTask(task))) return
      } finally {
        if (!task.heavy) plainRunning -= 1
        wake()
      }
    }
  }
  /** Кодирует один кусок (с одним повтором на процессоре). false — работу надо прекращать. */
  const encodeTask = async (task: ChunkTask): Promise<boolean> => {
    const file = join(workDir, segments[task.index])
    const startedAt = Date.now()
    let last: RunResult | null = null
    for (let tryNo = 0; tryNo < triesAllowed; tryNo += 1) {
      tracker.setChunk(task.index, 0)
      const run = await exec(
        () => task.prepare(encoder, file),
        (s) => {
          tracker.setChunk(task.index, s)
          report()
        }
      )
      if (run.cancelled || inner.signal.aborted) return false
      if (ok(run)) {
        tracker.doneChunk(task.index)
        report()
        const wall = (Date.now() - startedAt) / 1000
        timings.push({ index: task.index, seconds: task.weight, wall })
        return true
      }
      last = run
      await rm(file, { force: true }).catch(() => undefined)
      if (tryNo + 1 < triesAllowed) {
        o.log?.(`Кусок ${task.index}: неудача, повторяю (${run.stderrTail.slice(-1)[0] ?? ''})`)
      }
    }
    if (last) fail(last)
    return false
  }

  const audioFile = join(workDir, 'audio.mp4')
  const audioRun = o.audio
    ? (async (): Promise<void> => {
        const audio = o.audio as AudioTask
        const run = await exec(
          () => audio.prepare(audioFile),
          (s) => {
            // Прогресс звука: доля от длины всего результата.
            const total = tasks.reduce((a, t) => a + t.weight, 0)
            tracker.setAudio(total > 0 ? s / total : 0)
            report()
          }
        )
        if (run.cancelled || inner.signal.aborted) return
        if (ok(run)) tracker.doneAudio()
        else fail(run)
      })()
    : Promise.resolve()

  const pool = Math.max(
    1,
    Math.min(tasks.length, o.workers ?? parallelWorkers(encoder, o.logicalCores))
  )
  await Promise.all([...Array.from({ length: pool }, () => worker()), audioRun])
  signal?.removeEventListener('abort', forward)
  if (timings.length > 0) {
    const wall = timings.map((t) => t.wall)
    o.log?.(
      `Куски: ${timings.length}, на кусок в среднем ${(wall.reduce((a, b) => a + b, 0) / wall.length).toFixed(1)} с (от ${Math.min(...wall).toFixed(1)} до ${Math.max(...wall).toFixed(1)}), всего ${timings.reduce((a, t) => a + t.seconds, 0).toFixed(0)} с результата`
    )
  }

  if (signal?.aborted) return { status: 'cancelled' }
  if (failure) return { status: 'failed', run: failure }

  // Склейка кусков и звука без перекодирования.
  const listPath = join(workDir, 'list.ffconcat')
  await writeFile(listPath, concatList(segments), 'utf8')
  const muxArgs = [
    ...head(),
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    ...(o.audio ? ['-i', audioFile] : []),
    '-map',
    '0:v:0',
    ...(o.audio ? ['-map', '1:a:0'] : []),
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    '-y',
    o.output
  ]
  const total = tasks.reduce((a, t) => a + t.weight, 0)
  const mux = await runFfmpeg({
    ffmpegPath,
    args: muxArgs,
    signal,
    stallMs: o.stallMs,
    onTime: (s) => {
      tracker.setMux(total > 0 ? s / total : 0)
      report()
    }
  })
  if (mux.cancelled || signal?.aborted) return { status: 'cancelled' }
  if (!ok(mux)) return { status: 'failed', run: mux }
  tracker.doneMux()
  report()
  return { status: 'done' }
}

/** Запускает параллельный экспорт; при неудаче на видеокарте повторяет всё на процессоре (весь файл одним кодером). */
export async function runChunked(o: ChunkedOptions): Promise<ChunkedOutcome> {
  const first = await attempt(o, o.encoder)
  if (first.status === 'done') return { status: 'done', encoder: o.encoder, fellBack: false }
  if (first.status === 'cancelled') {
    return { status: 'cancelled', encoder: o.encoder, fellBack: false }
  }
  if (o.encoder.id === 'cpu') {
    return { status: 'failed', run: first.run as RunResult, encoder: o.encoder, fellBack: false }
  }
  o.log?.(
    `Кодирование на видеокарте (${o.encoder.ffmpegName}) не удалось, экспорт повторён на процессоре: ${
      first.run?.stderrTail.slice(-3).join(' | ') ?? first.run?.spawnError ?? ''
    }`
  )
  // Чистим рабочую папку: куски другого кодера склеивать нельзя (разные параметры потока).
  await rm(o.workDir, { recursive: true, force: true }).catch(() => undefined)
  await rm(o.output, { force: true }).catch(() => undefined)
  const second = await attempt(o, CPU_ENCODER)
  if (second.status === 'done') return { status: 'done', encoder: CPU_ENCODER, fellBack: true }
  if (second.status === 'cancelled') {
    return { status: 'cancelled', encoder: CPU_ENCODER, fellBack: true }
  }
  return { status: 'failed', run: second.run as RunResult, encoder: CPU_ENCODER, fellBack: true }
}
