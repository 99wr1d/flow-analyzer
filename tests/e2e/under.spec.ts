// Этап 16a: рисунки «под игроками» (ключ по газону, как в телевизионной телестрации).
// Настоящее приложение: поле pitch.mp4 (газон с полосами, маленькие игроки) и players.mp4 (крупные игроки).
// По пикселям скриншота окна и кадра готового видео проверяется: на траве рисунок виден, на игроке — нет, подпись поверх.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import { mkdirSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { ff, frameRgb, pixelAt } from '../../src/main/ffmpeg/ffmpeg.testkit'
import { grassMask, parseHex, rgbToU, rgbToV, toHex } from '../../src/shared/grassKey'
import { SHOTS, SUFFIX, fixture, launch, makeUserData, seekVideo, stubDialog } from './helpers'
import { calibrate, openPitch, project, saveCalibration, truth, type Pt } from './pitchHelpers'
import { cardByTitle, createProject, seedProject } from './startHelpers'
import {
  clickAt,
  dragPath,
  colorDiff,
  layerBox,
  readPng,
  setRange,
  shapes,
  type Frac,
  type Pixels
} from './toolsHelpers'

type Ctx = { app: ElectronApplication; win: Page; userData: string; projectsDir: string }
type Rgb = [number, number, number]

const shot = (win: Page, name: string): Promise<Buffer> =>
  win.screenshot({ path: join(SHOTS, `under-${name}${SUFFIX}.png`) })
const png = async (win: Page, name: string): Promise<Pixels> =>
  readPng(await win.screenshot(), SHOTS, `under-px-${name}`)

const canvasOf = (win: Page): Locator => win.getByTestId('under-canvas')
const luma = ([r, g, b]: Rgb): number => 0.299 * r + 0.587 * g + 0.114 * b

/** Кадр pitch.mp4 в момент 1.0 с (кадр 25) в родном размере и красная майка ближнего игрока (центр, доли кадра). */
const W = truth.frame.w
const H = truth.frame.h
function findShirt(): { frame: Buffer; shirt: Frac; grassInZone: Frac } {
  const frame = frameRgb(fixture('pitch.mp4'), 25, W, H)
  const foot = project(truth.players[0].world.x, truth.players[0].world.y)
  let sx = 0
  let sy = 0
  let n = 0
  for (let y = Math.round(foot.y * H) - 60; y < Math.round(foot.y * H) + 10; y += 1) {
    for (let x = Math.round(foot.x * W) - 40; x < Math.round(foot.x * W) + 40; x += 1) {
      const [r, g, b] = pixelAt(frame, W, x, y)
      if (r > 170 && g < 90 && b < 100) {
        sx += x
        sy += y
        n += 1
      }
    }
  }
  expect(n, 'красная майка на кадре').toBeGreaterThan(40)
  const g = project(truth.players[0].world.x + 2.4, truth.players[0].world.y + 0.6)
  return { frame, shirt: [sx / n / W, sy / n / H], grassInZone: [g.x, g.y] }
}

/** Зона 8×8 м на траве вокруг ближнего игрока (поле размечено): жёлтая, непрозрачность 60 %. */
async function drawZoneAroundPlayer(win: Page): Promise<void> {
  const c = truth.players[0].world
  await win.keyboard.press('z')
  const corners = [
    [c.x - 4, c.y - 4],
    [c.x + 4, c.y - 4],
    [c.x + 4, c.y + 4],
    [c.x - 4, c.y + 4]
  ]
  for (const [x, y] of corners) {
    const p = project(x, y)
    await clickAt(win, [p.x, p.y])
  }
  await win.keyboard.press('Enter')
  await expect(shapes(win, 'pzone')).toHaveCount(1)
  await win.keyboard.press('v')
  await setRange(win.getByTestId('prop-opacity'), 60)
}

async function pitchProject(ctx: Ctx, title = 'Под игроками'): Promise<void> {
  await openPitch(ctx, title)
  await calibrate(ctx.win)
  await saveCalibration(ctx.win)
}

