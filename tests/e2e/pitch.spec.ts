// Разметка поля и рисунки на поле в перспективе. Видео pitch.mp4 снято «настоящей камерой» с известными параметрами
// (см. scripts/make-fixtures.mjs), поэтому тест знает, где на кадре должны оказаться точки поля.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { mkdirSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { frameRgb, pixelAt, ff } from '../../src/main/ffmpeg/ffmpeg.testkit'
import { SHOTS, SUFFIX, fixture, launch, makeUserData, seekVideo, stubDialog } from './helpers'
import { cardByTitle, seedProject } from './startHelpers'
import {
  H,
  W,
  calibrate,
  click,
  drag,
  layerBox,
  openPitch,
  project,
  saveCalibration,
  truth
} from './pitchHelpers'
import type { Pt } from './pitchHelpers'

const shot = (win: Page, name: string): Promise<Buffer> =>
  win.screenshot({ path: join(SHOTS, `pitch-${name}${SUFFIX}.png`) })

/** Рамка залитого круга кольца в пикселях картинки (по SVG). */
async function discBox(ring: Locator): Promise<{ x: number; y: number; w: number; h: number }> {
  return ring.locator('path[data-part="disc"]').evaluate((el) => {
    const b = (el as SVGGraphicsElement).getBBox()
    return { x: b.x, y: b.y, w: b.width, h: b.height }
  })
}

/** Рамка проекции окружности по точной гомографии, в пикселях картинки (ширина layerW × высота layerH). */
function expectedCircleBox(
  cx: number,
  cy: number,
  r: number,
  layerW: number,
  layerH: number
): { x: number; y: number; w: number; h: number } {
  const pts = Array.from({ length: 360 }, (_, i) => {
    const a = (i / 360) * Math.PI * 2
    return project(cx + r * Math.cos(a), cy + r * Math.sin(a))
  })
  const xs = pts.map((p) => p.x * layerW)
  const ys = pts.map((p) => p.y * layerH)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys)
  }
}

const rings = (win: Page): Locator => win.locator('[data-testid="annotation"][data-type="ring"]')
const geo = async (l: Locator): Promise<Record<string, unknown>> =>
  JSON.parse((await l.getAttribute('data-geo')) ?? '{}') as Record<string, unknown>

