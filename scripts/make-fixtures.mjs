// Генератор тестовых видео для e2e-тестов (tests/fixtures).
//
// Запуск:
//   node scripts/make-fixtures.mjs          # всё сразу
//   node scripts/make-fixtures.mjs cfr      # только cfr25.mp4 и cfr30.webm (нужен лишь ffmpeg-static)
//   node scripts/make-fixtures.mjs chrome   # только sample.webm, sample.mp4, broken.mp4 (нужен Google Chrome)
//   node scripts/make-fixtures.mjs pitch    # только pitch.mp4 и pitch.json (нужны Google Chrome и ffmpeg-static)
//   node scripts/make-fixtures.mjs players  # только players.mp4 (нужен лишь ffmpeg-static)
//   node scripts/make-fixtures.mjs runner   # только runner.mp4 (нужен лишь ffmpeg-static)
//
// 1) cfr25.mp4 (H.264, 25 к/с) и cfr30.webm (VP8, 30 к/с): ровная частота кадров, на каждом кадре крупно
//    нарисован его номер (drawtext). Делает ffmpeg из пакета ffmpeg-static (devDependency).
// 3) pitch.mp4 + pitch.json: «футбольное поле в перспективе» для проверки разметки поля. Настоящая камера (положение,
//    поворот, фокус известны) проецирует газон, линии разметки, ворота и игроков на кадр 1280×720; кадр рисуется в
//    Chrome на canvas и кодируется ffmpeg в 3-секундное видео 25 к/с. В pitch.json лежит точная гомография
//    «поле (м) → кадр (0..1)» и координаты опорных точек — по ним тесты проверяют разметку и рисунки на поле.
// 4) players.mp4: газон с шумом и полосами, белая линия и три крупных «игрока» (красный, синий, жёлтый) — для
//    проверки рисунков «под игроками» (ключ по газону). 640×360, 25 к/с, 3 секунды. Координаты игроков описаны
//    в PLAYERS ниже: по ним тесты знают, где игрок, а где трава.
// 5) runner.mp4: «бегущая фигурка» для слежения за игроком. Газон, красный бегун (голова, туловище, ноги) бежит вправо,
//    синий стоит на его пути (бегун проходит мимо него), жёлтый стоит дальше. С 2,4 с — смена плана (серый кадр).
//    Положение бегуна — точная функция времени середины кадра (см. RUNNER): по ней e2e проверяют, что ключи слежения
//    попадают на тот же кадр, который показывает плеер. 640×360, 25 к/с, 3 секунды.
// 2) sample.*: в странице рисуется 6-секундная анимация на canvas, canvas.captureStream() пишется через
//    MediaRecorder в Chrome (Playwright, channel: 'chrome'). Частота кадров там НЕ постоянная — это нужно,
//    чтобы проверять поведение на «неидеальных» файлах. WebM из MediaRecorder не содержит длительности,
//    поэтому скрипт дописывает элемент Duration в заголовок. Если Chrome не умеет писать MP4 — sample.mp4 пропускается.
import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

// ---------- Поле в перспективе ----------
const PITCH = { length: 105, width: 68 }
const FRAME = { w: 1280, h: 720 }
// Камера у ближней боковой линии (y = 68 — к зрителю), высоко над левой штрафной; мир: x вправо, y к зрителю.
const CAMERA = { position: [24, 100, 22], target: [14, 36, 0], focal: 1.2 }

function cameraModel() {
  const { position: C, target: T, focal: F } = CAMERA
  const aspect = FRAME.w / FRAME.h
  const sub = (a, b) => a.map((v, i) => v - b[i])
  const norm = (a) => a.map((v) => v / Math.hypot(...a))
  const cr = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ]
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const f = norm(sub(T, C))
  const r = norm(cr([0, 0, 1], f))
  const d = cr(r, f)
  const project = (x, y, z = 0) => {
    const X = sub([x, y, z], C)
    const depth = dot(X, f)
    return { x: 0.5 + (F * dot(X, r)) / depth, y: 0.5 + (F * aspect * dot(X, d)) / depth }
  }
  // Гомография для точек земли (z = 0): строки w, u·w, v·w.
  const rowW = [f[0], f[1], -dot(f, C)]
  const rowR = [r[0], r[1], -dot(r, C)]
  const rowD = [d[0], d[1], -dot(d, C)]
  const H = [
    ...rowW.map((v, i) => 0.5 * v + F * rowR[i]),
    ...rowW.map((v, i) => 0.5 * v + F * aspect * rowD[i]),
    ...rowW
  ]
  return { project, H }
}

