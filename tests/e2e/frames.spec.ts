// Покадровый переход: точность проверяется по кадру, который реально показал браузер (requestVideoFrameCallback),
// а не по currentTime. Фикстуры cfr25.mp4 / cfr30.webm имеют постоянную частоту и номер кадра, нарисованный на картинке.
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { join } from 'path'
import { SHOTS, SUFFIX, fixture, launch, stubDialog, videoState } from './helpers'

/** Ставит на <video> слушатель, который запоминает mediaTime последнего показанного кадра. */
async function trackPresentedFrames(win: Page): Promise<void> {
  await win.evaluate(() => {
    const v = document.querySelector('video')!
    const w = window as unknown as { __mediaTime: number | null }
    w.__mediaTime = null
    const cb = (_now: number, meta: VideoFrameCallbackMetadata): void => {
      w.__mediaTime = meta.mediaTime
      v.requestVideoFrameCallback(cb)
    }
    v.requestVideoFrameCallback(cb)
  })
}

/** Номер последнего показанного кадра (по mediaTime); до первого колбэка считаем, что показан кадр 0. */
const presentedFrame = (win: Page, fps: number): Promise<number> =>
  win.evaluate((rate) => {
    const w = window as unknown as { __mediaTime: number | null }
    return Math.round((w.__mediaTime ?? 0) * rate)
  }, fps)

/** Ждёт, пока браузер действительно покажет кадр n, и проверяет, что currentTime лежит внутри этого кадра. */
async function expectFrame(win: Page, fps: number, n: number): Promise<void> {
  await expect.poll(() => presentedFrame(win, fps), { timeout: 5000 }).toBe(n)
  const state = (await videoState(win))!
  expect(state.currentTime).toBeGreaterThanOrEqual(n / fps - 1e-6)
  expect(state.currentTime).toBeLessThan((n + 1) / fps)
  expect(state.paused).toBe(true)
}

async function openFixture(name: string): Promise<{
  app: Awaited<ReturnType<typeof launch>>['app']
  win: Page
}> {
  const { app, win } = await launch()
  await stubDialog(app, fixture(name))
  await win.getByTestId('open-video').click()
  await expect(win.getByTestId('play-toggle')).toBeEnabled()
  await trackPresentedFrames(win)
  return { app, win }
}

const press = (win: Page, key: string): Promise<void> => win.keyboard.press(key)

