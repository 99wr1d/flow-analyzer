// Задание на экспорт: проверка, подготовка, запуск ffmpeg для каждого клипа (или одной подборки), уборка за собой.
// Не зависит от Electron — вызывается из IPC и напрямую из тестов.
import { existsSync } from 'fs'
import { mkdtemp, rename, rm, writeFile } from 'fs/promises'
import { availableParallelism, tmpdir } from 'os'
import { join } from 'path'
import type {
  ExportFailure,
  ExportProgress,
  ExportRequest,
  ExportResult
} from '../../shared/export'
import { prepareClips, totalDuration, type PreparedClip } from '../../shared/exportRanges'
import { hasDrawings, planExport, type OverlayPlan } from '../../shared/exportOverlays'
import {
  buildClipArgs,
  buildCompilationArgs,
  buildDrawnArgs,
  buildProbeArgs,
  head,
  planCompilation,
  reencodeAudio,
  sec
} from './args'
import { writeBlankPng } from './blankPng'
import { planReadChunks } from './chunks'
import { runChunked, type AudioTask, type ChunkTask } from './chunked'
import {
  CPU_ENCODER,
  withQuality,
  chooseEncoder,
  parallelWorkers,
  probeEncoders,
  type EncoderProfile
} from './encoders'
import { planAudioOnly } from './audioGraph'
import { planChunks, type PlannedChunk, type TimeWindow } from './exportChunks'
import { loupeGeometry } from '../../shared/tools/loupe'
import { planDrawn, type GraphLoupe, type GraphPlan } from './drawGraph'
import type { LoupeAnimKey } from './loupe'
import { clipStem, uniqueFileName } from './names'
import {
  EXPORT_MESSAGES,
  friendlyFfmpegError,
  looksVariableRate,
  parseMediaInfo,
  type MediaFacts
} from './progress'
import { runFfmpeg, type RunResult } from './runner'

export const COMPILATION_FAST_ERROR =
  'Подборку можно собрать только с перекодированием: куски из разных мест видео нельзя надёжно склеить без него'

export const DRAWINGS_FAST_ERROR =
  'Рисунки можно нанести только с перекодированием: выберите режим «Точно»'
export const DRAWINGS_MISSING_ERROR =
  'Не удалось подготовить рисунки для экспорта. Закройте окно экспорта и повторите'

/** Картинки с рисунками, уже проверенные и записанные на диск (см. staging.ts). */
export interface JobOverlays {
  width: number
  height: number
  /** Ключ набора рисунков → путь к PNG слоя «поверх всего». */
  files: ReadonlyMap<string, string>
  /** Ключ набора рисунков → путь к PNG слоя «под игроками» (нет — таких рисунков нет). */
  underFiles?: ReadonlyMap<string, string>
  /** Папка с картинками (для рядов кадров анимации по шаблону имени). */
  dir?: string
  /** Кадры движущихся рисунков: номер кадра видео → путь к PNG, по слоям. */
  frames?: {
    over: ReadonlyMap<number, string>
    under: ReadonlyMap<number, string>
  }
}

/** Ошибка, текст которой можно показать пользователю как есть. */
export class ExportError extends Error {}

export interface JobInput {
  ffmpegPath: string
  inputPath: string
  /** Уже проверенный схемой запрос. */
  request: ExportRequest
  /** Режим «Отдельные файлы»: папка. Режим «Подборка»: путь к итоговому файлу. */
  target: string
  onProgress?: (progress: ExportProgress) => void
  signal?: AbortSignal
  stallMs?: number
  /** Сообщает путь недописанного файла (null — его больше нет): по нему приложение чистит за собой при выходе. */
  onPartFile?: (path: string | null) => void
  /** Папка для временных файлов (по умолчанию системная). */
  tempRoot?: string
  /** Картинки для request.drawings. */
  overlays?: JobOverlays
  /** Запись в журнал (необязательно). */
  log?: (message: string) => void
  /** Настройки скорости; нужны автотестам и замерам, приложение их не задаёт. */
  tuning?: JobTuning
}