/** Кадр поля, нарисованный в Chrome: возвращает PNG и описание опорных точек. */
async function drawPitchFrame(page) {
  const { project, H } = cameraModel()
  const L = PITCH.length
  const W = PITCH.width
  const y0 = (W - 40.32) / 2
  const y1 = y0 + 40.32
  const ga0 = (W - 18.32) / 2
  const ga1 = ga0 + 18.32
  // Данные уходят в страницу как числа: ссылки на функции node там не работают.
  const world = (x, y, z = 0) => {
    const p = project(x, y, z)
    return [p.x * FRAME.w, p.y * FRAME.h]
  }
  const arc = (cx, cy, rad, a0, a1, n) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / n
      return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)]
    })
  const half = Math.acos(5.5 / 9.15)
  const lines = [
    [
      [0, 0],
      [L, 0],
      [L, W],
      [0, W],
      [0, 0]
    ],
    [
      [L / 2, 0],
      [L / 2, W]
    ],
    arc(L / 2, W / 2, 9.15, 0, Math.PI * 2, 120),
    [
      [0, y0],
      [16.5, y0],
      [16.5, y1],
      [0, y1]
    ],
    [
      [0, ga0],
      [5.5, ga0],
      [5.5, ga1],
      [0, ga1]
    ],
    arc(11, W / 2, 9.15, -half, half, 40),
    [
      [L, y0],
      [L - 16.5, y0],
      [L - 16.5, y1],
      [L, y1]
    ],
    [
      [L, ga0],
      [L - 5.5, ga0],
      [L - 5.5, ga1],
      [L, ga1]
    ],
    arc(L - 11, W / 2, 9.15, Math.PI - half, Math.PI + half, 40),
    arc(0, 0, 1, 0, Math.PI / 2, 8),
    arc(0, W, 1, -Math.PI / 2, 0, 8),
    arc(L, 0, 1, Math.PI / 2, Math.PI, 8),
    arc(L, W, 1, Math.PI, (Math.PI * 3) / 2, 8)
  ]
  const players = [
    { x: 9, y: 34, shirt: '#d62839' },
    { x: 13.5, y: 22, shirt: '#1d4ed8' },
    { x: 6.5, y: 45, shirt: '#d62839' },
    { x: 2.2, y: 31, shirt: '#f2c200' }
  ]
  const spots = [
    [11, W / 2],
    [L / 2, W / 2],
    [L - 11, W / 2]
  ]
  const toPoint = ([x, y]) => {
    const p = project(x, y)
    return { world: { x, y }, image: { x: p.x, y: p.y } }
  }
  // Всё нужное для рисования — готовые координаты кадра.
  const draw = {
    frame: FRAME,
    stripes: Array.from({ length: 24 }, (_, i) => ({
      odd: i % 2 === 1,
      quad: [
        world(-12 + i * 5.5, -8),
        world(-12 + (i + 1) * 5.5, -8),
        world(-12 + (i + 1) * 5.5, W + 8),
        world(-12 + i * 5.5, W + 8)
      ]
    })),
    ribbons: lines.map((pts) => {
      const quads = []
      for (let i = 0; i + 1 < pts.length; i += 1) {
        const [ax, ay] = pts[i]
        const [bx, by] = pts[i + 1]
        const len = Math.hypot(bx - ax, by - ay)
        if (len === 0) continue
        const nx = (-(by - ay) / len) * 0.07
        const ny = ((bx - ax) / len) * 0.07
        // Чуть удлиняем отрезок, чтобы в углах не было щелей.
        const ex = ((bx - ax) / len) * 0.07
        const ey = ((by - ay) / len) * 0.07
        quads.push([
          world(ax - ex + nx, ay - ey + ny),
          world(bx + ex + nx, by + ey + ny),
          world(bx + ex - nx, by + ey - ny),
          world(ax - ex - nx, ay - ey - ny)
        ])
      }
      return quads
    }),
    spots: spots.map(([x, y]) => ({ c: world(x, y), rx: 5, ry: 2.2 })),
    goal: [
      [world(0, W / 2 - 3.66, 0), world(0, W / 2 - 3.66, 2.44)],
      [world(0, W / 2 + 3.66, 0), world(0, W / 2 + 3.66, 2.44)],
      [world(0, W / 2 - 3.66, 2.44), world(0, W / 2 + 3.66, 2.44)]
    ],
    players: players.map((p) => ({
      foot: world(p.x, p.y),
      head: world(p.x, p.y, 1.75),
      shirt: p.shirt
    }))
  }
  const dataUrl = await page.evaluate(async (d) => {
    const canvas = document.createElement('canvas')
    canvas.width = d.frame.w
    canvas.height = d.frame.h
    const ctx = canvas.getContext('2d')
    const grad = ctx.createLinearGradient(0, 0, 0, d.frame.h)
    grad.addColorStop(0, '#1b4a2b')
    grad.addColorStop(1, '#236a38')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, d.frame.w, d.frame.h)
    const poly = (pts, fill) => {
      ctx.beginPath()
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)))
      ctx.closePath()
      ctx.fillStyle = fill
      ctx.fill()
    }
    for (const s of d.stripes) poly(s.quad, s.odd ? '#2c8a47' : '#277d41')
    ctx.globalAlpha = 0.96
    for (const quads of d.ribbons) for (const q of quads) poly(q, '#f4f6f2')
    ctx.globalAlpha = 1
    for (const s of d.spots) {
      ctx.beginPath()
      ctx.ellipse(s.c[0], s.c[1], s.rx, s.ry, 0, 0, Math.PI * 2)
      ctx.fillStyle = '#f4f6f2'
      ctx.fill()
    }
    ctx.strokeStyle = '#f2f2f2'
    ctx.lineWidth = 3.5
    ctx.lineCap = 'round'
    for (const [a, b] of d.goal) {
      ctx.beginPath()
      ctx.moveTo(a[0], a[1])
      ctx.lineTo(b[0], b[1])
      ctx.stroke()
    }
    // Игроки: тень на земле, ноги, туловище и голова.
    for (const p of d.players) {
      ctx.beginPath()
      ctx.ellipse(p.foot[0], p.foot[1], 11, 4, 0, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(0,0,0,0.28)'
      ctx.fill()
      const h = p.foot[1] - p.head[1]
      ctx.strokeStyle = '#1b1f2a'
      ctx.lineWidth = Math.max(3, h * 0.12)
      ctx.beginPath()
      ctx.moveTo(p.foot[0], p.foot[1])
      ctx.lineTo(p.foot[0], p.foot[1] - h * 0.45)
      ctx.stroke()
      ctx.strokeStyle = p.shirt
      ctx.lineWidth = Math.max(5, h * 0.3)
      ctx.beginPath()
      ctx.moveTo(p.foot[0], p.foot[1] - h * 0.42)
      ctx.lineTo(p.foot[0], p.foot[1] - h * 0.82)
      ctx.stroke()
      ctx.beginPath()
      ctx.arc(p.head[0], p.head[1] + h * 0.07, Math.max(3, h * 0.09), 0, Math.PI * 2)
      ctx.fillStyle = '#e8b896'
      ctx.fill()
    }
    return canvas.toDataURL('image/png')
  }, draw)
  const info = {
    video: 'pitch.mp4',
    frame: FRAME,
    fps: 25,
    duration: 3,
    pitch: PITCH,
    camera: CAMERA,
    note: 'H: поле (x, y, 1) в метрах → (u·w, v·w, w), u и v — доли ширины и высоты кадра.',
    H,
    points: {
      penaltyArea: [
        [0, y0],
        [16.5, y0],
        [16.5, y1],
        [0, y1]
      ].map(toPoint),
      goalArea: [
        [0, ga0],
        [5.5, ga0],
        [5.5, ga1],
        [0, ga1]
      ].map(toPoint),
      penaltySpot: toPoint([11, W / 2]),
      centreSpot: toPoint([L / 2, W / 2])
    },
    players: players.map((p) => ({ world: { x: p.x, y: p.y }, shirt: p.shirt }))
  }
  return { png: Buffer.from(dataUrl.split(',')[1], 'base64'), info }
}