test.describe('cfr25.mp4 (25 к/с, контейнер)', () => {
  test('частота из контейнера; идентификатор видео в probeVideo проверяется', async () => {
    const { app, win } = await openFixture('cfr25.mp4')
    try {
      const fps = win.getByTestId('fps')
      await expect(fps).toHaveText('25 к/с')
      await expect(fps).toHaveAttribute('data-source', 'container')
      await expect(fps).toHaveAttribute('data-variable', 'false')
      await expect(fps).toHaveAttribute('title', /из файла/)
      await expect(win.getByTestId('total-time')).toHaveText('00:04.0')

      const probe = (id: unknown): Promise<string> =>
        win.evaluate(
          (value) =>
            window.api.probeVideo(value as string).then(
              () => 'ok',
              (e: Error) => e.message
            ),
          id
        )
      expect(await probe('C:\\Users\\user\\video.mp4')).toBe('Некорректный идентификатор видео')
      expect(await probe(42)).toBe('Некорректный идентификатор видео')
      expect(await probe('00000000-0000-4000-8000-000000000000')).toBe(
        'Видео не найдено — откройте файл заново'
      )
    } finally {
      await app.close()
    }
  })

  test('→ ×10 даёт кадр 10, ← ×3 даёт 7, Shift+→ это +25 кадров', async () => {
    const { app, win } = await openFixture('cfr25.mp4')
    try {
      await expect(win.getByTestId('fps')).toHaveText('25 к/с')
      // По одному нажатию: после каждого проверяем показанный кадр.
      for (let i = 1; i <= 10; i++) {
        await press(win, 'ArrowRight')
        await expectFrame(win, 25, i)
      }
      for (const expected of [9, 8, 7]) {
        await press(win, 'ArrowLeft')
        await expectFrame(win, 25, expected)
      }
      await press(win, 'Shift+ArrowRight')
      await expectFrame(win, 25, 32)
      await press(win, 'Shift+ArrowLeft')
      await expectFrame(win, 25, 7)
      await win.screenshot({ path: join(SHOTS, `e2e-step-frame7${SUFFIX}.png`) })
    } finally {
      await app.close()
    }
  })

  test('быстрые нажатия без пауз склеиваются и не теряются', async () => {
    const { app, win } = await openFixture('cfr25.mp4')
    try {
      for (let i = 0; i < 10; i++) await press(win, 'ArrowRight')
      await expectFrame(win, 25, 10)

      // Удержание: повторные keydown без keyup (автоповтор).
      for (let i = 0; i < 12; i++) await win.keyboard.down('ArrowRight')
      await win.keyboard.up('ArrowRight')
      await expectFrame(win, 25, 22)

      for (let i = 0; i < 20; i++) await win.keyboard.down('ArrowLeft')
      await win.keyboard.up('ArrowLeft')
      await expectFrame(win, 25, 2)
    } finally {
      await app.close()
    }
  })

  test('границы: на первом кадре ← остаётся 0, на последнем → остаётся 99', async () => {
    const { app, win } = await openFixture('cfr25.mp4')
    try {
      await press(win, 'ArrowLeft')
      await press(win, 'ArrowLeft')
      await press(win, 'Shift+ArrowLeft')
      await win.waitForTimeout(300)
      await expectFrame(win, 25, 0)
      expect((await videoState(win))!.currentTime).toBeLessThan(0.04)
      await expect(win.getByTestId('current-time')).toHaveText('00:00.0')

      for (let i = 0; i < 5; i++) await press(win, 'Shift+ArrowRight') // 125 кадров > 99
      await expectFrame(win, 25, 99)
      await press(win, 'ArrowRight')
      await press(win, 'ArrowRight')
      await win.waitForTimeout(300)
      await expectFrame(win, 25, 99)
      const end = (await videoState(win))!
      expect(end.currentTime).toBeLessThanOrEqual(4 - 0.5 / 25 + 1e-6)
      await expect(win.getByTestId('current-time')).toHaveText('00:03.9')

      await press(win, 'ArrowLeft')
      await expectFrame(win, 25, 98)
    } finally {
      await app.close()
    }
  })

  test('с конца ролика шаг назад даёт предпоследний кадр', async () => {
    const { app, win } = await openFixture('cfr25.mp4')
    try {
      await win.getByTestId('scrub').focus()
      await press(win, 'End')
      await expect.poll(async () => (await videoState(win))!.currentTime).toBeGreaterThan(3.9)
      await press(win, 'ArrowLeft')
      await expectFrame(win, 25, 98)
    } finally {
      await app.close()
    }
  })

  test('кнопки работают так же, как клавиши; шаг останавливает воспроизведение', async () => {
    const { app, win } = await openFixture('cfr25.mp4')
    try {
      const fwd = win.getByTestId('frame-forward')
      const back = win.getByTestId('frame-back')
      await expect(fwd).toBeEnabled()
      await expect(fwd).toHaveAttribute('title', 'Кадр вперёд (→)')
      await expect(back).toHaveAttribute('title', 'Кадр назад (←)')
      for (let i = 1; i <= 3; i++) {
        await fwd.click()
        await expectFrame(win, 25, i)
      }
      await back.click()
      await expectFrame(win, 25, 2)

      await win.getByTestId('play-toggle').click()
      await expect.poll(async () => (await videoState(win))!.paused).toBe(false)
      await press(win, 'ArrowRight')
      await expect.poll(async () => (await videoState(win))!.paused).toBe(true)
      // Шаг после паузы идёт ровно на один кадр от того места, где остановились.
      await win.waitForTimeout(300)
      const stopped = await presentedFrame(win, 25)
      expect(stopped).toBeGreaterThan(2)
      await press(win, 'ArrowRight')
      await expectFrame(win, 25, stopped + 1)
    } finally {
      await app.close()
    }
  })

  test('на ползунке громкости стрелки меняют громкость, а не кадр', async () => {
    const { app, win } = await openFixture('cfr25.mp4')
    try {
      await win.getByTestId('volume').focus()
      await press(win, 'ArrowLeft')
      await expect.poll(async () => (await videoState(win))!.volume).toBeLessThan(1)
      await win.waitForTimeout(150)
      expect(await presentedFrame(win, 25)).toBe(0)
      expect((await videoState(win))!.currentTime).toBe(0)
    } finally {
      await app.close()
    }
  })

  test('переключатель времени: ММ:СС.д и таймкод ЧЧ:ММ:СС:КК', async () => {
    const { app, win } = await openFixture('cfr25.mp4')
    try {
      const time = win.getByTestId('current-time')
      const transport = win.getByRole('group', { name: 'Управление воспроизведением' })
      for (let i = 0; i < 10; i++) await press(win, 'ArrowRight')
      await expectFrame(win, 25, 10)
      await expect(time).toHaveText('00:00.4')
      await transport.screenshot({ path: join(SHOTS, `e2e-transport-time${SUFFIX}.png`) })

      await time.click()
      await expect(time).toHaveText('00:00:00:10')
      await expect(win.getByTestId('total-time')).toHaveText('00:00:04:00')
      await transport.screenshot({ path: join(SHOTS, `e2e-transport-timecode${SUFFIX}.png`) })
      await win.screenshot({ path: join(SHOTS, `e2e-timecode-full${SUFFIX}.png`) })

      // Таймкод обновляется сразу при шаге (клавиши работают, даже когда фокус на кнопке времени).
      await press(win, 'Shift+ArrowRight')
      await expect(time).toHaveText('00:00:01:10')
      await press(win, 'ArrowLeft')
      await expect(time).toHaveText('00:00:01:09')

      await time.click()
      await expect(time).toHaveText(/^00:01\.\d$/)

      // Выбранный формат сохраняется при открытии другого файла.
      await time.click()
      await stubDialog(app, fixture('cfr30.webm'))
      await win.getByTestId('open-video').click()
      await expect(win.getByTestId('fps')).toHaveAttribute('data-source', 'default')
      await expect(time).toHaveText('00:00:00:00')
    } finally {
      await app.close()
    }
  })
})

