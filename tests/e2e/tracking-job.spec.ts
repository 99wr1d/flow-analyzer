// Задача слежения: настоящие ffmpeg и IPC, детектор — заглушка (FLOW_DETECTOR_STUB=1, сценарий по умолчанию: один игрок идёт вправо).
// Отмена и закрытие окна не оставляют ни процессов ffmpeg, ни окна-детектора, ни события «готово».
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { spawnSync } from 'child_process'
import { closeWindow, fixture, launch, makeUserData, stubDialog } from './helpers'

const VIDEO = fixture('players.mp4')
/** Игрок стандартного сценария заглушки в начале: рамка x 0.30–0.36, y 0.35–0.65. */
const ANCHOR = { x: 0.33, y: 0.5 }
const STUB_ENV = { FLOW_DETECTOR_STUB: '1' }

/** Сколько процессов ffmpeg сейчас читает наше тестовое видео (по командной строке). */
function ffmpegCount(): number {
  const script =
    "@(Get-CimInstance Win32_Process -Filter \"Name='ffmpeg.exe'\" | Where-Object { $_.CommandLine -like '*players.mp4*' }).Count"
  const r = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
  return Number((r.stdout ?? '').trim() || '0')
}

async function waitFor(check: () => boolean | Promise<boolean>, ms = 15_000): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('условие не выполнилось вовремя')
}

interface Seen {
  progress: Array<{ done: number; total: number }>
  ask: unknown[]
  done: Array<Record<string, unknown>>
}

/** Подписка в интерфейсе на события слежения и открытие видео; возвращает идентификатор видео. */
async function prepare(app: ElectronApplication, win: Page): Promise<string> {
  await stubDialog(app, VIDEO)
  return win.evaluate(async () => {
    const w = window as unknown as { __seen: Seen }
    w.__seen = { progress: [], ask: [], done: [] }
    window.api.onTrackingProgress((p) => w.__seen.progress.push(p))
    window.api.onTrackingAsk((a) => w.__seen.ask.push(a))
    window.api.onTrackingDone((d) => w.__seen.done.push(d as unknown as Record<string, unknown>))
    const source = await window.api.openVideoDialog()
    return source!.id
  })
}

const seen = (win: Page): Promise<Seen> =>
  win.evaluate(() => (window as unknown as { __seen: Seen }).__seen)

const start = (win: Page, videoId: string, anchor = ANCHOR, from = 0, to = 3): Promise<string> =>
  win.evaluate(async (a) => (await window.api.startTracking(a)).jobId, {
    videoId,
    from,
    to,
    anchor
  })

test('слежение по заглушке: отсчёт на каждый кадр, ход работы и итог', async () => {
  const { app, win } = await launch({ env: STUB_ENV })
  try {
    const id = await prepare(app, win)
    const jobId = await start(win, id)
    await waitFor(async () => (await seen(win)).done.length > 0)
    const s = await seen(win)
    expect(s.done).toHaveLength(1)
    const done = s.done[0] as {
      jobId: string
      samples: Array<{ t: number; foot: { x: number; y: number }; height: number }>
      stop: unknown
    }
    expect(done.jobId).toBe(jobId)
    expect(done.stop).toBeNull()
    expect(done.samples).toHaveLength(75)
    expect(done.samples[0].t).toBeCloseTo(0.5 / 25, 6)
    expect(done.samples[74].t).toBeCloseTo(74.5 / 25, 6)
    // рамка стандартного сценария: ноги посередине нижней кромки, высота 0,30
    expect(done.samples[0].foot.y).toBeCloseTo(0.65, 2)
    expect(done.samples[0].height).toBeCloseTo(0.3, 2)
    expect(done.samples[74].foot.x).toBeGreaterThan(done.samples[0].foot.x)
    expect(s.progress.at(-1)).toEqual({ jobId, done: 75, total: 75 })
    expect(ffmpegCount()).toBe(0)
    // после окончания можно начать новую задачу
    await start(win, id)
  } finally {
    await app.close()
  }
})

