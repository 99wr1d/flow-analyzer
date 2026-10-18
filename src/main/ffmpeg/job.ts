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
import { buildClipArgs, buildCompilationArgs, buildProbeArgs, planCompilation } from './args'
import { clipStem, uniqueFileName } from './names'
import { EXPORT_MESSAGES, friendlyFfmpegError, parseMediaInfo, type MediaFacts } from './progress'
import { runFfmpeg, type RunResult } from './runner'

export const COMPILATION_FAST_ERROR =
  'Подборку можно собрать только с перекодированием: куски из разных мест видео нельзя надёжно склеить без него'

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
    const total = totalDuration(clips)
    const taken = new Set<string>()
    let doneSeconds = 0

    for (let i = 0; i < clips.length; i += 1) {
      if (signal?.aborted) return finish('cancelled')
      const clip = clips[i]
      const length = clip.end - clip.start
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

      const run = await runFfmpeg({
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
        onTime: (s) =>
          emit(i, clips.length, name, s / length, (doneSeconds + Math.min(s, length)) / total)
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
    const plan = planCompilation(clips as PreparedClip[], facts.hasAudio)
    const length = totalDuration(clips)
    const name = target.split(/[\\/]/).pop() ?? 'подборка.mp4'
    const part = partPath(target)
    let workDir: string | null = null
    input.onPartFile?.(part)
    emit(0, 1, name, 0, 0)
    try {
      workDir = await mkdtemp(join(input.tempRoot ?? tmpdir(), 'flow-export-'))
      const scriptPath = join(workDir, 'graph.txt')
      await writeFile(scriptPath, plan.script, 'utf8')
      const run = await runFfmpeg({
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
        onTime: (s) => emit(0, 1, name, s / length, s / length)
      })
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
