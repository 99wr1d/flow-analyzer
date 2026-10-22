// «Следить за игроком»: интерфейс целиком. Настоящие окно, ffmpeg и IPC; детектор — заглушка со сценарием
// (FLOW_DETECTOR_STUB=1), кроме последнего теста (настоящая модель на синтетическом кадре: «не упало, есть результат или сообщение»).
// Видео runner.mp4: красный бегун идёт вправо, синий стоит на его пути, с 2,4 с — смена плана; положение бегуна —
// точная функция времени середины кадра, поэтому по пикселям кадра проверяется, что ключи слежения попадают на тот же кадр,
// который показывает плеер.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { frameRgb, pixelAt } from '../../src/main/ffmpeg/ffmpeg.testkit'
import { calibrate, click as clickPitch, openPitch, project, saveCalibration } from './pitchHelpers'
import {
  SHOTS,
  SUFFIX,
  dragOnPicture,
  fixture,
  launch,
  makeUserData,
  seekVideo,
  stubDialog
} from './helpers'

const W = 640
const H = 360
const FPS = 25
const VIDEO = fixture('runner.mp4')
const PATTERN = fixture('stub-runner.json')
// cross.mp4 + stub-cross.json: до 1.2 с один красный игрок, потом два одинаковых красных (рамки заглушки лежат на фигурах видео).
const CROSS = fixture('stub-cross.json')
const CROSS_VIDEO = fixture('cross.mp4')
// stub-nested.json: два одинаковых игрока, один целиком внутри рамки другого (малая рамка поверх большой в окне «Кто из них ваш?»).
const NESTED = fixture('stub-nested.json')

type Ctx = { app: ElectronApplication; win: Page }

const shot = (win: Page, name: string): Promise<Buffer> =>
  win.screenshot({ path: join(SHOTS, `${name}${SUFFIX}.png`) })

async function open(
  pattern: string = PATTERN,
  extraEnv: Record<string, string> = {},
  video: string = VIDEO
): Promise<Ctx> {
  const { app, win } = await launch({
    env: { FLOW_DETECTOR_STUB: '1', FLOW_DETECTOR_STUB_PATTERN: pattern, ...extraEnv }
  })
  await stubDialog(app, video)
  await win.getByTestId('open-video').click()
  await expect(win.getByTestId('play-toggle')).toBeEnabled()
  await expect(win.getByTestId('annotation-layer')).toBeVisible()
  return { app, win }
}

const circle = (win: Page) => win.locator('[data-testid="annotation"][data-type="circle"]')

interface Geo {
  p1: { x: number; y: number }
  p2: { x: number; y: number }
}
async function ringCenter(win: Page): Promise<{ x: number; y: number }> {
  const geo = JSON.parse((await circle(win).getAttribute('data-geo')) as string) as Geo
  return { x: (geo.p1.x + geo.p2.x) / 2, y: (geo.p1.y + geo.p2.y) / 2 }
}

/** Кольцо у ног бегуна на кадре 0 (центр 0.08, 0.74; бегун на кадре 0: центр рамки 0.085, ноги 0.74). */
async function drawRing(
  win: Page,
  opts: { color?: string; from?: [number, number]; to?: [number, number]; duration?: number } = {}
): Promise<void> {
  await seekVideo(win, 0.5 / FPS)
  await win.getByTestId('tool-circle').click()
  if (opts.color) await win.getByTestId(`color-${opts.color}`).click()
  await dragOnPicture(win, opts.from ?? [0.05, 0.71], opts.to ?? [0.11, 0.77])
  await expect(circle(win)).toHaveCount(1)
  await win.getByTestId('tool-select').click()
  if (opts.duration !== undefined) {
    await win.getByTestId('duration-input').fill(String(opts.duration))
  }
}

/** Сколько отрезка у рисунка: ключи на дорожке (всего / авто). */
const trackItem = (win: Page) => win.getByTestId('track-item')

const runsOf = async (win: Page): Promise<number> =>
  Number(await win.getByTestId('tracking-state').getAttribute('data-runs'))

/** Ждёт, пока закончится ещё одно слежение (больше, чем было), и убеждается, что панель убрана. */
async function waitRun(win: Page, before: number): Promise<void> {
  await expect(win.getByTestId('tracking-state')).toHaveAttribute('data-runs', String(before + 1), {
    timeout: 60_000
  })
}

