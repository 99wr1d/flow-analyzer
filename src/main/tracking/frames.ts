// Кадры отрезка видео для слежения: ffmpeg декодирует точно по времени кадров и отдаёт RGBA заданной ширины.
// Время t — середина кадра в шкале плеера (так же, как frameCenter у рисунков и ключей), с учётом start_time видео.
import { spawn } from 'child_process'
import { frameCenter } from '../../shared/annotations'
import { getFfmpegPath } from '../ffmpeg/path'
import { parseMediaInfo } from '../ffmpeg/progress'
import { killTree, runFfmpeg, trackChild } from '../ffmpeg/runner'

export const DEFAULT_TRACK_WIDTH = 960
const FALLBACK_FPS = 25
const EPS = 1e-6
/** Запас на входе сверх отрезка: точные границы потом режет select по времени кадра. */
const TAIL_MARGIN = 0.25

export interface DecodedFrame {
  /** Номер кадра в шкале плеера: floor(время показа × fps). */
  index: number
  /** Середина кадра в шкале плеера (frameCenter). */
  t: number
  rgba: Uint8Array
  width: number
  height: number
}

export interface DecodeOptions {
  videoPath: string
  from: number
  to: number
  /** Ширина кадров; по умолчанию 960. Высота — по пропорциям, чётная. */
  width?: number
  signal: AbortSignal
  /** Для тестов и учёта: процесс ffmpeg запущен. */
  onSpawn?: (pid: number) => void
}

/** Высота при заданной ширине: по пропорциям, округляется до чётного. */
export function scaledHeight(srcWidth: number, srcHeight: number, width: number): number {
  return Math.max(2, 2 * Math.round((width * srcHeight) / srcWidth / 2))
}

const secs = (v: number): string => Math.max(0, v).toFixed(6)

/**
 * Кадры, чьё время показа лежит в [from, to), по порядку. Возвращает точное число кадров (как экспорт: -ss до -i и отбор по
 * времени кадра). Отмена (signal) или выход из цикла останавливают ffmpeg и дожидаются его закрытия; ошибка ffmpeg — исключение.
 */
export async function* decodeFrames(opts: DecodeOptions): AsyncGenerator<DecodedFrame> {
  const { videoPath, from, to, signal } = opts
  const width = opts.width ?? DEFAULT_TRACK_WIDTH
  if (signal.aborted || !(to > from)) return
  const located = getFfmpegPath()
  if (!located.ok) throw new Error(located.error)

  const probe = await runFfmpeg({
    ffmpegPath: located.path,
    args: ['-hide_banner', '-i', videoPath],
    signal
  })
  if (signal.aborted) return
  const facts = parseMediaInfo(probe.stderr)
  if (!facts.hasVideo || !facts.width || !facts.height) {
    throw new Error(
      probe.spawnError ?? (probe.stderrTail.at(-1) || 'Не удалось прочитать видео для слежения')
    )
  }
  const fps = facts.fps && facts.fps > 0 ? facts.fps : FALLBACK_FPS
  // Начало файла: -ss отсчитывается от него, а метки кадров (-copyts) остаются «сырыми».
  const startMatch = /Duration:[^\n]*?start:\s*(-?[\d.]+)/.exec(probe.stderr)
  const fileStart = startMatch ? Number(startMatch[1]) : 0
  const height = scaledHeight(facts.width, facts.height, width)
  const frameBytes = width * height * 4
  const rawFrom = from + fileStart - 1e-3
  const rawTo = to + fileStart - 1e-3

  const args = [
    ...['-hide_banner', '-nostdin', '-loglevel', 'info'],
    '-copyts',
    ...['-ss', secs(from), '-t', secs(to - from + TAIL_MARGIN), '-i', videoPath],
    ...['-map', '0:v:0', '-an', '-sn', '-dn'],
    ...[
      '-vf',
      `select='gte(t,${secs(rawFrom)})*lt(t,${secs(rawTo)})',showinfo,scale=${width}:${height},format=rgba`
    ],
    ...['-fps_mode', 'passthrough', '-f', 'rawvideo', '-']
  ]

  const child = spawn(located.path, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  const untrack = trackChild(child)
  const closed = new Promise<number | null>((resolve) => {
    child.once('close', (code) => resolve(code))
    child.once('error', () => resolve(null))
  })
  if (child.pid) opts.onSpawn?.(child.pid)

  // Время показа каждого выданного кадра приходит в stderr (showinfo) отдельным потоком.
  const times: number[] = []
  let wake: (() => void) | undefined
  let tail = ''
  let errText = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    if (errText.length < 20_000) errText += chunk
    const lines = (tail + chunk).split(/\r?\n/)
    tail = lines.pop() ?? ''
    for (const line of lines) {
      const m = /Parsed_showinfo.*?pts_time:\s*(-?[\d.]+)/.exec(line)
      if (m) times.push(Number(m[1]))
    }
    wake?.()
  })
  const nextTime = async (): Promise<number | undefined> => {
    while (times.length === 0) {
      if (child.exitCode !== null || child.signalCode !== null) return undefined
      await new Promise<void>((resolve) => {
        wake = resolve
        child.once('close', resolve)
        setTimeout(resolve, 50).unref()
      })
    }
    return times.shift()
  }

  const onAbort = (): void => killTree(child)
  signal.addEventListener('abort', onAbort, { once: true })

  try {
    let buf = Buffer.alloc(frameBytes)
    let filled = 0
    for await (const chunk of child.stdout as AsyncIterable<Buffer>) {
      let pos = 0
      while (pos < chunk.length) {
        const n = Math.min(frameBytes - filled, chunk.length - pos)
        chunk.copy(buf, filled, pos, pos + n)
        filled += n
        pos += n
        if (filled === frameBytes) {
          const pts = await nextTime()
          if (signal.aborted) return
          if (pts === undefined) throw new Error('ffmpeg не сообщил время кадра')
          const player = pts - fileStart
          yield {
            index: Math.floor(Math.max(0, player) * fps + EPS),
            t: frameCenter(player, fps),
            rgba: new Uint8Array(buf.buffer, buf.byteOffset, frameBytes),
            width,
            height
          }
          buf = Buffer.alloc(frameBytes)
          filled = 0
        }
      }
      if (signal.aborted) return
    }
    const code = await closed
    if (signal.aborted) return
    if (code !== 0) {
      const lines = errText.split(/\r?\n/).filter((l) => l.trim() && !/showinfo/.test(l))
      throw new Error(lines.slice(-3).join('\n') || 'ffmpeg завершился с ошибкой')
    }
  } finally {
    signal.removeEventListener('abort', onAbort)
    if (child.exitCode === null && child.signalCode === null) killTree(child)
    await closed
    untrack()
  }
}
