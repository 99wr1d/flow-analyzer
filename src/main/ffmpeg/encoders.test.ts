import { beforeEach, describe, expect, it } from 'vitest'
import {
  BROKEN_GPU_ENCODER,
  CPU_ENCODER,
  GPU_ENCODERS,
  buildEncoderTestArgs,
  chooseEncoder,
  detectEncoders,
  parallelWorkers,
  parseEncoderList,
  probeEncoders,
  resetEncoderProbeCache,
  SMALL_QUALITY_STEP,
  withQuality,
  type ExecFn
} from './encoders'
import { reencodeVideo } from './args'

const LIST = `Encoders:
 V..... = Video
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D h264_amf             AMD AMF H.264 Encoder (codec h264)
 V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)
 V..... h264_qsv             H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (Intel Quick Sync Video acceleration) (codec h264)
 V....D libx265              libx265 H.265 / HEVC (codec hevc)
 A....D aac                  AAC (Advanced Audio Coding)
`

describe('список кодеров ffmpeg', () => {
  it('берёт только видеокодеры и их имена', () => {
    const names = parseEncoderList(LIST)
    expect(names.has('libx264')).toBe(true)
    expect(names.has('h264_nvenc')).toBe(true)
    expect(names.has('h264_qsv')).toBe(true)
    expect(names.has('h264_amf')).toBe(true)
    expect(names.has('aac')).toBe(false)
    expect(names.has('Video')).toBe(false)
  })
  it('пустой и мусорный вывод — пустой набор', () => {
    expect(parseEncoderList('').size).toBe(0)
    expect(parseEncoderList('ffmpeg: command not found').size).toBe(0)
  })
})

describe('аргументы по кодерам', () => {
  it('процессор — x264 veryfast CRF 20, yuv420p (как было до этапа 18)', () => {
    expect(CPU_ENCODER.videoArgs).toEqual([
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '20',
      '-pix_fmt',
      'yuv420p'
    ])
    expect(reencodeVideo()).toEqual(CPU_ENCODER.videoArgs)
  })
  it('NVENC: p4, tune hq, vbr, постоянное качество cq 23 без ограничения битрейта, адаптивное квантование', () => {
    const nv = GPU_ENCODERS.find((e) => e.id === 'nvenc')!
    const a = reencodeVideo(nv)
    expect(a).toEqual(
      expect.arrayContaining(['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq'])
    )
    expect(a.join(' ')).toContain('-rc vbr -cq 23 -b:v 0')
    expect(a.join(' ')).toContain('-spatial-aq 1 -temporal-aq 1')
    expect(a.join(' ')).toContain('-pix_fmt yuv420p')
  })
  it('у каждого кодера видеокарты свои параметры и свой кодер ffmpeg', () => {
    expect(GPU_ENCODERS.map((e) => e.ffmpegName)).toEqual(['h264_nvenc', 'h264_qsv', 'h264_amf'])
    for (const e of GPU_ENCODERS) {
      expect(e.videoArgs).toContain(e.ffmpegName)
      expect(e.maxParallel).toBeLessThanOrEqual(3)
    }
  })
  it('проверочное кодирование: одна секунда тестового видео в никуда, кодер задан профилем', () => {
    const a = buildEncoderTestArgs(GPU_ENCODERS[0])
    expect(a).toContain('lavfi')
    expect(a.join(' ')).toContain('testsrc2=size=1280x720:rate=25:duration=1')
    expect(a.join(' ')).toContain('-c:v h264_nvenc')
    expect(a.slice(-3)).toEqual(['-f', 'null', '-'])
  })
})

/** Подменённый запуск: перечень кодеров и результат проверки каждого. */
function fakeExec(
  listed: string,
  results: Record<string, number>
): { exec: ExecFn; calls: string[][] } {
  const calls: string[][] = []
  const exec: ExecFn = async (_file, args) => {
    calls.push(args)
    if (args.includes('-encoders')) return { code: 0, stdout: listed, stderr: '' }
    const enc = args[args.indexOf('-c:v') + 1]
    return { code: results[enc] ?? 1, stdout: '', stderr: '' }
  }
  return { exec, calls }
}

