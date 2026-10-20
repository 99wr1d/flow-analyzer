// Сравнение качества и скорости кодеров экспорта: x264 (процессор) и NVENC (видеокарта NVIDIA) на отрывке видео.
//
// Запуск:  node scripts/encoder-quality.mjs <видео> [начало, с] [длительность, с]
// Для каждого кодера кодирует отрывок теми же параметрами, что и экспорт (src/main/ffmpeg/encoders.ts — держите их одинаковыми),
// и сравнивает результат с исходным отрывком: SSIM и PSNR (чем выше, тем ближе к исходнику), размер файла, скорость кодирования.
// Требование этапа 18: SSIM аппаратного кодера против исходника не ниже 0.97 и не хуже x264.
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-static')

const input = process.argv[2] ? resolve(process.argv[2]) : null
const start = process.argv[3] ?? '0'
const seconds = process.argv[4] ?? '20'
if (!input) {
  console.error(
    'Использование: node scripts/encoder-quality.mjs <видео> [начало, с] [длительность, с]'
  )
  process.exit(1)
}

const encoders = {
  'x264 (процессор): veryfast, CRF 20': [
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-pix_fmt',
    'yuv420p'
  ],
  'NVENC (видеокарта): p4, hq, vbr, cq 23, aq': [
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
  ]
}

const run = (args) =>
  spawnSync(ffmpeg, ['-hide_banner', '-nostdin', ...args], { maxBuffer: 1 << 28 })
const metric = (file, filter) => {
  const r = run([
    '-i',
    file,
    '-ss',
    start,
    '-t',
    seconds,
    '-i',
    input,
    '-lavfi',
    `[0:v]setpts=PTS-STARTPTS[a];[1:v]setpts=PTS-STARTPTS,format=yuv420p[b];[a][b]${filter}`,
    '-f',
    'null',
    '-'
  ])
  return r.stderr.toString()
}

const dir = mkdtempSync(join(tmpdir(), 'flow-quality-'))
try {
  console.log(`Отрывок: ${input}, с ${start} с, ${seconds} с\n`)
  for (const [name, args] of Object.entries(encoders)) {
    const out = join(dir, 'out.mp4')
    const t0 = Date.now()
    const r = run([
      '-loglevel',
      'error',
      '-y',
      '-ss',
      start,
      '-t',
      seconds,
      '-i',
      input,
      '-vf',
      'format=yuv420p',
      ...args,
      out
    ])
    const wall = (Date.now() - t0) / 1000
    if (r.status !== 0) {
      console.log(
        `${name}: не работает на этом компьютере\n${r.stderr.toString().trim().split('\n').slice(-2).join('\n')}\n`
      )
      continue
    }
    const ssim = /All:(\S+)/.exec(metric(out, 'ssim'))?.[1]
    const psnr = /average:(\S+)/.exec(metric(out, 'psnr'))?.[1]
    const mb = (statSync(out).size / 1048576).toFixed(1)
    console.log(
      `${name}\n  SSIM ${ssim}   PSNR ${psnr} дБ   файл ${mb} МБ   ${wall.toFixed(1)} с\n`
    )
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}
