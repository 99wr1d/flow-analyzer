// Замеры производительности FlowAnalyzer на длинных матчах (npm run bench). НЕ часть обычного npm run test:e2e.
//
// Подготовка:  node scripts/make-bench.mjs <папка> all     (создаёт 90-минутное 1080p и 10-минутное 4K видео)
// Запуск:      FLOW_BENCH_DIR=<папка> FLOW_BENCH_LABEL=after npm run bench
// Переменные:  FLOW_BENCH_OUT — файл с результатами (JSON), FLOW_BENCH_ONLY=machine,video,uhd,scale,library,export,soak — часть замеров,
//              FLOW_BENCH_PLAY_SEC (по умолчанию 60) — длина воспроизведения, FLOW_BENCH_SOAK_MIN (по умолчанию 10), FLOW_BENCH_EXCERPT_SEC (отрывок для экспорта с рисунками, по умолчанию 120).
// Окна, как и в e2e, открываются за пределами экрана; все данные — во временных папках.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import { cpus, totalmem } from 'os'
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import ffmpegPath from 'ffmpeg-static'
import { launch, makeUserData, stubDialog } from '../e2e/helpers'
import { seedLibrary } from '../e2e/startHelpers'
import { generateThumb, thumbFile, thumbTime } from '../../src/main/library/thumbs'
import { benchProject, writeBenchProject } from './gen'
import { installProbe, takeProbe, type Cond } from './probe'
import { record, summarize } from './results'

const DIR = process.env.FLOW_BENCH_DIR
const ONLY = process.env.FLOW_BENCH_ONLY?.split(',') ?? null
const PLAY_SEC = Number(process.env.FLOW_BENCH_PLAY_SEC ?? 60)
const EXCERPT_SEC = Number(process.env.FLOW_BENCH_EXCERPT_SEC ?? 120)
const SOAK_MIN = Number(process.env.FLOW_BENCH_SOAK_MIN ?? 10)

const LONG = DIR ? join(DIR, 'bench-1080p-90min.mp4') : ''
const UHD = DIR ? join(DIR, 'bench-4k-10min.mp4') : ''
const LONG_SEC = 5400
const UHD_SEC = 600

const enabled = (name: string): boolean => (ONLY ? ONLY.includes(name) : true)
const SCRATCH = DIR ? join(DIR, 'work') : ''

test.skip(
  !DIR || !existsSync(LONG),
  'Задайте FLOW_BENCH_DIR (папка с видео из scripts/make-bench.mjs)'
)

const BENCH_ENV: Record<string, string> = { FLOW_BENCH: '1' }

type TimeBox = { __t: Record<string, number> }

async function openVideoTimed(app: ElectronApplication, win: Page, video: string): Promise<number> {
  await stubDialog(app, video)
  await win.evaluate(() => {
    const w = window as unknown as TimeBox
    w.__t = {}
    document.addEventListener('click', () => (w.__t.click = performance.now()), {
      capture: true,
      once: true
    })
    document.addEventListener('loadeddata', () => (w.__t.frame = performance.now()), {
      capture: true,
      once: true
    })
  })
  await win.getByTestId('open-video').click()
  await win.waitForFunction(() => (window as unknown as TimeBox).__t.frame !== undefined, null, {
    timeout: 120_000
  })
  await expect(win.getByTestId('play-toggle')).toBeEnabled()
  return win.evaluate(() => {
    const t = (window as unknown as TimeBox).__t
    return t.frame - t.click
  })
}

