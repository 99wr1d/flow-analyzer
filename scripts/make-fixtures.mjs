// Генератор тестовых видео для e2e-тестов (tests/fixtures).
//
// Запуск:
//   node scripts/make-fixtures.mjs          # всё сразу
//   node scripts/make-fixtures.mjs cfr      # только cfr25.mp4 и cfr30.webm (нужен лишь ffmpeg-static)
//   node scripts/make-fixtures.mjs chrome   # только sample.webm, sample.mp4, broken.mp4 (нужен Google Chrome)
//
// 1) cfr25.mp4 (H.264, 25 к/с) и cfr30.webm (VP8, 30 к/с): ровная частота кадров, на каждом кадре крупно
//    нарисован его номер (drawtext). Делает ffmpeg из пакета ffmpeg-static (devDependency).
// 2) sample.*: в странице рисуется 6-секундная анимация на canvas, canvas.captureStream() пишется через
//    MediaRecorder в Chrome (Playwright, channel: 'chrome'). Частота кадров там НЕ постоянная — это нужно,
//    чтобы проверять поведение на «неидеальных» файлах. WebM из MediaRecorder не содержит длительности,
//    поэтому скрипт дописывает элемент Duration в заголовок. Если Chrome не умеет писать MP4 — sample.mp4 пропускается.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures')
const DURATION_MS = 6000

// ---------- Дописываем Duration в WebM ----------
function readVint(buf, pos) {
  const first = buf[pos]
  let len = 1
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++
  let value = first & (0xff >> len)
  let unknown = value === 0xff >> len
  for (let i = 1; i < len; i++) {
    value = value * 256 + buf[pos + i]
    if (buf[pos + i] !== 0xff) unknown = false
  }
  return { len, value, unknown }
}

function readId(buf, pos) {
  const first = buf[pos]
  let len = 1
  while (len <= 4 && !(first & (0x80 >> (len - 1)))) len++
  return { len, id: buf.readUIntBE(pos, len) }
}

function sizeVint8(value) {
  const b = Buffer.alloc(8)
  b[0] = 0x01
  b.writeUIntBE(value, 2, 6)
  return b
}

export function patchWebmDuration(input, durationMs) {
  let pos = 0
  const header = readId(input, pos)
  if (header.id !== 0x1a45dfa3) throw new Error('Не WebM: нет EBML-заголовка')
  const headerSize = readVint(input, pos + header.len)
  pos += header.len + headerSize.len + headerSize.value

  const segId = readId(input, pos)
  if (segId.id !== 0x18538067) throw new Error('Нет элемента Segment')
  const segSizePos = pos + segId.len
  const segSize = readVint(input, segSizePos)
  const segBodyStart = segSizePos + segSize.len

  let p = segBodyStart
  while (p < input.length) {
    const id = readId(input, p)
    const size = readVint(input, p + id.len)
    const bodyStart = p + id.len + size.len
    if (id.id === 0x1549a966) {
      const infoBody = input.subarray(bodyStart, bodyStart + size.value)
      const duration = Buffer.alloc(11)
      duration.writeUInt16BE(0x4489, 0)
      duration[2] = 0x88
      duration.writeDoubleBE(durationMs, 3)
      const newInfoHeader = Buffer.concat([
        Buffer.from([0x15, 0x49, 0xa9, 0x66]),
        sizeVint8(size.value + 11)
      ])
      const delta = 11 + (newInfoHeader.length - (id.len + size.len))
      let segHeader = input.subarray(segSizePos - segId.len, segBodyStart)
      if (!segSize.unknown) {
        segHeader = Buffer.concat([
          input.subarray(segSizePos - segId.len, segSizePos),
          sizeVint8(segSize.value + delta)
        ])
      }
      return Buffer.concat([
        input.subarray(0, segSizePos - segId.len),
        segHeader,
        input.subarray(segBodyStart, p),
        newInfoHeader,
        infoBody,
        duration,
        input.subarray(bodyStart + size.value)
      ])
    }
    if (size.unknown) break
    p = bodyStart + size.value
  }
  throw new Error('Нет элемента Info')
}