export interface JobTuning {
  /**
   * Длина куска результата, секунд. Если задана, параллельный экспорт включается для любого файла (даже короткого, даже без
   * рисунков) — так тесты проверяют склейку кусков на коротких видео. Не задана — куски только для длинных результатов с рисунками.
   */
  chunkSeconds?: number
  /** Замеры и тесты: никогда не делить на куски (старый способ — один процесс ffmpeg на весь результат). */
  noChunks?: boolean
  /** Сколько обычных кусков (без рисунков) кодировать одновременно; по умолчанию два. */
  plainLimit?: number
  /** Потоков x264 на один кусок (по умолчанию решает сам x264). */
  encoderThreads?: number
  /** Сколько кусков кодировать одновременно (по умолчанию по кодеру и числу ядер). */
  workers?: number
  /** Число логических ядер (по умолчанию — настоящее). */
  cores?: number
  /** Автотест: притвориться, что есть видеокарта, кодер которой ломается. */
  fakeBrokenGpu?: boolean
}

/** Результат короче этого кодируется одним процессом даже с рисунками, если читать нужно один непрерывный кусок. */
export const CHUNK_MIN_OUTPUT_SECONDS = 120
/** Ограничения на длину куска, когда она выбирается сама. */
const CHUNK_AUTO_MIN_SECONDS = 20
const CHUNK_AUTO_MAX_SECONDS = 240

export interface JobOutput {
  result: ExportResult
  /** Полные пути созданных файлов (наружу, в интерфейс, не уходят). */
  paths: string[]
}

/** Узнаёт длительность и наличие звука запуском `ffmpeg -i`. */
export async function probeMedia(
  ffmpegPath: string,
  inputPath: string,
  signal?: AbortSignal
): Promise<MediaFacts> {
  const run = await runFfmpeg({
    ffmpegPath,
    args: buildProbeArgs(inputPath),
    signal,
    stallMs: 30_000
  })
  if (run.spawnError) throw new ExportError(EXPORT_MESSAGES.generic)
  const facts = parseMediaInfo(run.stderr)
  if (!facts.hasVideo) {
    const message = friendlyFfmpegError(run.stderrTail)
    throw new ExportError(message === EXPORT_MESSAGES.generic ? EXPORT_MESSAGES.noVideo : message)
  }
  return facts
}

const partPath = (target: string): string => `${target}.part`

async function removeQuietly(path: string): Promise<void> {
  await rm(path, { force: true }).catch(() => undefined)
}

/** Превращает неудачный запуск ffmpeg в понятное сообщение и подробности. */
function describeFailure(run: RunResult): { message: string; details?: string } {
  if (run.stalled) return { message: EXPORT_MESSAGES.stalled, details: run.stderrTail.join('\n') }
  if (run.spawnError) return { message: EXPORT_MESSAGES.generic, details: run.spawnError }
  return {
    message: friendlyFfmpegError(run.stderrTail),
    details: run.stderrTail.join('\n') || `ffmpeg завершился с кодом ${run.code}`
  }
}

