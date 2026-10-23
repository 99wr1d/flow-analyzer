// Экспорт с рисунками: наложение на видео, стоп-кадры, «Всё видео целиком», переключатель «С рисунками».
// Настоящий ffmpeg; по пикселям выходных кадров проверяется, что рисунки попали куда нужно и когда нужно.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  countFrames,
  durationOf,
  ff,
  frameRgb,
  framesWhere,
  isWhite,
  pixelAt
} from '../../src/main/ffmpeg/ffmpeg.testkit'
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

type Ctx = { app: ElectronApplication; win: Page; userData: string }

/** Тёмный цвет рисунка (#111827): кодек H.264 чуть сдвигает цвета, поэтому порог мягкий. */
const isDark = ([r, g, b]: [number, number, number]): boolean => r < 80 && g < 80 && b < 80

const W = 640
const H = 360
const shot = (win: Page, name: string): Promise<Buffer> =>
  win.screenshot({ path: join(SHOTS, `${name}${SUFFIX}.png`) })
const dialog = (win: Page) => win.getByTestId('export-dialog')

function makeOutDir(): string {
  const dir = join(makeUserData(), 'out')
  mkdirSync(dir)
  return dir
}

/**
 * Приложение работает со своей временной папкой (TEMP/TMP), а не с общей системной: параллельные процессы на машине
 * (другие тесты, vitest) в неё ничего не кладут. Сколько в ней папок с временными картинками (после экспорта быть не должно).
 */
function ownTemp(): { dir: string; env: Record<string, string> } {
  const dir = join(makeUserData(), 'tmp')
  mkdirSync(dir)
  return { dir, env: { TEMP: dir, TMP: dir } }
}
const tempLeftovers = (dir: string): number =>
  readdirSync(dir).filter((n) => n.startsWith('flow-overlays-') || n.startsWith('flow-export-')).length

async function openVideo(ctx: Ctx, video = fixture('cfr25.mp4')): Promise<void> {
  await stubDialog(ctx.app, video)
  await ctx.win.getByTestId('open-video').click()
  await expect(ctx.win.getByTestId('play-toggle')).toBeEnabled()
  await expect(ctx.win.getByTestId('annotation-layer')).toBeVisible()
}

async function addEpisode(win: Page, start: number, end: number, digit: number): Promise<void> {
  await seekVideo(win, start)
  await win.keyboard.press('i')
  await seekVideo(win, end)
  await win.keyboard.press('o')
  await win.keyboard.press(`Digit${digit}`)
}

/** Белая толстая стрелка у левого края (по красной полосе фона): видна ≈ [from, from + seconds). */
async function drawArrow(win: Page, from: number, seconds: number): Promise<void> {
  await seekVideo(win, from)
  await win.getByTestId('tool-arrow').click()
  await win.getByTestId('color-ffffff').click()
  await win.getByTestId('width-2').click()
  await dragOnPicture(win, [0.05, 0.2], [0.3, 0.2])
  await win.getByTestId('duration-input').fill(String(seconds))
  await expect(win.getByTestId('duration-hint')).toHaveText(/^\s*$/)
}

/** Тёмный круг «Только кадр» на кадре, где стоит видео; стоп-кадр freeze секунд. */
async function drawFrameCircle(win: Page, at: number, freeze: string): Promise<void> {
  await seekVideo(win, at)
  await win.getByTestId('tool-circle').click()
  // С 0.16.4 новый круг лежит под игроками; на этом видео нет газона, поэтому рисунок кладём поверх.
  await win.getByTestId('under-toggle').click()
  await win.getByTestId('color-111827').click()
  await win.getByTestId('width-2').click()
  await dragOnPicture(win, [0.55, 0.55], [0.85, 0.9])
  await win.getByTestId('mode-frame').click()
  await expect(win.getByTestId('freeze-input')).toHaveValue('3')
  await win.getByTestId('freeze-input').fill(freeze)
  await expect(win.getByTestId('freeze-hint')).toContainText('кадр замрёт на это время')
}

// Точки проверки в пикселях видео: середина стрелки (белая на красной полосе) и левый край круга (тёмный на синей полосе).
const ARROW_PX = [Math.round(0.175 * W) - 1, Math.round(0.2 * H) - 1] as const
const CIRCLE_PX = [Math.round(0.55 * W) - 1, Math.round(0.725 * H) - 1] as const