async function seekTests(win: Page, duration: number, section: string): Promise<void> {
  const ms = await win.evaluate(async (d) => {
    const v = document.querySelector('video')!
    v.pause()
    let s = 12345
    const rnd = (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
    const out: number[] = []
    for (let i = 0; i < 20; i += 1) {
      const t = 1 + rnd() * (d - 2)
      const t0 = performance.now()
      await new Promise<void>((res) => {
        v.addEventListener('seeked', () => res(), { once: true })
        v.currentTime = t
      })
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      out.push(performance.now() - t0)
      await new Promise((r) => setTimeout(r, 120))
    }
    return out
  }, duration)
  record(section, 'seek_x20_ms', summarize(ms))

  // Перемотка щелчком по линейке (весь путь: указатель, приложение, видео, seeked, отрисовка).
  await installProbe(win)
  const ruler = (await win.getByTestId('ruler').boundingBox())!
  const ui: number[] = []
  for (let i = 0; i < 10; i += 1) {
    const name = `ui${i}`
    await win.evaluate((n) => window.__p!.arm(n, 'pointerdown', { id: '', mode: 'seeked' }), name)
    await win.mouse.click(ruler.x + ruler.width * (0.05 + 0.09 * i), ruler.y + ruler.height / 2)
    ui.push((await takeProbe(win, name)).paint)
    await win.waitForTimeout(120)
  }
  record(section, 'seek_ruler_click_x10_ms', summarize(ui))
}

async function stepTests(win: Page, section: string): Promise<void> {
  await win.evaluate(() => {
    const v = document.querySelector('video')!
    v.pause()
    v.currentTime = 120
  })
  await win.waitForTimeout(500)
  await installProbe(win)
  const ms: number[] = []
  for (let i = 0; i < 50; i += 1) {
    const name = `step${i}`
    await win.evaluate((n) => window.__p!.arm(n, 'keydown', { id: '', mode: 'seeked' }), name)
    await win.keyboard.press(i % 10 < 8 ? 'ArrowRight' : 'ArrowLeft')
    ms.push((await takeProbe(win, name)).paint)
    await win.waitForTimeout(40)
  }
  record(section, 'frame_step_x50_ms', summarize(ms))
}

type PlayBox = {
  __q0: { total: number; dropped: number; t: number }
  __long: number[]
  __po: PerformanceObserver
}

async function playbackTest(win: Page, section: string, rate: number): Promise<void> {
  await win.evaluate(async (r) => {
    const v = document.querySelector('video')!
    v.pause()
    await new Promise<void>((res) => {
      v.addEventListener('seeked', () => res(), { once: true })
      v.currentTime = 300
    })
    v.playbackRate = r
    const w = window as unknown as PlayBox
    w.__long = []
    w.__po = new PerformanceObserver((list) =>
      list.getEntries().forEach((e) => w.__long.push(e.duration))
    )
    w.__po.observe({ entryTypes: ['longtask'] })
    const q = v.getVideoPlaybackQuality()
    w.__q0 = { total: q.totalVideoFrames, dropped: q.droppedVideoFrames, t: v.currentTime }
    await v.play()
  }, rate)
  await win.waitForTimeout(PLAY_SEC * 1000)
  const r = await win.evaluate(() => {
    const v = document.querySelector('video')!
    const q = v.getVideoPlaybackQuality()
    const w = window as unknown as PlayBox
    w.__po.disconnect()
    v.pause()
    return {
      frames: q.totalVideoFrames - w.__q0.total,
      dropped: q.droppedVideoFrames - w.__q0.dropped,
      advanced: Math.round((v.currentTime - w.__q0.t) * 10) / 10,
      longTasks: w.__long.length,
      longTaskMaxMs: Math.round(Math.max(0, ...w.__long))
    }
  })
  record(section, `playback_${rate}x_${PLAY_SEC}s`, {
    ...r,
    droppedPercent: r.frames > 0 ? Math.round((r.dropped / r.frames) * 1000) / 10 : null
  })
}

async function memory(app: ElectronApplication, win: Page): Promise<Record<string, number>> {
  const procs = await app.evaluate(({ app: a }) =>
    a.getAppMetrics().map((m) => ({ type: m.type, ws: m.memory.workingSetSize }))
  )
  const heap = await win.evaluate(() => {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    return m ? m.usedJSHeapSize : 0
  })
  const sum = (types: string[]): number =>
    Math.round(procs.filter((p) => types.includes(p.type)).reduce((a, p) => a + p.ws, 0) / 1024)
  return {
    rendererMB: sum(['Tab']),
    mainMB: sum(['Browser']),
    gpuMB: sum(['GPU']),
    totalMB: sum(procs.map((p) => p.type)),
    jsHeapMB: Math.round(heap / 1048576)
  }
}

test('машина', async () => {
  test.skip(!enabled('machine'))
  const { app } = await launch({ env: BENCH_ENV })
  try {
    const gpu = await app.evaluate(async ({ app: a }) => a.getGPUInfo('basic').catch(() => null))
    const versions = await app.evaluate(() => ({ ...process.versions }))
    const devices = (
      gpu as {
        gpuDevice?: Array<{ vendorId: number; deviceId: number; active?: boolean }>
      } | null
    )?.gpuDevice
    record('machine', 'info', {
      cpu: cpus()[0].model.trim(),
      logicalCores: cpus().length,
      ramGB: Math.round(totalmem() / 2 ** 30),
      gpuDevices: devices ?? null,
      gpuRaw: gpu,
      electron: versions.electron,
      chromium: versions.chrome,
      node: versions.node,
      os: process.platform
    })
  } finally {
    await app.close()
  }
})

for (const [name, video, sec] of [
  ['video', LONG, LONG_SEC],
  ['uhd', UHD, UHD_SEC]
] as const) {
  test(`воспроизведение: ${name}`, async () => {
    test.skip(!enabled(name) || !existsSync(video))
    test.setTimeout(20 * 60_000)
    const { app, win } = await launch({ env: BENCH_ENV })
    const section = name === 'video' ? '1080p_90min' : '4k_10min'
    try {
      const open = await openVideoTimed(app, win, video)
      record(section, 'open_to_first_frame_ms', Math.round(open))
      await win.waitForTimeout(1500)
      record(section, 'memory_after_open', await memory(app, win))
      await seekTests(win, sec, section)
      await stepTests(win, section)
      await playbackTest(win, section, 1)
      await playbackTest(win, section, 2)
      record(section, 'memory_after_playback', await memory(app, win))
    } finally {
      await app.close()
    }
  })
}

test('масштаб проекта: 2000 эпизодов, 500 рисунков', async () => {
  test.skip(!enabled('scale'))
  test.setTimeout(20 * 60_000)
  const userData = makeUserData()
  const file = join(userData, 'Projects', 'Большой матч.flowproj')
  writeBenchProject(file, {
    video: LONG,
    duration: LONG_SEC,
    episodes: 2000,
    drawings: 500,
    animated: 20,
    title: 'Большой матч'
  })
  const section = 'scale_2000ep_500dr'
  record(section, 'project_file_bytes', statSync(file).size)
  const { app, win } = await launch({
    userData,
    env: { ...BENCH_ENV, FLOW_AUTOSAVE_MS: '3600000' }
  })
  try {
    await installProbe(win)
    await stubDialog(app, file)
    await win.evaluate(() => {
      const w = window as unknown as TimeBox
      w.__t = {}
      document.addEventListener('keydown', () => (w.__t.key = performance.now()), {
        capture: true,
        once: true
      })
      document.addEventListener('loadeddata', () => (w.__t.frame = performance.now()), {
        capture: true,
        once: true
      })
    })
    await win.evaluate(() =>
      window.__p!.arm('open', 'keydown', { id: 'episode-count', mode: 'text', value: '2000' })
    )
    await win.keyboard.press('Control+Shift+KeyO')
    const open = await takeProbe(win, 'open')
    record(section, 'open_project_data_shown_ms', Math.round(open.paint))
    await win.waitForFunction(() => (window as unknown as TimeBox).__t.frame !== undefined, null, {
      timeout: 120_000
    })
    record(
      section,
      'open_project_video_frame_ms',
      Math.round(
        await win.evaluate(() => {
          const t = (window as unknown as TimeBox).__t
          return t.frame - t.key
        })
      )
    )
    await expect(win.getByTestId('play-toggle')).toBeEnabled()
    await win.waitForTimeout(1500)
    record(section, 'memory_after_open', await memory(app, win))
    const snap = await win.evaluate(() => window.__flowTest!.snapshot!())
    record(section, 'snapshot_build', { ms: Math.round(snap.ms * 10) / 10, jsonBytes: snap.bytes })

    // Горячая клавиша тега: от нажатия до появления эпизода.
    await win.evaluate(() => {
      const v = document.querySelector('video')!
      v.pause()
      v.currentTime = 2000
    })
    await win.waitForTimeout(800)
    const tag: number[] = []
    for (let i = 0; i < 12; i += 1) {
      const name = `tag${i}`
      await win.evaluate(
        ([n, c]) =>
          window.__p!.arm(n as string, 'keydown', {
            id: 'episode-count',
            mode: 'text',
            value: String(c)
          }),
        [name, 2001 + i] as const
      )
      await win.keyboard.press(`Digit${(i % 9) + 1}`)
      tag.push((await takeProbe(win, name)).paint)
      await win.waitForTimeout(150)
    }
    record(section, 'tag_hotkey_x12_ms', summarize(tag))

    // Отмена.
    const undo: number[] = []
    for (let i = 0; i < 6; i += 1) {
      const name = `undo${i}`
      await win.evaluate(
        ([n, c]) =>
          window.__p!.arm(n as string, 'keydown', {
            id: 'episode-count',
            mode: 'text',
            value: String(c)
          }),
        [name, 2011 - i] as const
      )
      await win.keyboard.press('Control+KeyZ')
      undo.push((await takeProbe(win, name)).paint)
      await win.waitForTimeout(150)
    }
    record(section, 'undo_x6_ms', summarize(undo))

    // Фильтр по тегу: перерисовка списка эпизодов и дорожки таймлайна.
    const chips = win.getByTestId('filter-chip')
    const filt: number[] = []
    for (let i = 0; i < 4; i += 1) {
      const name = `filt${i}`
      const cond: Cond =
        i % 2 === 0
          ? { id: 'filter-reset', mode: 'present' }
          : { id: 'filter-reset', mode: 'absent' }
      await win.evaluate(([n, c]) => window.__p!.arm(n as string, 'click', c as Cond), [
        name,
        cond
      ] as const)
      if (i % 2 === 0) await chips.first().click()
      else await win.getByTestId('filter-reset').click()
      filt.push((await takeProbe(win, name)).paint)
      await win.waitForTimeout(150)
    }
    record(section, 'filter_toggle_x4_ms', summarize(filt))

    // Прокрутка списка эпизодов: время кадра.
    const scroll = await win.evaluate(async () => {
      const list = document.querySelector('[data-testid="episode-list"]') as HTMLElement
      let el: HTMLElement | null = list
      while (
        el &&
        !(
          el.scrollHeight > el.clientHeight + 5 &&
          /(auto|scroll)/.test(getComputedStyle(el).overflowY)
        )
      ) {
        el = el.parentElement
      }
      const rows = list.querySelectorAll('li').length
      if (!el) return { frames: 0, mean: 0, p95: 0, max: 0, over50: 0, scrollHeight: 0, rows }
      const deltas: number[] = []
      let last = performance.now()
      for (let i = 0; i < 120; i += 1) {
        el.scrollTop += 500
        await new Promise((r) => requestAnimationFrame(() => r(null)))
        const now = performance.now()
        deltas.push(now - last)
        last = now
      }
      deltas.sort((a, b) => a - b)
      return {
        frames: deltas.length,
        mean: Math.round((deltas.reduce((a, b) => a + b, 0) / deltas.length) * 10) / 10,
        p95: Math.round(deltas[Math.floor(deltas.length * 0.95)] * 10) / 10,
        max: Math.round(deltas[deltas.length - 1] * 10) / 10,
        over50: deltas.filter((d) => d > 50).length,
        scrollHeight: el.scrollHeight,
        rows
      }
    })
    record(section, 'episode_list_scroll_frame_ms', scroll)

    // Окно статистики.
    const stats: number[] = []
    for (let i = 0; i < 3; i += 1) {
      const name = `stats${i}`
      await win.evaluate(
        (n) => window.__p!.arm(n, 'keydown', { id: 'stats-kpis', mode: 'present' }),
        name
      )
      await win.keyboard.press('Control+KeyI')
      stats.push((await takeProbe(win, name)).paint)
      await win.keyboard.press('Escape')
      await expect(win.getByTestId('stats-dialog')).toHaveCount(0)
      await win.waitForTimeout(200)
    }
    record(section, 'stats_open_x3_ms', summarize(stats))

    // Сохранение: Ctrl+S (проект уже с путём, диалога нет).
    const saves: number[] = []
    for (let i = 0; i < 3; i += 1) {
      await win.keyboard.press(`Digit${i + 1}`)
      await expect(win.getByTestId('project-dirty')).toBeVisible()
      const name = `save${i}`
      await win.evaluate(
        (n) => window.__p!.arm(n, 'keydown', { id: 'project-dirty', mode: 'absent' }),
        name
      )
      await win.keyboard.press('Control+KeyS')
      saves.push((await takeProbe(win, name)).paint)
      await win.waitForTimeout(300)
    }
    record(section, 'save_ctrl_s_x3_ms', summarize(saves))
    record(section, 'saved_file_bytes', statSync(file).size)

    // Автосохранение (копия работы): сборка снимка и IPC.
    const auto: Array<{ buildMs: number; totalMs: number }> = []
    for (let i = 0; i < 3; i += 1) {
      auto.push(await win.evaluate(() => window.__flowTest!.autosave!()))
    }
    record(section, 'autosave_build_ms', summarize(auto.map((a) => a.buildMs)))
    record(section, 'autosave_total_ms', summarize(auto.map((a) => a.totalMs)))

    // Воспроизведение при большом проекте: рисунки, дорожки, подписки.
    await playbackTest(win, section, 1)
  } finally {
    await app.close()
  }

  // Запуск приложения сразу с файлом проекта.
  const second = await launch({ userData, args: [file], env: BENCH_ENV })
  try {
    await second.win.waitForFunction(
      () => document.querySelector('[data-testid="episode-count"]')?.textContent === '2009',
      null,
      { timeout: 60_000 }
    )
    const t = await second.win.evaluate(() => performance.now())
    record(section, 'launch_with_project_until_episodes_shown_ms', Math.round(t))
  } finally {
    await second.app.close()
  }
})

test('библиотека: 200 проектов', async () => {
  test.skip(!enabled('library'))
  test.setTimeout(30 * 60_000)
  const userData = makeUserData()
  const projects: string[] = []
  for (let i = 0; i < 200; i += 1) {
    const p = join(userData, 'Projects', `Матч ${String(i + 1).padStart(3, '0')}.flowproj`)
    writeBenchProject(p, {
      video: LONG,
      duration: LONG_SEC,
      episodes: 5 + (i % 40),
      drawings: i % 10,
      title: `Матч ${i + 1}`,
      seed: i + 7
    })
    projects.push(p)
  }
  seedLibrary(userData, projects)

  // Эскизы: ровно так же, как при сохранении проекта (ffmpeg, -ss до -i), по очереди.
  const t0 = Date.now()
  for (const [i, p] of projects.entries()) {
    await generateThumb({
      ffmpegPath: ffmpegPath as string,
      videoPath: LONG,
      time: thumbTime(600 + (i % 50) * 60, LONG_SEC),
      out: thumbFile(userData, p)
    })
  }
  const thumbTotal = Date.now() - t0
  record('library_200', 'thumbnails_generated', {
    count: readdirSync(join(userData, 'thumbs')).length,
    totalMs: thumbTotal,
    perThumbMs: Math.round(thumbTotal / 200)
  })

  const { app, win } = await launch({ userData, env: BENCH_ENV })
  try {
    await win.waitForFunction(
      () => document.querySelectorAll('[data-testid="project-card"]').length >= 200,
      null,
      { timeout: 120_000 }
    )
    record(
      'library_200',
      'start_screen_200_cards_since_page_load_ms',
      Math.round(await win.evaluate(() => performance.now()))
    )
    const list = await win.evaluate(async () => {
      const out: number[] = []
      let cards = 0
      let thumbBytes = 0
      for (let i = 0; i < 3; i += 1) {
        const t = performance.now()
        const r = await window.api.listLibrary()
        out.push(performance.now() - t)
        cards = r.cards.length
        thumbBytes = r.cards.reduce((a, c) => a + (c.thumb ? c.thumb.byteLength : 0), 0)
      }
      return { out, cards, thumbBytes }
    })
    record('library_200', 'listLibrary_ipc_x3_ms', summarize(list.out))
    record('library_200', 'listing', { cards: list.cards, thumbBytes: list.thumbBytes })

    // Возврат на стартовый экран из проекта: до появления карточек.
    await win.getByTestId('project-card').first().click()
    await expect(win.getByTestId('play-toggle')).toBeEnabled({ timeout: 60_000 })
    await installProbe(win)
    await win.evaluate(() =>
      window.__p!.arm('home', 'click', { id: 'project-card', mode: 'count', value: 200 })
    )
    await win.getByTestId('go-home').click()
    record('library_200', 'home_to_200_cards_ms', Math.round((await takeProbe(win, 'home')).paint))
  } finally {
    await app.close()
  }
})

function makeExcerpt(): string {
  mkdirSync(SCRATCH, { recursive: true })
  const out = join(SCRATCH, `bench-1080p-${EXCERPT_SEC}s.mp4`)
  if (!existsSync(out)) {
    execFileSync(
      ffmpegPath as string,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        '1200',
        '-t',
        String(EXCERPT_SEC),
        '-i',
        LONG,
        '-c',
        'copy',
        '-y',
        out
      ],
      { windowsHide: true }
    )
  }
  return out
}

