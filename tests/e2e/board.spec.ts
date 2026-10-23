// Доска тренера: создание, сохранение, анимация, экспорт картинки и видео, вопрос о сохранении, повреждённый файл.
import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import {
  SHOTS,
  SUFFIX,
  closeWindow,
  launch,
  makeUserData,
  saveDialogCalls,
  stubSaveDialog
} from './helpers'
import {
  addFrame,
  boardsDir,
  clickField,
  dragField,
  openNewBoard,
  place,
  scene,
  sceneItems
} from './boardHelpers'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

test.describe('доска', () => {
  test('новая доска: вратарь, сторона, сохранение и повторное открытие', async () => {
    const { app, win, projectsDir } = await launch()
    try {
      await openNewBoard(win)
      await place(win, 'gk', 'set', [0.5, 0.6])
      await expect(sceneItems(win, 'figure')).toHaveCount(1)
      await win.getByTestId('board-facing-back').click()
      await expect(sceneItems(win, 'figure')).toHaveAttribute('data-facing', 'back')

      await win.keyboard.press('Control+s')
      const file = join(boardsDir(projectsDir), 'Новая доска.flowboard')
      await expect.poll(() => existsSync(file)).toBe(true)
      await expect(win.getByTestId('board-dirty')).toHaveCount(0)

      await win.getByTestId('board-home').click()
      await expect(win.getByTestId('start-screen')).toBeVisible()
      const card = win.getByTestId('board-card').filter({ hasText: 'Новая доска' })
      await expect(card).toHaveCount(1)
      await card.getByTestId('board-card-open-main').click()
      await expect(win.getByTestId('board-editor')).toBeVisible()
      await expect(sceneItems(win, 'figure')).toHaveCount(1)
      await expect(sceneItems(win, 'figure')).toHaveAttribute('data-facing', 'back')
    } finally {
      await app.close()
    }
  })

  test('анимация: два кадра, поза и положение меняются, воспроизведение идёт', async () => {
    const { app, win } = await launch()
    try {
      await openNewBoard(win)
      await place(win, 'gk', 'set', [0.4, 0.6])
      await expect(sceneItems(win, 'figure')).toHaveAttribute('data-pose', 'set')

      await addFrame(win)
      await expect(scene(win)).toHaveAttribute('data-frame', '1')
      // На втором кадре видна тень первого, но прямой элемент по-прежнему один.
      await expect(sceneItems(win, 'figure')).toHaveCount(1)

      const before = (await sceneItems(win, 'figure').boundingBox())!
      // Инструмент остаётся «поставить», поэтому для сдвига переключаемся на «Выбор»; берём фигуру выше ступней.
      await win.getByTestId('board-tool-select').click()
      await dragField(win, [0.4, 0.5], [0.65, 0.5])
      await expect
        .poll(async () => (await sceneItems(win, 'figure').boundingBox())!.x)
        .toBeGreaterThan(before.x + 50)
      await win.getByTestId('board-pose').selectOption('dive-low')
      await expect(sceneItems(win, 'figure')).toHaveAttribute('data-pose', 'dive-low')

      await win.getByTestId('board-frame-1').click()
      await expect(scene(win)).toHaveAttribute('data-frame', '0')
      await expect(sceneItems(win, 'figure')).toHaveAttribute('data-pose', 'set')
      const first = (await sceneItems(win, 'figure').boundingBox())!
      expect(Math.abs(first.x - before.x)).toBeLessThan(5)
      await win.getByTestId('board-frame-2').click()
      await expect(sceneItems(win, 'figure')).toHaveAttribute('data-pose', 'dive-low')

      // Воспроизведение: LEAD_IN 0,5 с + половина перехода (1 с / 2) = 1 с — сцена между кадрами.
      await win.getByTestId('board-play').click()
      await expect(scene(win)).toHaveAttribute('data-time', /.+/)
      await expect
        .poll(async () => Number(await scene(win).getAttribute('data-time')), { timeout: 5000 })
        .toBeGreaterThanOrEqual(1)
      const t = Number(await scene(win).getAttribute('data-time'))
      expect(t).toBeLessThan(2)
      // По окончании сцена возвращается к последнему кадру.
      await expect(scene(win)).toHaveAttribute('data-frame', '1', { timeout: 10_000 })
      await expect(sceneItems(win, 'figure')).toHaveAttribute('data-pose', 'dive-low')
    } finally {
      await app.close()
    }
  })

  test('появление: мяч, поставленный в кадре 2, в кадре 1 не виден', async () => {
    const { app, win } = await launch()
    try {
      await openNewBoard(win)
      await addFrame(win)
      await expect(scene(win)).toHaveAttribute('data-frame', '1')
      await place(win, 'equipment', 'ball', [0.5, 0.5])
      await expect(sceneItems(win, 'equip')).toHaveCount(1)
      await win.getByTestId('board-frame-1').click()
      await expect(scene(win)).toHaveAttribute('data-frame', '0')
      await expect(sceneItems(win)).toHaveCount(0)
      await win.getByTestId('board-frame-2').click()
      await expect(sceneItems(win, 'equip')).toHaveCount(1)
    } finally {
      await app.close()
    }
  })

  test('сохранить картинку: PNG 1920×1080', async () => {
    const { app, win, userData } = await launch()
    try {
      await openNewBoard(win)
      await place(win, 'gk', 'set', [0.5, 0.6])
      const png = join(userData, 'доска.png')
      await stubSaveDialog(app, png)
      await win.getByTestId('board-save-image').click()
      await expect.poll(() => existsSync(png), { timeout: 15_000 }).toBe(true)
      await expect.poll(() => statSync(png).size).toBeGreaterThan(1000)
      const bytes = readFileSync(png)
      expect([...bytes.subarray(0, 8)]).toEqual(PNG_SIGNATURE)
      expect(bytes.readUInt32BE(16)).toBe(1920)
      expect(bytes.readUInt32BE(20)).toBe(1080)
      expect(await saveDialogCalls(app)).toBe(1)
    } finally {
      await app.close()
    }
  })

  test('сохранить видео: два кадра -> MP4', async () => {
    const { app, win, userData } = await launch()
    try {
      await openNewBoard(win)
      await place(win, 'gk', 'set', [0.4, 0.6])
      // С одним кадром видео сохранить нельзя.
      await expect(win.getByTestId('board-save-video')).toBeDisabled()
      await addFrame(win)
      await win.getByTestId('board-tool-select').click()
      await dragField(win, [0.4, 0.5], [0.6, 0.5])
      await expect(win.getByTestId('board-save-video')).toBeEnabled()
      const mp4 = join(userData, 'доска.mp4')
      await stubSaveDialog(app, mp4)
      await win.getByTestId('board-save-video').click()
      await expect
        .poll(() => existsSync(mp4) && statSync(mp4).size, { timeout: 90_000 })
        .toBeGreaterThan(10 * 1024)
      await expect(win.getByTestId('board-video-progress')).toHaveCount(0, { timeout: 30_000 })
      expect(statSync(mp4).size).toBeGreaterThan(10 * 1024)
    } finally {
      await app.close()
    }
  })

  test('закрытие окна во время сохранения видео задаёт вопрос', async () => {
    const { app, win, userData } = await launch()
    try {
      await openNewBoard(win)
      await place(win, 'gk', 'set', [0.4, 0.6])
      // Несколько кадров с длинным переходом: видео заведомо не успеет собраться за время проверки.
      for (let i = 0; i < 4; i += 1) await addFrame(win)
      await win.getByTestId('board-transition').fill('5')
      await win.getByTestId('board-save').click()
      await expect(win.getByTestId('board-dirty')).toHaveCount(0)
      await stubSaveDialog(app, join(userData, 'долгое.mp4'))
      await win.getByTestId('board-save-video').click()
      await expect(win.getByTestId('board-video-progress')).toBeVisible()

      await closeWindow(app)
      await expect(win.getByTestId('unsaved-dialog')).toBeVisible()
      await expect(win.getByText('Идёт сохранение видео')).toBeVisible()
      // «Продолжить сохранение» — окно остаётся, видео идёт.
      await win.getByTestId('unsaved-cancel').click()
      await expect(win.getByTestId('unsaved-dialog')).toHaveCount(0)
      await expect(win.getByTestId('board-video-progress')).toBeVisible()
      await win.getByTestId('board-video-cancel').click()
      await expect(win.getByTestId('board-video-progress')).toHaveCount(0, { timeout: 30_000 })
    } finally {
      await app.close()
    }
  })

  test('несохранённая доска: «← Главная» спрашивает, «Отмена» оставляет на доске', async () => {
    const { app, win } = await launch()
    try {
      await openNewBoard(win)
      await place(win, 'gk', 'set', [0.5, 0.6])
      await expect(win.getByTestId('board-dirty')).toBeVisible()
      await win.getByTestId('board-home').click()
      await expect(win.getByTestId('unsaved-dialog')).toBeVisible()
      await win.getByTestId('unsaved-cancel').click()
      await expect(win.getByTestId('unsaved-dialog')).toHaveCount(0)
      await expect(win.getByTestId('board-editor')).toBeVisible()
      await expect(sceneItems(win, 'figure')).toHaveCount(1)

      // «Не сохранять» — уходим на начальный экран, карточки не появляется.
      await win.getByTestId('board-home').click()
      await win.getByTestId('unsaved-discard').click()
      await expect(win.getByTestId('start-screen')).toBeVisible()
      await expect(win.getByTestId('board-card')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('повреждённый файл: карточка с пометкой ошибки, программа работает', async () => {
    const userData = makeUserData()
    const projectsDir = join(userData, 'Projects')
    mkdirSync(boardsDir(projectsDir), { recursive: true })
    writeFileSync(join(boardsDir(projectsDir), 'Битая.flowboard'), '{', 'utf8')
    const { app, win } = await launch({ userData })
    try {
      await expect(win.getByTestId('start-screen')).toBeVisible()
      const card = win.getByTestId('board-card')
      await expect(card).toHaveCount(1)
      await expect(card.getByTestId('board-card-error')).toBeVisible()
      // Программа жива: можно открыть новую доску.
      await openNewBoard(win)
    } finally {
      await app.close()
    }
  })

  test('снимок редактора: вратарь и стрелка', async () => {
    const { app, win } = await launch()
    try {
      await openNewBoard(win)
      await place(win, 'gk', 'set', [0.5, 0.65])
      await win.getByTestId('board-facing-front').click()
      await win.getByTestId('board-section-arrows').click()
      await win.getByTestId('board-tray-arrow').click()
      await dragField(win, [0.2, 0.3], [0.45, 0.5])
      await expect(sceneItems(win, 'figure')).toHaveCount(1)
      await expect(sceneItems(win)).toHaveCount(2)
      await clickField(win, 0.9, 0.1)
      await win.waitForTimeout(300)
      mkdirSync(SHOTS, { recursive: true })
      await win.screenshot({ path: join(SHOTS, `board-editor${SUFFIX}.png`) })
    } finally {
      await app.close()
    }
  })
})