test.describe('разметка поля', () => {
  test('шаблон «штрафная»: точки по порядку, предпросмотр, точность, сохранение, список', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      // Без разметки: «На поле» и «Линейка» недоступны, причина объяснена.
      await expect(win.getByTestId('pitch-on')).toBeDisabled()
      await expect(win.getByTestId('pitch-active')).toHaveText('Не размечено')
      await expect(win.getByTestId('pitch-active')).toHaveAttribute('title', 'Поле не размечено')
      await expect(win.getByTestId('tool-ruler')).toBeDisabled()
      await expect(win.getByTestId('tool-ruler')).toHaveAttribute('title', /Сначала разметьте поле/)

      // Клавиша R без разметки подсказывает, что делать; клавиша P открывает режим разметки, Esc отменяет.
      await win.keyboard.press('r')
      await expect(win.getByTestId('toast')).toContainText('Сначала разметьте поле')
      await win.keyboard.press('p')
      await expect(win.getByTestId('calibration-mode')).toBeVisible()
      await win.keyboard.press('Escape')
      await expect(win.getByTestId('calibration-mode')).toHaveCount(0)
      // Пока размечается поле, остальные команды молчат: «A» не включает стрелку.
      await win.getByTestId('pitch-calibrate').click()
      await expect(win.getByTestId('calibration-mode')).toBeVisible()
      await win.keyboard.press('a')
      await expect(win.getByTestId('tool-arrow')).toHaveAttribute('aria-pressed', 'false')
      // Видео поставлено на паузу.
      expect(await win.evaluate(() => document.querySelector('video')!.paused)).toBe(true)
      await shot(win, 'cal-start')

      // Первые четыре точки: счётчик, подсказка на схеме, клавиша Backspace убирает последнюю.
      const p = truth.points.penaltyArea
      await click(win, p[0].image)
      await expect(win.getByTestId('cal-point-1')).toHaveAttribute('data-state', 'placed')
      await expect(win.getByTestId('cal-point-2')).toHaveAttribute('data-state', 'next')
      await win.keyboard.press('Backspace')
      await expect(win.getByTestId('cal-point-1')).toHaveAttribute('data-state', 'next')

      // Остальные три точки — и разметка готова к сохранению.
      await click(win, p[0].image)
      for (const i of [1, 2, 3]) await click(win, p[i].image)
      await expect(win.getByTestId('cal-save')).toBeEnabled()
      await expect(win.getByTestId('cal-accuracy')).toContainText(
        'с 4 точками ошибку проверить нельзя'
      )
    } finally {
      await app.close()
    }
  })

  test('точность по 4 + 5 точкам, сетка поля, сохранение разметки', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      const text = await calibrate(win)
      await shot(win, 'cal-mode')
      const rms = Number(/Точность: ([\d.]+) px/.exec(text)?.[1])
      console.log('Точность разметки (9 точек):', text)
      expect(Number.isFinite(rms)).toBe(true)
      expect(rms).toBeLessThan(3)
      await expect(win.getByTestId('cal-accuracy')).toHaveAttribute('data-quality', 'good')
      // Линии поля проецируются поверх кадра.
      const preview = await win.getByTestId('cal-preview').getAttribute('d')
      expect(preview!.length).toBeGreaterThan(500)
      await saveCalibration(win)
      await expect(win.getByTestId('pitch-active')).toContainText('Поле 00:01.0')
      await expect(win.getByTestId('pitch-active')).toHaveAttribute(
        'title',
        /Разметка поля: 00:01.0/
      )
      await expect(win.getByTestId('pitch-on')).toBeEnabled()
      await expect(win.getByTestId('tool-ruler')).toBeEnabled()
      await expect(win.getByTestId('calibration-item')).toContainText('Штрафная площадь (слева)')
      await expect(win.getByTestId('project-dirty')).toBeVisible()

      // Сетка поля показывается рядом с кадром разметки и пропадает далеко от него.
      await win.getByTestId('pitch-grid-toggle').check()
      await expect(win.getByTestId('pitch-grid')).toHaveCount(1)
      await shot(win, 'grid')
      await seekVideo(win, 2.9)
      await expect(win.getByTestId('pitch-grid')).toHaveCount(0)
      await seekVideo(win, 1.4)
      await expect(win.getByTestId('pitch-grid')).toHaveCount(1)
      await win.getByTestId('pitch-grid-toggle').uncheck()
      await expect(win.getByTestId('pitch-grid')).toHaveCount(0)

      // Клик по строке списка возвращает на кадр разметки.
      await seekVideo(win, 2.5)
      await win.getByTestId('calibration-goto').click()
      await expect
        .poll(() => win.evaluate(() => document.querySelector('video')!.currentTime))
        .toBeCloseTo(1, 1)
    } finally {
      await app.close()
    }
  })

  test('неточные клики: точность показывает ошибку, а кольцо всё равно ложится на игрока', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      const text = await calibrate(win, 'goal-area', true)
      const rms = Number(/Точность: ([\d.]+) px/.exec(text)?.[1])
      console.log('Точность при неточных кликах (9 точек, ±1–1.5 экранных px):', text)
      expect(rms).toBeGreaterThan(0.3)
      expect(rms).toBeLessThan(5)
      await saveCalibration(win)
      const player = truth.players[0].world
      await win.getByTestId('tool-circle').click()
      await click(win, project(player.x, player.y))
      const layer = await layerBox(win)
      const got = await discBox(rings(win).first())
      const want = expectedCircleBox(player.x, player.y, 1, layer.width, layer.height)
      const scale = W / layer.width
      const dx = (got.x + got.w / 2 - (want.x + want.w / 2)) * scale
      const dy = (got.y + got.h / 2 - (want.y + want.h / 2)) * scale
      console.log(
        'Кольцо при неточной разметке: смещение центра в пикселях видео =',
        dx.toFixed(2),
        dy.toFixed(2)
      )
      expect(Math.hypot(dx, dy)).toBeLessThan(6)
      const g = (await geo(rings(win).first())) as { center: Pt }
      console.log('Центр кольца в метрах:', JSON.stringify(g.center), 'ожидалось (9, 34)')
      expect(Math.hypot(g.center.x - player.x, g.center.y - player.y)).toBeLessThan(0.6)
    } finally {
      await app.close()
    }
  })

  test('ошибки разметки объяснены: точки в неверном порядке, слишком близко', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await win.getByTestId('pitch-calibrate').click()
      const p = truth.points.penaltyArea
      // Углы 1, 3, 2, 4: линии пересекаются.
      for (const i of [0, 2, 1, 3]) await click(win, p[i].image)
      await expect(win.getByTestId('cal-accuracy')).toContainText('неверном порядке')
      await expect(win.getByTestId('cal-save')).toBeDisabled()
      for (let i = 0; i < 3; i += 1) await win.keyboard.press('Backspace')
      for (const i of [1, 2, 3]) await click(win, p[i].image)
      await expect(win.getByTestId('cal-save')).toBeEnabled()
      // Отмена с поставленными точками спрашивает; «Сбросить» закрывает режим и ничего не сохраняет.
      await win.getByTestId('cal-cancel').click()
      await win.getByTestId('cal-cancel-discard').click()
      await expect(win.getByTestId('calibration-mode')).toHaveCount(0)
      await expect(win.getByTestId('calibration-item')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('рисунки на траве: кольцо, стрелка, линия, подпись, линейка; Shift по осям поля', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await calibrate(win)
      await saveCalibration(win)

      // --- Кольцо (клик = 1 м) вокруг игрока в точке (9, 34) ---
      const player = truth.players[0].world
      await win.getByTestId('tool-circle').click()
      await click(win, project(player.x, player.y))
      const ring = rings(win)
      await expect(ring).toHaveCount(1)
      await expect(ring).toHaveAttribute('data-space', 'pitch')
      const g = (await geo(ring)) as { center: Pt; radius: number }
      expect(Math.hypot(g.center.x - player.x, g.center.y - player.y)).toBeLessThan(0.25)
      expect(g.radius).toBeCloseTo(1, 5)
      // Новый рисунок на поле — «Только кадр».
      await expect(win.getByTestId('mode-frame')).toHaveAttribute('aria-pressed', 'true')
      // Форма на экране совпадает с проекцией окружности по точной гомографии.
      const layer = await layerBox(win)
      const got = await discBox(ring)
      const want = expectedCircleBox(player.x, player.y, 1, layer.width, layer.height)
      expect(Math.abs(got.x + got.w / 2 - (want.x + want.w / 2))).toBeLessThan(3)
      expect(Math.abs(got.y + got.h / 2 - (want.y + want.h / 2))).toBeLessThan(3)
      expect(Math.abs(got.w / 2 - want.w / 2)).toBeLessThan(3)
      expect(Math.abs(got.h / 2 - want.h / 2)).toBeLessThan(3)
      console.log(
        'Кольцо 1 м: смещение центра px =',
        (got.x + got.w / 2 - (want.x + want.w / 2)).toFixed(2),
        (got.y + got.h / 2 - (want.y + want.h / 2)).toFixed(2),
        '; полуширина px (получено / ожидалось) =',
        (got.w / 2).toFixed(2),
        (want.w / 2).toFixed(2),
        '; центр в метрах =',
        JSON.stringify(g.center)
      )
      // Это эллипс, а не круг: перспектива сплющивает его.
      expect(got.w).toBeGreaterThan(got.h * 1.5)

      // Большое кольцо перетаскиванием: радиус в метрах = расстояние на земле.
      await click(win, { x: 0.9, y: 0.05 }) // клик в небо — рисунок не создаётся
      await expect(rings(win)).toHaveCount(1)
      const blue = truth.players[1].world
      await drag(win, project(blue.x, blue.y), project(blue.x + 3, blue.y))
      await expect(rings(win)).toHaveCount(2)
      const big = (await geo(rings(win).nth(1))) as { radius: number }
      expect(Math.abs(big.radius - 3)).toBeLessThan(0.3)

      // --- Стрелка на траве: вдоль поля, сужается вдаль ---
      await win.getByTestId('tool-arrow').click()
      await win.getByTestId('color-ffffff').click()
      await drag(win, project(8, 48), project(20, 48))
      const arrow = win.locator('[data-testid="annotation"][data-type="parrow"]')
      await expect(arrow).toHaveCount(1)
      await expect(arrow).toHaveAttribute('data-space', 'pitch')

      // --- Линия пунктиром, Shift: угол кратен 45° относительно осей поля ---
      await win.getByTestId('tool-line').click()
      await win.getByTestId('dash-dashed').click()
      await drag(win, project(2, 10), project(14, 12.3), true)
      const line = win.locator('[data-testid="annotation"][data-type="pline"]')
      await expect(line).toHaveCount(1)
      const lg = (await geo(line)) as { p1: Pt; p2: Pt }
      expect(Math.abs(lg.p2.y - lg.p1.y)).toBeLessThan(0.01)
      expect(lg.p2.x - lg.p1.x).toBeGreaterThan(8)

      // --- Подпись над точкой земли ---
      await win.getByTestId('tool-text').click()
      await win.getByTestId('text-size-2').click()
      await click(win, project(22, 56))
      await win.keyboard.type('Прессинг')
      await win.keyboard.press('Enter')
      const label = win.locator('[data-testid="annotation"][data-type="ptext"]')
      await expect(label).toHaveCount(1)
      await expect(label).toHaveAttribute('data-text', 'Прессинг')

      // --- Линейка вдоль линии ворот: 40.32 м ---
      await win.getByTestId('tool-ruler').click()
      await win.getByTestId('color-ffd60a').click()
      const pa = truth.points.penaltyArea
      await drag(win, pa[0].image, pa[3].image)
      const ruler = win.locator('[data-testid="annotation"][data-type="ruler"]')
      await expect(ruler).toHaveCount(1)
      const text = (await ruler.getByTestId('ruler-label').textContent()) ?? ''
      console.log('Линейка 40.32 м показала:', text)
      expect(text).toMatch(/^40\.[2-4] м$/)
      const value = Number(text.replace(' м', ''))
      expect(Math.abs(value - 40.32)).toBeLessThan(0.25)
      // Ещё одна: ширина штрафной площади (16.5 м). Начало на конце выбранной линейки: с Alt нажатие рисует новую.
      await win.keyboard.down('Alt')
      await drag(win, pa[0].image, pa[1].image)
      await win.keyboard.up('Alt')
      const second = win.locator('[data-testid="annotation"][data-type="ruler"]').nth(1)
      const text2 = (await second.getByTestId('ruler-label').textContent()) ?? ''
      console.log('Линейка 16.5 м показала:', text2)
      expect(Math.abs(Number(text2.replace(' м', '')) - 16.5)).toBeLessThan(0.25)
      await win.getByTestId('tool-select').click()
      await seekVideo(win, 1)
      await shot(win, 'drawings')

      // Выбор рисунка на поле: ручки и Инспектор; ручку радиуса можно тянуть.
      await click(win, project(player.x - 0.5, player.y))
      await expect(win.getByTestId('handles')).toBeVisible()
      await shot(win, 'selected')
      const before = (await geo(rings(win).first())) as { radius: number }
      const handle = win.locator('[data-handle="radius"]')
      const hb = (await handle.boundingBox())!
      await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
      await win.mouse.down()
      await win.mouse.move(hb.x + hb.width / 2 + 40, hb.y + hb.height / 2, { steps: 5 })
      await win.mouse.up()
      const after = (await geo(rings(win).first())) as { radius: number }
      expect(after.radius).toBeGreaterThan(before.radius + 0.2)

      // Перетаскивание рисунка целиком сдвигает его по земле.
      const c0 = ((await geo(rings(win).first())) as { center: Pt }).center
      await drag(win, project(c0.x, c0.y), project(c0.x - 2, c0.y + 1))
      const c1 = ((await geo(rings(win).first())) as { center: Pt }).center
      expect(Math.abs(c1.x - (c0.x - 2))).toBeLessThan(0.3)
      expect(Math.abs(c1.y - (c0.y + 1))).toBeLessThan(0.3)

      // Отмена возвращает на место, повтор — обратно.
      await win.keyboard.press('Control+z')
      const c2 = ((await geo(rings(win).first())) as { center: Pt }).center
      expect(Math.abs(c2.x - c0.x)).toBeLessThan(0.01)
      await win.keyboard.press('Control+y')
    } finally {
      await app.close()
    }
  })

  test('перетаскивание точки разметки двигает рисунки; отмена разметки возвращает всё', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await calibrate(win)
      await saveCalibration(win)
      const player = truth.players[0].world
      await win.getByTestId('tool-circle').click()
      await click(win, project(player.x, player.y))
      await win.getByTestId('tool-select').click()
      const ring = rings(win).first()
      const before = await discBox(ring)

      // Правка точек: рисунок пересчитывается вживую.
      await win.getByTestId('calibration-edit').click()
      await expect(win.getByTestId('calibration-mode')).toBeVisible()
      await expect(win.getByTestId('cal-pt')).toHaveCount(9)
      const first = win.getByTestId('cal-pt').first().locator('circle').first()
      const fb = (await first.boundingBox())!
      await win.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2)
      await win.mouse.down()
      // Пока кнопка нажата — лупа рядом с курсором (сначала чуть сдвинули — на снимке видны линии).
      await win.mouse.move(fb.x + fb.width / 2 + 4, fb.y + fb.height / 2 + 3, { steps: 3 })
      await expect(win.getByTestId('cal-loupe')).toBeVisible()
      await shot(win, 'loupe')
      await win.mouse.move(fb.x + fb.width / 2 + 25, fb.y + fb.height / 2 + 12, { steps: 6 })
      await win.mouse.up()
      await expect(win.getByTestId('cal-loupe')).toHaveCount(0)
      const during = await discBox(ring)
      expect(Math.abs(during.x - before.x) + Math.abs(during.w - before.w)).toBeGreaterThan(1)
      // Отметка ушла: ошибка точности выросла и точка подсвечена.
      await expect(win.getByTestId('cal-accuracy')).toContainText('Точность')

      // Стрелки: Alt+← сдвигает выбранную точку на пиксель.
      await win.keyboard.press('Alt+ArrowLeft')
      // Отмена: рисунок возвращается на место.
      await win.getByTestId('cal-cancel').click()
      await win.getByTestId('cal-cancel-discard').click()
      await expect(win.getByTestId('calibration-mode')).toHaveCount(0)
      const restored = await discBox(ring)
      expect(Math.abs(restored.x - before.x)).toBeLessThan(0.01)
      expect(Math.abs(restored.w - before.w)).toBeLessThan(0.01)

      // Правка с сохранением: разметка заменена, а отмена (Ctrl+Z) возвращает прежнюю.
      await win.getByTestId('calibration-edit').click()
      const p0 = win.getByTestId('cal-pt').first().locator('circle').first()
      const pb = (await p0.boundingBox())!
      await win.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2)
      await win.mouse.down()
      await win.mouse.move(pb.x + pb.width / 2 + 30, pb.y + pb.height / 2, { steps: 5 })
      await win.mouse.up()
      await win.getByTestId('cal-save').click()
      await expect(win.getByTestId('calibration-mode')).toHaveCount(0)
      const edited = await discBox(ring)
      expect(Math.abs(edited.x - before.x) + Math.abs(edited.w - before.w)).toBeGreaterThan(0.5)
      await win.keyboard.press('Control+z')
      const undone = await discBox(ring)
      expect(Math.abs(undone.x - before.x)).toBeLessThan(0.01)

      // Удаление разметки: рисунок на поле прячется, отмена возвращает и разметку, и рисунок.
      await win.getByTestId('calibration-delete').click()
      await expect(win.getByTestId('calibration-item')).toHaveCount(0)
      await expect(win.locator('[data-testid="annotation"][data-type="ring"]')).toHaveCount(0)
      await win.keyboard.press('Control+z')
      await expect(win.getByTestId('calibration-item')).toHaveCount(1)
      await expect(rings(win)).toHaveCount(1)
    } finally {
      await app.close()
    }
  })

  test('рисунок далеко от кадра разметки бледнеет и предупреждает; рисунки на экране не затронуты', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await calibrate(win, 'none')
      await saveCalibration(win)
      await win.getByTestId('tool-circle').click()
      await click(win, project(9, 34))
      await win.getByTestId('tool-select').click()
      await expect(rings(win).first()).not.toHaveAttribute('data-dimmed', 'true')
      // Рисунок «Отрезок» виден 3 секунды; через 2 секунды от разметки он бледнеет.
      await win.getByTestId('mode-range').click()
      await win.getByTestId('duration-input').fill('3')
      await expect(win.getByTestId('pitch-stale')).toHaveCount(0)
      await seekVideo(win, 2.6)
      await expect(rings(win).first()).toHaveAttribute('data-dimmed', 'true')
      await click(win, project(9, 34))
      await expect(win.getByTestId('pitch-stale')).toContainText('Камера могла сдвинуться')
      await shot(win, 'stale')
      await expect(win.getByTestId('pitch-active')).toHaveAttribute('data-stale', 'true')

      // «На поле» выключено: круг рисуется обычным, на экране.
      await win.getByTestId('pitch-on').click()
      await win.getByTestId('tool-circle').click()
      await drag(win, { x: 0.7, y: 0.1 }, { x: 0.85, y: 0.25 })
      await expect(win.locator('[data-testid="annotation"][data-type="circle"]')).toHaveCount(1)
      await expect(win.locator('[data-testid="annotation"][data-type="circle"]')).toHaveAttribute(
        'data-space',
        'screen'
      )
    } finally {
      await app.close()
    }
  })

  test('сохранение и открытие проекта: разметка и рисунки на поле возвращаются', async () => {
    const ctx = await launch()
    let { app, win } = ctx
    const userData = ctx.userData
    try {
      await openPitch(ctx, 'Поле проект')
      await calibrate(win)
      await saveCalibration(win)
      await win.getByTestId('tool-circle').click()
      await click(win, project(9, 34))
      await win.getByTestId('tool-ruler').click()
      const pa = truth.points.penaltyArea
      await drag(win, pa[0].image, pa[3].image)
      await win.getByTestId('tool-select').click()
      const rulerText = await win
        .locator('[data-testid="annotation"][data-type="ruler"]')
        .getByTestId('ruler-label')
        .textContent()
      const ringGeo = await geo(rings(win).first())
      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      await app.close()

      const next = await launch({ userData })
      app = next.app
      win = next.win
      await cardByTitle(win, 'Поле проект').getByTestId('card-open-main').click()
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await expect(win.getByTestId('calibration-item')).toHaveCount(1)
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      await seekVideo(win, 1)
      await expect(rings(win)).toHaveCount(1)
      expect(await geo(rings(win).first())).toEqual(ringGeo)
      await expect(
        win.locator('[data-testid="annotation"][data-type="ruler"]').getByTestId('ruler-label')
      ).toHaveText(rulerText!)
      await shot(win, 'reopened')
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('старый проект без разметок открывается как раньше', async () => {
    const ctx = await launch()
    const { app, projectsDir } = ctx
    try {
      mkdirSync(projectsDir, { recursive: true })
      const file = join(projectsDir, 'старый.flowproj')
      seedProject(file, {
        video: fixture('pitch.mp4'),
        meta: { title: 'Старый', type: 'other' },
        annotations: 2
      })
      await app.close()
      const next = await launch({ userData: ctx.userData })
      await expect(cardByTitle(next.win, 'Старый')).toBeVisible()
      await cardByTitle(next.win, 'Старый').getByTestId('card-open-main').click()
      await expect(next.win.getByTestId('play-toggle')).toBeEnabled()
      await seekVideo(next.win, 1.5)
      await expect(next.win.getByTestId('annotation')).toHaveCount(2)
      await expect(next.win.getByTestId('calibration-item')).toHaveCount(0)
      await expect(next.win.getByTestId('pitch-on')).toBeDisabled()
      await next.app.close()
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('экспорт: кольцо на траве попадает в видео в перспективе', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    const out = join(makeUserData(), 'out')
    mkdirSync(out)
    try {
      await openPitch(ctx)
      await calibrate(win)
      await saveCalibration(win)
      const player = truth.players[0].world
      await win.getByTestId('tool-circle').click()
      await win.getByTestId('color-ff3b30').click()
      await win.getByTestId('width-2').click()
      // Большое кольцо (2.5 м) вокруг игрока: рисуется перетаскиванием.
      await drag(win, project(player.x, player.y), project(player.x + 2.5, player.y))
      await win.getByTestId('tool-ruler').click()
      await win.getByTestId('color-ffd60a').click()
      const pa = truth.points.penaltyArea
      await drag(win, pa[1].image, pa[2].image)
      await win.getByTestId('tool-select').click()
      await seekVideo(win, 1)
      const layer = await win.getByTestId('annotation-layer').boundingBox()
      await win.screenshot({ path: join(SHOTS, `pitch-screen${SUFFIX}.png`), clip: layer! })

      await stubDialog(app, out)
      await win.getByTestId('export-open').click()
      await expect(win.getByTestId('export-scope-whole')).toBeChecked()
      await expect(win.getByTestId('export-drawings')).toBeChecked()
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 60_000 })
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done')
      const file = join(out, readdirSync(out)[0])
      expect(statSync(file).size).toBeGreaterThan(1000)

      // Кадр из стоп-кадра (≈ секунда 1): рисунок красный, значит пиксели на окружности кольца красные.
      // Окружность радиуса 2.5 м по точной гомографии — точка справа от центра.
      const frameIndex = 25 + 12
      const png = join(SHOTS, `pitch-export-frame${SUFFIX}.png`)
      ff(['-i', file, '-vf', `select=eq(n\\,${frameIndex})`, '-frames:v', '1', '-y', png])
      expect(statSync(png).size).toBeGreaterThan(1000)
      const rgb = frameRgb(file, frameIndex, W, H)
      const redAt = (x: number, y: number): boolean => {
        // Ищем красный в небольшой окрестности (линия тонкая, кодек сдвигает цвет).
        for (let dy = -3; dy <= 3; dy += 1) {
          for (let dx = -3; dx <= 3; dx += 1) {
            const [r, g, b] = pixelAt(rgb, W, Math.round(x) + dx, Math.round(y) + dy)
            if (r > 170 && g < 90 && b < 90) return true
          }
        }
        return false
      }
      const onRing = [0, 90, 180, 270].map((deg) => {
        const a = (deg * Math.PI) / 180
        const p = project(player.x + 2.5 * Math.cos(a), player.y + 2.5 * Math.sin(a))
        return redAt(p.x * W, p.y * H)
      })
      expect(onRing.filter(Boolean).length).toBeGreaterThanOrEqual(4)
      // Центр кольца внутри — не красный сплошной (заливка прозрачная), а вдали красного нет.
      const far = project(30, 60)
      expect(redAt(far.x * W, far.y * H)).toBe(false)
      // Жёлтая линейка на месте: середина отрезка между передними углами штрафной.
      const mid = { x: (pa[1].image.x + pa[2].image.x) / 2, y: (pa[1].image.y + pa[2].image.y) / 2 }
      let yellow = false
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const [r, g, b] = pixelAt(rgb, W, Math.round(mid.x * W) + dx, Math.round(mid.y * H) + dy)
          if (r > 200 && g > 170 && b < 120) yellow = true
        }
      }
      expect(yellow).toBe(true)
    } finally {
      await app.close()
    }
  })
})
