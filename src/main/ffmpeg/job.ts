// Задание на экспорт: проверка, подготовка, запуск ffmpeg для каждого клипа (или одной подборки), уборка за собой.
// Не зависит от Electron — вызывается из IPC и напрямую из тестов.
import { existsSync } from 'fs'
import { mkdtemp, rename, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import type {
  ExportFailure,
  ExportProgress,
  ExportRequest,
  ExportResult
} from '../../shared/export'
import { prepareClips, totalDuration, type PreparedClip } from '../../shared/exportRanges'
import { planExport, type OverlayPlan } from '../../shared/exportOverlays'
import {
  buildClipArgs,
  buildCompilationArgs,
  buildDrawnArgs,
  buildProbeArgs,
  planCompilation
} from './args'
import { loupeGeometry } from '../../shared/tools/loupe'
import { planDrawn, type GraphLoupe, type GraphPlan } from './drawGraph'
import { clipStem, uniqueFileName } from './names'
import { EXPORT_MESSAGES, friendlyFfmpegError, parseMediaInfo, type MediaFacts } from './progress'
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
}

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
      ? planExport(clips, request.mode, drawings.timings, fps).map((plan) => {
          if (plan.keys.length === 0) return null
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

  /** Запуск ffmpeg по графу с рисунками. Временные файлы убираются всегда. */
  async function runDrawn(
    plan: OverlayPlan,
    outputPart: string,
    onTime: (seconds: number) => void
  ): Promise<{ run: RunResult; seconds: number }> {
    const overlays = input.overlays!
    // Лупы: размер кадра — по файлу, а если он неизвестен, по размеру картинок с рисунками.
    const frameW = facts.width && facts.height ? facts.width : overlays.width
    const frameH = facts.width && facts.height ? facts.height : overlays.height
    const loupes: GraphLoupe[] = (drawings?.loupes ?? [])
      .filter((l) => l.index < (drawings?.timings.length ?? 0))
      .map((l) => ({
        index: l.index,
        geometry: loupeGeometry(l, frameW, frameH),
        timing: drawings!.timings[l.index]
      }))
    const layers = new Map<string, { over: boolean; under: boolean }>()
    for (const key of plan.keys) {
      layers.set(key, {
        over: overlays.files.has(key),
        under: overlays.underFiles?.has(key) ?? false
      })
    }
    const graph: GraphPlan = planDrawn({
      loupes,
      layers,
      grass: drawings?.grass,
      ranges: plan.ranges,
      segments: plan.segments,
      fps,
      audio: facts.hasAudio
        ? { sampleRate: facts.audioRate ?? 48000, mono: facts.audioMono }
        : null,
      videoSize: facts.width && facts.height ? { w: facts.width, h: facts.height } : null,
      pngSize: { w: overlays.width, h: overlays.height }
    })
    let dir: string | null = null
    try {
      dir = await mkdtemp(join(input.tempRoot ?? tmpdir(), 'flow-export-'))
      const scriptPath = join(dir, 'graph.txt')
      await writeFile(scriptPath, graph.script, 'utf8')
      const run = await runFfmpeg({
        ffmpegPath,
        args: buildDrawnArgs({
          input: inputPath,
          pngPaths: graph.inputs.map((x) =>
            x.layer === 'under' ? overlays.underFiles!.get(x.key)! : overlays.files.get(x.key)!
          ),
          output: outputPart,
          scriptPath,
          offset: graph.offset,
          span: graph.span,
          hasAudio: facts.hasAudio
        }),
        signal,
        stallMs: input.stallMs,
        onTime
      })
      return { run, seconds: graph.outputSeconds }
    } catch (error) {
      const run: RunResult = {
        code: null,
        cancelled: false,
        stalled: false,
        spawnError: error instanceof Error ? error.message : String(error),
        stderrTail: [],
        stderr: ''
      }
      return { run, seconds: 0 }
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined)
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
      const run = plan
        ? (await runDrawn(plan, part, onTime)).run
        : await runFfmpeg({
            ffmpegPath,
            args: buildClipArgs({
              input: inputPath,
              output: part,
              start: clip.start,
              end: clip.end,
              fast: request.precision === 'fast'
            }),
            signal,
            stallMs: input.stallMs,
            onTime
          })

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
    const plan = planCompilation(clips as PreparedClip[], facts.hasAudio)
    const length = totalDuration(clips) + (drawn?.freezeSeconds ?? 0)
    const name = target.split(/[\\/]/).pop() ?? 'подборка.mp4'
    const part = partPath(target)
    let workDir: string | null = null
    input.onPartFile?.(part)
    emit(0, 1, name, 0, 0)
    try {
      const onTime = (s: number): void => emit(0, 1, name, s / length, s / length)
      let run: RunResult
      if (drawn) {
        run = (await runDrawn(drawn, part, onTime)).run
      } else {
        workDir = await mkdtemp(join(input.tempRoot ?? tmpdir(), 'flow-export-'))
        const scriptPath = join(workDir, 'graph.txt')
        await writeFile(scriptPath, plan.script, 'utf8')
        run = await runFfmpeg({
          ffmpegPath,
          args: buildCompilationArgs({
            input: inputPath,
            output: part,
            scriptPath,
            plan,
            hasAudio: facts.hasAudio
          }),
          signal,
          stallMs: input.stallMs,
          onTime
        })
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