async function makePitch() {
  const ffmpeg = createRequire(import.meta.url)('ffmpeg-static')
  if (!ffmpeg) throw new Error('ffmpeg-static не нашёл ffmpeg для этой системы')
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage()
    await page.goto('about:blank')
    const { png, info } = await drawPitchFrame(page)
    const pngPath = join(OUT, 'pitch.frame.png')
    writeFileSync(pngPath, png)
    execFileSync(
      ffmpeg,
      [
        ...['-y', '-hide_banner', '-loglevel', 'error'],
        ...['-loop', '1', '-framerate', '25', '-i', pngPath],
        ...['-t', '3', '-r', '25', '-vf', 'format=yuv420p'],
        ...['-c:v', 'libx264', '-profile:v', 'main', '-preset', 'slow', '-crf', '20', '-g', '25'],
        ...['-an', '-movflags', '+faststart', join(OUT, 'pitch.mp4')]
      ],
      { stdio: 'inherit' }
    )
    rmSync(pngPath)
    writeFileSync(join(OUT, 'pitch.json'), JSON.stringify(info, null, 2) + '\n', 'utf8')
    const kb = (statSync(join(OUT, 'pitch.mp4')).size / 1024).toFixed(0)
    console.log(`pitch.mp4: ${kb} КБ, pitch.json: создан`)
  } finally {
    await browser.close()
  }
}