test('нет игрока под рисунком: итог no-player', async () => {
  const { app, win } = await launch({ env: STUB_ENV })
  try {
    const id = await prepare(app, win)
    await start(win, id, { x: 0.9, y: 0.9 })
    await waitFor(async () => (await seen(win)).done.length > 0)
    const s = await seen(win)
    expect(s.done[0]).toMatchObject({ error: 'no-player' })
    expect(ffmpegCount()).toBe(0)
  } finally {
    await app.close()
  }
})

test('вторая задача при идущей первой отклоняется; неверные запросы отклоняются', async () => {
  const { app, win } = await launch({ env: { ...STUB_ENV, FLOW_DETECTOR_STUB_DELAY_MS: '60' } })
  try {
    const id = await prepare(app, win)
    const jobId = await start(win, id)
    const second = await win.evaluate(
      (a) =>
        window.api.startTracking(a).then(
          () => 'ok',
          (e: Error) => e.message
        ),
      { videoId: id, from: 0, to: 3, anchor: ANCHOR }
    )
    expect(second).toMatch(/уже идёт/)
    const bad = await win.evaluate(() =>
      window.api.startTracking({ videoId: 'x', from: 2, to: 1, anchor: { x: 2, y: 0 } }).then(
        () => 'ok',
        (e: Error) => e.message
      )
    )
    expect(bad).not.toBe('ok')
    const wrongAnswer = await win.evaluate(
      (j) =>
        window.api.resolveTracking(j, 0).then(
          () => 'ok',
          (e: Error) => e.message
        ),
      jobId
    )
    expect(wrongAnswer).not.toBe('ok')
    await win.evaluate((j) => window.api.cancelTracking(j), jobId)
  } finally {
    await app.close()
  }
})

test('отмена посреди расчёта: ни события «готово», ни процессов ffmpeg', async () => {
  const { app, win } = await launch({ env: { ...STUB_ENV, FLOW_DETECTOR_STUB_DELAY_MS: '80' } })
  try {
    const id = await prepare(app, win)
    const jobId = await start(win, id)
    await waitFor(async () => (await seen(win)).progress.length >= 3)
    // ffmpeg действительно работает (иначе проверка «нет процессов» ничего не доказывает)
    expect(ffmpegCount()).toBeGreaterThan(0)
    await win.evaluate((j) => window.api.cancelTracking(j), jobId)
    // отмена возвращается, когда всё остановлено
    expect(ffmpegCount()).toBe(0)
    await win.waitForTimeout(1500)
    const s = await seen(win)
    expect(s.done).toHaveLength(0)
    expect(s.progress.at(-1)!.done).toBeLessThan(75)
    expect(ffmpegCount()).toBe(0)
    // и место свободно для новой задачи
    await start(win, id)
    await win.evaluate((j) => window.api.cancelTracking(j), jobId)
  } finally {
    await app.close()
  }
})

test('отмена с настоящим окном-детектором: окно закрыто, события «готово» нет', async () => {
  test.setTimeout(240_000)
  const { app, win } = await launch({
    env: { FLOW_DETECTOR_BACKEND: 'wasm', FLOW_DETECTOR_LOAD_DELAY_MS: '30000' }
  })
  try {
    const windows = (): Promise<number> =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    const before = await windows()
    const id = await prepare(app, win)
    const jobId = await start(win, id)
    // окно-детектор появилось
    await waitFor(async () => (await windows()) === before + 1, 60_000)
    // отмена посреди загрузки модели: возвращается быстро (не ждёт готовности детектора), окно уже уничтожено
    const t0 = Date.now()
    await win.evaluate((j) => window.api.cancelTracking(j), jobId)
    expect(Date.now() - t0).toBeLessThan(3000)
    expect(await windows()).toBe(before)
    await win.waitForTimeout(1000)
    expect((await seen(win)).done).toHaveLength(0)
    expect(ffmpegCount()).toBe(0)
  } finally {
    await app.close()
  }
})