export async function runExportJob(input: JobInput): Promise<JobOutput> {
  const { ffmpegPath, inputPath, request, target, signal } = input
  const startedAt = Date.now()
  const elapsed = (): number => Date.now() - startedAt

  if (request.mode === 'compilation' && request.precision === 'fast') {
    throw new ExportError(COMPILATION_FAST_ERROR)
  }
  const drawings = request.drawings
  if (drawings && request.precision === 'fast') throw new ExportError(DRAWINGS_FAST_ERROR)
  if (drawings && !input.overlays) throw new ExportError(DRAWINGS_MISSING_ERROR)

  let facts: MediaFacts
  try {
    facts = await probeMedia(ffmpegPath, inputPath, signal)
  } catch (error) {
    if (!signal?.aborted) throw error
    const result: ExportResult = {
      status: 'cancelled',
      mode: request.mode,
      total: request.mode === 'files' ? request.clips.length : 1,
      files: [],
      target,
      failures: [],
      elapsedMs: elapsed()
    }
    return { result, paths: [] }
  }
  const prepared = prepareClips(request.clips, facts.duration, request.padding)
  if (!prepared.ok) throw new ExportError(prepared.error)
  const clips = prepared.clips

  // Рисунки: частота кадров из запроса, но если файл говорит иное (разница больше 5%), верим файлу.
  const fps =
    facts.fps && drawings && Math.abs(facts.fps / drawings.fps - 1) > 0.05
      ? facts.fps
      : (drawings?.fps ?? facts.fps ?? 25)
  // Планы строятся до запуска ffmpeg: если картинок не хватает, ничего не создаётся.
  // null — рисунков в этом файле нет (обычная обрезка).
  const plans: Array<OverlayPlan | null> =
    drawings && input.overlays
      ? planExport(
          clips,
          request.mode,
          drawings.timings,
          fps,
          new Set(drawings.animated ?? [])
        ).map((plan) => {
          if (!hasDrawings(plan)) return null
          const animLayers = drawings.animLayers
          for (const f of plan.animation.frames) {
            const o = input.overlays!
            if (
              (animLayers?.over && !o.frames?.over.has(f.frame)) ||
              (animLayers?.under && !o.frames?.under.has(f.frame)) ||
              !animLayers
            ) {
              throw new ExportError(DRAWINGS_MISSING_ERROR)
            }
          }
          if (animLayers?.under && !drawings.grass) throw new ExportError(DRAWINGS_MISSING_ERROR)
          for (const key of plan.keys) {
            const o = input.overlays!
            if (!o.files.has(key) && !o.underFiles?.has(key)) {
              throw new ExportError(DRAWINGS_MISSING_ERROR)
            }
            if (o.underFiles?.has(key) && !drawings!.grass) {
              throw new ExportError(DRAWINGS_MISSING_ERROR)
            }
          }
          return plan
        })
      : clips.map(() => null)

  // ---------- Кодер ----------
  // «Авто» — видеокарта, если она есть и работает (проверено заранее, один раз за запуск), иначе процессор.
  const tuning = input.tuning ?? {}
  const choice = request.encoder ?? 'auto'
  // Без перекодирования («Быстро») кодер не нужен, и видеокарту проверять незачем.
  const probe =
    choice === 'cpu' || request.precision === 'fast'
      ? { gpu: null, rejected: [] as string[] }
      : await probeEncoders(ffmpegPath, { fakeBrokenGpu: tuning.fakeBrokenGpu })
  const quality = request.quality ?? 'normal'
  // Потолок битрейта по исходнику: файл не должен вырасти в разы (видеокарта на шумной картинке даёт втрое больше).
  const sourceBps = facts.videoBitrate
  const cpuEncoder = withQuality(CPU_ENCODER, quality, sourceBps)
  let encoder: EncoderProfile = withQuality(chooseEncoder(choice, probe), quality, sourceBps)
  const cores = tuning.cores ?? availableParallelism()
  input.log?.(`Экспорт: кодер ${encoder.ffmpegName}`)

  /**
   * Запуск с откатом: если кодер видеокарты не сработал, то же задание сразу повторяется на процессоре, и дальше
   * (в остальных файлах этого экспорта) используется процессор.
   */
  async function withFallback(
    attemptWith: (enc: EncoderProfile) => Promise<RunResult>
  ): Promise<RunResult> {
    const first = await attemptWith(encoder)
    const good = first.code === 0 && !first.spawnError && !first.stalled
    if (encoder.id === 'cpu' || good || first.cancelled) return first
    input.log?.(
      `Кодер ${encoder.ffmpegName} не сработал, повторяю на процессоре: ${first.stderrTail.slice(-3).join(' | ')}`
    )
    encoder = cpuEncoder
    return attemptWith(cpuEncoder)
  }

  // Параллельные куски считают кадры по ровной сетке: видео с переменной частотой кадров кодируется обычным способом.
  const chunkable = !looksVariableRate(facts) && fps > 0

  /** Лупы запроса в пикселях видео. */
  function makeLoupes(): GraphLoupe[] {
    const overlays = input.overlays
    const frameW = facts.width && facts.height ? facts.width : (overlays?.width ?? 0)
    const frameH = facts.width && facts.height ? facts.height : (overlays?.height ?? 0)
    return (drawings?.loupes ?? [])
      .filter((l) => l.index < (drawings?.timings.length ?? 0))
      .map((l) => ({
        index: l.index,
        geometry: loupeGeometry(l, frameW, frameH),
        timing: drawings!.timings[l.index],
        anim: l.keys?.map((k): LoupeAnimKey => ({
          t: k.t,
          ease: k.ease,
          geometry: loupeGeometry(
            { pos: k.pos, src: k.src, radius: l.radius, zoom: l.zoom },
            frameW,
            frameH
          )
        }))
      }))
  }

  interface DrawnOptions {
    encoder: EncoderProfile
    encoderThreads?: number
    /** Только видео (кусок параллельного экспорта): звука в графе нет. */
    videoOnly?: boolean
  }
  interface PreparedDrawn {
    args: string[]
    seconds: number
    cleanup: () => Promise<void>
  }

  /** Записывает граф и собирает аргументы ffmpeg для плана с рисунками. Уборку (cleanup) вызывает тот, кто запускает. */
  async function prepareDrawn(
    plan: OverlayPlan,
    outputPart: string,
    o: DrawnOptions
  ): Promise<PreparedDrawn> {
    const overlays = input.overlays
    const layers = new Map<string, { over: boolean; under: boolean }>()
    for (const key of plan.keys) {
      layers.set(key, {
        over: overlays?.files.has(key) ?? false,
        under: overlays?.underFiles?.has(key) ?? false
      })
    }
    const withAudio = facts.hasAudio && !o.videoOnly
    const graph: GraphPlan = planDrawn({
      loupes: makeLoupes(),
      layers,
      grass: drawings?.grass,
      animation:
        plan.animation.runs.length > 0 && drawings?.animLayers
          ? { runs: plan.animation.runs, layers: drawings.animLayers }
          : undefined,
      ranges: plan.ranges,
      segments: plan.segments,
      fps,
      audio: withAudio ? { sampleRate: facts.audioRate ?? 48000, mono: facts.audioMono } : null,
      videoSize: facts.width && facts.height ? { w: facts.width, h: facts.height } : null,
      pngSize: overlays ? { w: overlays.width, h: overlays.height } : null
    })
    let dir: string | null = null
    const cleanup = async (): Promise<void> => {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
    try {
      dir = await mkdtemp(join(input.tempRoot ?? tmpdir(), 'flow-export-'))
      const scriptPath = join(dir, 'graph.txt')
      await writeFile(scriptPath, graph.script, 'utf8')
      // Ряд кадров анимации кончается пустой картинкой (см. blankPng.ts), если за его концом нет настоящего кадра.
      for (const x of graph.inputs) {
        if (!x.seq || !overlays) continue
        const next = x.seq.last + 1
        if (overlays.frames?.[x.layer].has(next)) continue
        await writeBlankPng(
          join(overlays.dir ?? '', `${x.layer}_${String(next).padStart(7, '0')}.png`),
          overlays.width,
          overlays.height
        )
      }
      const args = buildDrawnArgs({
        input: inputPath,
        pngPaths: graph.inputs.map((x) => {
          const ov = overlays as JobOverlays
          if (x.seq) {
            const pattern = `${ov.dir ?? ''}/${x.layer}_%07d.png`.split('\\').join('/')
            return { pattern, start: x.seq.first, fps }
          }
          if (x.still !== undefined) return ov.frames![x.layer].get(x.still)!
          return x.layer === 'under' ? ov.underFiles!.get(x.key)! : ov.files.get(x.key)!
        }),
        output: outputPart,
        scriptPath,
        offset: graph.offset,
        span: graph.span,
        hasAudio: withAudio,
        encoder: o.encoder,
        encoderThreads: o.encoderThreads
      })
      return { args, seconds: graph.outputSeconds, cleanup }
    } catch (error) {
      await cleanup()
      throw error
    }
  }

  const spawnFailure = (error: unknown): RunResult => ({
    code: null,
    cancelled: false,
    stalled: false,
    spawnError: error instanceof Error ? error.message : String(error),
    stderrTail: [],
    stderr: ''
  })

  /** Запуск ffmpeg по графу с рисунками одним процессом. Временные файлы убираются всегда. */
  async function runDrawn(
    plan: OverlayPlan,
    outputPart: string,
    onTime: (seconds: number) => void
  ): Promise<{ run: RunResult; seconds: number }> {
    let seconds = 0
    const run = await withFallback(async (enc) => {
      let prepared: PreparedDrawn | null = null
      try {
        prepared = await prepareDrawn(plan, outputPart, { encoder: enc })
        seconds = prepared.seconds
        return await runFfmpeg({
          ffmpegPath,
          args: prepared.args,
          signal,
          stallMs: input.stallMs,
          onTime
        })
      } catch (error) {
        return spawnFailure(error)
      } finally {
        await prepared?.cleanup()
      }
    })
    return { run, seconds }
  }

  // ---------- Параллельный экспорт по кускам ----------
  /** План без рисунков (чистые отрезки): для кусков, когда режим включён принудительно. */
  const plainPlan = (ranges: ReadonlyArray<{ start: number; end: number }>): OverlayPlan => ({
    segments: [],
    ranges: ranges.map((r) => ({ start: r.start, end: r.end, freezes: [] })),
    keys: [],
    freezeSeconds: 0,
    animation: { frames: [], runs: [] }
  })

  /** Нужен ли параллельный экспорт для этого плана. */
  function shouldChunk(plan: OverlayPlan | null, outputSeconds: number): boolean {
    if (!chunkable || tuning.noChunks) return false
    if (tuning.chunkSeconds !== undefined) return true
    if (!plan || !hasDrawings(plan)) return false
    // Длинный результат или отрезки, далёкие друг от друга: обычный запуск прочитал бы всё между ними.
    return outputSeconds >= CHUNK_MIN_OUTPUT_SECONDS || planReadChunks(plan.ranges).length > 1
  }

  function loupeWindows(): TimeWindow[] {
    return (drawings?.loupes ?? []).flatMap((l) => {
      const t = drawings?.timings[l.index]
      return t && t.mode === 'range' ? [{ from: t.start, to: t.start + t.duration }] : []
    })
  }

  /** Часть плана для одного куска: ряды и сегменты только этого куска. */
  function chunkAsPlan(c: PlannedChunk): OverlayPlan {
    const keys = new Set<string>()
    for (const s of c.segments) keys.add(s.key)
    for (const r of c.ranges) for (const f of r.freezes) keys.add(f.key)
    return {
      segments: c.segments,
      ranges: c.ranges,
      keys: [...keys],
      freezeSeconds: c.ranges.reduce((n, r) => n + r.freezes.reduce((m, f) => m + f.seconds, 0), 0),
      animation: { frames: [], runs: c.runs }
    }
  }

  /**
   * Кодирует план кусками: параллельно, затем склейка. Возвращает результат в виде RunResult, чтобы остальной код
   * (отмена, ошибки, переименование файла) работал так же, как для одного процесса.
   */
  async function runChunkedPlan(
    plan: OverlayPlan,
    outputPart: string,
    onFraction: (fraction: number) => void
  ): Promise<RunResult> {
    const workers = tuning.workers ?? parallelWorkers(encoder, cores)
    const totalSeconds = plan.ranges.reduce((n, r) => n + (r.end - r.start), 0) + plan.freezeSeconds
    const target =
      tuning.chunkSeconds ??
      Math.min(
        CHUNK_AUTO_MAX_SECONDS,
        Math.max(CHUNK_AUTO_MIN_SECONDS, totalSeconds / (Math.max(1, workers) * 3))
      )
    const cp = planChunks({
      plan,
      fps,
      loupeWindows: loupeWindows(),
      targetSeconds: target
    })
    const noFrames: RunResult = {
      code: null,
      cancelled: false,
      stalled: false,
      spawnError: 'нет кадров для экспорта',
      stderrTail: [],
      stderr: ''
    }
    if (cp.chunks.length === 0) return noFrames
    input.log?.(
      `Экспорт кусками: ${cp.chunks.length} шт., кодер ${encoder.ffmpegName}, одновременно ${workers}`
    )
    let workDir: string | null = null
    try {
      workDir = await mkdtemp(join(input.tempRoot ?? tmpdir(), 'flow-export-'))
      const tasks: ChunkTask[] = cp.chunks.map((c) => ({
        index: c.index,
        weight: c.outputSeconds,
        heavy: c.drawn,
        prepare: async (enc, output) => {
          const prepared = await prepareDrawn(chunkAsPlan(c), output, {
            encoder: enc,
            encoderThreads: c.drawn ? tuning.encoderThreads : undefined,
            videoOnly: true
          })
          return { args: prepared.args, cleanup: prepared.cleanup }
        }
      }))
      const audio: AudioTask | null = facts.hasAudio
        ? {
            prepare: async (output) => {
              const g = planAudioOnly({
                ranges: cp.ranges,
                fps,
                audio: { sampleRate: facts.audioRate ?? 48000, mono: facts.audioMono }
              })
              const dir = await mkdtemp(join(input.tempRoot ?? tmpdir(), 'flow-export-'))
              const scriptPath = join(dir, 'audio.txt')
              try {
                await writeFile(scriptPath, g.script, 'utf8')
              } catch (error) {
                await rm(dir, { recursive: true, force: true }).catch(() => undefined)
                throw error
              }
              return {
                args: [
                  ...head(),
                  '-ss',
                  sec(g.offset),
                  '-t',
                  sec(g.span),
                  '-i',
                  inputPath,
                  '-filter_complex_script',
                  scriptPath,
                  '-map',
                  '[outa]',
                  ...reencodeAudio(),
                  '-f',
                  'mp4',
                  '-y',
                  output
                ],
                cleanup: () => rm(dir, { recursive: true, force: true })
              }
            }
          }
        : null
      const outcome = await runChunked({
        ffmpegPath,
        workDir,
        output: outputPart,
        tasks,
        audio,
        encoder,
        fallbackEncoder: cpuEncoder,
        logicalCores: cores,
        workers: tuning.workers,
        plainLimit: tuning.plainLimit,
        signal,
        stallMs: input.stallMs,
        onProgress: onFraction,
        log: input.log
      })
      if (outcome.fellBack) encoder = cpuEncoder
      if (outcome.status === 'done') {
        return { code: 0, cancelled: false, stalled: false, stderrTail: [], stderr: '' }
      }
      if (outcome.status === 'cancelled') {
        return { ...noFrames, cancelled: true, spawnError: undefined }
      }
      return outcome.run
    } catch (error) {
      return spawnFailure(error)
    } finally {
      if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  const failures: ExportFailure[] = []
  const files: string[] = []
  const paths: string[] = []
  const finish = (status: ExportResult['status']): JobOutput => ({
    result: {
      status,
      mode: request.mode,
      total: request.mode === 'files' ? clips.length : 1,
      files,
      target,
      failures,
      elapsedMs: elapsed()
    },
    paths
  })

  const emit = (
    index: number,
    count: number,
    name: string,
    clipFraction: number,
    overall: number
  ): void =>
    input.onProgress?.({
      index,
      count,
      name,
      clipFraction: Math.min(1, Math.max(0, clipFraction)),
      overallFraction: Math.min(1, Math.max(0, overall)),
      elapsedMs: elapsed()
    })

  if (request.mode === 'compilation') {
    return runCompilation()
  }
  return runFiles()

  // ---------- Отдельные файлы ----------
  async function runFiles(): Promise<JobOutput> {
    const lengths = clips.map((c, i) => c.end - c.start + (plans[i]?.freezeSeconds ?? 0))
    const total = lengths.reduce((a, b) => a + b, 0)
    const taken = new Set<string>()
    let doneSeconds = 0

    for (let i = 0; i < clips.length; i += 1) {
      if (signal?.aborted) return finish('cancelled')
      const clip = clips[i]
      const length = lengths[i]
      const plan = plans[i]
      const stem = clipStem(clip.number, clip.label, clip.episodeStart)
      const name = uniqueFileName(
        stem,
        'mp4',
        (candidate) => taken.has(candidate.toLowerCase()) || existsSync(join(target, candidate))
      )
      taken.add(name.toLowerCase())
      const output = join(target, name)
      const part = partPath(output)
      input.onPartFile?.(part)
      emit(i, clips.length, name, 0, doneSeconds / total)

      const onTime = (s: number): void =>
        emit(i, clips.length, name, s / length, (doneSeconds + Math.min(s, length)) / total)
      const precise = request.precision !== 'fast'
      const chunkSource =
        plan ?? (precise && tuning.chunkSeconds !== undefined ? plainPlan([clip]) : null)
      let run: RunResult
      if (precise && chunkSource && shouldChunk(plan, length)) {
        run = await runChunkedPlan(chunkSource, part, (f) =>
          emit(i, clips.length, name, f, (doneSeconds + f * length) / total)
        )
      } else if (plan) {
        run = (await runDrawn(plan, part, onTime)).run
      } else {
        run = await withFallback((enc) =>
          runFfmpeg({
            ffmpegPath,
            args: buildClipArgs({
              input: inputPath,
              output: part,
              start: clip.start,
              end: clip.end,
              fast: !precise,
              encoder: enc
            }),
            signal,
            stallMs: input.stallMs,
            onTime
          })
        )
      }

      if (run.cancelled) {
        await removeQuietly(part)
        input.onPartFile?.(null)
        return finish('cancelled')
      }
      if (run.code === 0 && !run.spawnError && !run.stalled) {
        try {
          await rename(part, output)
          files.push(name)
          paths.push(output)
        } catch (error) {
          await removeQuietly(part)
          failures.push({
            label: `${clip.number} ${clip.label}`,
            message: EXPORT_MESSAGES.cantCreate,
            details: error instanceof Error ? error.message : undefined
          })
        }
      } else {
        await removeQuietly(part)
        failures.push({ label: `${clip.number} ${clip.label}`, ...describeFailure(run) })
      }
      input.onPartFile?.(null)
      doneSeconds += length
      emit(i, clips.length, name, 1, doneSeconds / total)
    }
    return finish(files.length > 0 ? 'done' : 'failed')
  }

  // ---------- Одна подборка ----------
  async function runCompilation(): Promise<JobOutput> {
    const drawn = plans[0]
    const plan = planCompilation(clips as PreparedClip[], facts.hasAudio, fps)
    const length = totalDuration(clips) + (drawn?.freezeSeconds ?? 0)
    const name = target.split(/[\\/]/).pop() ?? 'подборка.mp4'
    const part = partPath(target)
    let workDir: string | null = null
    input.onPartFile?.(part)
    emit(0, 1, name, 0, 0)
    try {
      const onTime = (s: number): void => emit(0, 1, name, s / length, s / length)
      let run: RunResult
      const chunkSource = drawn ?? (tuning.chunkSeconds !== undefined ? plainPlan(clips) : null)
      if (chunkSource && shouldChunk(drawn, length)) {
        run = await runChunkedPlan(chunkSource, part, (f) => emit(0, 1, name, f, f))
      } else if (drawn) {
        run = (await runDrawn(drawn, part, onTime)).run
      } else {
        workDir = await mkdtemp(join(input.tempRoot ?? tmpdir(), 'flow-export-'))
        const scriptPath = join(workDir, 'graph.txt')
        await writeFile(scriptPath, plan.script, 'utf8')
        run = await withFallback((enc) =>
          runFfmpeg({
            ffmpegPath,
            args: buildCompilationArgs({
              input: inputPath,
              output: part,
              scriptPath,
              plan,
              hasAudio: facts.hasAudio,
              encoder: enc
            }),
            signal,
            stallMs: input.stallMs,
            onTime
          })
        )
      }
      if (run.cancelled) {
        await removeQuietly(part)
        return finish('cancelled')
      }
      if (run.code === 0 && !run.spawnError && !run.stalled) {
        await rename(part, target)
        files.push(name)
        paths.push(target)
        emit(0, 1, name, 1, 1)
        return finish('done')
      }
      await removeQuietly(part)
      failures.push({ label: name, ...describeFailure(run) })
      return finish('failed')
    } catch (error) {
      await removeQuietly(part)
      failures.push({
        label: name,
        message: EXPORT_MESSAGES.cantCreate,
        details: error instanceof Error ? error.message : undefined
      })
      return finish('failed')
    } finally {
      input.onPartFile?.(null)
      if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
