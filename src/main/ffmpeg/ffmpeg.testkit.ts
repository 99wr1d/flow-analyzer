// Помощники для тестов с настоящим ffmpeg: подсчёт кадров, сравнение кадров, генерация входных файлов.
import { spawnSync } from 'child_process'
import { join, resolve } from 'path'
import ffmpegStatic from 'ffmpeg-static'
import { parseMediaInfo } from './progress'

export const FFMPEG = ffmpegStatic as string
export const FIXTURE = (name: string): string => resolve('tests/fixtures', name)

export function ff(args: string[]): { stderr: string; stdout: Buffer; status: number | null } {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-nostdin', ...args], {
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true
  })
  return { stderr: r.stderr.toString('utf8'), stdout: r.stdout, status: r.status }
}

/** Число кадров видеодорожки (декодируем весь файл и считаем кадры). */
export function countFrames(path: string): number {
  const { stderr } = ff(['-i', path, '-map', '0:v:0', '-f', 'null', '-'])
  const all = [...stderr.matchAll(/frame=\s*(\d+)/g)]
  return all.length ? Number(all[all.length - 1][1]) : -1
}

export function durationOf(path: string): number | null {
  return parseMediaInfo(ff(['-i', path]).stderr).duration
}

export function hasAudio(path: string): boolean {
  return parseMediaInfo(ff(['-i', path]).stderr).hasAudio
}

const SIZE = '160:90'

/** Серое уменьшенное изображение кадра с номером n (n = 0 — первый кадр файла). */
export function grayFrame(path: string, n: number): Buffer {
  const { stdout } = ff([
    '-i',
    path,
    '-vf',
    `select=eq(n\\,${n}),scale=${SIZE},format=gray`,
    '-frames:v',
    '1',
    '-f',
    'rawvideo',
    '-'
  ])
  return stdout
}

export function frameDistance(a: Buffer, b: Buffer): number {
  if (a.length === 0 || a.length !== b.length) return Infinity
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i])
  return sum / a.length
}

/**
 * Номер кадра исходника, на который больше всего похож первый кадр клипа (среди кандидатов).
 * На кадрах fixtures/cfr25.mp4 крупно нарисован их номер, поэтому соседние кадры хорошо различаются.
 */
export function closestSourceFrame(source: string, clip: string, candidates: number[]): number {
  const first = grayFrame(clip, 0)
  let best = -1
  let bestDistance = Infinity
  for (const n of candidates) {
    const d = frameDistance(first, grayFrame(source, n))
    if (d < bestDistance) {
      bestDistance = d
      best = n
    }
  }
  return best
}

/** Видео со звуком (тестовая картинка и тон), чтобы проверить ветку со звуком. */
export function makeAudioVideo(dir: string, seconds = 6): string {
  const out = join(dir, 'with-audio.mp4')
  const r = ff([
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=320x180:rate=25:duration=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${seconds}`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-shortest',
    '-y',
    out
  ])
  if (r.status !== 0) throw new Error(r.stderr)
  return out
}

/** Длинное видео, чтобы успеть отменить экспорт посреди работы. */
export function makeLongVideo(dir: string, seconds = 40): string {
  const out = join(dir, 'long.mp4')
  const r = ff([
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=1280x720:rate=30:duration=${seconds}`,
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-pix_fmt',
    'yuv420p',
    '-y',
    out
  ])
  if (r.status !== 0) throw new Error(r.stderr)
  return out
}
