// Сборка аргументов ffmpeg. Всегда массив для spawn — никаких строк для оболочки.
import type { PreparedClip } from '../../shared/exportRanges'

export const VIDEO_QUALITY = { preset: 'veryfast', crf: '20' } as const
export const AUDIO_BITRATE = '160k'

/** Секунды в виде, понятном ffmpeg (всегда точка, три знака). */
export const sec = (value: number): string => Math.max(0, value).toFixed(3)

/** Общие параметры: тихий вывод, ход работы в stdout (key=value), без чтения с клавиатуры. */
function head(): string[] {
  return ['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'warning', '-progress', 'pipe:1']
}

/** Чётные размеры кадра: yuv420p иначе не кодируется. Для обычных видео ничего не меняет. */
const EVEN_SIZE = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'

const reencodeVideo = (): string[] => [
  '-c:v',
  'libx264',
  '-preset',
  VIDEO_QUALITY.preset,
  '-crf',
  VIDEO_QUALITY.crf,
  '-pix_fmt',
  'yuv420p'
]
const reencodeAudio = (): string[] => ['-c:a', 'aac', '-b:a', AUDIO_BITRATE]

/**
 * Один клип.
 * -ss и -t стоят ДО -i (параметры входного файла): ffmpeg быстро прыгает к ближайшему ключевому кадру перед началом,
 * а при перекодировании сам отбрасывает кадры до нужного — начало точное до кадра, и не нужно читать файл с начала.
 * Длительность -t тоже входная: так число кадров совпадает с ожидаемым (проверено на cfr25.mp4: с -t после -i
 * на границах между кадрами терялся один кадр).
 * Звук берётся, если он есть (знак «?» после номера дорожки).
 */
export function buildClipArgs(opts: {
  input: string
  output: string
  start: number
  end: number
  fast: boolean
}): string[] {
  const { input, output, start, end, fast } = opts
  const common = ['-ss', sec(start), '-t', sec(end - start), '-i', input]
  const maps = ['-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn']
  const codecs = fast
    ? ['-c', 'copy', '-avoid_negative_ts', 'make_zero']
    : ['-vf', EVEN_SIZE, ...reencodeVideo(), ...reencodeAudio()]
  return [
    ...head(),
    ...common,
    ...maps,
    ...codecs,
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    '-y',
    output
  ]
}

export interface CompilationPlan {
  /** Смещение входа: всё до первого клипа пропускается быстрой перемоткой. */
  offset: number
  /** Сколько секунд входа нужно прочитать от смещения. */
  span: number
  /** Содержимое файла с описанием фильтров (-filter_complex_script). */
  script: string
}

/**
 * Подборка: trim/atrim каждого эпизода и склейка concat с перекодированием.
 * Граф кладётся в файл, а не в аргумент: у 500 эпизодов он длиннее предела командной строки Windows.
 * Времена в графе отсчитываются от offset (так -ss перед -i сдвигает метки времени).
 */
export function planCompilation(
  clips: readonly Pick<PreparedClip, 'start' | 'end'>[],
  hasAudio: boolean
): CompilationPlan {
  const offset = Math.min(...clips.map((c) => c.start))
  const span = Math.max(...clips.map((c) => c.end)) - offset
  const n = clips.length
  const lines: string[] = []

  const labels = (prefix: string): string => clips.map((_, i) => `[${prefix}${i}]`).join('')
  if (n > 1) {
    lines.push(`[0:v]split=${n}${labels('sv')}`)
    if (hasAudio) lines.push(`[0:a]asplit=${n}${labels('sa')}`)
  }
  clips.forEach((c, i) => {
    const from = sec(c.start - offset)
    const to = sec(c.end - offset)
    const vin = n > 1 ? `[sv${i}]` : '[0:v]'
    lines.push(`${vin}trim=start=${from}:end=${to},setpts=PTS-STARTPTS[tv${i}]`)
    if (hasAudio) {
      const ain = n > 1 ? `[sa${i}]` : '[0:a]'
      lines.push(`${ain}atrim=start=${from}:end=${to},asetpts=PTS-STARTPTS[ta${i}]`)
    }
  })
  const inputs = clips.map((_, i) => `[tv${i}]${hasAudio ? `[ta${i}]` : ''}`).join('')
  const outputs = hasAudio ? '[cv][outa]' : '[cv]'
  lines.push(`${inputs}concat=n=${n}:v=1:a=${hasAudio ? 1 : 0}${outputs}`)
  lines.push(`[cv]${EVEN_SIZE}[outv]`)
  return { offset, span, script: lines.join(';\n') + '\n' }
}

export function buildCompilationArgs(opts: {
  input: string
  output: string
  scriptPath: string
  plan: CompilationPlan
  hasAudio: boolean
}): string[] {
  const { input, output, scriptPath, plan, hasAudio } = opts
  return [
    ...head(),
    '-ss',
    sec(plan.offset),
    '-t',
    sec(plan.span),
    '-i',
    input,
    '-filter_complex_script',
    scriptPath,
    '-map',
    '[outv]',
    ...(hasAudio ? ['-map', '[outa]'] : []),
    ...reencodeVideo(),
    ...(hasAudio ? reencodeAudio() : []),
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    '-y',
    output
  ]
}

/** Перекодирование по готовому графу с рисунками. PNG-наложения — входы ffmpeg с номерами 1, 2, … */
export function buildDrawnArgs(opts: {
  input: string
  pngPaths: readonly string[]
  output: string
  scriptPath: string
  offset: number
  span: number
  hasAudio: boolean
}): string[] {
  const { input, pngPaths, output, scriptPath, offset, span, hasAudio } = opts
  return [
    ...head(),
    '-ss',
    sec(offset),
    '-t',
    sec(span),
    '-i',
    input,
    ...pngPaths.flatMap((p) => ['-i', p]),
    '-filter_complex_script',
    scriptPath,
    '-map',
    '[outv]',
    ...(hasAudio ? ['-map', '[outa]'] : []),
    ...reencodeVideo(),
    ...(hasAudio ? reencodeAudio() : []),
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    '-y',
    output
  ]
}

/** Только чтение сведений о файле: ffmpeg без выхода печатает потоки в stderr и завершается с ошибкой — это нормально. */
export function buildProbeArgs(input: string): string[] {
  return ['-hide_banner', '-nostdin', '-i', input]
}
