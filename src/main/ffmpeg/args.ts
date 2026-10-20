// Сборка аргументов ffmpeg. Всегда массив для spawn — никаких строк для оболочки.
import type { PreparedClip } from '../../shared/exportRanges'
import { planReadChunks } from './chunks'
import { CPU_ENCODER, type EncoderProfile } from './encoders'

export const AUDIO_BITRATE = '160k'

/** Секунды в виде, понятном ffmpeg (всегда точка, три знака). */
export const sec = (value: number): string => Math.max(0, value).toFixed(3)

/** Общие параметры: тихий вывод, ход работы в stdout (key=value), без чтения с клавиатуры. */
export function head(): string[] {
  return ['-hide_banner', '-nostdin', '-nostats', '-loglevel', 'warning', '-progress', 'pipe:1']
}

/** Чётные размеры кадра: yuv420p иначе не кодируется. Для обычных видео ничего не меняет. */
export const EVEN_SIZE = 'scale=trunc(iw/2)*2:trunc(ih/2)*2'

/**
 * Метки времени куска видео, начинающегося с момента from (секунды, строка): первый кадр кладётся на 0 (setpts=PTS-STARTPTS),
 * но если до него в исходнике пусто больше чем на кадр (видео начинается позже звука: start_time 0.0333 у фрагментированного
 * MP4), этот пробел возвращается. Иначе видео уезжало бы на кадр раньше звука. Обычные куски (первый кадр в пределах кадра
 * от from) получают прежние метки.
 */
export const startPts = (from: string, fps: number): string =>
  `setpts='PTS-STARTPTS+if(gt(STARTPTS*TB-${from},${(0.75 / fps).toFixed(6)}),STARTPTS-${from}/TB,0)'`

/** Параметры видео для перекодирования: процессор (по умолчанию) или кодер видеокарты. */
export const reencodeVideo = (encoder: EncoderProfile = CPU_ENCODER): string[] => [
  ...encoder.videoArgs
]
export const reencodeAudio = (): string[] => ['-c:a', 'aac', '-b:a', AUDIO_BITRATE]

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
  encoder?: EncoderProfile
}): string[] {
  const { input, output, start, end, fast, encoder } = opts
  const common = ['-ss', sec(start), '-t', sec(end - start), '-i', input]
  const maps = ['-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn']
  const codecs = fast
    ? ['-c', 'copy', '-avoid_negative_ts', 'make_zero']
    : ['-vf', EVEN_SIZE, ...reencodeVideo(encoder), ...reencodeAudio()]
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
  /**
   * Входы ffmpeg: один кусок видео на вход (-ss до -i, поэтому пропущенное между кусками не декодируется).
   * Близкие эпизоды читаются одним куском, далёкие — разными (см. chunks.ts).
   */
  inputs: Array<{ offset: number; span: number }>
  /** Содержимое файла с описанием фильтров (-filter_complex_script). */
  script: string
}

/**
 * Подборка: trim/atrim каждого эпизода и склейка concat с перекодированием.
 * Граф кладётся в файл, а не в аргумент: у 500 эпизодов он длиннее предела командной строки Windows.
 * Времена в графе отсчитываются от смещения своего входа (так -ss перед -i сдвигает метки времени).
 * fps (если известен) нужен, чтобы не сдвигать видео, начинающееся позже звука (см. startPts).
 * Эпизоды склеиваются в том порядке, в котором переданы; один эпизод берётся ровно из одного куска.
 */