describe('поиск рабочего кодера видеокарты', () => {
  it('первый рабочий в порядке NVIDIA → Intel → AMD', async () => {
    const { exec } = fakeExec(LIST, { h264_nvenc: 0, h264_qsv: 0, h264_amf: 0 })
    const probe = await detectEncoders('ffmpeg', { exec })
    expect(probe.gpu?.id).toBe('nvenc')
    expect(probe.rejected).toEqual([])
  })
  it('кодер есть в списке, но проверка не прошла (нет драйвера) — берётся следующий', async () => {
    const { exec } = fakeExec(LIST, { h264_nvenc: 1, h264_qsv: 0 })
    const probe = await detectEncoders('ffmpeg', { exec })
    expect(probe.gpu?.id).toBe('qsv')
    expect(probe.rejected).toEqual(['h264_nvenc'])
  })
  it('ни один не заработал — видеокарты нет, остаётся процессор', async () => {
    const { exec } = fakeExec(LIST, {})
    const probe = await detectEncoders('ffmpeg', { exec })
    expect(probe.gpu).toBeNull()
    expect(probe.rejected).toEqual(['h264_nvenc', 'h264_qsv', 'h264_amf'])
  })
  it('кодеров видеокарт нет в сборке ffmpeg: проверочных запусков нет', async () => {
    const { exec, calls } = fakeExec(' V....D libx264   libx264 H.264\n', { h264_nvenc: 0 })
    const probe = await detectEncoders('ffmpeg', { exec })
    expect(probe.gpu).toBeNull()
    expect(calls).toHaveLength(1)
  })
  it('сам ffmpeg не отвечает на список — без видеокарты, без исключения', async () => {
    const exec: ExecFn = async () => ({ code: null, stdout: '', stderr: '' })
    expect((await detectEncoders('ffmpeg', { exec })).gpu).toBeNull()
  })
  it('автотест может подсунуть сломанную видеокарту', async () => {
    const probe = await detectEncoders('ffmpeg', { fakeBrokenGpu: true })
    expect(probe.gpu).toBe(BROKEN_GPU_ENCODER)
    expect(BROKEN_GPU_ENCODER.videoArgs).toContain('flow_broken_encoder')
  })
})

describe('запоминание результата проверки', () => {
  beforeEach(() => resetEncoderProbeCache())
  it('проверка по одному пути ffmpeg выполняется один раз за запуск', async () => {
    const first = probeEncoders('/definitely/not/ffmpeg', { fakeBrokenGpu: true })
    const second = probeEncoders('/definitely/not/ffmpeg', { fakeBrokenGpu: true })
    expect(second).toBe(first)
    // Настоящий и «ненастоящий» режимы не смешиваются.
    expect(probeEncoders('/definitely/not/ffmpeg')).not.toBe(first)
  })
  it('несуществующий ffmpeg: видеокарты нет', async () => {
    const probe = await probeEncoders('/definitely/not/ffmpeg')
    expect(probe.gpu).toBeNull()
  })
})

describe('выбор кодера', () => {
  const withGpu = { gpu: GPU_ENCODERS[0], rejected: [] }
  const without = { gpu: null, rejected: [] }
  it('«Авто»: видеокарта, если есть; иначе процессор', () => {
    expect(chooseEncoder('auto', withGpu)).toBe(GPU_ENCODERS[0])
    expect(chooseEncoder('auto', without)).toBe(CPU_ENCODER)
  })
  it('«Процессор» — всегда x264', () => {
    expect(chooseEncoder('cpu', withGpu)).toBe(CPU_ENCODER)
  })
})

describe('сколько процессов одновременно', () => {
  it('процессор: половина ядер, но не больше шести и не меньше одного', () => {
    expect(parallelWorkers(CPU_ENCODER, 12)).toBe(6)
    expect(parallelWorkers(CPU_ENCODER, 32)).toBe(6)
    expect(parallelWorkers(CPU_ENCODER, 8)).toBe(4)
    expect(parallelWorkers(CPU_ENCODER, 2)).toBe(1)
    expect(parallelWorkers(CPU_ENCODER, 1)).toBe(1)
  })
  it('видеокарта: два-три сеанса, независимо от ядер (у NVIDIA три)', () => {
    expect(parallelWorkers(GPU_ENCODERS[0], 4)).toBe(3)
    expect(parallelWorkers(GPU_ENCODERS[0], 32)).toBe(3)
    expect(parallelWorkers(GPU_ENCODERS[1], 32)).toBe(2)
  })
})

describe('withQuality', () => {
  it('обычное качество не меняет профиль', () => {
    expect(withQuality(CPU_ENCODER, 'normal')).toBe(CPU_ENCODER)
  })

  it('x264: CRF 20 → 26, остальное без изменений', () => {
    const small = withQuality(CPU_ENCODER, 'small')
    expect(small.videoArgs).toEqual(CPU_ENCODER.videoArgs.map((a) => (a === '20' ? '26' : a)))
    expect(small.videoArgs[small.videoArgs.indexOf('-crf') + 1]).toBe('26')
    expect(CPU_ENCODER.videoArgs[CPU_ENCODER.videoArgs.indexOf('-crf') + 1]).toBe('20')
  })

  it('у каждой видеокарты качество грубее на тот же шаг; битрейт и прочее не трогаются', () => {
    for (const p of GPU_ENCODERS) {
      const small = withQuality(p, 'small')
      expect(small.videoArgs).toHaveLength(p.videoArgs.length)
      const changed = small.videoArgs.filter((a, i) => a !== p.videoArgs[i])
      expect(changed.length, p.id).toBeGreaterThan(0)
      p.videoArgs.forEach((a, i) => {
        if (small.videoArgs[i] !== a) {
          expect(Number(small.videoArgs[i]) - Number(a)).toBe(SMALL_QUALITY_STEP)
        }
      })
    }
    const nv = withQuality(
      GPU_ENCODERS.find((p) => p.id === 'nvenc')!,
      'small'
    ).videoArgs
    expect(nv[nv.indexOf('-cq') + 1]).toBe('29')
    expect(nv[nv.indexOf('-b:v') + 1]).toBe('0')
  })
})