test.describe('экспорт с рисунками', () => {
  test('отдельные файлы: рисунок-отрезок, стоп-кадр «Только кадр», длительность и пиксели', async () => {
    const tmp = ownTemp()
    const ctx = await launch({ env: tmp.env })
    const { app, win } = ctx
    const out = makeOutDir()
    const before = tempLeftovers(tmp.dir)
    try {
      await openVideo(ctx)
      await addEpisode(win, 1.0, 3.0, 1)
      // Стрелка виден [1.5, 2.5); круг на кадре 50 (2.02 с) со стоп-кадром 1.5 с.
      await drawArrow(win, 1.52, 1)
      await drawFrameCircle(win, 2.02, '1.5')
      // Подпись (отрезок 3 с от 2.02): попадает и в стоп-кадр, и в обычную часть видео. Рисунок идентичен экранному.
      await win.getByTestId('tool-text').click()
      const b = (await win.getByTestId('annotation-layer').boundingBox())!
      await win.mouse.click(b.x + 0.04 * b.width, b.y + 0.8 * b.height)
      await win.keyboard.type('Игрок №7: пас в центр')
      await win.keyboard.press('Enter')
      await expect(win.locator('[data-testid="annotation"][data-type="text"]')).toHaveCount(1)
      await shot(win, 'export-drawings-inspector')
      await win.getByTestId('tool-select').click()

      // Снимок экрана с обоими рисунками на кадре стоп-кадра — для сравнения с кадром экспорта.
      await seekVideo(win, 2.02)
      const layer = (await win.getByTestId('annotation-layer').boundingBox())!
      await win.screenshot({
        path: join(SHOTS, `export-drawings-screen${SUFFIX}.png`),
        clip: layer
      })

      await stubDialog(app, out)
      await win.getByTestId('export-open').click()
      await expect(win.getByTestId('export-scope-all')).toBeChecked()
      // Рисунки попадают в экспорт: «С рисунками» включено, сводка с учётом стоп-кадра (2 + 1.5 = 3.5 → 0:04).
      await expect(win.getByTestId('export-drawings')).toBeChecked()
      await expect(win.getByTestId('export-drawings')).toBeEnabled()
      await expect(win.getByTestId('export-summary')).toContainText('Будет создано: 1 файл')
      await expect(win.getByTestId('export-summary')).toContainText('0:04')
      await expect(win.getByTestId('export-summary')).toContainText('(с учётом стоп-кадров)')
      await shot(win, 'export-drawings-dialog')

      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 60_000 })
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done')
      const files = readdirSync(out)
      expect(files).toEqual(['001_Атака_00-01.mp4'])
      const file = join(out, files[0])

      // Длительность: эпизод 2.0 с + стоп-кадр 1.5 с = 3.5 с = 87.5 кадра (±1).
      expect(Math.abs(countFrames(file) - 87.5)).toBeLessThanOrEqual(1)
      expect(Math.abs((durationOf(file) ?? 0) - 3.5)).toBeLessThanOrEqual(0.08)

      // Стрелка (белая): кадры 12..24, стоп-кадр 25..63, снова 64..75 — одним куском; ни до, ни после её нет.
      const arrow = framesWhere(file, ARROW_PX[0], ARROW_PX[1], isWhite)
      expect(arrow[0]).toBeGreaterThanOrEqual(11)
      expect(arrow[0]).toBeLessThanOrEqual(13)
      expect(arrow[arrow.length - 1]).toBeGreaterThanOrEqual(74)
      expect(arrow[arrow.length - 1]).toBeLessThanOrEqual(76)
      expect(arrow.length).toBe(arrow[arrow.length - 1] - arrow[0] + 1)

      // Круг (тёмный) — только на стоп-кадре (≈ кадры 25..63).
      const circle = framesWhere(file, CIRCLE_PX[0], CIRCLE_PX[1], isDark)
      expect(circle[0]).toBeGreaterThanOrEqual(24)
      expect(circle[0]).toBeLessThanOrEqual(26)
      expect(circle[circle.length - 1]).toBeGreaterThanOrEqual(62)
      expect(circle[circle.length - 1]).toBeLessThanOrEqual(64)

      // Кадр из середины стоп-кадра: оба рисунка на месте, а сам кадр — кадр 50 исходника (его номер нарисован на картинке).
      const mid = frameRgb(file, 44, W, H)
      expect(isWhite(pixelAt(mid, W, ARROW_PX[0], ARROW_PX[1]))).toBe(true)
      expect(isDark(pixelAt(mid, W, CIRCLE_PX[0], CIRCLE_PX[1]))).toBe(true)
      const png = join(SHOTS, `export-drawings-frame${SUFFIX}.png`)
      ff(['-i', file, '-vf', 'select=eq(n\\,44)', '-frames:v', '1', '-y', png])
      expect(statSync(png).size).toBeGreaterThan(1000)

      // До и после рисунков на кадре чисто.
      const early = frameRgb(file, 4, W, H)
      expect(isWhite(pixelAt(early, W, ARROW_PX[0], ARROW_PX[1]))).toBe(false)
      expect(isDark(pixelAt(early, W, CIRCLE_PX[0], CIRCLE_PX[1]))).toBe(false)

      // Временные файлы убраны.
      expect(tempLeftovers(tmp.dir)).toBe(before)
    } finally {
      await app.close()
    }
  })

  test('«Всё видео целиком» работает без эпизодов; рисунок попадает на нужные кадры', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    const out = makeOutDir()
    try {
      await openVideo(ctx)
      await drawArrow(win, 1.52, 1)
      await win.getByTestId('tool-select').click()
      await stubDialog(app, out)

      // Эпизодов нет — кнопка и Ctrl+E доступны, «Всё видео» выбрано само.
      await expect(win.getByTestId('export-open')).toBeEnabled()
      await win.keyboard.press('Control+e')
      await expect(dialog(win)).toBeVisible()
      await expect(win.getByTestId('export-scope-whole')).toBeChecked()
      await expect(win.getByTestId('export-mode-files')).toHaveCount(0)
      await expect(win.getByTestId('export-summary')).toContainText('всё видео')
      await expect(win.getByTestId('export-summary')).toContainText('0:04')
      await expect(win.getByTestId('export-drawings')).toBeChecked()
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 60_000 })
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done')
      expect(readdirSync(out)).toEqual(['001_Всё_видео_00-00.mp4'])
      const file = join(out, '001_Всё_видео_00-00.mp4')
      expect(countFrames(file)).toBe(100)

      // Стрелка видна на кадрах 38..62 (1.5–2.5 с) ±1.
      const arrow = framesWhere(file, ARROW_PX[0], ARROW_PX[1], isWhite)
      expect(arrow[0]).toBeGreaterThanOrEqual(37)
      expect(arrow[0]).toBeLessThanOrEqual(39)
      expect(arrow[arrow.length - 1]).toBeGreaterThanOrEqual(61)
      expect(arrow[arrow.length - 1]).toBeLessThanOrEqual(63)
      expect(arrow.length).toBe(arrow[arrow.length - 1] - arrow[0] + 1)
    } finally {
      await app.close()
    }
  })

  test('без рисунков в выбранном: «С рисунками» выключено и объяснено; экспорт как раньше', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    const out = makeOutDir()
    try {
      await openVideo(ctx)
      await addEpisode(win, 0.4, 1.2, 1)
      await drawArrow(win, 3.2, 0.5)
      await win.getByTestId('tool-select').click()
      await stubDialog(app, out)
      await win.getByTestId('export-open').click()
      await expect(win.getByTestId('export-drawings')).not.toBeChecked()
      await expect(win.getByTestId('export-drawings')).toBeDisabled()
      await expect(win.getByTestId('export-dialog')).toContainText(
        'В выбранных отрезках нет рисунков'
      )
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 30_000 })
      expect(countFrames(join(out, readdirSync(out)[0]))).toBe(20)
    } finally {
      await app.close()
    }
  })

  test('«Быстро» отключает «С рисунками» с пояснением; «Точно» возвращает; подборка с рисунками', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    const out = makeOutDir()
    try {
      await openVideo(ctx)
      await addEpisode(win, 1.0, 2.0, 1)
      await addEpisode(win, 2.5, 3.5, 6)
      await drawArrow(win, 1.52, 3)
      await win.getByTestId('tool-select').click()

      await win.getByTestId('export-open').click()
      await expect(win.getByTestId('export-drawings')).toBeChecked()
      await win.getByTestId('export-precision-fast').check()
      await expect(win.getByTestId('export-drawings')).toBeDisabled()
      await expect(win.getByTestId('export-drawings')).not.toBeChecked()
      await expect(win.getByTestId('export-dialog')).toContainText(
        'Недоступно в режиме «Быстро»: без перекодирования нельзя нанести рисунки'
      )
      await shot(win, 'export-drawings-fast')
      await win.getByTestId('export-precision-precise').check()
      await expect(win.getByTestId('export-drawings')).toBeEnabled()
      await expect(win.getByTestId('export-drawings')).toBeChecked()

      // Можно и отключить вручную.
      await win.getByTestId('export-drawings').uncheck()
      await expect(win.getByTestId('export-drawings')).not.toBeChecked()
      await win.getByTestId('export-drawings').check()

      // Подборка с рисунками: стрелка на втором эпизоде (2.5–3.5) видна с начала, на первом — со второй половины.
      await app.evaluate(
        ({ dialog: d }, p) => {
          d.showSaveDialog = (async () => ({
            canceled: false,
            filePath: p
          })) as unknown as typeof d.showSaveDialog
        },
        join(out, 'подборка с рисунками.mp4')
      )
      await win.getByTestId('export-mode-compilation').check()
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 60_000 })
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done')
      const file = join(out, 'подборка с рисунками.mp4')
      expect(Math.abs(countFrames(file) - 50)).toBeLessThanOrEqual(1)
      const arrow = framesWhere(file, ARROW_PX[0], ARROW_PX[1], isWhite)
      // Эпизод 1: кадры 0..24, стрелка с 1.52 → с кадра 12; эпизод 2: кадры 25..49, стрелка до конца.
      expect(arrow[0]).toBeGreaterThanOrEqual(11)
      expect(arrow[0]).toBeLessThanOrEqual(13)
      expect(arrow[arrow.length - 1]).toBe(countFrames(file) - 1)
    } finally {
      await app.close()
    }
  })

  test('старый проект без freezeSeconds открывается: стоп-кадр 3 с; поле меняется и сохраняется', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    const dir = makeUserData()
    const file = join(dir, 'старый.flowproj')
    const video = fixture('cfr25.mp4')
    const project = {
      format: 'flowanalyzer-project',
      version: 1,
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-02T10:00:00.000Z',
      appVersion: '0.7.0',
      video: {
        path: video,
        relativePath: null,
        fileName: 'cfr25.mp4',
        sizeBytes: statSync(video).size,
        fps: 25,
        fpsSource: 'container'
      },
      annotations: [
        {
          id: '3f2b8c1e-5d4a-4b7e-9c1d-2a6f8e0b4c11',
          type: 'circle',
          p1: { x: 0.55, y: 0.55 },
          p2: { x: 0.85, y: 0.9 },
          style: { color: '#111827', width: 0.018, dash: 'solid' },
          // Как в версии 0.7.0: у «только кадр» нет freezeSeconds.
          timing: { mode: 'frame', start: 2.02 }
        }
      ],
      episodes: [],
      tags: [],
      ui: { lastTime: 2.02 }
    }
    writeFileSync(file, JSON.stringify(project), 'utf8')
    try {
      await stubDialog(app, file)
      await win.keyboard.press('Control+Shift+O')
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await win.getByTestId('track-item').click()
      await expect(win.getByTestId('inspector')).toBeVisible()
      await expect(win.getByTestId('freeze-input')).toHaveValue('3')

      // Проверка ввода: ошибка, значение не меняется; корректное значение принимается.
      await win.getByTestId('freeze-input').fill('0.2')
      await expect(win.getByTestId('freeze-hint')).toHaveText('Допустимо от 0.5 до 30 секунд')
      await win.getByTestId('freeze-input').fill('2.5')
      await expect(win.getByTestId('freeze-hint')).toContainText('кадр замрёт на это время')
      await expect(win.getByTestId('project-dirty')).toBeVisible()
      // Отмена возвращает прежнее значение (правка попадает в общую историю).
      await win.getByTestId('freeze-input').blur()
      await win.keyboard.press('Control+z')
      await win.getByTestId('track-item').click()
      await expect(win.getByTestId('freeze-input')).toHaveValue('3')
    } finally {
      await app.close()
    }
  })
})
