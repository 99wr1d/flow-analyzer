import { expect, test } from '@playwright/test'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { FIXTURES, SHOTS, SUFFIX, fixture, launch, stubDialog, videoState } from './helpers'

const PLAYBACK_ERROR =
  'Не удалось воспроизвести файл. Поддерживаются MP4 (H.264), WebM и MOV. Другие форматы научимся открывать позже.'

test('приложение запускается безопасно и показывает версию', async () => {
  const { app, win } = await launch()
  try {
    await expect(win).toHaveTitle('FlowAnalyzer')
    await expect(win.getByTestId('app-info')).toContainText('FlowAnalyzer 0.6.0')

    const leaks = await win.evaluate(() => {
      const w = window as unknown as Record<string, unknown>
      return {
        require: typeof w.require,
        process: typeof w.process,
        electron: typeof w.electron,
        apiKeys: Object.keys(window.api).sort()
      }
    })
    expect(leaks.require).toBe('undefined')
    expect(leaks.process).toBe('undefined')
    expect(leaks.electron).toBe('undefined')
    expect(leaks.apiKeys).toEqual([
      'autosaveProject',
      'cancelClose',
      'clearRecovery',
      'confirmClose',
      'discardRecovery',
      'getAppInfo',
      'getSettings',
      'importDroppedVideo',
      'listRecentProjects',
      'listRecovery',
      'onCloseRequested',
      'onOpenProjectRequested',
      'openProject',
      'openVideoDialog',
      'probeVideo',
      'relinkProjectVideo',
      'respondClose',
      'restoreRecovery',
      'saveProject',
      'saveSettings',
      'setWindowTitle',
      'takeLaunchProject'
    ])

    await win.screenshot({ path: join(SHOTS, `e2e-empty${SUFFIX}.png`) })
  } finally {
    await app.close()
  }
})

test('до загрузки видео управление отключено, подсказки на месте', async () => {
  const { app, win } = await launch()
  try {
    await expect(win.getByText('Перетащите видео сюда или нажмите «Открыть видео»')).toBeVisible()
    await expect(win.getByTestId('open-video')).toBeEnabled()
    await expect(win.getByTestId('play-toggle')).toBeDisabled()
    await expect(win.getByTestId('frame-back')).toBeDisabled()
    await expect(win.getByTestId('frame-forward')).toBeDisabled()
    await expect(win.getByTestId('frame-back')).toHaveAttribute('title', 'Кадр назад (←)')
    await expect(win.getByTestId('frame-forward')).toHaveAttribute('title', 'Кадр вперёд (→)')
    await expect(win.getByTestId('speed')).toBeDisabled()
    await expect(win.getByTestId('mute')).toBeDisabled()
    await expect(win.getByTestId('volume')).toBeDisabled()
    await expect(win.getByText('Таймлайн появится после загрузки видео')).toBeVisible()
    await expect(win.getByTestId('play-toggle')).toHaveAttribute('title', /Пробел/)
  } finally {
    await app.close()
  }
})

