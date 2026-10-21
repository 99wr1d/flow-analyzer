// Эскизы проектов: JPEG ~320 px по ширине из кадра видео. Лежат в userData/thumbs/<sha1 пути>.jpg,
// создаются при сохранении проекта (кадр у lastTime или на 10% длительности) и удаляются, когда проект убран из списка.
import { createHash } from 'crypto'
import { mkdir, readFile, rename, rm, stat } from 'fs/promises'
import { dirname, join } from 'path'
import { MAX_THUMB_BYTES, THUMB_WIDTH } from '../../shared/library'
import { getFfmpegPath } from '../ffmpeg/path'
import { runFfmpeg } from '../ffmpeg/runner'
import { pathKey } from '../project/recent'

export const THUMBS_DIR = 'thumbs'
const STALL_MS = 20_000
/** Значения -q:v по очереди: если JPEG вышел тяжелее лимита, пробуем сжать сильнее. */
const QUALITIES = [5, 11, 20] as const

export function thumbKey(projectPath: string): string {
  return createHash('sha1').update(pathKey(projectPath)).digest('hex')
}

export const thumbFile = (userData: string, projectPath: string): string =>
  join(userData, THUMBS_DIR, `${thumbKey(projectPath)}.jpg`)

/** Что известно о проекте для выбора кадра эскиза. */
export interface ThumbHint {
  /** Обложка, выбранная пользователем («Сделать этот кадр обложкой»), секунды. */
  cover?: number
  /** Эпизоды проекта: без обложки берётся середина самого раннего. */
  episodes?: ReadonlyArray<{ start: number; end: number }>
}

/**
 * Время кадра для эскиза: обложка проекта; иначе середина первого эпизода; иначе сохранённое место просмотра,
 * иначе 10% видео, иначе первая секунда. Кадр не ближе 0.2 с к концу видео.
 */
export function thumbTime(
  lastTime: number,
  duration: number | undefined,
  hint: ThumbHint = {}
): number {
  const known = duration !== undefined && duration > 0
  const clampEnd = (t: number): number => (known ? Math.min(t, Math.max(0, duration - 0.2)) : t)
  if (hint.cover !== undefined && hint.cover >= 0) return clampEnd(hint.cover)
  const first = hint.episodes?.reduce<{ start: number; end: number } | null>(
    (best, e) => (best === null || e.start < best.start ? e : best),
    null
  )
  if (first) return clampEnd((first.start + first.end) / 2)
  if (lastTime > 0) return known ? Math.min(lastTime, Math.max(0, duration - 0.2)) : lastTime
  return known ? duration * 0.1 : 1
}

export function thumbArgs(videoPath: string, time: number, out: string, quality: number): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-ss',
    time.toFixed(3),
    '-i',
    videoPath,
    '-frames:v',
    '1',
    '-an',
    '-vf',
    `scale=${THUMB_WIDTH}:-2`,
    '-q:v',
    String(quality),
    '-y',
    out
  ]
}

export interface ThumbJob {
  ffmpegPath: string
  videoPath: string
  time: number
  /** Итоговый файл .jpg. */
  out: string
}

/** Делает эскиз ffmpeg-ом. true — файл создан и не тяжелее лимита. Если кадра на нужном месте нет, берётся начало видео. */
export async function generateThumb(job: ThumbJob): Promise<boolean> {
  await mkdir(dirname(job.out), { recursive: true })
  const temp = job.out.replace(/\.jpg$/i, `.${process.pid}.tmp.jpg`)
  try {
    for (const time of job.time > 0 ? [job.time, 0] : [0]) {
      for (const quality of QUALITIES) {
        await rm(temp, { force: true })
        const result = await runFfmpeg({
          ffmpegPath: job.ffmpegPath,
          args: thumbArgs(job.videoPath, time, temp, quality),
          stallMs: STALL_MS
        })
        if (result.code !== 0) break
        let size = 0
        try {
          size = (await stat(temp)).size
        } catch {
          break // кадра за концом видео нет — пробуем начало
        }
        if (size > 0 && size <= MAX_THUMB_BYTES) {
          await rename(temp, job.out)
          return true
        }
      }
    }
    return false
  } catch {
    return false
  } finally {
    await rm(temp, { force: true }).catch(() => undefined)
  }
}

// Эскизы одного проекта делаются по очереди; список проектов ждёт, пока текущие задания закончатся.
const jobs = new Map<string, Promise<unknown>>()

/** Запускает создание эскиза в фоне; ошибки не выбрасывает (эскиз — украшение). */
export function scheduleThumb(
  userData: string,
  projectPath: string,
  videoPath: string,
  lastTime: number,
  duration: number | undefined,
  hint: ThumbHint = {}
): void {
  const located = getFfmpegPath()
  if (!located.ok) return
  const key = thumbKey(projectPath)
  const previous = jobs.get(key) ?? Promise.resolve()
  const run: Promise<unknown> = previous
    .then(() =>
      generateThumb({
        ffmpegPath: located.path,
        videoPath,
        time: thumbTime(lastTime, duration, hint),
        out: thumbFile(userData, projectPath)
      })
    )
    .catch(() => undefined)
    .finally(() => {
      if (jobs.get(key) === run) jobs.delete(key)
    })
  jobs.set(key, run)
}

/** Ждёт все начатые эскизы (перед показом списка проектов). */
export async function settleThumbs(): Promise<void> {
  await Promise.all([...jobs.values()])
}

export async function readThumb(userData: string, projectPath: string): Promise<Uint8Array | null> {
  try {
    const file = thumbFile(userData, projectPath)
    const info = await stat(file)
    if (!info.isFile() || info.size === 0 || info.size > MAX_THUMB_BYTES) return null
    return new Uint8Array(await readFile(file))
  } catch {
    return null
  }
}

export async function removeThumb(userData: string, projectPath: string): Promise<void> {
  await rm(thumbFile(userData, projectPath), { force: true }).catch(() => undefined)
}

/** Проект переехал: эскиз переименовывается под новый путь. */
export async function moveThumb(userData: string, from: string, to: string): Promise<void> {
  try {
    await mkdir(join(userData, THUMBS_DIR), { recursive: true })
    await rename(thumbFile(userData, from), thumbFile(userData, to))
  } catch {
    /* эскиза не было */
  }
}