// ---------- Газон с игроками ----------
export const PLAYERS = {
  frame: { w: 640, h: 360 },
  grass: '#2a7d3e',
  stripe: '#2f8c47',
  line: { y: 300, h: 4, color: '#f2f4ee' },
  // Тело (x, y — левый верхний угол) и голова над ним.
  players: [
    { name: 'red', x: 120, y: 130, w: 44, h: 120, color: '#d62839' },
    { name: 'blue', x: 300, y: 150, w: 44, h: 110, color: '#1d4ed8' },
    { name: 'yellow', x: 480, y: 110, w: 44, h: 130, color: '#f2c200' }
  ],
  head: { h: 22, color: '#e8b896' }
}

function makePlayers() {
  const ffmpeg = createRequire(import.meta.url)('ffmpeg-static')
  if (!ffmpeg) throw new Error('ffmpeg-static не нашёл ffmpeg для этой системы')
  const { frame, grass, stripe, line, players, head } = PLAYERS
  const box = (x, y, w, h, color) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=fill`
  const filters = []
  // Светлые полосы газона: цвет тот же, меняется яркость (как у настоящего поля).
  for (let x = 0; x < frame.w; x += 160) filters.push(box(x, 0, 80, frame.h, stripe))
  filters.push(box(0, line.y, frame.w, line.h, line.color))
  for (const p of players) {
    filters.push(box(p.x, p.y, p.w, p.h, p.color))
    filters.push(box(p.x + p.w / 4, p.y - head.h, p.w / 2, head.h, head.color))
  }
  // Шум и сжатие: края и трава — как у настоящего видео, а не идеальные.
  filters.push('noise=alls=6:allf=u:all_seed=5', 'format=yuv420p')
  execFileSync(
    ffmpeg,
    [
      ...['-y', '-hide_banner', '-loglevel', 'error'],
      ...['-f', 'lavfi', '-i', `color=c=${grass}:s=${frame.w}x${frame.h}:r=25:d=3`],
      ...['-vf', filters.join(',')],
      ...['-c:v', 'libx264', '-profile:v', 'main', '-preset', 'slow', '-crf', '18', '-g', '25'],
      ...['-r', '25', '-an', '-movflags', '+faststart', join(OUT, 'players.mp4')]
    ],
    { stdio: 'inherit' }
  )
  writeFileSync(join(OUT, 'players.json'), JSON.stringify(PLAYERS, null, 2) + '\n', 'utf8')
  console.log(`players.mp4: ${(statSync(join(OUT, 'players.mp4')).size / 1024).toFixed(0)} КБ`)
}

// ---------- Бегущая фигурка (слежение за игроком) ----------
export const RUNNER = {
  frame: { w: 640, h: 360 },
  fps: 25,
  seconds: 3,
  grass: '#2a7d3e',
  /** Смена плана: с этого момента кадр серый и игроков нет. */
  cutAt: 2.4,
  // Рамки фигур в долях кадра; бегун: x(t) = x0 + speed · t, t — середина кадра.
  runner: { x0: 0.05, y: 0.4, w: 0.06, h: 0.34, speed: 0.25, color: '#d62839' },
  blue: { x: 0.42, y: 0.36, w: 0.06, h: 0.34, color: '#1d4ed8' },
  yellow: { x: 0.8, y: 0.45, w: 0.06, h: 0.34, color: '#f2c200' },
  skin: '#e8b896',
  cutColor: '#4a4f5a'
}

/** Слой с фигурой человека (голова, туловище, две ноги) на прозрачном фоне: w × h пикселей. */
function figureLayer(w, h, color, skin, seconds, fps) {
  const hex = (c) => '0x' + c.slice(1)
  const head = Math.round(h * 0.22)
  const torsoTop = Math.round(h * 0.25)
  const legsTop = Math.round(h * 0.68)
  const leg = Math.round(w * 0.4)
  const headW = Math.round(w * 0.5)
  const box = (x, y, bw, bh, c) => `drawbox=x=${x}:y=${y}:w=${bw}:h=${bh}:color=${hex(c)}:t=fill`
  return [
    `color=c=0xFF00FF:s=${w}x${h}:r=${fps}:d=${seconds}`,
    box(Math.round((w - headW) / 2), 0, headW, head, skin),
    box(0, torsoTop, w, legsTop - torsoTop, color),
    box(0, legsTop, leg, h - legsTop, color),
    box(w - leg, legsTop, leg, h - legsTop, color),
    // Фон фигуры (пурпурный) — прозрачный.
    'format=rgba',
    'colorkey=0xFF00FF:0.01:0'
  ].join(',')
}

function makeRunner() {
  const ffmpeg = createRequire(import.meta.url)('ffmpeg-static')
  if (!ffmpeg) throw new Error('ffmpeg-static не нашёл ffmpeg для этой системы')
  const { frame, fps, seconds, grass, cutAt, runner, blue, yellow, skin, cutColor } = RUNNER
  const px = (v, total) => Math.round(v * total)
  const size = (f) => [px(f.w, frame.w), px(f.h, frame.h)]
  const [rw, rh] = size(runner)
  const [bw, bh] = size(blue)
  const [yw, yh] = size(yellow)
  // Бегун: левый край = ширина кадра · (x0 + скорость · время середины кадра); t в overlay — начало кадра, середина = t + 0,5/fps.
  const runnerX = `${frame.w}*(${runner.x0}+${runner.speed}*(t+${0.5 / fps}))`
  const graph = [
    `[0:v][1:v]overlay=x='${runnerX}':y=${px(runner.y, frame.h)}:eval=frame[a]`,
    `[a][2:v]overlay=x=${px(blue.x, frame.w)}:y=${px(blue.y, frame.h)}[b]`,
    `[b][3:v]overlay=x=${px(yellow.x, frame.w)}:y=${px(yellow.y, frame.h)}[c]`,
    `[c]drawbox=x=0:y=0:w=${frame.w}:h=${frame.h}:color=${'0x' + cutColor.slice(1)}:t=fill:enable='gte(t,${cutAt})',format=yuv420p[v]`
  ].join(';')
  execFileSync(
    ffmpeg,
    [
      ...['-y', '-hide_banner', '-loglevel', 'error'],
      ...['-f', 'lavfi', '-i', `color=c=${grass}:s=${frame.w}x${frame.h}:r=${fps}:d=${seconds}`],
      ...['-f', 'lavfi', '-i', figureLayer(rw, rh, runner.color, skin, seconds, fps)],
      ...['-f', 'lavfi', '-i', figureLayer(bw, bh, blue.color, skin, seconds, fps)],
      ...['-f', 'lavfi', '-i', figureLayer(yw, yh, yellow.color, skin, seconds, fps)],
      ...['-filter_complex', graph, '-map', '[v]'],
      ...['-c:v', 'libx264', '-profile:v', 'main', '-preset', 'slow', '-crf', '16', '-g', '25'],
      ...['-r', String(fps), '-an', '-movflags', '+faststart', join(OUT, 'runner.mp4')]
    ],
    { stdio: 'inherit' }
  )
  writeFileSync(join(OUT, 'runner.json'), JSON.stringify(RUNNER, null, 2) + '\n', 'utf8')
  console.log(`runner.mp4: ${(statSync(join(OUT, 'runner.mp4')).size / 1024).toFixed(0)} КБ`)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const mode = process.argv[2] ?? 'all'
  if (mode === 'pitch') return makePitch()
  if (mode === 'players') return makePlayers()
  if (mode === 'runner') return makeRunner()
  if (mode === 'all' || mode === 'cfr') makeCfr()
  if (mode === 'all') makePlayers()
  if (mode === 'all') makeRunner()
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
  if (mode === 'all') await makePitch()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
