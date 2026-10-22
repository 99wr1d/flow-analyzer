// Этап 16б: анимация рисунков по ключевым кадрам. Настоящее приложение и настоящий ffmpeg:
// ключи и автоключи, навигация, ромбики на дорожке, воспроизведение, сохранение, экспорт и панель стиля в один ряд.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { mkdirSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { ff, frameRgb } from '../../src/main/ffmpeg/ffmpeg.testkit'
import {
  SHOTS,
  SUFFIX,
  dragOnPicture,
  fixture,
  launch,
  makeUserData,
  seekVideo,
  stubDialog,
  videoState
} from './helpers'
import {
  calibrate,
  openPitch,
  project,
  saveCalibration,
  truth,
  click as clickPitch
} from './pitchHelpers'
import { createProject } from './startHelpers'
import { geo, layerBox } from './toolsHelpers'

type Ctx = { app: ElectronApplication; win: Page; userData: string; projectsDir: string }

const W = 640
const H = 360
const shot = (
  win: Page,
  name: string,
  clip?: { x: number; y: number; width: number; height: number }
): Promise<Buffer> =>
  win.screenshot({ path: join(SHOTS, `animation-${name}${SUFFIX}.png`), ...(clip ? { clip } : {}) })

const circles = (win: Page): Locator =>
  win.locator('[data-testid="annotation"][data-type="circle"]:not([data-id="poly-draft"])')
const keys = (win: Page): Locator => win.getByTestId('track-key')
const keyTimes = async (win: Page): Promise<number[]> =>
  await keys(win).evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-time'))))

interface CircleGeo {
  p1: { x: number; y: number }
  p2: { x: number; y: number }
}
/** Центр круга в долях кадра по его геометрии на показанном кадре. */
async function centerFrac(win: Page): Promise<[number, number]> {
  const g = await geo<CircleGeo>(circles(win))
  return [(g.p1.x + g.p2.x) / 2, (g.p1.y + g.p2.y) / 2]
}
/** Центр круга на экране (пиксели окна): середина ограничивающей рамки нарисованной фигуры. */
async function centerPx(win: Page): Promise<[number, number]> {
  const b = await circles(win).first().boundingBox()
  expect(b).not.toBeNull()
  return [b!.x + b!.width / 2, b!.y + b!.height / 2]
}

/** Круг у нижнего края кадра (там нет цифр на картинке): рисуется перетаскиванием, виден 3 с от текущего момента. */
async function drawCircle(win: Page, from: [number, number], to: [number, number]): Promise<void> {
  await win.getByTestId('tool-circle').click()
  // С 0.16.4 новый круг лежит под игроками; на этом видео нет газона, поэтому рисунок кладём поверх.
  await win.getByTestId('under-toggle').click()
  await win.getByTestId('color-ffffff').click()
  await win.getByTestId('width-2').click()
  await dragOnPicture(win, from, to)
  await expect(circles(win)).toHaveCount(1)
  await win.getByTestId('tool-select').click()
}

/** Файл проекта в папке проектов (проект создан через окно «Новый проект», Ctrl+S пишет в него без диалога). */
function findProject(dir: string): string {
  const walk = (d: string): string[] =>
    readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(d, e.name))
        : e.name.endsWith('.flowproj')
          ? [join(d, e.name)]
          : []
    )
  const found = walk(dir)
  expect(found).toHaveLength(1)
  return found[0]
}

async function newProject(ctx: Ctx, title = 'Анимация'): Promise<void> {
  await createProject(ctx, { title, video: fixture('cfr25.mp4') })
  await ctx.win.keyboard.press('Escape')
}

const CIRCLE_FROM: [number, number] = [0.15, 0.8]
const CIRCLE_TO: [number, number] = [0.25, 0.9]
/** Правый край круга: щелчок по линии круга его выбирает и двигает. */
const GRAB: [number, number] = [0.25, 0.85]

/**
 * Базовая сцена: круг нарисован на 1.0 с, «Анимировать» на 1.0 с (ключ 1 в кадре 25, t = 1.02),
 * на 2.06 с (кадр 51) круг перетащен вправо на 0.4 ширины кадра (ключ 2). Середина между ключами — кадр 38 (t = 1.54).
 */