test('экспорт', async () => {
  test.skip(!enabled('export'))
  test.setTimeout(60 * 60_000)
  const userData = makeUserData()
  const out = join(userData, 'out')
  mkdirSync(out, { recursive: true })

  // 1) 10 отдельных точных клипов по 10 секунд; 2) подборка из 20 эпизодов по 10 секунд, разнесённых по 90 минутам.
  const proj = join(userData, 'Projects', 'Экспорт.flowproj')
  const base = JSON.parse(
    benchProject({ video: LONG, duration: LONG_SEC, episodes: 20, drawings: 0, title: 'Экспорт' })
  ) as { episodes: Array<{ start: number; end: number }> }
  base.episodes.forEach((e, i) => {
    e.start = 120 + i * 255
    e.end = e.start + 10
  })
  mkdirSync(join(userData, 'Projects'), { recursive: true })
  writeFileSync(proj, JSON.stringify(base), 'utf8')

  const { app, win } = await launch({ userData, args: [proj], env: BENCH_ENV })
  try {
    await expect(win.getByTestId('episode-count')).toHaveText('20', { timeout: 60_000 })
    await expect(win.getByTestId('play-toggle')).toBeEnabled()
    await stubDialog(app, out)

    await win.keyboard.press('Control+KeyE')
    await win.getByTestId('export-scope-pick').check()
    await win.getByTestId('export-pick-none').click()
    for (let i = 0; i < 10; i += 1) await win.getByTestId('export-pick-row').nth(i).check()
    await win.getByTestId('export-mode-files').check()
    await win.getByTestId('export-padding').fill('0')
    const t0 = Date.now()
    await win.getByTestId('export-start').click()
    await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 30 * 60_000 })
    const filesMs = Date.now() - t0
    record('export', 'files_10x10s_precise', {
      ms: filesMs,
      encodeFps: Math.round((10 * 10 * 25) / (filesMs / 1000)),
      status: await win.getByTestId('export-result').getAttribute('data-status')
    })
    await win.getByTestId('export-done').click()

    await app.evaluate(
      ({ dialog }, p) => {
        dialog.showSaveDialog = (async () => ({
          canceled: false,
          filePath: p
        })) as unknown as typeof dialog.showSaveDialog
      },
      join(out, 'подборка.mp4')
    )
    await win.keyboard.press('Control+KeyE')
    await win.getByTestId('export-scope-all').check()
    await win.getByTestId('export-mode-compilation').check()
    await win.getByTestId('export-padding').fill('0')
    const t1 = Date.now()
    await win.getByTestId('export-start').click()
    await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 60 * 60_000 })
    const compMs = Date.now() - t1
    record('export', 'compilation_20x10s_spread_over_90min', {
      ms: compMs,
      encodeFps: Math.round((20 * 10 * 25) / (compMs / 1000)),
      status: await win.getByTestId('export-result').getAttribute('data-status'),
      bytes: statSync(join(out, 'подборка.mp4')).size
    })
    await win.getByTestId('export-done').click()
  } finally {
    await app.close()
  }

  // 3) «Всё видео» с рисунками: отрывок (по умолчанию 2 минуты, FLOW_BENCH_EXCERPT_SEC) с экстраполяцией на 90 минут.
  const excerpt = makeExcerpt()
  const proj2 = join(userData, 'Projects', 'Рисунки.flowproj')
  writeBenchProject(proj2, {
    video: excerpt,
    duration: EXCERPT_SEC,
    episodes: 5,
    drawings: 40,
    animated: 5,
    title: 'Рисунки'
  })
  const second = await launch({ userData, args: [proj2], env: BENCH_ENV })
  try {
    await expect(second.win.getByTestId('play-toggle')).toBeEnabled({ timeout: 60_000 })
    // «Всё видео» — режим отдельного файла в папку: подменяем выбор папки.
    await stubDialog(second.app, out)
    await second.win.keyboard.press('Control+KeyE')
    await second.win.getByTestId('export-scope-whole').check()
    const draw = second.win.getByTestId('export-drawings')
    if (!(await draw.isChecked())) await draw.check()
    const t2 = Date.now()
    await second.win.getByTestId('export-start').click()
    await expect(second.win.getByTestId('export-result')).toBeVisible({ timeout: 60 * 60_000 })
    const ms = Date.now() - t2
    record('export', 'whole_10min_with_drawings', {
      ms,
      encodeFps: Math.round((EXCERPT_SEC * 25) / (ms / 1000)),
      excerptSeconds: EXCERPT_SEC,
      extrapolated90minMinutes: Math.round((ms * (5400 / EXCERPT_SEC)) / 60000),
      status: await second.win.getByTestId('export-result').getAttribute('data-status')
    })
  } finally {
    await second.app.close()
  }
})

