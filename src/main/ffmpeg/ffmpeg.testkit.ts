// Помощники для тестов с настоящим ffmpeg: подсчёт кадров, сравнение кадров, генерация входных файлов.
import { spawnSync } from 'child_process'
import { join, resolve } from 'path'
import { crc32, deflateSync } from 'zlib'
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

// ---------- Рисунки: PNG, пиксели кадров, звук ----------

/** PNG RGBA нужного размера. paint(x, y) возвращает [r, g, b, a]; по умолчанию всё прозрачно. */
export function makePng(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number, number] = () => [0, 0, 0, 0]
): Uint8Array {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y)
      raw.set([r, g, b, a], row + 1 + x * 4)
    }
  }
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // глубина
  ihdr[9] = 6 // RGBA
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0))
    ])
  )
}

/** Сплошной прямоугольник цвета rgb (непрозрачный) в рамке [x0,x1)×[y0,y1). */
export function boxPng(
  width: number,
  height: number,
  box: { x0: number; y0: number; x1: number; y1: number },
  rgb: [number, number, number]
): Uint8Array {
  return makePng(width, height, (x, y) =>
    x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1 ? [...rgb, 255] : [0, 0, 0, 0]
  )
}

/** Кадр с номером n (с 0) как сырые RGB-пиксели width×height. */
export function frameRgb(path: string, n: number, width: number, height: number): Buffer {
  const { stdout } = ff([
    '-i',
    path,
    '-vf',
    `select=eq(n\\,${n})`,
    '-frames:v',
    '1',
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    '-'
  ])
  if (stdout.length !== width * height * 3) {
    throw new Error(`кадр ${n}: получено ${stdout.length} байт вместо ${width * height * 3}`)
  }
  return stdout
}

export const pixelAt = (
  rgb: Buffer,
  width: number,
  x: number,
  y: number
): [number, number, number] => {
  const i = (y * width + x) * 3
  return [rgb[i], rgb[i + 1], rgb[i + 2]]
}

/** Пиксель «почти белый» / «почти чёрный» (H.264 цвет немного меняет). */
export const isWhite = ([r, g, b]: [number, number, number]): boolean =>
  r > 215 && g > 215 && b > 215
export const isBlack = ([r, g, b]: [number, number, number]): boolean => r < 40 && g < 40 && b < 40

/** Номера кадров видео, в которых пиксель (x, y) удовлетворяет условию. */
export function framesWhere(
  path: string,
  x: number,
  y: number,
  test: (rgb: [number, number, number]) => boolean
): number[] {
  // Окно 2×2: у yuv420p нечётные размеры не переводятся в rgb.
  const { stdout } = ff([
    '-i',
    path,
    '-vf',
    `crop=2:2:${x}:${y}`,
    '-pix_fmt',
    'rgb24',
    '-f',
    'rawvideo',
    '-'
  ])
  const result: number[] = []
  for (let i = 0; i + 11 < stdout.length; i += 12) {
    if (test([stdout[i], stdout[i + 1], stdout[i + 2]])) result.push(i / 12)
  }
  return result
}

/** Видео 320×180, 25 к/с, со звуком: тишина и один «писк» 1 кГц с beepAt секунды длиной 0.2 с (стерео или моно). */
export function makeBeepVideo(
  dir: string,
  opts: { seconds?: number; beepAt?: number; mono?: boolean } = {}
): string {
  const seconds = opts.seconds ?? 10
  const beepAt = opts.beepAt ?? 3
  const wave = `sin(2*PI*1000*t)*between(t,${beepAt},${beepAt + 0.2})`
  const out = join(dir, opts.mono ? 'beep-mono.mp4' : 'beep.mp4')
  const r = ff([
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=320x180:rate=25:duration=${seconds}`,
    '-f',
    'lavfi',
    '-i',
    `aevalsrc='${opts.mono ? wave : `${wave}|${wave}`}':s=44100:d=${seconds}`,
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

/** Время (с) первого громкого отсчёта звука; null — звук тихий. Звук приводится к моно 44100 Гц. */
export function firstLoudSample(path: string, threshold = 0.1): number | null {
  const { stdout } = ff(['-i', path, '-vn', '-ac', '1', '-ar', '44100', '-f', 'f32le', '-'])
  const samples = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 4))
  for (let i = 0; i < samples.length; i += 1) {
    if (Math.abs(samples[i]) > threshold) return i / 44100
  }
  return null
}

/** Длительность дорожки звука / видео по ffprobe-подобному разбору: через -f null. */
export function streamDurations(path: string): { video: number; audio: number } {
  const time = (spec: string): number => {
    const { stderr } = ff(['-i', path, '-map', spec, '-f', 'null', '-'])
    const all = [...stderr.matchAll(/time=(\d+):(\d{2}):(\d{2}\.\d+)/g)]
    const last = all[all.length - 1]
    return last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : -1
  }
  return { video: time('0:v:0'), audio: time('0:a:0') }
}
