// Генератор больших тестовых видео для замеров производительности (npm run bench).
//
// Запуск:  node scripts/make-bench.mjs <папка> [long|uhd|vfr|all] [минуты]
//   long — bench-1080p-90min.mp4: 1920×1080, 25 к/с, H.264 (yuv420p, GOP 50), AAC (синус). Подвижная картинка с таймкодом.
//   uhd  — bench-4k-10min.mp4: 3840×2160, 25 к/с, H.264, 10 минут.
//   vfr  — bench-1080p-vfr.mp4: 1080p, 29.97 к/с с «дырами» во времени кадров (необязательно, по умолчанию не делается).
// Третий аргумент меняет длительность (в минутах) — для быстрой проверки скрипта.
// Файлы большие (гигабайты): держите их вне репозитория и удаляйте после замеров. Нужен лишь ffmpeg-static.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-static')

const out = process.argv[2] ? resolve(process.argv[2]) : null
const what = process.argv[3] ?? 'long'
const minutesArg = process.argv[4] ? Number(process.argv[4]) : null
if (!out) {
  console.error('Использование: node scripts/make-bench.mjs <папка> [long|uhd|vfr|all] [минуты]')
  process.exit(1)
}
mkdirSync(out, { recursive: true })

const FONT = String.raw`C\:/Windows/Fonts/arial.ttf`

function run(args, name) {
  return new Promise((done, fail) => {
    const started = Date.now()
    const p = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-stats', '-y', ...args], {
      stdio: ['ignore', 'inherit', 'inherit']
    })
    p.on('error', fail)
    p.on('exit', (code) => {
      if (code !== 0) return fail(new Error(`ffmpeg завершился с кодом ${code}`))
      const mb = (statSync(args[args.length - 1]).size / 1048576).toFixed(0)
      console.log(`\n${name}: ${mb} МБ за ${((Date.now() - started) / 1000).toFixed(0)} с`)
      done()
    })
  })
}

function make({ file, w, h, minutes, fps = 25, bitrate, filterExtra = '' }) {
  const target = join(out, file)
  if (existsSync(target)) {
    console.log(`${file} уже есть — пропускаю`)
    return Promise.resolve()
  }
  const seconds = Math.round(minutes * 60)
  const text = String.raw`drawtext=fontfile='${FONT}':text='%{pts\:hms}':x=40:y=40:fontsize=${Math.round(h / 10)}:fontcolor=white:box=1:boxcolor=black@0.6`
  return run(
    [
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=${w}x${h}:rate=${fps}:duration=${seconds}`,
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=440:sample_rate=48000:duration=${seconds}`,
      '-vf',
      `${text}${filterExtra},format=yuv420p`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-g',
      '50',
      '-keyint_min',
      '50',
      '-sc_threshold',
      '0',
      '-b:v',
      bitrate,
      '-maxrate',
      bitrate,
      '-bufsize',
      '8M',
      '-fps_mode',
      'passthrough',
      '-c:a',
      'aac',
      '-b:a',
      '96k',
      '-movflags',
      '+faststart',
      '-shortest',
      target
    ],
    file
  )
}

const minutesFor = (def) => minutesArg ?? def
if (what === 'long' || what === 'all') {
  await make({
    file: 'bench-1080p-90min.mp4',
    w: 1920,
    h: 1080,
    minutes: minutesFor(90),
    bitrate: '3M'
  })
}
if (what === 'uhd' || what === 'all') {
  await make({
    file: 'bench-4k-10min.mp4',
    w: 3840,
    h: 2160,
    minutes: minutesFor(10),
    bitrate: '12M'
  })
}
if (what === 'vfr') {
  // Переменная частота: 30000/1001, часть кадров отброшена (select) — метки времени идут с «дырами».
  await make({
    file: 'bench-1080p-vfr.mp4',
    w: 1920,
    h: 1080,
    minutes: minutesFor(90),
    fps: 30,
    bitrate: '3M',
    filterExtra: String.raw`,select='gte(random(0)\,0.08)'`
  })
}
console.log('Готово.')