/** Ждёт, пока слой «под игроками» нарисовал рисунки и кадр (по счётчикам, которые он ведёт). */
async function waitUnderDrawn(win: Page): Promise<void> {
  await expect(canvasOf(win)).toHaveAttribute('data-renderer', 'webgl2')
  await expect
    .poll(async () => Number((await canvasOf(win).getAttribute('data-rasters')) ?? 0), {
      timeout: 10_000
    })
    .toBeGreaterThan(0)
  await win.waitForTimeout(250)
}

// GRASS_TAILS_ADDED
const info = JSON.parse(readFileSync(fixture('players.json'), 'utf8')) as {
  line: { y: number; h: number }
  players: Array<{ name: string; x: number; y: number; w: number; h: number }>
}
const W2 = 640
const H2 = 360

async function playersProject(ctx: Ctx, title: string): Promise<void> {
  await createProject(ctx, { title, video: fixture('players.mp4') })
  await seekVideo(ctx.win, 1)
  await ctx.win.keyboard.press('Escape')
}

/** Центр игрока (доли кадра). */
function playerCenter(name: string): Frac {
  const p = info.players.find((x) => x.name === name)!
  return [(p.x + p.w / 2) / W2, (p.y + p.h / 2) / H2]
}

const playersFrame = (): Buffer => frameRgb(fixture('players.mp4'), 25, W2, H2)

/** Цвет кадра players.mp4 в точке (доли кадра): среднее по окну 3×3. */
function sourceColor(f: Frac): Rgb {
  const frame = playersFrame()
  const cx = Math.round(f[0] * W2)
  const cy = Math.round(f[1] * H2)
  const sum = [0, 0, 0]
  for (let y = cy - 1; y <= cy + 1; y += 1) {
    for (let x = cx - 1; x <= cx + 1; x += 1) {
      const p = pixelAt(frame, W2, x, y)
      for (let i = 0; i < 3; i += 1) sum[i] += p[i]
    }
  }
  return sum.map((v) => v / 9) as Rgb
}

const hexOf = ([r, g, b]: Rgb): string => toHex(r, g, b)
/** Расстояние между цветами по цветности (U и V ключа). */
const uvDistance = (a: Rgb, b: Rgb): number =>
  Math.hypot(rgbToU(...a) - rgbToU(...b), rgbToV(...a) - rgbToV(...b))

/** Маска «газон» по TS-функции на кадре players.mp4 (яркость 0..255 по пикселям кадра). */
function tsMaskOf(key: Rgb): Uint8Array {
  const rgb = playersFrame()
  const rgba = new Uint8Array(W2 * H2 * 4)
  for (let i = 0; i < W2 * H2; i += 1) {
    rgba[i * 4] = rgb[i * 3]
    rgba[i * 4 + 1] = rgb[i * 3 + 1]
    rgba[i * 4 + 2] = rgb[i * 3 + 2]
    rgba[i * 4 + 3] = 255
  }
  return grassMask(rgba, W2, H2, { color: hexOf(key), similarity: 0.07, blend: 0.05 })
}

/** Ждёт, пока слой нарисовал хотя бы один кадр (маска без рисунков). */
async function waitMaskDrawn(win: Page): Promise<void> {
  await expect
    .poll(async () => Number((await canvasOf(win).getAttribute('data-frames')) ?? 0), {
      timeout: 10_000
    })
    .toBeGreaterThan(0)
  await win.waitForTimeout(250)
}

