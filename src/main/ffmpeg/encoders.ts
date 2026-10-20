// Видеокодеры экспорта: процессор (libx264) и аппаратные кодеры видеокарт (NVENC, Quick Sync, AMF).
// Какие из них работают на этом компьютере, выясняется один раз за запуск: ffmpeg перечисляет кодеры, а затем
// каждый найденный проверяется настоящим кодированием одной секунды (в списке кодер бывает, а драйвера или карты нет).
// Чистые функции (разбор списка, аргументы, выбор) проверяются юнит-тестами; запуск ffmpeg можно подменить.
import { execFile } from 'child_process'

export type EncoderId = 'cpu' | 'nvenc' | 'qsv' | 'amf'

export interface EncoderProfile {
  id: EncoderId
  /** Имя кодера в ffmpeg. */
  ffmpegName: string
  /** Название для интерфейса. */
  label: string
  /** Параметры видео (кодер, качество, формат пикселей). */
  videoArgs: string[]
  /**
   * Сколько ffmpeg с этим кодером можно запускать одновременно. У видеокарт кодирует одно устройство, и два-три
   * сеанса уже его загружают (проверено замером: кусков с рисунками идёт больше, чем успевает кодировать видеокарта, а фильтры
   * у них однопоточные, поэтому третий сеанс всё же даёт +20 %), а у потребительских карт NVIDIA число сеансов ещё и ограничено
   * драйвером (с трёх в старых версиях); при отказе экспорт повторяется на процессоре.
   */
  maxParallel: number
}

/** Качество процессора, как и раньше: x264, пресет veryfast, CRF 20. */
export const CPU_ENCODER: EncoderProfile = {
  id: 'cpu',
  ffmpegName: 'libx264',
  label: 'Процессор (x264)',
  videoArgs: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p'],
  maxParallel: 6
}

/**
 * Видеокарты. Настройки подобраны так, чтобы качество было не хуже x264 CRF 20 (замер SSIM против исходника в
 * docs/performance.md: 0.9987 против 0.9973; на шумной картинке 0.979 против 0.977): у NVENC при таком качестве файл получается в полтора-два раза больше,
 * это цена скорости.
 * Проверены на NVIDIA; Intel и AMD в этой сборке не проверялись (нет такого железа) — если кодер не заведётся,
 * проверка при запуске его отбросит, а экспорт пойдёт на процессоре.
 */
export const GPU_ENCODERS: readonly EncoderProfile[] = [
  {
    id: 'nvenc',
    ffmpegName: 'h264_nvenc',
    label: 'Видеокарта NVIDIA (NVENC)',
    videoArgs: [
      '-c:v',
      'h264_nvenc',
      '-preset',
      'p4',
      '-tune',
      'hq',
      '-rc',
      'vbr',
      '-cq',
      '23',
      '-b:v',
      '0',
      '-spatial-aq',
      '1',
      '-temporal-aq',
      '1',
      '-pix_fmt',
      'yuv420p'
    ],
    maxParallel: 3
  },
  {
    id: 'qsv',
    ffmpegName: 'h264_qsv',
    label: 'Видеокарта Intel (Quick Sync)',
    videoArgs: [
      '-c:v',
      'h264_qsv',
      '-preset',
      'medium',
      '-global_quality',
      '22',
      '-pix_fmt',
      'nv12'
    ],
    maxParallel: 2
  },
  {
    id: 'amf',
    ffmpegName: 'h264_amf',
    label: 'Видеокарта AMD (AMF)',
    videoArgs: [
      '-c:v',
      'h264_amf',
      '-usage',
      'transcoding',
      '-quality',
      'quality',
      '-rc',
      'cqp',
      '-qp_i',
      '21',
      '-qp_p',
      '22',
      '-qp_b',
      '24',
      '-pix_fmt',
      'yuv420p'
    ],
    maxParallel: 2
  }
]

/** Названия кодеров из вывода `ffmpeg -encoders`. */
export function parseEncoderList(text: string): Set<string> {
  const names = new Set<string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*V[.\w]{5}\s+(\S+)\s/.exec(line)
    if (m) names.add(m[1])
  }
  return names
}

/** Аргументы проверки кодера: одна секунда тестового видео в «никуда». Размер как у настоящего видео (у части кодеров есть минимум). */
export function buildEncoderTestArgs(profile: EncoderProfile): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1280x720:rate=25:duration=1',
    '-frames:v',
    '25',
    ...profile.videoArgs,
    '-f',
    'null',
    '-'
  ]
}

export interface ExecResult {
  code: number | null
  stdout: string
  stderr: string
}
export type ExecFn = (file: string, args: string[], timeoutMs: number) => Promise<ExecResult>