test.describe('cfr30.webm (30 к/с, оценка)', () => {
  test('частота оценивается по воспроизведению, шаги точные', async () => {
    const { app, win } = await openFixture('cfr30.webm')
    try {
      const fps = win.getByTestId('fps')
      await expect(fps).toHaveAttribute('data-source', 'default')
      await expect(fps).toHaveText('25 к/с?')
      await expect(fps).toHaveAttribute('title', /по умолчанию/i)

      await win.getByTestId('play-toggle').click()
      await expect(fps).toHaveAttribute('data-source', 'estimated', { timeout: 10_000 })
      await expect(fps).toHaveText('≈30 к/с', { timeout: 10_000 })
      await expect(fps).toHaveAttribute('title', /Оценка по воспроизведению/)
      await win.getByTestId('play-toggle').click()
      await expect.poll(async () => (await videoState(win))!.paused).toBe(true)

      // Теперь частота известна: идём в начало и шагаем.
      await win.getByTestId('scrub').focus()
      await press(win, 'Home')
      await expect.poll(async () => (await videoState(win))!.currentTime).toBeLessThan(0.05)
      await win.waitForTimeout(200)
      const base = await presentedFrame(win, 30)
      expect(base).toBe(0)
      for (let i = 1; i <= 7; i++) {
        await press(win, 'ArrowRight')
        await expectFrame(win, 30, base + i)
      }
      await press(win, 'ArrowLeft')
      await expectFrame(win, 30, base + 6)
      await press(win, 'Shift+ArrowRight')
      await expectFrame(win, 30, base + 36)
      await win.screenshot({ path: join(SHOTS, `e2e-webm-estimated${SUFFIX}.png`) })
    } finally {
      await app.close()
    }
  })
})

test.describe('sample.mp4 (MediaRecorder)', () => {
  test('частота из контейнера; при переменной частоте помечена как приблизительная', async () => {
    const { app, win } = await openFixture('sample.mp4')
    try {
      const fps = win.getByTestId('fps')
      await expect(fps).toHaveAttribute('data-source', 'container')
      const variable = (await fps.getAttribute('data-variable')) === 'true'
      const text = (await fps.textContent()) ?? ''
      expect(text.startsWith('≈')).toBe(variable)
      console.log(`sample.mp4: ${text}, variable=${variable}`)
    } finally {
      await app.close()
    }
  })
})