test.describe('рисунки под игроками', () => {
  test('поле: зона уходит под игрока, на траве видна; «Под игроками» выключено — поверх всего', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await pitchProject(ctx)
      await win.keyboard.press('Escape')
      await win.waitForTimeout(150)
      const { shirt, grassInZone } = findShirt()
      const layer = await layerBox(win)
      const at = (p: Pixels, f: Frac): Rgb =>
        p.at(layer.x + f[0] * layer.width, layer.y + f[1] * layer.height)
      const base = await png(win, 'base')
      await shot(win, 'before')

      await drawZoneAroundPlayer(win)
      const zone = shapes(win, 'pzone').first()
      await expect(zone).toHaveAttribute('data-under', 'true')
      await expect(win.getByTestId('prop-under')).toBeChecked()
      await expect(win.getByTestId('under-toggle')).toHaveAttribute('aria-pressed', 'true')
      await waitUnderDrawn(win)
      await expect(canvasOf(win)).toHaveAttribute('data-items', '1')
      // Выделение: у рисунка «под игроками» поверх остаётся бледная обводка, чтобы за него можно было взяться.
      await expect(win.getByTestId('handles')).toBeVisible()

      // Подпись площади («64.0 м²») лежит над игроком и остаётся сверху: подписи всегда поверх.
      await win.keyboard.press('Escape')
      await win.waitForTimeout(250)
      const labelled = await png(win, 'labelled')
      await shot(win, 'zone-label-on-top')
      expect(colorDiff(at(labelled, shirt), at(base, shirt))).toBeGreaterThan(60)

      // Без подписи на майке игрока остаётся его цвет, а рядом на траве — жёлтая зона.
      await win.keyboard.press('v')
      await clickAt(win, grassInZone)
      await win.getByTestId('prop-area').uncheck()
      await win.keyboard.press('Escape')
      await win.waitForTimeout(250)
      const under = await png(win, 'under')
      await shot(win, 'zone-under-player')
      const dShirtUnder = colorDiff(at(under, shirt), at(base, shirt))
      const dGrassUnder = colorDiff(at(under, grassInZone), at(base, grassInZone))
      console.log(
        `Зона под игроком: майка отличается от исходной на ${dShirtUnder.toFixed(1)}, трава в зоне — на ${dGrassUnder.toFixed(1)}`
      )
      expect(dGrassUnder).toBeGreaterThan(35)
      expect(dShirtUnder).toBeLessThan(10)

      // Выключаем «Под игроками»: зона ложится поверх игрока.
      await win.keyboard.press('v')
      await clickAt(win, grassInZone)
      await expect(win.getByTestId('inspector')).toBeVisible()
      await win.getByTestId('prop-under').uncheck()
      await expect(zone).toHaveAttribute('data-under', 'false')
      await expect(win.getByTestId('under-toggle')).toHaveAttribute('aria-pressed', 'false')
      await expect(canvasOf(win)).toHaveAttribute('data-items', '0')
      await win.keyboard.press('Escape')
      await win.waitForTimeout(250)
      const over = await png(win, 'over')
      await shot(win, 'zone-over-player')
      const dShirtOver = colorDiff(at(over, shirt), at(base, shirt))
      console.log(`Зона поверх игрока: майка отличается от исходной на ${dShirtOver.toFixed(1)}`)
      expect(dShirtOver).toBeGreaterThan(35)
      // Включаем обратно: игрок снова чистый.
      await win.keyboard.press('v')
      await clickAt(win, grassInZone)
      await win.getByTestId('prop-under').check()
      await win.keyboard.press('Escape')
      await win.waitForTimeout(300)
      const again = await png(win, 'again')
      expect(colorDiff(at(again, shirt), at(base, shirt))).toBeLessThan(10)
    } finally {
      await ctx.app.close()
    }
  })

  test('газон: цвет находится сам, пипетка, маска, ползунки, сброс (players.mp4)', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await playersProject(ctx, 'Газон')
      const layer = await layerBox(win)
      const at = (p: Pixels, f: Frac): Rgb =>
        p.at(layer.x + f[0] * layer.width, layer.y + f[1] * layer.height)
      const redC = playerCenter('red')
      const blueC = playerCenter('blue')
      const grassC: Frac = [0.05, 0.2]
      const lineC: Frac = [0.2, (info.line.y + info.line.h / 2) / H2]

      // Окно «Газон»: цвет определён автоматически, он совпадает с цветом газона на кадре.
      await win.getByTestId('grass-button').click()
      await expect(win.getByTestId('grass-popover')).toBeVisible()
      await shot(win, 'popover')
      const swatch = win.getByTestId('grass-swatch')
      await expect(swatch).toHaveAttribute('data-auto', 'true')
      const found = (await swatch.getAttribute('data-color'))!
      const truthGrass = sourceColor(grassC)
      console.log(`Цвет газона: найден ${found}, на кадре ${hexOf(truthGrass)}`)
      expect(uvDistance(parseHex(found), truthGrass)).toBeLessThan(6)

      // Маска: белое — газон, чёрное — игроки и линия.
      await win.getByTestId('grass-mask').check()
      await expect(canvasOf(win)).toHaveAttribute('data-mask', 'true')
      await waitMaskDrawn(win)
      await win.getByTestId('grass-button').click()
      await win.waitForTimeout(250)
      const mask = await png(win, 'mask')
      await shot(win, 'mask')
      console.log(
        'Маска: трава',
        luma(at(mask, grassC)).toFixed(0),
        'красный',
        luma(at(mask, redC)).toFixed(0),
        'синий',
        luma(at(mask, blueC)).toFixed(0),
        'линия',
        luma(at(mask, lineC)).toFixed(0)
      )
      expect(luma(at(mask, grassC))).toBeGreaterThan(235)
      expect(luma(at(mask, redC))).toBeLessThan(25)
      expect(luma(at(mask, blueC))).toBeLessThan(25)
      expect(luma(at(mask, lineC))).toBeLessThan(90)
      // Маска из WebGL совпадает с расчётом TS-функции на том же кадре (в однотонных местах).
      const tsMask = tsMaskOf(parseHex(found))
      for (const f of [grassC, redC, blueC, playerCenter('yellow'), [0.7, 0.9] as Frac]) {
        const want = tsMask[Math.round(f[1] * H2) * W2 + Math.round(f[0] * W2)]
        expect(Math.abs(luma(at(mask, f)) - want), `маска в ${f}`).toBeLessThan(10)
      }

      // Пипетка по игроку: цвет газона теперь «красный», маска переворачивается.
      await win.getByTestId('grass-button').click()
      await win.getByTestId('grass-eyedropper').click()
      await expect(win.getByTestId('eyedropper-layer')).toBeVisible()
      await shot(win, 'eyedropper')
      await clickAt(win, redC)
      await expect(win.getByTestId('eyedropper-layer')).toHaveCount(0)
      await expect(swatch).toHaveAttribute('data-auto', 'false')
      const picked = parseHex((await swatch.getAttribute('data-color'))!)
      expect(colorDiff(picked, sourceColor(redC))).toBeLessThan(25)
      await win.getByTestId('grass-button').click()
      await win.waitForTimeout(250)
      const flipped = await png(win, 'flipped')
      expect(luma(at(flipped, redC))).toBeGreaterThan(235)
      expect(luma(at(flipped, grassC))).toBeLessThan(25)
      await win.getByTestId('grass-button').click()

      // Пипетка по траве возвращает обычную картину.
      await win.getByTestId('grass-eyedropper').click()
      await clickAt(win, grassC)
      await expect(swatch).toHaveAttribute('data-auto', 'false')
      const pickedGrass = parseHex((await swatch.getAttribute('data-color'))!)
      expect(colorDiff(pickedGrass, truthGrass)).toBeLessThan(14)
      // Esc отменяет пипетку без выбора цвета.
      await win.getByTestId('grass-eyedropper').click()
      await expect(win.getByTestId('eyedropper-layer')).toBeVisible()
      await win.keyboard.press('Escape')
      await expect(win.getByTestId('eyedropper-layer')).toHaveCount(0)
      await expect(win.getByTestId('grass-popover')).toBeVisible()

      // Чувствительность 50 %: «газоном» считается почти всё, игроки белеют.
      await setRange(win.getByTestId('grass-similarity'), 50)
      await expect(win.getByTestId('grass-similarity-value')).toHaveText('50 %')
      await win.getByTestId('grass-button').click()
      await win.waitForTimeout(300)
      const wide = await png(win, 'wide')
      await shot(win, 'mask-wide')
      expect(luma(at(wide, redC))).toBeGreaterThan(235)
      expect(luma(at(wide, blueC))).toBeGreaterThan(235)
      await win.getByTestId('grass-button').click()

      // Мягкость края: переход у игрока шире при 30 %, чем при 0 %.
      await setRange(win.getByTestId('grass-similarity'), 7)
      const edge = async (blend: number): Promise<number> => {
        await setRange(win.getByTestId('grass-blend'), blend)
        await win.getByTestId('grass-button').click()
        await win.waitForTimeout(300)
        const p = await png(win, `edge-${blend}`)
        await win.getByTestId('grass-button').click()
        // Строка пикселей поперёк левого края красного игрока.
        const y = layer.y + redC[1] * layer.height
        const edgeX = layer.x + (info.players[0].x / W2) * layer.width
        let mid = 0
        for (let x = edgeX - 14; x <= edgeX + 14; x += 1) {
          const l = luma(p.at(x, y))
          if (l > 30 && l < 225) mid += 1
        }
        return mid
      }
      const hard = await edge(0)
      const soft = await edge(30)
      console.log(`Переход маски у края игрока: ${hard} px при 0 %, ${soft} px при 30 %`)
      expect(soft).toBeGreaterThan(hard + 1)

      // Сброс: цвет снова автоматический, ползунки по умолчанию, маска как вначале.
      await win.getByTestId('grass-reset').click()
      await expect(swatch).toHaveAttribute('data-auto', 'true')
      await expect(win.getByTestId('grass-similarity-value')).toHaveText('7 %')
      await expect(win.getByTestId('grass-blend-value')).toHaveText('5 %')
      expect(
        uvDistance(parseHex((await swatch.getAttribute('data-color'))!), truthGrass)
      ).toBeLessThan(6)
      await win.getByTestId('grass-button').click()
      await win.waitForTimeout(300)
      const reset = await png(win, 'reset')
      expect(luma(at(reset, redC))).toBeLessThan(25)
      expect(luma(at(reset, grassC))).toBeGreaterThan(235)
      // Пока маска включена, в углу висит плашка; щелчок по ней возвращает видео.
      await expect(win.getByTestId('mask-badge')).toBeVisible()
      await win.getByTestId('mask-badge').click()
      await expect(win.getByTestId('mask-badge')).toHaveCount(0)
      await expect(canvasOf(win)).toHaveAttribute('data-mask', 'false')
      await win.waitForTimeout(250)
      const plain = await png(win, 'plain')
      expect(colorDiff(at(plain, redC), sourceColor(redC))).toBeLessThan(25)
    } finally {
      await ctx.app.close()
    }
  })

  test('сохранение: настройки газона и «Под игроками» возвращаются после открытия; без правок в файле их нет', async () => {
    const ctx = await launch()
    let { app, win } = ctx
    const { userData, projectsDir } = ctx
    try {
      await playersProject(ctx, 'Сохранение газона')
      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      const file = (): string =>
        join(
          projectsDir,
          readdirSync(projectsDir).find((n) => n.endsWith('.flowproj'))!
        )
      const saved = (): {
        grassKey?: Record<string, unknown>
        annotations: Array<Record<string, unknown>>
      } => JSON.parse(readFileSync(file(), 'utf8'))
      // Ничего не трогали — в файле настроек газона нет (старый формат).
      expect(saved().grassKey).toBeUndefined()

      // Правим настройки: проект становится «грязным».
      await win.getByTestId('grass-button').click()
      await win.getByTestId('grass-eyedropper').click()
      await clickAt(win, [0.05, 0.2])
      await setRange(win.getByTestId('grass-similarity'), 22)
      await setRange(win.getByTestId('grass-blend'), 11)
      const color = (await win.getByTestId('grass-swatch').getAttribute('data-color')) ?? ''
      await win.getByTestId('grass-button').click()
      await expect(win.getByTestId('project-dirty')).toBeVisible()
      // Зона на экране, положена под игроков.
      await win.getByTestId('tool-zone').click()
      await win.getByTestId('under-toggle').click()
      await expect(win.getByTestId('under-toggle')).toHaveAttribute('aria-pressed', 'true')
      for (const f of [
        [0.08, 0.55],
        [0.45, 0.55],
        [0.45, 0.75],
        [0.08, 0.75]
      ] as Frac[]) {
        await clickAt(win, f)
      }
      await win.keyboard.press('Enter')
      await expect(shapes(win, 'zone')).toHaveAttribute('data-under', 'true')
      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      const json = saved()
      expect(json.grassKey).toEqual({
        color,
        similarity: 0.22,
        blend: 0.11,
        auto: false,
        from: expect.any(Number)
      })
      expect(json.annotations[0].underPlayers).toBe(true)
      await app.close()

      // Открываем снова: всё на месте.
      const next = await launch({ userData })
      app = next.app
      win = next.win
      await cardByTitle(win, 'Сохранение газона').getByTestId('card-open-main').click()
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await seekVideo(win, 1)
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      await win.getByTestId('grass-button').click()
      await expect(win.getByTestId('grass-swatch')).toHaveAttribute('data-color', color)
      await expect(win.getByTestId('grass-swatch')).toHaveAttribute('data-auto', 'false')
      await expect(win.getByTestId('grass-similarity-value')).toHaveText('22 %')
      await expect(win.getByTestId('grass-blend-value')).toHaveText('11 %')
      await win.getByTestId('grass-button').click()
      await expect(shapes(win, 'zone')).toHaveAttribute('data-under', 'true')
      await expect(canvasOf(win)).toHaveAttribute('data-items', '1')

      // «Сбросить (авто)» — проект с правкой, а после сохранения настроек в файле снова нет.
      await win.getByTestId('grass-button').click()
      await win.getByTestId('grass-reset').click()
      await expect(win.getByTestId('project-dirty')).toBeVisible()
      await win.getByTestId('grass-button').click()
      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      expect(saved().grassKey).toBeUndefined()
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('старый проект: рисунки без поля underPlayers открываются со значениями по умолчанию', async () => {
    const ctx = await launch()
    const { app, projectsDir } = ctx
    try {
      mkdirSync(projectsDir, { recursive: true })
      const file = join(projectsDir, 'старый.flowproj')
      seedProject(file, {
        video: fixture('players.mp4'),
        meta: { title: 'Старый газон', type: 'other' },
        annotations: 2
      })
      await app.close()
      const next = await launch({ userData: ctx.userData })
      const win = next.win
      await cardByTitle(win, 'Старый газон').getByTestId('card-open-main').click()
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await seekVideo(win, 1.5)
      await expect(shapes(win, 'arrow')).toHaveCount(2)
      // Рисунки на экране по умолчанию лежат поверх игроков; слой «под игроками» пуст.
      await expect(shapes(win, 'arrow').first()).toHaveAttribute('data-under', 'false')
      await expect(canvasOf(win)).toHaveAttribute('data-items', '0')
      await win.getByTestId('grass-button').click()
      await expect(win.getByTestId('grass-swatch')).toHaveAttribute('data-auto', 'true')
      await next.app.close()
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('«Под игроками» для новых рисунков запоминается отдельно для поля и экрана', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await pitchProject(ctx, 'Запоминание')
      const toggle = win.getByTestId('under-toggle')
      // Инструмент «Выбор» без выбранного рисунка: переключать нечего.
      await expect(toggle).toBeDisabled()
      await win.getByTestId('tool-circle').click()
      // На поле новые рисунки по умолчанию под игроками.
      await expect(win.getByTestId('pitch-on')).toHaveAttribute('aria-pressed', 'true')
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      // Рисунок на экране: по умолчанию поверх игроков; включаем «Под игроками».
      await win.getByTestId('pitch-on').click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await toggle.click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      // Обратно «На поле»: помнит выбор для поля (выключено), потом экран — включено.
      await win.getByTestId('pitch-on').click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await win.getByTestId('pitch-on').click()
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      // Подписи и лупа: переключатель недоступен (всегда сверху).
      await win.getByTestId('tool-text').click()
      await expect(toggle).toBeDisabled()
      await win.getByTestId('tool-loupe').click()
      await expect(toggle).toBeDisabled()
      // Новый рисунок получает запомненное значение: на экране — включено, на поле — выключено.
      await win.getByTestId('tool-circle').click()
      await dragPath(win, [
        [0.3, 0.2],
        [0.4, 0.28]
      ])
      await expect(shapes(win, 'circle')).toHaveAttribute('data-under', 'true')
      await win.getByTestId('pitch-on').click()
      const spot = truth.points.penaltySpot.image
      await clickAt(win, [spot.x, spot.y])
      await expect(shapes(win, 'ring')).toHaveAttribute('data-under', 'false')
    } finally {
      await ctx.app.close()
    }
  })

  test('без WebGL2: рисунки рисуются поверх, одно уведомление', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      // До открытия видео WebGL2 «пропадает» (как на очень старом видеоадаптере).
      await win.evaluate(() => {
        const original = HTMLCanvasElement.prototype.getContext
        HTMLCanvasElement.prototype.getContext = function (
          this: HTMLCanvasElement,
          type: string,
          ...rest: unknown[]
        ) {
          if (type === 'webgl2') return null
          return (original as (...a: unknown[]) => unknown).call(this, type, ...rest)
        } as typeof original
      })
      await pitchProject(ctx, 'Без WebGL')
      await win.keyboard.press('Escape')
      await win.waitForTimeout(150)
      const { shirt } = findShirt()
      const layer = await layerBox(win)
      const at = (p: Pixels, f: Frac): Rgb =>
        p.at(layer.x + f[0] * layer.width, layer.y + f[1] * layer.height)
      const base = await png(win, 'nogl-base')
      await drawZoneAroundPlayer(win)
      await win.getByTestId('prop-area').uncheck()
      await expect(shapes(win, 'pzone')).toHaveAttribute('data-under', 'true')
      await expect(win.getByTestId('toast')).toContainText('на экране недоступен')
      await win.keyboard.press('Escape')
      await win.waitForTimeout(300)
      const over = await png(win, 'nogl-over')
      await shot(win, 'no-webgl')
      // Без WebGL зона нарисована поверх игрока.
      expect(colorDiff(at(over, shirt), at(base, shirt))).toBeGreaterThan(30)
      await expect(canvasOf(win)).toHaveAttribute('data-renderer', 'none')
    } finally {
      await ctx.app.close()
    }
  })

  test('экспорт: кадр готового видео совпадает с экраном — трава в зоне окрашена, игрок чистый', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await pitchProject(ctx, 'Экспорт под игроками')
      await win.keyboard.press('Escape')
      await win.waitForTimeout(150)
      const { shirt, grassInZone } = findShirt()
      const layer = await layerBox(win)
      const at = (p: Pixels, f: Frac): Rgb =>
        p.at(layer.x + f[0] * layer.width, layer.y + f[1] * layer.height)
      const base = await png(win, 'exp-base')

      await drawZoneAroundPlayer(win)
      await win.getByTestId('prop-area').uncheck()
      // Рисунок «Отрезок»: виден с кадра разметки до конца видео, поэтому в экспорте нет стоп-кадров.
      await win.getByTestId('mode-range').click()
      await win.keyboard.press('Escape')
      await seekVideo(win, 1.2)
      await win.waitForTimeout(350)
      const screen = await png(win, 'exp-screen')
      const scrDelta = (f: Frac): Rgb =>
        [0, 1, 2].map((i) => at(screen, f)[i] - at(base, f)[i]) as Rgb

      const out = join(makeUserData(), 'out')
      mkdirSync(out)
      await stubDialog(app, out)
      await win.getByTestId('export-open').click()
      await expect(win.getByTestId('export-scope-whole')).toBeChecked()
      await expect(win.getByTestId('export-drawings')).toBeChecked()
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 90_000 })
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done')
      const file = join(out, readdirSync(out)[0])
      await win
        .getByTestId('export-close')
        .click()
        .catch(() => undefined)

      const index = 30 // 1.2 с: зона уже видна
      const exported = frameRgb(file, index, W, H)
      const source = frameRgb(fixture('pitch.mp4'), index, W, H)
      ff([
        '-i',
        file,
        '-vf',
        `select=eq(n\\,${index})`,
        '-frames:v',
        '1',
        '-y',
        join(SHOTS, `under-export-frame${SUFFIX}.png`)
      ])
      const vpx = (frame: Buffer, f: Frac): Rgb =>
        pixelAt(frame, W, Math.round(f[0] * W), Math.round(f[1] * H))
      const expDelta = (f: Frac): Rgb =>
        [0, 1, 2].map((i) => vpx(exported, f)[i] - vpx(source, f)[i]) as Rgb
      const dShirt = colorDiff(vpx(exported, shirt), vpx(source, shirt))
      const dGrass = colorDiff(vpx(exported, grassInZone), vpx(source, grassInZone))
      const scr = scrDelta(grassInZone)
      const exp = expDelta(grassInZone)
      console.log(
        `Экспорт: майка отличается от исходной на ${dShirt.toFixed(1)}, трава в зоне — на ${dGrass.toFixed(1)}; ` +
          `окрашивание травы: экран ${scr.map((v) => v.toFixed(0)).join('/')}, видео ${exp.map((v) => v.toFixed(0)).join('/')}`
      )
      expect(dShirt).toBeLessThan(12)
      expect(dGrass).toBeGreaterThan(35)
      // Экран и готовое видео окрашивают траву одинаково (в пределах сжатия и масштаба).
      for (let i = 0; i < 3; i += 1) expect(Math.abs(scr[i] - exp[i])).toBeLessThan(30)
      expect(colorDiff(at(screen, shirt), at(base, shirt))).toBeLessThan(10)
    } finally {
      await app.close()
    }
  })

  test('кольцо радиусом 3 м: задняя дуга уходит под игрока, передняя — на траве', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await pitchProject(ctx, 'Кольцо')
      await win.keyboard.press('Escape')
      await win.waitForTimeout(150)
      const c = truth.players[0].world
      const layer = await layerBox(win)
      const frac = (p: Pt): Frac => [p.x, p.y]
      const at = (p: Pixels, f: Frac): Rgb =>
        p.at(layer.x + f[0] * layer.width, layer.y + f[1] * layer.height)
      const { shirt } = findShirt() // майка игрока: диск кольца и задняя дуга лежат за ней
      const front = frac(project(c.x, c.y + 3)) // дуга перед игроком: на траве
      const base = await png(win, 'ring-base')
      // Кольцо протягиванием: радиус 3 м.
      await win.getByTestId('tool-circle').click()
      await dragPath(win, [frac(project(c.x, c.y)), frac(project(c.x + 3, c.y))])
      await expect(shapes(win, 'ring')).toHaveCount(1)
      await expect(shapes(win, 'ring')).toHaveAttribute('data-under', 'true')
      await waitUnderDrawn(win)
      await win.keyboard.press('v')
      await win.keyboard.press('Escape')
      await win.waitForTimeout(250)
      const under = await png(win, 'ring-under')
      await shot(win, 'ring-under-player')
      const dBack = colorDiff(at(under, shirt), at(base, shirt))
      // Обводка тонкая: ищем наибольшее изменение в окне вокруг точки передней дуги.
      let dFront = 0
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const f: Frac = [front[0] + dx / layer.width, front[1] + dy / layer.height]
          dFront = Math.max(dFront, colorDiff(at(under, f), at(base, f)))
        }
      }
      console.log(
        `Кольцо 3 м: майка игрока меняется на ${dBack.toFixed(1)}, передняя дуга (на траве) — на ${dFront.toFixed(1)}`
      )
      expect(dBack).toBeLessThan(12)
      expect(dFront).toBeGreaterThan(40)

      // Воспроизведение: слой берёт каждый показанный кадр (счётчик растёт), без перерисовки интерфейса.
      await win.keyboard.press('v')
      await clickAt(win, front)
      await win.getByTestId('mode-range').click()
      await win.keyboard.press('Escape')
      await seekVideo(win, 1.1)
      await win.waitForTimeout(200)
      const frames = async (): Promise<number> =>
        Number((await canvasOf(win).getAttribute('data-frames')) ?? 0)
      const before = await frames()
      await win.getByTestId('play-toggle').click()
      await win.waitForTimeout(700)
      await win.getByTestId('play-toggle').click()
      const during = (await frames()) - before
      console.log(`Воспроизведение 0.7 с: слой нарисовал ${during} кадров`)
      expect(during).toBeGreaterThan(8)
      // На паузе кадры не грузятся.
      await win.waitForTimeout(400)
      const paused = await frames()
      await win.waitForTimeout(500)
      expect((await frames()) - paused).toBe(0)
    } finally {
      await ctx.app.close()
    }
  })
})