for (const file of ['sample.webm', 'sample.mp4']) {
  test.describe(file, () => {
    test.skip(
      !existsSync(fixture(file)),
      `нет фикстуры ${file} (npm: node scripts/make-fixtures.mjs)`
    )

    test('открытие, воспроизведение, скорость, перемотка до конца', async () => {
      const { app, win } = await launch()
      try {
        await stubDialog(app, fixture(file))
        await win.getByTestId('open-video').click()

        await expect(win.getByTestId('file-name')).toHaveText(file)
        await expect(win.getByTestId('play-toggle')).toBeEnabled()
        const meta = await videoState(win)
        expect(meta?.duration).toBeGreaterThan(5.5)
        expect(meta?.duration).toBeLessThan(6.5)
        await expect(win.getByTestId('total-time')).toHaveText(/^00:0[56]\.\d$/)
        await expect(win.locator('[data-testid="ruler"] .timeline__tick-label').first()).toHaveText(
          /^00:00(.0)?$/
        )
        await expect(win.getByText('Меток пока нет').first()).toBeVisible()

        // Play → время идёт.
        await win.getByTestId('play-toggle').click()
        await expect
          .poll(async () => (await videoState(win))?.currentTime ?? 0)
          .toBeGreaterThan(0.4)
        await expect(win.getByTestId('play-toggle')).toHaveAttribute('aria-label', 'Пауза')
        await win.screenshot({ path: join(SHOTS, `e2e-playing-${file}${SUFFIX}.png`) })

        // Pause → время стоит.
        await win.getByTestId('play-toggle').click()
        await expect.poll(async () => (await videoState(win))?.paused).toBe(true)
        const t1 = (await videoState(win))?.currentTime ?? 0
        await win.waitForTimeout(400)
        expect((await videoState(win))?.currentTime).toBe(t1)

        // Пробел переключает (фокус не на кнопке).
        await win.getByTestId('file-name').click()
        await win.keyboard.press('Space')
        await expect.poll(async () => (await videoState(win))?.paused).toBe(false)
        await win.keyboard.press('Space')
        await expect.poll(async () => (await videoState(win))?.paused).toBe(true)

        // Скорость.
        await win.getByTestId('speed').selectOption('2')
        await expect.poll(async () => (await videoState(win))?.rate).toBe(2)
        await win.getByTestId('file-name').click()
        await win.keyboard.press('[')
        await expect.poll(async () => (await videoState(win))?.rate).toBe(1.5)
        await win.keyboard.press(']')
        await win.keyboard.press(']')
        await expect.poll(async () => (await videoState(win))?.rate).toBe(2)
        await expect(win.getByTestId('speed')).toHaveValue('2')

        // Звук.
        await win.keyboard.press('m')
        await expect.poll(async () => (await videoState(win))?.muted).toBe(true)
        await win.getByTestId('mute').click()
        await expect.poll(async () => (await videoState(win))?.muted).toBe(false)

        // Перемотка кликом по линейке таймлайна на ~5 с.
        const ruler = await win.getByTestId('ruler').boundingBox()
        expect(ruler).not.toBeNull()
        const dur = (await videoState(win))?.duration ?? 6
        await win.mouse.click(ruler!.x + (ruler!.width * 5) / dur, ruler!.y + ruler!.height / 2)
        await expect
          .poll(async () => (await videoState(win))?.currentTime ?? 0)
          .toBeGreaterThan(4.8)
        expect((await videoState(win))?.currentTime).toBeLessThan(5.3)
        await expect(win.getByTestId('current-time')).toHaveText(/^00:0[45]\.\d$/)

        // Играем до конца на 2× — доказывает, что Range-запросы работают.
        await win.keyboard.press('Space')
        await expect
          .poll(async () => (await videoState(win))?.ended, { timeout: 15_000 })
          .toBe(true)
        await expect(win.getByTestId('play-toggle')).toHaveAttribute('aria-label', 'Воспроизвести')

        // Перемотка ползунком (клик по scrub) в середину.
        const scrub = await win.getByTestId('scrub').boundingBox()
        await win.mouse.click(scrub!.x + scrub!.width / 2, scrub!.y + scrub!.height / 2)
        await expect
          .poll(async () => (await videoState(win))?.currentTime ?? 0)
          .toBeGreaterThan(dur / 2 - 0.4)
        expect((await videoState(win))?.currentTime).toBeLessThan(dur / 2 + 0.4)
      } finally {
        await app.close()
      }
    })

    test('Ctrl+O открывает диалог; протокол flow-media отдаёт только выданные файлы', async () => {
      const { app, win } = await launch()
      try {
        await stubDialog(app, fixture(file))
        await win.keyboard.press('Control+o')
        await expect(win.getByTestId('file-name')).toHaveText(file)

        const url = await win.evaluate(() => document.querySelector('video')!.src)
        expect(url).toMatch(/^flow-media:\/\/video\/[0-9a-f-]{36}$/)

        const probe = (u: string, range?: string) =>
          app.evaluate(
            async ({ net }, [target, rng]) => {
              const r = await net.fetch(target as string, {
                headers: rng ? { Range: rng as string } : {}
              })
              await r.arrayBuffer()
              return {
                status: r.status,
                contentRange: r.headers.get('content-range'),
                acceptRanges: r.headers.get('accept-ranges'),
                length: r.headers.get('content-length'),
                type: r.headers.get('content-type')
              }
            },
            [u, range ?? '']
          )

        const whole = await probe(url)
        expect(whole.status).toBe(200)
        expect(whole.acceptRanges).toBe('bytes')
        const part = await probe(url, 'bytes=0-9')
        expect(part.status).toBe(206)
        expect(part.length).toBe('10')
        expect(part.contentRange).toMatch(/^bytes 0-9\/\d+$/)
        const bad = await probe(url, 'bytes=999999999-')
        expect(bad.status).toBe(416)

        const random = await probe('flow-media://video/00000000-0000-4000-8000-000000000000')
        expect(random.status).toBe(404)
        const junk = await probe('flow-media://video/..%2f..%2fpackage.json')
        expect(junk.status).toBe(404)
      } finally {
        await app.close()
      }
    })

    test('новый импорт полностью сбрасывает состояние', async () => {
      const { app, win } = await launch()
      try {
        await stubDialog(app, fixture(file))
        await win.getByTestId('open-video').click()
        await expect(win.getByTestId('play-toggle')).toBeEnabled()
        await win.getByTestId('speed').selectOption('0.5')
        await win.getByTestId('play-toggle').click()
        await expect
          .poll(async () => (await videoState(win))?.currentTime ?? 0)
          .toBeGreaterThan(0.3)

        await stubDialog(app, fixture('broken.mp4'))
        await win.getByTestId('open-video').click()
        await expect(win.getByTestId('playback-error')).toHaveText(PLAYBACK_ERROR)
        await expect(win.getByTestId('play-toggle')).toBeDisabled()

        await stubDialog(app, fixture(file))
        await win.getByTestId('open-video').click()
        await expect(win.getByTestId('playback-error')).toHaveCount(0)
        await expect(win.getByTestId('play-toggle')).toBeEnabled()
        await expect(win.getByTestId('current-time')).toHaveText('00:00.0')
        await expect(win.getByTestId('speed')).toHaveValue('1')
        const s = await videoState(win)
        expect(s?.paused).toBe(true)
        expect(s?.rate).toBe(1)
        expect(s?.currentTime).toBe(0)
      } finally {
        await app.close()
      }
    })
  })
}