const defaultExec: ExecFn = (file, args, timeoutMs) =>
  new Promise((resolve) => {
    try {
      execFile(
        file,
        args,
        { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const code =
            error && typeof (error as NodeJS.ErrnoException).code === 'number'
              ? ((error as NodeJS.ErrnoException).code as unknown as number)
              : error
                ? null
                : 0
          resolve({ code, stdout: String(stdout), stderr: String(stderr) })
        }
      )
    } catch {
      resolve({ code: null, stdout: '', stderr: '' })
    }
  })

export interface EncoderProbe {
  /** Первый работающий аппаратный кодер; null — видеокарты для кодирования не нашлось. */
  gpu: EncoderProfile | null
  /** Какие кодеры ffmpeg перечислил, но проверка не прошла (для журнала). */
  rejected: string[]
}

export interface ProbeOptions {
  exec?: ExecFn
  /** Для автотестов: притвориться, что есть видеокарта, кодер которой сломан (проверка отката на процессор). */
  fakeBrokenGpu?: boolean
}

/** Сломанный кодер для автотестов: ffmpeg не знает такого имени и сразу завершается с ошибкой. */
export const BROKEN_GPU_ENCODER: EncoderProfile = {
  id: 'nvenc',
  ffmpegName: 'h264_nvenc',
  label: 'Видеокарта NVIDIA (NVENC)',
  videoArgs: ['-c:v', 'flow_broken_encoder', '-pix_fmt', 'yuv420p'],
  maxParallel: 2
}

/** Находит рабочий аппаратный кодер. Каждая проверка ограничена по времени (драйвер может зависнуть). */
export async function detectEncoders(
  ffmpegPath: string,
  options: ProbeOptions = {}
): Promise<EncoderProbe> {
  if (options.fakeBrokenGpu) return { gpu: BROKEN_GPU_ENCODER, rejected: [] }
  const exec = options.exec ?? defaultExec
  const listed = await exec(ffmpegPath, ['-hide_banner', '-encoders'], 15_000)
  if (listed.code !== 0) return { gpu: null, rejected: [] }
  const names = parseEncoderList(listed.stdout)
  const rejected: string[] = []
  for (const profile of GPU_ENCODERS) {
    if (!names.has(profile.ffmpegName)) continue
    const test = await exec(ffmpegPath, buildEncoderTestArgs(profile), 20_000)
    if (test.code === 0) return { gpu: profile, rejected }
    rejected.push(profile.ffmpegName)
  }
  return { gpu: null, rejected }
}

const cache = new Map<string, Promise<EncoderProbe>>()

/** Результат проверки запоминается на время работы приложения (по пути к ffmpeg). */
export function probeEncoders(
  ffmpegPath: string,
  options: ProbeOptions = {}
): Promise<EncoderProbe> {
  const key = `${ffmpegPath}|${options.fakeBrokenGpu ? 'fake' : ''}`
  let found = cache.get(key)
  if (!found) {
    found = detectEncoders(ffmpegPath, options)
    cache.set(key, found)
  }
  return found
}

export function resetEncoderProbeCache(): void {
  cache.clear()
}

export type EncoderQuality = 'normal' | 'small'

/**
 * Насколько «Меньше размер» грубее обычного качества: значение качества (CRF/CQ/QP) больше на 6 (x264: CRF 20 → 26,
 * NVENC: CQ 23 → 29), это примерно вдвое меньше файл при заметно, но не сильно худшей картинке.
 */
export const SMALL_QUALITY_STEP = 6
const QUALITY_FLAGS = new Set(['-crf', '-cq', '-global_quality', '-qp_i', '-qp_p', '-qp_b'])

/** Профиль кодера с нужным качеством. «Обычное» возвращает профиль без изменений. */
export function withQuality(profile: EncoderProfile, quality: EncoderQuality): EncoderProfile {
  if (quality === 'normal') return profile
  const videoArgs = profile.videoArgs.map((arg, i, all) =>
    i > 0 && QUALITY_FLAGS.has(all[i - 1]) ? String(Number(arg) + SMALL_QUALITY_STEP) : arg
  )
  return { ...profile, videoArgs }
}

export type EncoderChoice = 'auto' | 'cpu'

/** Кодер для задания: «Авто» — видеокарта, если она есть; «Процессор» — всегда x264. */
export function chooseEncoder(choice: EncoderChoice, probe: EncoderProbe): EncoderProfile {
  return choice === 'auto' && probe.gpu ? probe.gpu : CPU_ENCODER
}

/** Сколько процессов ffmpeg запускать одновременно для кусков одного файла. */
export function parallelWorkers(profile: EncoderProfile, logicalCores: number): number {
  if (profile.id === 'cpu') {
    return Math.max(1, Math.min(profile.maxParallel, Math.floor(logicalCores / 2)))
  }
  return profile.maxParallel
}