// ---------- Запись в Chrome ----------
async function record(page, mimeType) {
  return page.evaluate(
    async ({ mimeType, durationMs }) => {
      if (!MediaRecorder.isTypeSupported(mimeType)) return null
      const canvas = document.createElement('canvas')
      canvas.width = 640
      canvas.height = 360
      document.body.appendChild(canvas)
      const ctx = canvas.getContext('2d')
      const pad = (n) => String(n).padStart(2, '0')

      const draw = (t) => {
        const sec = t / 1000
        ctx.fillStyle = '#1f7a3d'
        ctx.fillRect(0, 0, 640, 360)
        ctx.fillStyle = '#25914a'
        for (let i = 0; i < 8; i += 2) ctx.fillRect(i * 80, 0, 80, 360)
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'
        ctx.lineWidth = 3
        ctx.strokeRect(20, 20, 600, 320)
        ctx.beginPath()
        ctx.moveTo(320, 20)
        ctx.lineTo(320, 340)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(320, 180, 50, 0, Math.PI * 2)
        ctx.stroke()
        // Мяч двигается по эллипсу — по кадру видно, какой это момент времени.
        const a = (sec / 6) * Math.PI * 2
        const x = 320 + Math.cos(a) * 230
        const y = 180 + Math.sin(a) * 110
        ctx.fillStyle = '#fff'
        ctx.beginPath()
        ctx.arc(x, y, 14, 0, Math.PI * 2)
        ctx.fill()
        ctx.strokeStyle = '#111'
        ctx.lineWidth = 2
        ctx.stroke()
        // Полоса прогресса и таймкод.
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(0, 0, 640, 56)
        ctx.fillStyle = '#ffd400'
        ctx.fillRect(0, 50, (sec / 6) * 640, 6)
        ctx.fillStyle = '#fff'
        ctx.font = 'bold 34px monospace'
        ctx.textBaseline = 'middle'
        const tenths = Math.floor(sec * 10) % 10
        ctx.fillText(`${pad(Math.floor(sec / 60))}:${pad(Math.floor(sec) % 60)}.${tenths}`, 16, 26)
      }

      const stream = canvas.captureStream(30)
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 400_000 })
      const chunks = []
      recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
      const stopped = new Promise((resolve) => (recorder.onstop = resolve))

      const start = performance.now()
      recorder.start()
      await new Promise((resolve) => {
        const tick = () => {
          const t = performance.now() - start
          draw(Math.min(t, durationMs))
          if (t >= durationMs) resolve()
          else setTimeout(tick, 1000 / 30)
        }
        tick()
      })
      recorder.stop()
      await stopped
      const blob = new Blob(chunks, { type: mimeType })
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      }
      canvas.remove()
      return btoa(binary)
    },
    { mimeType, durationMs: DURATION_MS }
  )
}

// ---------- ffmpeg: файлы с постоянной частотой кадров ----------
function makeCfr() {
  const ffmpeg = createRequire(import.meta.url)('ffmpeg-static')
  if (!ffmpeg) throw new Error('ffmpeg-static не нашёл ffmpeg для этой системы')
  // Номер кадра рисуется крупно: text='%{eif:n:d:3}' (n — номер кадра с нуля). Внутри фильтра двоеточия экранируются.
  const font = 'C\\:/Windows/Fonts/arial.ttf'
  const overlay =
    "drawtext=fontfile='" +
    font +
    "':text='%{eif\\:n\\:d\\:3}':fontsize=140:fontcolor=white:" +
    'borderw=6:bordercolor=black:x=(w-text_w)/2:y=(h-text_h)/2'
  const source = (fps) => ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=' + fps + ':duration=4']
  const common = ['-y', '-hide_banner', '-loglevel', 'error']
  const jobs = [
    [
      'cfr25.mp4',
      [
        ...source(25),
        '-vf',
        overlay + ',format=yuv420p',
        '-c:v',
        'libx264',
        '-profile:v',
        'main',
        '-preset',
        'medium',
        '-crf',
        '30',
        '-g',
        '25',
        '-r',
        '25',
        '-an',
        '-movflags',
        '+faststart'
      ]
    ],
    [
      'cfr30.webm',
      [
        ...source(30),
        '-vf',
        overlay + ',format=yuv420p',
        '-c:v',
        'libvpx',
        '-b:v',
        '300k',
        '-g',
        '30',
        '-r',
        '30',
        '-an'
      ]
    ]
  ]
  for (const [file, args] of jobs) {
    execFileSync(ffmpeg, [...common, ...args, join(OUT, file)], { stdio: 'inherit' })
    console.log(file + ': ' + (statSync(join(OUT, file)).size / 1024).toFixed(0) + ' КБ')
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const mode = process.argv[2] ?? 'all'
  if (mode === 'all' || mode === 'cfr') makeCfr()
  if (mode === 'cfr') return
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    await page.goto('about:blank')

    for (const [file, mime, patch] of [
      ['sample.webm', 'video/webm;codecs=vp8', true],
      ['sample.mp4', 'video/mp4;codecs=avc1', false]
    ]) {
      const base64 = await record(page, mime)
      if (!base64) {
        console.log(`${file}: пропущен — Chrome не поддерживает запись ${mime}`)
        continue
      }
      let data = Buffer.from(base64, 'base64')
      if (patch) data = patchWebmDuration(data, DURATION_MS)
      writeFileSync(join(OUT, file), data)
      console.log(`${file}: ${(data.length / 1024).toFixed(0)} КБ`)
    }
  } finally {
    await browser.close()
  }

  writeFileSync(join(OUT, 'broken.mp4'), 'Это не видео, а просто текст.\n', 'utf8')
  console.log('broken.mp4: создан')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