/** Нажимает «Следить» и ждёт конца этого расчёта. */
async function runTracking(win: Page): Promise<void> {
  const before = await runsOf(win)
  await win.getByTestId('track-button').click()
  await waitRun(win, before)
}

test.describe('слежение за игроком (заглушка детектора)', () => {
  test('кольцо едет за бегуном: авто-ключи, полоса «слежение», остановка на смене плана, Ctrl+Z', async () => {
    const { app, win } = await open()
    try {
      await drawRing(win, { duration: 2.9 })
      const before = await ringCenter(win)
      await expect(win.getByTestId('track-button')).toBeVisible()
      await expect(win.getByTestId('track-button')).toHaveText('Следить за игроком')
      await shot(win, 'tracking-button')

      await runTracking(win)

      // Остановка на смене плана (время — последний уверенный кадр, 2.34 с, а не кадр смены): тост с причиной и временем; ключи — сплошной полосой, ромбиков нет.
      const toast = win.getByTestId('toast')
      await expect(toast).toContainText('Игрок потерян на 00:02.3 — смена плана')
      await expect(toast).toContainText('Поставьте рисунок на игрока и нажмите «Следить» ещё раз.')
      await shot(win, 'tracking-lost-toast')
      const keys = Number(await trackItem(win).getAttribute('data-keys'))
      expect(keys).toBeGreaterThanOrEqual(2)
      expect(keys).toBeLessThan(20)
      expect(await trackItem(win).getAttribute('data-auto-keys')).toBe(String(keys))
      await expect(win.getByTestId('track-band')).toHaveCount(1)
      await expect(win.getByTestId('track-band')).toHaveAttribute('data-count', String(keys))
      await expect(win.getByTestId('track-key')).toHaveCount(0)
      await shot(win, 'tracking-band')

      // Кольцо на последнем кадре (2.38 с) у ног бегуна: центр рамки 0.05 + 0.25 · 2.38 + 0.03, ноги на 0.74 (±3 % кадра).
      await seekVideo(win, (59 + 0.5) / FPS)
      const end = await ringCenter(win)
      expect(Math.abs(end.x - (0.05 + 0.25 * (59.5 / FPS) + 0.03 - 0.005))).toBeLessThan(0.03)
      expect(Math.abs(end.y - 0.74)).toBeLessThan(0.03)
      expect(end.x).toBeGreaterThan(before.x + 0.4)

      // Один Ctrl+Z убирает всё слежение.
      await win.keyboard.press('Control+z')
      await expect(trackItem(win)).toHaveAttribute('data-keys', '0')
      await seekVideo(win, (59 + 0.5) / FPS)
      const undone = await ringCenter(win)
      expect(undone.x).toBeCloseTo(before.x, 4)
      expect(undone.y).toBeCloseTo(before.y, 4)
      // И возвращается одним Ctrl+Shift+Z.
      await win.keyboard.press('Control+Shift+z')
      await expect(trackItem(win)).toHaveAttribute('data-keys', String(keys))
    } finally {
      await app.close()
    }
  })

  test('«Только кадр» и стрелка: кнопки «Следить» нет', async () => {
    const { app, win } = await open()
    try {
      await drawRing(win)
      await expect(win.getByTestId('track-button')).toBeVisible()
      await win.getByTestId('mode-frame').click()
      await expect(win.getByTestId('track-button')).toHaveCount(0)
      await win.getByTestId('mode-range').click()
      await expect(win.getByTestId('track-button')).toBeVisible()

      await win.getByTestId('tool-arrow').click()
      await dragOnPicture(win, [0.5, 0.2], [0.7, 0.2])
      await win.getByTestId('tool-select').click()
      await expect(win.locator('[data-testid="annotation"][data-type="arrow"]')).toHaveCount(1)
      await expect(win.getByTestId('track-button')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('отмена кнопкой и Esc: полоса прогресса, рисунок не меняется', async () => {
    const { app, win } = await open(PATTERN, { FLOW_DETECTOR_STUB_DELAY_MS: '60' })
    try {
      await drawRing(win, { duration: 2.9 })
      const before = await circle(win).getAttribute('data-geo')

      await win.getByTestId('track-button').click()
      await expect(win.getByTestId('tracking-panel')).toBeVisible()
      await expect(win.getByTestId('tracking-progress')).toBeVisible()
      await expect
        .poll(
          async () => Number(await win.getByTestId('tracking-progress').getAttribute('data-done')),
          {
            timeout: 15_000
          }
        )
        .toBeGreaterThan(20)
      await shot(win, 'tracking-progress')
      await win.getByTestId('tracking-cancel').click()
      await waitRun(win, 0)
      await expect(trackItem(win)).toHaveAttribute('data-keys', '0')
      expect(await circle(win).getAttribute('data-geo')).toBe(before)
      await expect(win.getByTestId('toast')).toHaveCount(0)

      // То же с Esc.
      await win.getByTestId('track-button').click()
      await expect(win.getByTestId('tracking-progress')).not.toHaveAttribute('data-done', '0', {
        timeout: 15_000
      })
      await win.keyboard.press('Escape')
      await waitRun(win, 1)
      await expect(trackItem(win)).toHaveAttribute('data-keys', '0')
      expect(await circle(win).getAttribute('data-geo')).toBe(before)
      // Рисунок остался выбранным, кнопка снова доступна.
      await expect(win.getByTestId('track-button')).toBeEnabled()
    } finally {
      await app.close()
    }
  })

  test('поправили кольцо руками в середине и нажали «Следить» с этого кадра: ручной ключ сохранён', async () => {
    const { app, win } = await open()
    try {
      await drawRing(win, { duration: 2.9 })
      await runTracking(win)
      const autoBefore = Number(await trackItem(win).getAttribute('data-auto-keys'))

      // На кадре 1.0 с тянем кольцо вправо: появляется ручной ключ (ромбик), а полоса делится на две части.
      const frame = 25
      await seekVideo(win, (frame + 0.5) / FPS)
      const c0 = await ringCenter(win)
      const geo = JSON.parse((await circle(win).getAttribute('data-geo')) as string) as Geo
      await dragOnPicture(win, [geo.p1.x, c0.y], [geo.p1.x + 0.02, c0.y])
      await expect(win.getByTestId('track-key')).toHaveCount(1)
      const manual = Number(await win.getByTestId('track-key').getAttribute('data-time'))
      expect(manual).toBeCloseTo((frame + 0.5) / FPS, 3)
      const edited = await ringCenter(win)
      expect(edited.x).toBeGreaterThan(c0.x + 0.01)
      await expect(win.getByTestId('track-band')).toHaveCount(2)

      // Слежение с этого кадра: ручной ключ на месте, до него и после — авто-ключи.
      await expect(win.getByTestId('track-button')).toHaveAttribute('data-mode', 'start')
      await runTracking(win)
      await expect(win.getByTestId('track-key')).toHaveCount(1)
      expect(Number(await win.getByTestId('track-key').getAttribute('data-time'))).toBeCloseTo(
        manual,
        6
      )
      await expect(win.getByTestId('track-band')).toHaveCount(2)
      expect(Number(await trackItem(win).getAttribute('data-auto-keys'))).toBeGreaterThanOrEqual(
        autoBefore - 1
      )
      // Поправка сохранилась как смещение: на 1.5 с кольцо правее ног бегуна примерно на 0.015 + 0.005 (первоначальный сдвиг).
      await seekVideo(win, (37 + 0.5) / FPS)
      const later = await ringCenter(win)
      const foot = 0.05 + 0.25 * (37.5 / FPS) + 0.03
      expect(later.x - foot).toBeGreaterThan(0.005)
      expect(later.x - foot).toBeLessThan(0.04)
    } finally {
      await app.close()
    }
  })

  test('«Продолжить слежение»: отрезок растянули дальше последнего ключа — досчитывает с последнего ключа', async () => {
    const { app, win } = await open()
    try {
      await drawRing(win, { duration: 1 })
      await runTracking(win)
      await expect(win.getByTestId('toast')).toContainText('Слежение готово')
      const lastKey = async (): Promise<number> =>
        Number(await win.getByTestId('track-band').last().getAttribute('data-to'))
      const firstEnd = await lastKey()
      expect(firstEnd).toBeGreaterThan(0.9)
      expect(firstEnd).toBeLessThan(1.1)
      // Пока отрезок не растянут, кнопка — «Следить за игроком».
      await expect(win.getByTestId('track-button')).toHaveText('Следить за игроком')

      await win.getByTestId('duration-input').fill('2.9')
      await expect(win.getByTestId('track-button')).toHaveText('Продолжить слежение')
      await expect(win.getByTestId('track-button')).toHaveAttribute('data-mode', 'continue')
      await runTracking(win)
      await expect(win.getByTestId('toast')).toContainText('смена плана')
      // Всё та же одна полоса, но длиннее; начало слежения не тронуто.
      await expect(win.getByTestId('track-band')).toHaveCount(1)
      expect(await lastKey()).toBeGreaterThan(2.3)
      await expect(win.getByTestId('track-key')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('«Кто из них ваш?»: рамки лежат на настоящих фигурах кадра, щелчок продолжает слежение; Esc отменяет', async () => {
    const { app, win } = await open(CROSS, {}, CROSS_VIDEO)
    try {
      // Кольцо у ног единственного игрока кадра 0 (ноги на 0.65).
      await drawRing(win, { from: [0.3, 0.62], to: [0.36, 0.68], duration: 2.9 })
      const runs0 = await runsOf(win)
      await win.getByTestId('track-button').click()
      await expect(win.getByTestId('pick-overlay')).toBeVisible({ timeout: 60_000 })
      await expect(win.getByTestId('pick-text')).toHaveText('Кто из них ваш? Щёлкните по игроку.')
      await expect(win.getByTestId('pick-box')).toHaveCount(2)
      // Каждая рамка лежит на настоящей (красной) фигуре показанного кадра.
      const kinds = await boxKinds(win)
      expect(kinds).toEqual(['red', 'red'])
      await shot(win, 'tracking-pick')

      // Esc отменяет без изменений.
      await win.keyboard.press('Escape')
      await waitRun(win, runs0)
      await expect(trackItem(win)).toHaveAttribute('data-keys', '0')

      // Ещё раз: щелчок по нижнему игроку («мой»).
      const runs1 = await runsOf(win)
      await win.getByTestId('track-button').click()
      await expect(win.getByTestId('pick-box')).toHaveCount(2, { timeout: 60_000 })
      const boxes = win.getByTestId('pick-box')
      const tops = await boxes.evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetTop))
      await boxes.nth(tops[0] > tops[1] ? 0 : 1).click()
      await waitRun(win, runs1)
      await seekVideo(win, (72 + 0.5) / FPS)
      const end = await ringCenter(win)
      // Нижний игрок: ноги на 0.47 + 0.3 = 0.77, кольцо у ног (центр 0.65 при ногах 0.65). Верхний дал бы 0.53.
      expect(Math.abs(end.y - 0.77)).toBeLessThan(0.03)
    } finally {
      await app.close()
    }
  })

  test('«Кто из них ваш?»: малая рамка внутри большой кликабельна, у большой кликается свободная часть', async () => {
    for (const small of [true, false]) {
      const { app, win } = await open(NESTED, {}, CROSS_VIDEO)
      try {
        // Кольцо у ног малого игрока (ноги на 0.48, он бежит вправо), внутри рамки большого (ноги на 0.65, стоит).
        await drawRing(win, { from: [0.3, 0.45], to: [0.36, 0.51], duration: 1 })
        const runs0 = await runsOf(win)
        await win.getByTestId('track-button').click()
        await expect(win.getByTestId('pick-box')).toHaveCount(2, { timeout: 60_000 })
        const heights = await win
          .getByTestId('pick-box')
          .evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetHeight))
        const smallIdx = heights[0] < heights[1] ? 0 : 1
        const idx = small ? smallIdx : 1 - smallIdx
        const box = win.getByTestId('pick-box').nth(idx)
        // Малая рамка — выше в порядке отрисовки: щелчок по её центру попадает в неё; у большой — свободный низ.
        if (small) await box.click()
        else await box.click({ position: { x: 5, y: heights[idx] - 5 } })
        await waitRun(win, runs0)
        await seekVideo(win, (20 + 0.5) / FPS)
        const end = await ringCenter(win)
        // Малый игрок бежит вправо (0.1/с), большой стоит: кольцо едет только за выбранным (смещение кольца от рамки сохраняется).
        if (small) expect(end.x).toBeGreaterThan(0.33 + 0.05)
        else expect(Math.abs(end.x - 0.33)).toBeLessThan(0.02)
      } finally {
        await app.close()
      }
    }
  })
})

test.describe('слежение и смена видео или правка рисунка', () => {
  test('открыли другое видео во время расчёта: расчёт отменён, рамок и ключей на новом видео нет', async () => {
    const { app, win } = await open(PATTERN, { FLOW_DETECTOR_STUB_DELAY_MS: '60' })
    try {
      await drawRing(win, { duration: 2.9 })
      await win.getByTestId('track-button').click()
      await expect(win.getByTestId('tracking-progress')).not.toHaveAttribute('data-done', '0', {
        timeout: 15_000
      })
      await stubDialog(app, CROSS_VIDEO)
      await win.getByTestId('open-video').click()
      await win.getByTestId('unsaved-discard').click()
      await expect(win.getByTestId('tracking-state')).toHaveAttribute('data-phase', 'idle', {
        timeout: 15_000
      })
      await expect(win.getByTestId('tracking-host')).toHaveCount(0)
      await expect(win.getByTestId('pick-box')).toHaveCount(0)
      // Новое видео чистое: ничего не применено, рисунков нет, сообщений нет.
      await win.waitForTimeout(800)
      await expect(win.getByTestId('toast')).toHaveCount(0)
      await expect(circle(win)).toHaveCount(0)
      await expect(win.getByTestId('tracking-host')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('открыли другое видео, пока ждёт «Кто из них ваш?»: окна выбора нет, кадр не уводится', async () => {
    const { app, win } = await open(CROSS, {}, CROSS_VIDEO)
    try {
      await drawRing(win, { from: [0.3, 0.62], to: [0.36, 0.68], duration: 2.9 })
      await win.getByTestId('track-button').click()
      await expect(win.getByTestId('pick-overlay')).toBeVisible({ timeout: 60_000 })
      await stubDialog(app, VIDEO)
      await win.getByTestId('open-video').click()
      await win.getByTestId('unsaved-discard').click()
      await expect(win.getByTestId('tracking-state')).toHaveAttribute('data-phase', 'idle', {
        timeout: 15_000
      })
      await expect(win.getByTestId('pick-box')).toHaveCount(0)
      await expect(win.getByTestId('pick-overlay')).toHaveCount(0)
      await win.waitForTimeout(500)
      await expect(circle(win)).toHaveCount(0)
      await expect(win.getByTestId('toast')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('рисунок удалили во время расчёта: расчёт остановлен с сообщением, ничего не записано', async () => {
    const { app, win } = await open(PATTERN, { FLOW_DETECTOR_STUB_DELAY_MS: '60' })
    try {
      await drawRing(win, { duration: 2.9 })
      await win.getByTestId('track-button').click()
      await expect(win.getByTestId('tracking-progress')).not.toHaveAttribute('data-done', '0', {
        timeout: 15_000
      })
      // Фокус остаётся в поле длительности: Delete там ничего не удаляет.
      await win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await win.keyboard.press('Delete')
      await expect(win.getByTestId('tracking-state')).toHaveAttribute('data-phase', 'idle', {
        timeout: 15_000
      })
      await expect(win.getByTestId('toast')).toContainText('рисунок изменили или удалили')
      await expect(circle(win)).toHaveCount(0)
    } finally {
      await app.close()
    }
  })
})

/** Какая фигура кадра под каждой рамкой выбора: по цвету пикселей самого видео внутри рамки. */
async function boxKinds(win: Page): Promise<string[]> {
  return win.evaluate(() => {
    const v = document.querySelector('video') as HTMLVideoElement
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    const ctx = c.getContext('2d') as CanvasRenderingContext2D
    ctx.drawImage(v, 0, 0)
    const layer = (
      document.querySelector('[data-testid="annotation-layer"]') as HTMLElement
    ).getBoundingClientRect()
    return Array.from(document.querySelectorAll('[data-testid="pick-box"]')).map((el) => {
      const r = el.getBoundingClientRect()
      const x0 = Math.round(((r.left - layer.left) / layer.width) * c.width)
      const y0 = Math.round(((r.top - layer.top) / layer.height) * c.height)
      const w = Math.max(1, Math.round((r.width / layer.width) * c.width))
      const h = Math.max(1, Math.round((r.height / layer.height) * c.height))
      const d = ctx.getImageData(Math.max(0, x0), Math.max(0, y0), w, h).data
      let red = 0
      let blue = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i] > 170 && d[i + 1] < 90 && d[i + 2] < 110) red += 1
        else if (d[i + 2] > 170 && d[i] < 80) blue += 1
      }
      return red > 100 && red >= blue ? 'red' : blue > 100 ? 'blue' : 'none'
    })
  })
}

/** Доля ширины кадра, где центр красного бегуна на кадре, показанном плеером (по пикселям самого видео). */
async function redCentre(win: Page): Promise<number> {
  return win.evaluate(() => {
    const v = document.querySelector('video') as HTMLVideoElement
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    const ctx = c.getContext('2d') as CanvasRenderingContext2D
    ctx.drawImage(v, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let sx = 0
    let n = 0
    for (let y = 0; y < c.height; y += 1) {
      for (let x = 0; x < c.width; x += 1) {
        const i = (y * c.width + x) * 4
        if (d[i] > 170 && d[i + 1] < 90 && d[i + 2] < 110) {
          sx += x
          n += 1
        }
      }
    }
    return n > 50 ? sx / n / c.width : -1
  })
}

test.describe('время ключей слежения и кадры', () => {
  test('ключи попадают на тот же кадр, что показывает плеер (по пикселям, ±3.5 px при шаге бегуна 6.4 px)', async () => {
    const { app, win } = await open()
    try {
      await drawRing(win, { duration: 2.9 })
      await runTracking(win)
      // Кадры без перекрытия синим: бегун на 0.05..0.36 и правее 0.48 (t < 1.2 и t > 1.75). Кольцо при старте слежения встаёт центром на ноги (центр рамки по x).
      for (const n of [3, 10, 20, 46, 50, 55, 58]) {
        await seekVideo(win, (n + 0.5) / FPS)
        const red = await redCentre(win)
        expect(red).toBeGreaterThan(0)
        const ring = await ringCenter(win)
        expect(Math.abs(ring.x - red) * W).toBeLessThan(3.5)
      }
    } finally {
      await app.close()
    }
  })

  test('экспорт: отслеженное кольцо в кадре экспорта там же, где на экране', async () => {
    const { app, win } = await open()
    const out = join(makeUserData(), 'out')
    mkdirSync(out)
    try {
      await drawRing(win, { color: 'ffffff', duration: 2.9 })
      await runTracking(win)
      // Положение кольца на экране на трёх кадрах.
      const frames = [8, 30, 55]
      const onScreen: Array<{ x: number; y: number }> = []
      for (const n of frames) {
        await seekVideo(win, (n + 0.5) / FPS)
        onScreen.push(await ringCenter(win))
      }
      // Круг «под игроками» (по умолчанию) закрывается ногами фигур; для сравнения кладём его поверх.
      await win.getByTestId('under-toggle').click()
      await win.getByTestId('tool-select').click()
      await stubDialog(app, out)
      await win.getByTestId('export-open').click()
      await expect(win.getByTestId('export-scope-whole')).toBeChecked()
      await expect(win.getByTestId('export-drawings')).toBeChecked()
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 90_000 })
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done')
      const file = join(out, readdirSync(out)[0])
      frames.forEach((n, i) => {
        const rgb = frameRgb(file, n, W, H)
        // Белые пиксели кольца (бегун, трава и остальные цвета кадра — не белые).
        let sx = 0
        let sy = 0
        let count = 0
        for (let y = 0; y < H; y += 1) {
          for (let x = 0; x < W; x += 1) {
            const [r, g, b] = pixelAt(rgb, W, x, y)
            if (r > 215 && g > 215 && b > 215) {
              sx += x
              sy += y
              count += 1
            }
          }
        }
        expect(count).toBeGreaterThan(40)
        // Центр ограничивающей рамки белых пикселей = центр кольца на экране (±3 px).
        expect(Math.abs(sx / count / W - onScreen[i].x) * W).toBeLessThan(3)
        expect(Math.abs(sy / count / H - onScreen[i].y) * H).toBeLessThan(3)
      })
    } finally {
      await app.close()
    }
  })
})

test.describe('рисунки «на поле» превращаются в экранные', () => {
  /** Заглушка: один игрок стоит ногами в точке поля (9, 34) на кадре pitch.mp4. */
  function pitchPattern(): string {
    const foot = project(9, 34)
    const file = join(makeUserData(), 'stub-pitch.json')
    writeFileSync(
      file,
      JSON.stringify({
        players: [
          {
            start: { x: foot.x - 0.03, y: foot.y - 0.3, w: 0.06, h: 0.3 },
            velocity: { x: 0.02, y: 0 }
          }
        ],
        cuts: []
      })
    )
    return file
  }

  async function prepare(tool: 'tool-circle' | 'tool-spot'): Promise<Ctx> {
    const ctx = await launch({
      env: { FLOW_DETECTOR_STUB: '1', FLOW_DETECTOR_STUB_PATTERN: pitchPattern() }
    })
    await openPitch(ctx)
    await calibrate(ctx.win)
    await saveCalibration(ctx.win)
    await ctx.win.getByTestId(tool).click()
    await clickPitch(ctx.win, project(9, 34))
    await ctx.win.getByTestId('tool-select').click()
    // Рисунок с отрезком (у «Только кадр» слежения нет): от секунды 1 до конца видео.
    await ctx.win.getByTestId('mode-range').click()
    await ctx.win.getByTestId('duration-input').fill('1.9')
    return ctx
  }

  test('кольцо на поле → экранный круг «под игроками» с ключами, подсказка; один Ctrl+Z возвращает кольцо', async () => {
    const { app, win } = await prepare('tool-circle')
    try {
      const ring = win.locator('[data-testid="annotation"][data-type="ring"]')
      await expect(ring).toHaveCount(1)
      await seekVideo(win, 1)
      await runTracking(win)
      await expect(win.getByTestId('toast')).toContainText(
        'Рисунок «на поле» стал экранным: он будет ехать за игроком, но метры больше не показываются.'
      )
      await expect(ring).toHaveCount(0)
      const circles = win.locator('[data-testid="annotation"][data-type="circle"]')
      await expect(circles).toHaveCount(1)
      await expect(circles).toHaveAttribute('data-space', 'screen')
      await expect(circles).toHaveAttribute('data-under', 'true')
      expect(Number(await trackItem(win).getAttribute('data-auto-keys'))).toBeGreaterThanOrEqual(2)
      await shot(win, 'tracking-pitch-to-screen')

      await win.keyboard.press('Control+z')
      await expect(ring).toHaveCount(1)
      await expect(circles).toHaveCount(0)
      await expect(trackItem(win)).toHaveAttribute('data-keys', '0')
    } finally {
      await app.close()
    }
  })

  test('прожектор на поле → экранный прожектор с лучом: луч виден на экране', async () => {
    const { app, win } = await prepare('tool-spot')
    try {
      await expect(win.locator('[data-testid="annotation"][data-type="pspot"]')).toHaveCount(1)
      await seekVideo(win, 1)
      await runTracking(win)
      const spot = win.locator('[data-testid="annotation"][data-type="spot"]')
      await expect(spot).toHaveCount(1)
      await expect(spot).toHaveAttribute('data-space', 'screen')
      expect(await spot.getAttribute('data-geo')).toContain('"beam":true')
      await expect(spot.locator('[data-part="beam"]')).toHaveCount(1)
      await shot(win, 'tracking-pitch-spot-beam')
    } finally {
      await app.close()
    }
  })
})

test('настоящий детектор на синтетическом кадре: не падает, есть результат или понятное сообщение', async () => {
  test.setTimeout(240_000)
  const { app, win } = await launch()
  try {
    await stubDialog(app, VIDEO)
    await win.getByTestId('open-video').click()
    await expect(win.getByTestId('play-toggle')).toBeEnabled()
    await drawRing(win, { duration: 1 })
    const runs = await runsOf(win)
    await win.getByTestId('track-button').click()
    // Либо ключи (панели нет и есть авто-ключи), либо тост-сообщение; приложение живо.
    await expect(win.getByTestId('tracking-state')).toHaveAttribute('data-runs', String(runs + 1), {
      timeout: 200_000
    })
    const keys = Number(await trackItem(win).getAttribute('data-auto-keys'))
    const toast = await win.getByTestId('toast').count()
    expect(keys > 0 || toast > 0).toBe(true)
    await shot(win, 'tracking-real-detector')
    await expect(win.getByTestId('open-video')).toBeVisible()
  } finally {
    await app.close()
  }
})