test('битый файл показывает понятную ошибку и не ломает приложение', async () => {
  const { app, win } = await launch()
  try {
    await stubDialog(app, fixture('broken.mp4'))
    await win.getByTestId('open-video').click()
    await expect(win.getByTestId('playback-error')).toHaveText(PLAYBACK_ERROR)
    await expect(win.getByTestId('play-toggle')).toBeDisabled()
    await expect(win.getByTestId('file-name')).toHaveText('broken.mp4')
    await win.screenshot({ path: join(SHOTS, `e2e-error${SUFFIX}.png`) })
  } finally {
    await app.close()
  }
})

test('не-видео и несуществующий файл отклоняются с понятным сообщением', async () => {
  const { app, win } = await launch()
  try {
    await stubDialog(app, resolve('package.json'))
    await win.getByTestId('open-video').click()
    await expect(win.getByTestId('import-error')).toContainText('Это не видеофайл')
    await expect(win.getByTestId('file-name')).toHaveCount(0)

    await stubDialog(app, join(FIXTURES, 'нет-такого-файла.mp4'))
    await win.getByTestId('open-video').click()
    await expect(win.getByTestId('import-error')).toContainText('Файл не найден')
    await win.screenshot({ path: join(SHOTS, `e2e-import-error${SUFFIX}.png`) })

    await win.getByRole('button', { name: 'Закрыть сообщение' }).click()
    await expect(win.getByTestId('import-error')).toHaveCount(0)
  } finally {
    await app.close()
  }
})

test('отмена диалога ничего не меняет; перетаскивание подсвечивает окно', async () => {
  const { app, win } = await launch()
  try {
    await app.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] })
    })
    await win.getByTestId('open-video').click()
    await expect(win.getByTestId('file-name')).toHaveCount(0)
    await expect(win.getByTestId('import-error')).toHaveCount(0)

    // Имитация перетаскивания (настоящий drop из проводника проверяется вручную).
    await win.evaluate(() => {
      const dt = new DataTransfer()
      dt.items.add(new File(['x'], 'x.mp4', { type: 'video/mp4' }))
      window.dispatchEvent(
        new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true })
      )
    })
    await expect(win.getByText('Отпустите файл, чтобы открыть видео')).toBeVisible()
    await win.screenshot({ path: join(SHOTS, `e2e-drop${SUFFIX}.png`) })

    // У искусственного File нет пути на диске — должна быть понятная ошибка, а не падение.
    await win.evaluate(() => {
      const dt = new DataTransfer()
      dt.items.add(new File(['x'], 'x.mp4', { type: 'video/mp4' }))
      window.dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
      )
    })
    await expect(win.getByText('Отпустите файл, чтобы открыть видео')).toHaveCount(0)
    await expect(win.getByTestId('import-error')).toBeVisible()
  } finally {
    await app.close()
  }
})

test('перетаскивание настоящего файла (с путём на диске) открывает видео', async () => {
  const { app, win } = await launch()
  try {
    // Настоящий File с путём получаем через <input type=file>, затем «роняем» его на окно.
    await win.evaluate(() => {
      const input = document.createElement('input')
      input.type = 'file'
      input.id = 'test-file-input'
      document.body.appendChild(input)
    })
    await win.locator('#test-file-input').setInputFiles(fixture('sample.webm'))
    await win.evaluate(() => {
      const input = document.getElementById('test-file-input') as HTMLInputElement
      const dt = new DataTransfer()
      dt.items.add(input.files![0])
      window.dispatchEvent(
        new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })
      )
    })
    await expect(win.getByTestId('file-name')).toHaveText('sample.webm')
    await expect(win.getByTestId('play-toggle')).toBeEnabled()
    const meta = await videoState(win)
    expect(meta?.duration).toBeGreaterThan(5.5)
  } finally {
    await app.close()
  }
})
