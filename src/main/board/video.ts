// Видео из кадров доски: PNG приходят пачками во временную папку, ffmpeg собирает MP4. Одно видео за раз.
import { randomUUID } from 'crypto'
import { rmSync } from 'fs'
import { copyFile, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { MAX_BOARD_PNG_BYTES } from '../../shared/board/ipc'
import { head } from '../ffmpeg/args'
import { CPU_ENCODER } from '../ffmpeg/encoders'
import { runFfmpeg } from '../ffmpeg/runner'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export const BOARD_VIDEO_ERRORS = {
  busy: 'Видео уже сохраняется. Дождитесь окончания или отмените',
  unknown: 'Сохранение видео не найдено — начните заново',
  notPng: 'Кадр видео повреждён: это не PNG-картинка',
  tooBig: 'Кадр видео слишком большой',
  order: 'Кадры видео пришли не по порядку',
  tooMany: 'Кадров больше, чем заявлено',
  incomplete: 'Не все кадры видео переданы',
  failed: 'Не удалось собрать видео. Попробуйте ещё раз или выберите другое место',
  write: 'Не удалось записать файл. Выберите другое место'
} as const

export function boardVideoArgs(framesDir: string, fps: number, out: string): string[] {
  return [
    '-y',
    '-framerate',
    String(fps),
    '-i',
    join(framesDir, '%05d.png'),
    ...CPU_ENCODER.videoArgs,
    '-movflags',
    '+faststart',
    out
  ]
}

interface Job {
  token: string
  dir: string
  target: string
  frameCount: number
  fps: number
  staged: number
  controller: AbortController
  running: boolean
}

let active: Job | null = null

export interface BoardVideoStart {
  token: string
  dir: string
}

export async function beginBoardVideo(params: {
  frameCount: number
  fps: number
  target: string
}): Promise<BoardVideoStart> {
  if (active) throw new Error(BOARD_VIDEO_ERRORS.busy)
  const dir = await mkdtemp(join(tmpdir(), 'flow-board-'))
  if (active) {
    await rm(dir, { recursive: true, force: true })
    throw new Error(BOARD_VIDEO_ERRORS.busy)
  }
  const token = randomUUID()
  active = {
    token,
    dir,
    target: params.target,
    frameCount: params.frameCount,
    fps: params.fps,
    staged: 0,
    controller: new AbortController(),
    running: false
  }
  return { token, dir }
}

function jobFor(token: string): Job {
  if (!active || active.token !== token) throw new Error(BOARD_VIDEO_ERRORS.unknown)
  return active
}

function dispose(job: Job): void {
  if (active === job) active = null
  job.controller.abort()
  try {
    rmSync(job.dir, { recursive: true, force: true })
  } catch {
    // ffmpeg ещё держит файл: повторим, пока он не завершится
    void rm(job.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(
      () => undefined
    )
  }
}

export async function stageBoardFrames(
  token: string,
  start: number,
  pngs: Uint8Array[]
): Promise<void> {
  const job = jobFor(token)
  if (job.running) throw new Error(BOARD_VIDEO_ERRORS.unknown)
  if (start !== job.staged) throw new Error(BOARD_VIDEO_ERRORS.order)
  if (job.staged + pngs.length > job.frameCount) throw new Error(BOARD_VIDEO_ERRORS.tooMany)
  for (const png of pngs) {
    if (png.byteLength > MAX_BOARD_PNG_BYTES) throw new Error(BOARD_VIDEO_ERRORS.tooBig)
    if (png.byteLength < PNG_SIGNATURE.length || PNG_SIGNATURE.some((b, i) => png[i] !== b))
      throw new Error(BOARD_VIDEO_ERRORS.notPng)
  }
  for (const png of pngs) {
    job.staged += 1
    await writeFile(join(job.dir, `${String(job.staged).padStart(5, '0')}.png`), png)
  }
}

/** Собирает MP4 во временной папке и переносит на место; папка удаляется в любом исходе. */
export async function finishBoardVideo(
  token: string,
  ffmpegPath: string,
  onProgress: (done: number, total: number) => void
): Promise<{ path: string }> {
  const job = jobFor(token)
  try {
    if (job.running || job.staged !== job.frameCount) throw new Error(BOARD_VIDEO_ERRORS.incomplete)
    job.running = true
    const built = join(job.dir, 'out.mp4')
    const result = await runFfmpeg({
      ffmpegPath,
      args: [...head(), ...boardVideoArgs(job.dir, job.fps, built)],
      signal: job.controller.signal,
      onTime: (s) => onProgress(Math.min(job.frameCount, Math.round(s * job.fps)), job.frameCount)
    })
    if (result.cancelled) throw new Error('Сохранение видео отменено')
    if (result.code !== 0 || result.spawnError || result.stalled)
      throw new Error(BOARD_VIDEO_ERRORS.failed)
    try {
      await copyFile(built, job.target)
    } catch {
      await rm(job.target, { force: true }).catch(() => undefined)
      throw new Error(BOARD_VIDEO_ERRORS.write)
    }
    onProgress(job.frameCount, job.frameCount)
    return { path: job.target }
  } finally {
    dispose(job)
  }
}

/** Отмена: без token отменяет текущее видео, если оно есть. */
export function cancelBoardVideo(token?: string): void {
  if (!active || (token !== undefined && active.token !== token)) return
  dispose(active)
}