export function planCompilation(
  clips: readonly Pick<PreparedClip, 'start' | 'end'>[],
  hasAudio: boolean,
  fps?: number
): CompilationPlan {
  const n = clips.length
  const chunks = planReadChunks(clips)
  const lines: string[] = []
  // Для каждого эпизода: из какого входа он берётся.
  const where = new Map<number, number>()

  chunks.forEach((chunk, ci) => {
    const k = chunk.clips.length
    const names = (prefix: string): string =>
      chunk.clips.map((clip) => `[${prefix}${clip}]`).join('')
    if (k > 1) {
      lines.push(`[${ci}:v]split=${k}${names('sv')}`)
      if (hasAudio) lines.push(`[${ci}:a]asplit=${k}${names('sa')}`)
    }
    for (const clip of chunk.clips) where.set(clip, ci)
  })
  clips.forEach((c, i) => {
    const input = where.get(i) as number
    const chunk = chunks[input]
    const single = chunk.clips.length === 1
    const from = sec(c.start - chunk.offset)
    const to = sec(c.end - chunk.offset)
    const vin = single ? `[${input}:v]` : `[sv${i}]`
    lines.push(
      `${vin}trim=start=${from}:end=${to},${fps ? startPts(from, fps) : 'setpts=PTS-STARTPTS'}[tv${i}]`
    )
    if (hasAudio) {
      const ain = single ? `[${input}:a]` : `[sa${i}]`
      lines.push(`${ain}atrim=start=${from}:end=${to},asetpts=PTS-STARTPTS[ta${i}]`)
    }
  })
  const inputs = clips.map((_, i) => `[tv${i}]${hasAudio ? `[ta${i}]` : ''}`).join('')
  const outputs = hasAudio ? '[cv][outa]' : '[cv]'
  lines.push(`${inputs}concat=n=${n}:v=1:a=${hasAudio ? 1 : 0}${outputs}`)
  lines.push(`[cv]${EVEN_SIZE}[outv]`)
  return {
    inputs: chunks.map((c) => ({ offset: c.offset, span: c.span })),
    script: lines.join(';\n') + '\n'
  }
}

export function buildCompilationArgs(opts: {
  input: string
  output: string
  scriptPath: string
  plan: CompilationPlan
  hasAudio: boolean
  encoder?: EncoderProfile
}): string[] {
  const { input, output, scriptPath, plan, hasAudio, encoder } = opts
  return [
    ...head(),
    ...plan.inputs.flatMap((part) => ['-ss', sec(part.offset), '-t', sec(part.span), '-i', input]),
    '-filter_complex_script',
    scriptPath,
    '-map',
    '[outv]',
    ...(hasAudio ? ['-map', '[outa]'] : []),
    ...reencodeVideo(encoder),
    ...(hasAudio ? reencodeAudio() : []),
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    '-y',
    output
  ]
}

/** Ряд PNG-кадров как вход ffmpeg: шаблон имени с номером (%07d), первый номер и частота кадров. */
export interface SequenceInput {
  pattern: string
  start: number
  fps: number
}

/** Перекодирование по готовому графу с рисунками. PNG-наложения — входы ffmpeg с номерами 1, 2, … */
export function buildDrawnArgs(opts: {
  input: string
  pngPaths: ReadonlyArray<string | SequenceInput>
  output: string
  scriptPath: string
  offset: number
  span: number
  hasAudio: boolean
  encoder?: EncoderProfile
  /** Потоков кодера (для x264 при параллельных кусках; без значения — решает сам кодер). */
  encoderThreads?: number
}): string[] {
  const { input, pngPaths, output, scriptPath, offset, span, hasAudio, encoder, encoderThreads } =
    opts
  return [
    ...head(),
    '-ss',
    sec(offset),
    '-t',
    sec(span),
    '-i',
    input,
    ...pngPaths.flatMap((p) =>
      typeof p === 'string'
        ? ['-i', p]
        : [
            '-framerate',
            String(Math.round(p.fps * 1000) / 1000),
            '-start_number',
            String(p.start),
            '-i',
            p.pattern
          ]
    ),
    '-filter_complex_script',
    scriptPath,
    '-map',
    '[outv]',
    ...(hasAudio ? ['-map', '[outa]'] : []),
    ...reencodeVideo(encoder),
    ...(encoderThreads && (encoder ?? CPU_ENCODER).id === 'cpu'
      ? ['-threads', String(encoderThreads)]
      : []),
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
