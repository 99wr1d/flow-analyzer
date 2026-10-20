// Быстрый экспорт (этап 18): выбор кодера в окне экспорта, параллельные куски, откат с видеокарты на процессор.
// Настоящий ffmpeg. Куски включаются принудительно (FLOW_EXPORT_CHUNK_SEC), видеокарта «ломается» по FLOW_TEST_GPU_FAIL —
// эти переменные работают только в тестовом запуске с отдельной папкой данных (src/main/testFlags.ts).
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import ffmpegPath from 'ffmpeg-static'
import {
  HAS_GPU,
  GPU_PROBE,
  countFrames,
  durationOf,
  framesWhere,
  isWhite
} from '../../src/main/ffmpeg/ffmpeg.testkit'
import { dragOnPicture, fixture, launch, makeUserData, seekVideo, stubDialog } from './helpers'

type Ctx = { app: ElectronApplication; win: Page; userData: string }

const W = 640
const H = 360
const dialog = (win: Page) => win.getByTestId('export-dialog')

function makeOutDir(): string {
  const dir = join(makeUserData(), 'out')
  mkdirSync(dir)
  return dir
}

const tempLeftovers = (): string[] =>
  readdirSync(tmpdir()).filter(
    (n) => n.startsWith('flow-overlays-') || n.startsWith('flow-export-')
  )

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

/** Белая стрелка у левого края (по красной полосе фона): видна ≈ [from, from + seconds). */
async function drawArrow(win: Page, from: number, seconds: number): Promise<void> {
  await seekVideo(win, from)
  await win.getByTestId('tool-arrow').click()
  await win.getByTestId('color-ffffff').click()
  await win.getByTestId('width-2').click()
  await dragOnPicture(win, [0.05, 0.2], [0.3, 0.2])
  await win.getByTestId('duration-input').fill(String(seconds))
  await expect(win.getByTestId('duration-hint')).toHaveText(/^\s*$/)
}

/** Тёмный круг «Только кадр»: на кадре, где стоит видео; стоп-кадр freeze секунд. */
async function drawFrameCircle(win: Page, at: number, freeze: string): Promise<void> {
  await seekVideo(win, at)
  await win.getByTestId('tool-circle').click()
  await win.getByTestId('color-111827').click()
  await win.getByTestId('width-2').click()
  await dragOnPicture(win, [0.55, 0.55], [0.85, 0.9])
  await win.getByTestId('mode-frame').click()
  await win.getByTestId('freeze-input').fill(freeze)
}

const ARROW_PX = [Math.round(0.175 * W) - 1, Math.round(0.2 * H) - 1] as const
const CIRCLE_PX = [Math.round(0.55 * W) - 1, Math.round(0.725 * H) - 1] as const
const isDark = ([r, g, b]: [number, number, number]): boolean => r < 80 && g < 80 && b < 80

/** Содержимое журнала приложения (папка logs в данных теста). */
function logText(userData: string): string {
  const dir = join(userData, 'logs')
  if (!existsSync(dir)) return ''
  return readdirSync(dir)
    .map((n) => readFileSync(join(dir, n), 'utf8'))
    .join('\n')
}

function makeLongVideo(dir: string, seconds: number): string {
  const out = join(dir, 'long.mp4')
  execFileSync(
    ffmpegPath as string,
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `testsrc2=size=1280x720:rate=30:duration=${seconds}`,
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-y',
      out
    ],
    { windowsHide: true }
  )
  return out
}