test('закрытие главного окна во время загрузки модели: приложение выходит быстро, окна-детектора нет', async () => {
  test.setTimeout(120_000)
  const { app, win } = await launch({
    env: { FLOW_DETECTOR_BACKEND: 'wasm', FLOW_DETECTOR_LOAD_DELAY_MS: '60000' }
  })
  const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
  const windows = (): Promise<number> =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
  const before = await windows()
  const id = await prepare(app, win)
  await start(win, id)
  await waitFor(async () => (await windows()) === before + 1, 60_000)
  // закрываем именно главное окно (в списке окон есть и скрытое окно-детектор)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().startsWith('file:'))
      ?.close()
  })
  await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error('приложение не вышло')), 20_000))
  ])
})

test('перезагрузка страницы во время слежения: задача отменена, новая принимается, ничего не висит', async () => {
  const { app, win } = await launch({ env: { ...STUB_ENV, FLOW_DETECTOR_STUB_DELAY_MS: '80' } })
  try {
    const id = await prepare(app, win)
    await start(win, id)
    await waitFor(async () => (await seen(win)).progress.length >= 3)
    expect(ffmpegCount()).toBeGreaterThan(0)
    await win.reload()
    await win.getByTestId('open-video').waitFor()
    await waitFor(() => ffmpegCount() === 0, 10_000)
    // в новой странице задача снова запускается (прежняя не держит место)
    await win.evaluate(() => {
      const w = window as unknown as { __seen: Seen }
      w.__seen = { progress: [], ask: [], done: [] }
      window.api.onTrackingProgress((p) => w.__seen.progress.push(p))
      window.api.onTrackingDone((d) => w.__seen.done.push(d as unknown as Record<string, unknown>))
    })
    const jobId = await start(win, id)
    await waitFor(async () => (await seen(win)).progress.length >= 2)
    await win.evaluate((j) => window.api.cancelTracking(j), jobId)
    expect(ffmpegCount()).toBe(0)
    expect((await seen(win)).done).toHaveLength(0)
  } finally {
    await app.close()
  }
})

test('вопрос «Кто из них ваш?»: ask по IPC, ответ, слежение идёт дальше за выбранным', async () => {
  const userData = makeUserData()
  const { app, win } = await launch({
    userData,
    env: { ...STUB_ENV, FLOW_DETECTOR_STUB_PATTERN: fixture('stub-cross.json') }
  })
  try {
    const id = await prepare(app, win)
    await start(win, id)
    await waitFor(async () => (await seen(win)).ask.length > 0, 30_000)
    const ask = (await seen(win)).ask[0] as {
      jobId: string
      t: number
      candidates: Array<{ x: number; y: number; w: number; h: number }>
    }
    expect(ask.candidates).toHaveLength(2)
    expect(ask.t).toBeGreaterThan(1.2)
    // до ответа итога нет
    await win.waitForTimeout(300)
    expect((await seen(win)).done).toHaveLength(0)
    const mine = ask.candidates.findIndex((c) => c.y > 0.4)
    await win.evaluate(
      ([j, i]) => window.api.resolveTracking(j as string, i as number),
      [ask.jobId, mine]
    )
    await waitFor(async () => (await seen(win)).done.length > 0, 30_000)
    const done = (await seen(win)).done[0] as {
      samples: Array<{ t: number; foot: { x: number; y: number } }>
      stop: unknown
    }
    expect(done.stop).toBeNull()
    expect(done.samples).toHaveLength(75)
    // последние отсчёты — у нижнего игрока (ноги на y = 0,77), не у верхнего (0,53)
    expect(done.samples[74].foot.y).toBeCloseTo(0.77, 1)
  } finally {
    await app.close()
  }
})

test('закрытие окна во время слежения: приложение выходит, процессов ffmpeg не остаётся', async () => {
  const { app, win } = await launch({ env: { ...STUB_ENV, FLOW_DETECTOR_STUB_DELAY_MS: '80' } })
  const exited = new Promise<void>((resolve) => app.process().once('exit', () => resolve()))
  const id = await prepare(app, win)
  await start(win, id)
  await waitFor(async () => (await seen(win)).progress.length >= 3)
  expect(ffmpegCount()).toBeGreaterThan(0)
  await closeWindow(app)
  await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error('приложение не вышло')), 20_000))
  ])
  await waitFor(() => ffmpegCount() === 0, 10_000)
})