test('нагрузка: память после долгой работы', async () => {
  test.skip(!enabled('soak'))
  test.setTimeout((SOAK_MIN + 15) * 60_000)
  const userData = makeUserData()
  const file = join(userData, 'Projects', 'Нагрузка.flowproj')
  writeBenchProject(file, {
    video: LONG,
    duration: LONG_SEC,
    episodes: 600,
    drawings: 100,
    animated: 10,
    title: 'Нагрузка'
  })
  const { app, win } = await launch({
    userData,
    args: [file],
    env: { ...BENCH_ENV, FLOW_AUTOSAVE_MS: '5000' }
  })
  try {
    await expect(win.getByTestId('episode-count')).toHaveText('600', { timeout: 60_000 })
    await expect(win.getByTestId('play-toggle')).toBeEnabled()
    await win.waitForTimeout(2000)
    const samples: Array<Record<string, number>> = []
    const sample = async (minute: number): Promise<void> => {
      samples.push({ minute, ...(await memory(app, win)) })
    }
    await sample(0)
    const started = Date.now()
    let n = 0
    let lastSample = 0
    let s = 99
    const rnd = (): number => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
    while (Date.now() - started < SOAK_MIN * 60_000) {
      n += 1
      const t = Math.floor(rnd() * (LONG_SEC - 30))
      await win.evaluate(
        (x) =>
          new Promise<void>((res) => {
            const v = document.querySelector('video')!
            v.addEventListener('seeked', () => res(), { once: true })
            v.currentTime = x
          }),
        t
      )
      for (let k = 0; k < 8; k += 1) await win.keyboard.press(k < 6 ? 'ArrowRight' : 'ArrowLeft')
      await win.keyboard.press(`Digit${(n % 9) + 1}`)
      if (n % 3 === 0) await win.keyboard.press('Control+KeyZ')
      if (n % 5 === 0) {
        await win.getByTestId('stats-open').click()
        await expect(win.getByTestId('stats-dialog')).toBeVisible()
        await win.keyboard.press('Escape')
      }
      if (n % 4 === 0) await win.keyboard.press('Control+KeyS')
      if (n % 6 === 0) {
        await win.evaluate(() => {
          void document.querySelector('video')!.play()
        })
        await win.waitForTimeout(3000)
        await win.keyboard.press('Space')
      }
      await win.waitForTimeout(250)
      const minute = (Date.now() - started) / 60_000
      if (minute - lastSample >= 1) {
        lastSample = Math.floor(minute)
        await sample(Math.round(minute * 10) / 10)
      }
    }
    await sample(SOAK_MIN)
    record('soak', 'iterations', n)
    record('soak', 'memory_samples', samples)
  } finally {
    await app.close()
  }
})