test.describe('быстрый экспорт: кодер', () => {
  test('видеокарта найдена: в окне есть выбор «Авто / Процессор» с названием кодера; «Быстро» его прячет', async () => {
    // «Видеокарта» подставлена тестовым флагом: так проверка не зависит от железа.
    const ctx = await launch({ env: { FLOW_TEST_GPU_FAIL: '1' } })
    const { app, win } = ctx
    try {
      await openVideo(ctx)
      await win.keyboard.press('Control+e')
      await expect(dialog(win)).toBeVisible()
      await expect(win.getByTestId('export-encoder-group')).toBeVisible()
      await expect(win.getByTestId('export-encoder-auto')).toBeChecked()
      await expect(win.getByTestId('export-encoder-group')).toContainText(
        'Видеокарта NVIDIA (NVENC)'
      )
      await win.getByTestId('export-encoder-cpu').check()
      await expect(win.getByTestId('export-encoder-cpu')).toBeChecked()
      await expect(win.getByTestId('export-encoder-info')).toHaveCount(0)
      // Без перекодирования кодер не нужен — выбор прячется (опции-пустышки не оставляем).
      await win.getByTestId('export-precision-fast').check()
      await expect(win.getByTestId('export-encoder-group')).toHaveCount(0)
      await win.getByTestId('export-precision-precise').check()
      await expect(win.getByTestId('export-encoder-group')).toBeVisible()
      // Повторное открытие окна начинается с «Авто».
      await win.keyboard.press('Escape')
      await win.keyboard.press('Control+e')
      await expect(win.getByTestId('export-encoder-auto')).toBeChecked()
    } finally {
      await app.close()
    }
  })

  test('на этом компьютере: название настоящей видеокарты из проверки (или строка «видеокарта не найдена»)', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openVideo(ctx)
      await win.keyboard.press('Control+e')
      if (HAS_GPU) {
        await expect(win.getByTestId('export-encoder-group')).toBeVisible()
        await expect(win.getByTestId('export-encoder-group')).toContainText(
          (GPU_PROBE.gpu as { label: string }).label
        )
      } else {
        await expect(win.getByTestId('export-encoder-info')).toContainText(
          'видеокарта для кодирования не найдена'
        )
        await expect(win.getByTestId('export-encoder-group')).toHaveCount(0)
      }
    } finally {
      await app.close()
    }
  })

  test('«Авто» кодирует на видеокарте, «Процессор» — на x264 (по журналу), кадры на месте', async () => {
    test.skip(!HAS_GPU, 'На этом компьютере нет рабочей видеокарты для кодирования')
    const ctx = await launch()
    const { app, win, userData } = ctx
    const out = makeOutDir()
    try {
      await openVideo(ctx)
      await addEpisode(win, 1.0, 3.0, 1)
      await stubDialog(app, out)
      await win.keyboard.press('Control+e')
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done', {
        timeout: 60_000
      })
      expect(countFrames(join(out, '001_Атака_00-01.mp4'))).toBe(50)
      expect(logText(userData)).toMatch(/кодер h264_(nvenc|qsv|amf)/)
      await win.getByTestId('export-done').click()

      await win.keyboard.press('Control+e')
      await win.getByTestId('export-encoder-cpu').check()
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done', {
        timeout: 60_000
      })
      expect(countFrames(join(out, '001_Атака_00-01 (2).mp4'))).toBe(50)
      expect(logText(userData)).toContain('кодер libx264')
    } finally {
      await app.close()
    }
  })

  test('видеокарта сломалась на ходу: экспорт сам повторяется на процессоре, файл целый, в журнале есть причина', async () => {
    const ctx = await launch({ env: { FLOW_TEST_GPU_FAIL: '1' } })
    const { app, win, userData } = ctx
    const out = makeOutDir()
    try {
      await openVideo(ctx)
      await addEpisode(win, 1.0, 3.0, 1)
      await stubDialog(app, out)
      await win.keyboard.press('Control+e')
      await expect(win.getByTestId('export-encoder-auto')).toBeChecked()
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done', {
        timeout: 60_000
      })
      await expect(win.getByTestId('export-result-title')).toHaveText('Готово: создано 1 файл')
      const file = join(out, '001_Атака_00-01.mp4')
      expect(countFrames(file)).toBe(50)
      expect(logText(userData)).toContain('повторяю на процессоре')
    } finally {
      await app.close()
    }
  })
})