async function sceneTwoKeys(ctx: Ctx): Promise<void> {
  const { win } = ctx
  await newProject(ctx)
  await seekVideo(win, 1.0)
  await drawCircle(win, CIRCLE_FROM, CIRCLE_TO)
  await expect(win.getByTestId('anim-start')).toBeVisible()
  await win.getByTestId('anim-start').click()
  await expect(win.getByTestId('key-count')).toHaveAttribute('data-count', '1')
  await expect(keys(win)).toHaveCount(1)
  await seekVideo(win, 2.06)
  await expect(circles(win)).toHaveCount(1)
  await dragOnPicture(win, GRAB, [GRAB[0] + 0.4, GRAB[1]])
  await expect(keys(win)).toHaveCount(2)
}

test.describe('анимация рисунков', () => {
  test('Анимировать → автоключ при перетаскивании → середина между ключами, навигация , и .', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await newProject(ctx)
      await seekVideo(win, 1.0)
      await drawCircle(win, CIRCLE_FROM, CIRCLE_TO)
      // Рисунок без ключей: кнопка «Анимировать», ромбиков нет.
      await expect(win.getByTestId('anim-start')).toBeVisible()
      await expect(keys(win)).toHaveCount(0)
      await shot(win, 'inspector-before')

      await win.getByTestId('anim-start').click()
      await expect(win.getByTestId('anim-section')).toBeVisible()
      await expect(win.getByTestId('key-count')).toHaveAttribute('data-count', '1')
      await expect(keys(win)).toHaveCount(1)
      const [cx0, cy0] = await centerFrac(win)
      expect(cx0).toBeCloseTo(0.2, 2)

      // Перемотка на 2.06 с и перетаскивание: на этом кадре появился второй ключ.
      await seekVideo(win, 2.06)
      await expect(win.getByTestId('key-add')).toBeEnabled()
      await dragOnPicture(win, GRAB, [GRAB[0] + 0.4, GRAB[1]])
      await expect(keys(win)).toHaveCount(2)
      await expect(win.getByTestId('key-count')).toHaveAttribute('data-count', '2')
      const [cx1] = await centerFrac(win)
      expect(cx1).toBeCloseTo(0.6, 2)
      // На ключевом кадре «Ключ здесь» недоступен, а «Удалить ключ» доступен.
      await expect(win.getByTestId('key-add')).toBeDisabled()
      await expect(win.getByTestId('key-remove')).toBeEnabled()
      const times = await keyTimes(win)
      expect(times[0]).toBeCloseTo(1.02, 2)
      expect(times[1]).toBeCloseTo(2.06, 2)

      // «Равномерно»: на середине (кадр 38, t = 1.54) круг ровно посередине между ключами (±3 px экрана).
      await seekVideo(win, 1.54)
      await win.getByTestId('ease-linear').click()
      await seekVideo(win, 1.54)
      const layer = await layerBox(win)
      const [mx, my] = await centerPx(win)
      const startX = layer.x + cx0 * layer.width
      const endX = layer.x + cx1 * layer.width
      const halfX = (startX + endX) / 2
      const y = layer.y + cy0 * layer.height
      console.log(
        'Середина между ключами: x =',
        mx.toFixed(2),
        'ожидалось',
        halfX.toFixed(2),
        '; y =',
        my.toFixed(2),
        'ожидалось',
        y.toFixed(2)
      )
      expect(Math.abs(mx - halfX)).toBeLessThanOrEqual(3)
      expect(Math.abs(my - y)).toBeLessThanOrEqual(3)
      await shot(win, 'timeline-diamonds')
      await shot(win, 'inspector-animated')

      // «Плавно» (по умолчанию) на четверти пути отстаёт от равномерного.
      await win.getByTestId('ease-smooth').click()
      await seekVideo(win, 1.3)
      const [smoothX] = await centerPx(win)
      const u = (1.3 - 1.02) / (2.06 - 1.02)
      const linearX = startX + (endX - startX) * u
      expect(smoothX).toBeLessThan(linearX - 3)
      await win.getByTestId('ease-linear').click()

      // Клавиши «.» и «,»: следующий и предыдущий ключ.
      await seekVideo(win, 1.54)
      await win.keyboard.press('Period')
      await expect.poll(async () => (await videoState(win))!.currentTime).toBeCloseTo(2.06, 1)
      await win.keyboard.press('Comma')
      await expect.poll(async () => (await videoState(win))!.currentTime).toBeCloseTo(1.02, 1)
      // Кнопки панели.
      await win.getByTestId('key-next').click()
      await expect.poll(async () => (await videoState(win))!.currentTime).toBeCloseTo(2.06, 1)
      await win.getByTestId('key-prev').click()
      await expect.poll(async () => (await videoState(win))!.currentTime).toBeCloseTo(1.02, 1)
      // Дальше первого ключа назад ходу нет (кадр остаётся).
      await win.keyboard.press('Comma')
      await win.waitForTimeout(150)
      expect((await videoState(win))!.currentTime).toBeCloseTo(1.02, 1)
    } finally {
      await ctx.app.close()
    }
  })

  test('«Ключ здесь» и J, перетаскивание ромбика, Delete по ромбику, отмена и повтор одним шагом', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await sceneTwoKeys(ctx)
      // Один шаг отмены на перетаскивание: Ctrl+Z убирает автоключ, Ctrl+Y возвращает.
      await win.keyboard.press('Control+z')
      await expect(keys(win)).toHaveCount(1)
      await win.keyboard.press('Control+y')
      await expect(keys(win)).toHaveCount(2)

      // «Ключ здесь» на кадре 38 (t = 1.54): третий ключ в середине.
      await seekVideo(win, 1.54)
      await win.getByTestId('key-add').click()
      await expect(keys(win)).toHaveCount(3)
      await expect(win.getByTestId('key-add')).toBeDisabled()
      // Клавиша J на ключевом кадре — предупреждение, ключей не прибавилось.
      await win.keyboard.press('j')
      await expect(keys(win)).toHaveCount(3)
      // На другом кадре K ставит ключ.
      await seekVideo(win, 1.7)
      await win.keyboard.press('j')
      await expect(keys(win)).toHaveCount(4)
      const before = await keyTimes(win)

      // Перетаскивание ромбика: ключ 4 (t ≈ 1.7) едет вправо, но не заходит за соседний ключ (2.06).
      const diamond = keys(win).nth(2)
      const box = (await diamond.boundingBox())!
      const track = (await win.getByTestId('annotation-track').boundingBox())!
      const dx = 0.1 * track.width // примерно 0.4 с при 4-секундном видео
      await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await win.mouse.down()
      await win.mouse.move(box.x + box.width / 2 + dx / 2, box.y + box.height / 2, { steps: 4 })
      await win.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2, { steps: 4 })
      await win.mouse.up()
      const after = await keyTimes(win)
      expect(after).toHaveLength(4)
      expect(after[2]).toBeGreaterThan(before[2] + 0.1)
      expect(after[2]).toBeLessThan(after[3] - 0.03) // не пересекает соседа
      // Ключ стоит на середине кадра: (n + 0.5) / 25.
      const frames = after.map((t) => t * 25 - 0.5)
      for (const f of frames) expect(Math.abs(f - Math.round(f))).toBeLessThan(0.02)
      // Одна отмена возвращает прежнее время.
      await win.keyboard.press('Control+z')
      const undone = await keyTimes(win)
      expect(undone[2]).toBeCloseTo(before[2], 3)
      await win.keyboard.press('Control+y')
      expect((await keyTimes(win))[2]).toBeCloseTo(after[2], 3)

      // Резкий рывок за правый край и за левый: ромбик не выходит за соседей и за начало видео.
      const first = keys(win).first()
      const fb = (await first.boundingBox())!
      await win.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2)
      await win.mouse.down()
      await win.mouse.move(track.x - 40, fb.y + fb.height / 2, { steps: 6 })
      await win.mouse.up()
      expect((await keyTimes(win))[0]).toBeGreaterThanOrEqual(0)
      expect((await keyTimes(win))[0]).toBeLessThan(0.1)

      // Delete по выбранному ромбику убирает только ключ.
      await keys(win).nth(1).click()
      await expect(keys(win).nth(1)).toHaveAttribute('aria-pressed', 'true')
      await win.keyboard.press('Delete')
      await expect(keys(win)).toHaveCount(3)
      await expect(circles(win)).toHaveCount(1)
      await win.keyboard.press('Control+z')
      await expect(keys(win)).toHaveCount(4)
      await win.keyboard.press('Control+y')
      await expect(keys(win)).toHaveCount(3)

      // «Убрать анимацию»: рисунок застывает, ромбики исчезают, снова доступна «Анимировать».
      await seekVideo(win, 1.54)
      const [hx] = await centerFrac(win)
      await win.getByTestId('anim-stop').click()
      await expect(keys(win)).toHaveCount(0)
      await expect(win.getByTestId('anim-start')).toBeVisible()
      const [fx] = await centerFrac(win)
      expect(fx).toBeCloseTo(hx, 4)
      await seekVideo(win, 3)
      expect((await centerFrac(win))[0]).toBeCloseTo(hx, 4)
    } finally {
      await ctx.app.close()
    }
  })

  test('воспроизведение: круг едет, обновляется каждый показанный кадр, сохранение и повторное открытие', async () => {
    const ctx = await launch()
    const { win, app } = ctx
    try {
      await sceneTwoKeys(ctx)
      await seekVideo(win, 1.54)
      await win.getByTestId('ease-linear').click()
      await seekVideo(win, 0.9)
      // Выбранный рисунок скрыт до своего начала — снимаем выделение, чтобы он не мешал.
      await win.keyboard.press('Escape')
      await win.keyboard.press('Space')
      await expect.poll(async () => (await videoState(win))!.paused).toBe(false)
      // Ждём, пока рисунок появится (1.0 с), и замеряем 1 секунду воспроизведения: положение круга и число обновлений.
      await expect
        .poll(async () => (await videoState(win))!.currentTime, { timeout: 5000 })
        .toBeGreaterThan(1.08)
      const measured = await win.evaluate(
        () =>
          new Promise<{
            samples: Array<{ t: number; x: number }>
            updates: number
            frames: number
            seconds: number
          }>((resolve) => {
            const v = document.querySelector('video') as HTMLVideoElement & {
              requestVideoFrameCallback: (
                cb: (now: number, m: { mediaTime: number }) => void
              ) => number
            }
            const g = (): Element | null =>
              document.querySelector('[data-testid="annotation"][data-type="circle"]')
            const samples: Array<{ t: number; x: number }> = []
            let updates = 0
            let frames = 0
            let last = ''
            const observer = new MutationObserver(() => {
              const cur = g()?.getAttribute('data-geo') ?? ''
              if (cur !== last) {
                last = cur
                updates += 1
              }
            })
            const el = g()
            const layer = document.querySelector('[data-testid="annotation-layer"]')!
            observer.observe(layer, {
              attributes: true,
              subtree: true,
              attributeFilter: ['data-geo']
            })
            const started = performance.now()
            const onFrame = (_n: number, m: { mediaTime: number }): void => {
              frames += 1
              const e = g()
              if (e) {
                const geo = JSON.parse(e.getAttribute('data-geo') ?? '{}')
                samples.push({ t: m.mediaTime, x: (geo.p1.x + geo.p2.x) / 2 })
              }
              if (performance.now() - started < 900) v.requestVideoFrameCallback(onFrame)
              else {
                observer.disconnect()
                resolve({ samples, updates, frames, seconds: (performance.now() - started) / 1000 })
              }
            }
            void el
            v.requestVideoFrameCallback(onFrame)
          })
      )
      // Видео ещё играет: проверяем движение по замерам на двух моментах.
      const early = measured.samples[2]
      const late = measured.samples[measured.samples.length - 3]
      expect(late.t).toBeGreaterThan(early.t + 0.3)
      expect(late.x).toBeGreaterThan(early.x + 0.05)
      // Положение в каждый показанный кадр совпадает с линейной интерполяцией (допуск — кадр рассинхрона).
      let worst = 0
      for (const s of measured.samples) {
        const k0 = 1.02
        const k1 = 2.06
        const frame = Math.floor(s.t * 25 + 1e-6)
        const tc = (frame + 0.5) / 25
        const u = Math.min(1, Math.max(0, (tc - k0) / (k1 - k0)))
        const want = 0.2 + 0.4 * u
        worst = Math.max(worst, Math.abs(s.x - want))
      }
      const fps = measured.updates / measured.seconds
      console.log(
        'Воспроизведение: кадров показано',
        measured.frames,
        'обновлений геометрии',
        measured.updates,
        'за',
        measured.seconds.toFixed(2),
        'с → ' + fps.toFixed(1) + ' обновлений/с (видео 25 к/с); наибольшее отклонение x',
        (worst * 100).toFixed(2),
        '% кадра'
      )
      // Каждый показанный кадр — своё обновление (допускаем потерю пары кадров на дрожание таймера).
      expect(measured.updates).toBeGreaterThanOrEqual(Math.floor(measured.frames * 0.8))
      expect(worst).toBeLessThan(0.025)
      await win.keyboard.press('Space')

      // Сохранение и повторное открытие: ключи на месте.
      await seekVideo(win, 1.54)
      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('toast')).toContainText('сохранён')
      const file = findProject(ctx.projectsDir)
      const saved = JSON.parse(readFileSync(file, 'utf8'))
      const annotation = saved.annotations[0]
      expect(annotation.keyframes).toHaveLength(2)
      expect(annotation.keyframes[0].t).toBeCloseTo(1.02, 2)
      expect(annotation.keyframes[1].t).toBeCloseTo(2.06, 2)
      expect(annotation.keyframes[0].ease).toBe('linear')
      expect(annotation.keyframes[1].ease).toBe(undefined)
      expect(annotation.keyframes[0].geom.p1.x).toBeCloseTo(0.15, 2)
      expect(annotation.keyframes[1].geom.p1.x).toBeCloseTo(0.55, 2)
      await app.close()

      const again = await launch({ userData: makeUserData(), args: [file] })
      try {
        await expect(again.win.getByTestId('play-toggle')).toBeEnabled({ timeout: 20_000 })
        await again.win.getByTestId('track-item').first().click()
        await seekVideo(again.win, 1.5)
        await expect(again.win.getByTestId('track-key')).toHaveCount(2)
        await expect(again.win.getByTestId('key-count')).toHaveAttribute('data-count', '2')
        const [x] = await centerFrac(again.win)
        expect(x).toBeGreaterThan(0.25)
        expect(x).toBeLessThan(0.55)
      } finally {
        await again.app.close()
      }
    } catch (e) {
      await app.close().catch(() => undefined)
      throw e
    }
  })

  test('экспорт всего видео: кольцо в готовых кадрах там, где его считает анимация (±2 px)', async () => {
    const ctx = await launch()
    const { win, app } = ctx
    const out = join(makeUserData(), 'out')
    mkdirSync(out)
    try {
      await sceneTwoKeys(ctx)
      await seekVideo(win, 1.54)
      await win.getByTestId('ease-linear').click()
      await win.keyboard.press('Escape')
      await stubDialog(app, out)
      await win.keyboard.press('Control+e')
      await expect(win.getByTestId('export-dialog')).toBeVisible()
      await expect(win.getByTestId('export-drawings')).toBeChecked()
      await shot(win, 'export-dialog')
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 120_000 })
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done')
      const files = readdirSync(out)
      expect(files).toHaveLength(1)
      const file = join(out, files[0])

      // Кадры результата n = кадры исходника n. Ключи: кадр 25 (t = 1.02, x = 0.2), кадр 51 (t = 2.06, x = 0.6).
      const row = Math.round(0.85 * H)
      const centre = (n: number): number | null => {
        const rgb = frameRgb(file, n, W, H)
        const hits: number[] = []
        for (let x = 0; x < W; x += 1) {
          const i = (row * W + x) * 3
          if (rgb[i] > 225 && rgb[i + 1] > 225 && rgb[i + 2] > 225) hits.push(x)
        }
        if (hits.length === 0) return null
        return (hits[0] + hits[hits.length - 1] + 1) / 2
      }
      const expected = (n: number): number => {
        const t = (n + 0.5) / 25
        const u = Math.min(1, Math.max(0, (t - 1.02) / (2.06 - 1.02)))
        return (0.2 + 0.4 * u) * W
      }
      const report: string[] = []
      for (const n of [25, 38, 51, 60]) {
        const c = centre(n)
        expect(c, `кадр ${n}`).not.toBeNull()
        report.push(`кадр ${n}: ${c} / ${expected(n).toFixed(1)}`)
        expect(Math.abs(c! - expected(n)), `кадр ${n}`).toBeLessThanOrEqual(2)
      }
      console.log('Экспорт, центр круга (получено / ожидалось):', report.join('; '))
      // До появления (кадр 10) круга нет; после конца отрезка (4.0 с) он не нужен — видео кончается раньше.
      expect(centre(10)).toBeNull()
      for (const n of [25, 38, 51]) {
        ff([
          '-i',
          file,
          '-vf',
          `select=eq(n\\,${n})`,
          '-frames:v',
          '1',
          '-y',
          join(SHOTS, `animation-export-frame-${n}${SUFFIX}.png`)
        ])
      }
      // Временные файлы убраны.
      const left = readdirSync(process.env.TEMP ?? process.env.TMP ?? '.').filter(
        (n) => n.startsWith('flow-overlays-') || n.startsWith('flow-export-')
      )
      console.log('Временных папок после экспорта:', left.length)
      expect(left).toEqual([])
    } finally {
      await app.close()
    }
  })

  test('кольцо на поле уходит вглубь: радиус на экране уменьшается; слой «под игроками» обновляется на каждый кадр', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await openPitch(ctx, 'Анимация на поле')
      await calibrate(win)
      await saveCalibration(win)
      const near = truth.players[0].world
      await win.getByTestId('tool-circle').click()
      await clickPitch(win, project(near.x, near.y))
      const ring = win.locator('[data-testid="annotation"][data-type="ring"]')
      await expect(ring).toHaveCount(1)
      await win.getByTestId('tool-select').click()
      await win.getByTestId('anim-start').click()
      await expect(keys(win)).toHaveCount(1)
      const disc = (): Promise<{ w: number; h: number; x: number; y: number }> =>
        ring.locator('path[data-part="disc"]').evaluate((el) => {
          const b = (el as SVGGraphicsElement).getBoundingClientRect()
          return { w: b.width, h: b.height, x: b.x + b.width / 2, y: b.y + b.height / 2 }
        })
      const first = await disc()
      // К ключу 2 кольцо уезжает вглубь поля (дальше от камеры): на экране оно меньше.
      await seekVideo(win, 2.06)
      const g = (await geo<{ center: { x: number; y: number } }>(ring)).center
      const far = project(g.x, g.y - 22)
      const nearPt = project(g.x, g.y)
      const layer = await layerBox(win)
      const px = (p: { x: number; y: number }): [number, number] => [
        layer.x + p.x * layer.width,
        layer.y + p.y * layer.height
      ]
      const [x0, y0] = px(nearPt)
      const [x1, y1] = px(far)
      await win.mouse.move(x0, y0)
      await win.mouse.down()
      await win.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 5 })
      await win.mouse.move(x1, y1, { steps: 5 })
      await win.mouse.up()
      await expect(keys(win)).toHaveCount(2)
      const last = await disc()
      console.log('Кольцо вглубь: ширина диска px', first.w.toFixed(1), '→', last.w.toFixed(1))
      expect(last.w).toBeLessThan(first.w * 0.8)
      await seekVideo(win, 1.54)
      await win.getByTestId('ease-linear').click()
      const mid = await disc()
      expect(mid.w).toBeLessThan(first.w)
      expect(mid.w).toBeGreaterThan(last.w)
      await shot(win, 'pitch-ring-mid')

      // Слой «под игроками» (кольцо на траве под игроками по умолчанию): воспроизведение, частота растеризации.
      const canvas = win.getByTestId('under-canvas')
      await expect(canvas).toHaveAttribute('data-renderer', 'webgl2')
      await win.keyboard.press('Escape')
      await seekVideo(win, 1.0)
      await win.keyboard.press('Space')
      await expect.poll(async () => (await videoState(win))!.paused).toBe(false)
      const before = await canvas.evaluate((c) => ({
        r: Number(c.getAttribute('data-rasters') ?? 0),
        f: Number(c.getAttribute('data-frames') ?? 0)
      }))
      await win.waitForTimeout(1000)
      const after = await canvas.evaluate((c) => ({
        r: Number(c.getAttribute('data-rasters') ?? 0),
        f: Number(c.getAttribute('data-frames') ?? 0)
      }))
      await win.keyboard.press('Space')
      console.log(
        'Слой «под игроками» при воспроизведении, за ~1 с: растеризаций',
        after.r - before.r,
        ', кадров видео в текстуру',
        after.f - before.f
      )
      expect(after.r - before.r).toBeGreaterThanOrEqual(8)
      expect(after.f - before.f).toBeGreaterThanOrEqual(15)
    } finally {
      await ctx.app.close()
    }
  })

  test('панель стиля: элементы не налезают друг на друга при окне 1100, 1440 и 1920 для каждого инструмента, скриншоты', async () => {
    const ctx = await launch()
    const { win, app } = ctx
    try {
      await openPitch(ctx, 'Панель стиля')
      await calibrate(win)
      await saveCalibration(win)
      await win.getByTestId('tool-circle').click()
      await expect(win.getByTestId('pitch-active')).toHaveAttribute('data-stale', 'false')
      const sizes: Array<[number, number]> = [
        [1100, 720],
        [1440, 860],
        [1920, 1080]
      ]
      for (const [w, h] of sizes) {
        await app.evaluate(
          ({ BrowserWindow }, [width, height]) => {
            BrowserWindow.getAllWindows()[0].setSize(width, height)
          },
          [w, h]
        )
        await win.waitForFunction((width) => window.innerWidth >= width - 20, w)
        await win.waitForTimeout(400)
        for (const tool of ['select', 'arrow', 'circle', 'text', 'ruler']) {
          await win.getByTestId(`tool-${tool}`).click()
          await win.waitForTimeout(100)
          const info = await win.getByTestId('style-bar').evaluate((el) => {
            const box = el.getBoundingClientRect()
            const kids = [...el.querySelectorAll('button, [data-testid="pitch-active"]')]
              .map((k) => ({
                id: k.getAttribute('data-testid') ?? k.className,
                r: k.getBoundingClientRect()
              }))
              .filter((k) => k.r.width > 0 && k.r.height > 0)
            const overlaps: string[] = []
            for (let i = 0; i < kids.length; i += 1) {
              for (let j = i + 1; j < kids.length; j += 1) {
                const p = kids[i].r
                const q = kids[j].r
                const dx = Math.min(p.right, q.right) - Math.max(p.left, q.left)
                const dy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top)
                if (dx > 1 && dy > 1) overlaps.push(`${kids[i].id}|${kids[j].id}`)
              }
            }
            const outside = kids
              .filter(
                (k) =>
                  k.r.right > box.right + 0.5 ||
                  k.r.left < box.left - 0.5 ||
                  k.r.bottom > box.bottom + 0.5 ||
                  k.r.top < box.top - 0.5
              )
              .map((k) => k.id)
            return { overlaps, outside, height: box.height, count: kids.length }
          })
          expect(info.count, `${tool} @${w}`).toBeGreaterThan(10)
          expect(info.overlaps, `наложения: ${tool} @${w}`).toEqual([])
          expect(info.outside, `за краем панели: ${tool} @${w}`).toEqual([])
          expect(info.height).toBeLessThanOrEqual(80)
          if (tool === 'circle') {
            await win.screenshot({ path: join(SHOTS, `animation-stylebar-${w}${SUFFIX}.png`) })
          }
        }
        await win.getByTestId('tool-circle').click()
        // Все кнопки на месте и видны.
        for (const id of [
          'pitch-calibrate',
          'pitch-on',
          'under-toggle',
          'grass-button',
          'undo',
          'redo'
        ]) {
          await expect(win.getByTestId(id)).toBeVisible()
        }
        await expect(win.getByTestId('pitch-active')).toBeVisible()
      }
      // Окно «Газон» из значка раскрывается и не выходит за окно.
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].setSize(1100, 720)
      })
      await win.waitForTimeout(400)
      await win.getByTestId('grass-button').click()
      await expect(win.getByTestId('grass-popover')).toBeVisible()
      const pop = (await win.getByTestId('grass-popover').boundingBox())!
      expect(pop.x).toBeGreaterThanOrEqual(0)
      expect(pop.x + pop.width).toBeLessThanOrEqual(1100)
      await win.screenshot({ path: join(SHOTS, `animation-stylebar-grass-1100${SUFFIX}.png`) })
    } finally {
      await app.close()
    }
  })
})