test.describe('быстрый экспорт: параллельные куски', () => {
  test('отдельный файл с рисунками кусками по секунде: кадры, стоп-кадр и рисунки как у обычного экспорта', async () => {
    const ctx = await launch({ env: { FLOW_EXPORT_CHUNK_SEC: '1' } })
    const { app, win, userData } = ctx
    const out = makeOutDir()
    const before = tempLeftovers().length
    try {
      await openVideo(ctx)
      await addEpisode(win, 1.0, 3.0, 1)
      await drawArrow(win, 1.52, 1)
      await drawFrameCircle(win, 2.02, '1.5')
      await win.getByTestId('tool-select').click()
      await stubDialog(app, out)
      await win.getByTestId('export-open').click()
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 60_000 })
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done')
      const file = join(out, readdirSync(out)[0])

      // Те же проверки, что в экспорте одним процессом (export-drawings.spec.ts): 3.5 с, стрелка, круг на стоп-кадре.
      expect(Math.abs(countFrames(file) - 87.5)).toBeLessThanOrEqual(1)
      expect(Math.abs((durationOf(file) ?? 0) - 3.5)).toBeLessThanOrEqual(0.08)
      const arrow = framesWhere(file, ARROW_PX[0], ARROW_PX[1], isWhite)
      expect(arrow[0]).toBeGreaterThanOrEqual(11)
      expect(arrow[0]).toBeLessThanOrEqual(13)
      expect(arrow[arrow.length - 1]).toBeGreaterThanOrEqual(74)
      expect(arrow[arrow.length - 1]).toBeLessThanOrEqual(76)
      expect(arrow.length).toBe(arrow[arrow.length - 1] - arrow[0] + 1)
      const circle = framesWhere(file, CIRCLE_PX[0], CIRCLE_PX[1], isDark)
      expect(circle[0]).toBeGreaterThanOrEqual(24)
      expect(circle[0]).toBeLessThanOrEqual(26)
      expect(circle[circle.length - 1]).toBeGreaterThanOrEqual(62)
      expect(circle[circle.length - 1]).toBeLessThanOrEqual(64)

      // Экспорт шёл кусками, а временные файлы убраны.
      expect(logText(userData)).toMatch(/Экспорт кусками: \d+ шт\./)
      expect(tempLeftovers().length).toBe(before)
    } finally {
      await app.close()
    }
  })

  test('отмена посреди экспорта кусками: итоговой папке чисто, временных папок не осталось', async () => {
    const ctx = await launch({ env: { FLOW_EXPORT_CHUNK_SEC: '2' } })
    const { app, win, userData } = ctx
    const out = makeOutDir()
    const before = tempLeftovers().length
    try {
      await openVideo(ctx, makeLongVideo(userData, 40))
      await stubDialog(app, out)
      await win.keyboard.press('Control+e')
      await win.getByTestId('export-scope-whole').check()
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-cancel')).toBeVisible({ timeout: 30_000 })
      await expect
        .poll(async () =>
          Number((await win.getByTestId('export-progress').getAttribute('data-percent')) ?? '0')
        )
        .toBeGreaterThan(0)
      await win.getByTestId('export-cancel').click()
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'cancelled', {
        timeout: 30_000
      })
      expect(readdirSync(out)).toEqual([])
      await expect.poll(() => tempLeftovers().length, { timeout: 10_000 }).toBe(before)
    } finally {
      await app.close()
    }
  })

  test('подборка кусками: эпизоды по порядку, длительность равна сумме', async () => {
    const ctx = await launch({ env: { FLOW_EXPORT_CHUNK_SEC: '1' } })
    const { app, win } = ctx
    const out = makeOutDir()
    const target = join(out, 'подборка.mp4')
    try {
      await openVideo(ctx)
      await addEpisode(win, 1.0, 2.0, 1)
      await addEpisode(win, 2.5, 3.5, 6)
      await expect(win.getByTestId('episode-row')).toHaveCount(2)
      await app.evaluate(({ dialog: d }, p) => {
        d.showSaveDialog = (async () => ({
          canceled: false,
          filePath: p
        })) as unknown as typeof d.showSaveDialog
      }, target)
      await win.keyboard.press('Control+e')
      await win.getByTestId('export-mode-compilation').check()
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done', {
        timeout: 60_000
      })
      expect(countFrames(target)).toBe(50)
      expect(Math.abs((durationOf(target) ?? 0) - 2)).toBeLessThan(0.1)
    } finally {
      await app.close()
    }
  })
})
