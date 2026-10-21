// Версия 0.16.4: рисунки выделяют, а не мешают. Инструмент остаётся включённым, но нажатие на нарисованное правит его;
// подсветки по умолчанию под игроками и с лёгкой заливкой; мелкий текст; рисунки скрыты на время разметки поля; обложка проекта.
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { dragOnPicture, fixture, launch, seekVideo } from './helpers'
import { calibrate, openPitch, saveCalibration } from './pitchHelpers'
import { createProject } from './startHelpers'
import { geo, shapes } from './toolsHelpers'

type Ctx = Awaited<ReturnType<typeof launch>>

const arrows = (win: Page): Locator =>
  win.locator('[data-testid="annotation"][data-type="arrow"]:not([data-id="poly-draft"])')
const circles = (win: Page): Locator =>
  win.locator('[data-testid="annotation"][data-type="circle"]:not([data-id="poly-draft"])')

interface TwoPoints {
  p1: { x: number; y: number }
  p2: { x: number; y: number }
}

async function newProject(ctx: Ctx, title: string): Promise<void> {
  await createProject(ctx, { title, video: fixture('cfr25.mp4') })
  await ctx.win.keyboard.press('Escape')
}

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

test.describe('0.16.4: нарисованное правится, не мешая рисовать', () => {
  test('стрелка: перетаскивание нарисованной двигает её, на пустом месте рисуется новая', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await newProject(ctx, 'Правка инструментом')
      await seekVideo(win, 1)
      await win.getByTestId('tool-arrow').click()
      await dragOnPicture(win, [0.2, 0.3], [0.5, 0.3])
      await expect(arrows(win)).toHaveCount(1)
      const before = await geo<TwoPoints>(arrows(win))
      // Инструмент «Стрелка» остался включённым.
      await expect(win.getByTestId('annotation-layer')).toHaveAttribute('data-tool', 'arrow')

      // Нажатие на тело стрелки и протяжка вниз: стрелка переехала, новых нет.
      await dragOnPicture(win, [0.35, 0.3], [0.35, 0.6])
      await expect(arrows(win)).toHaveCount(1)
      const moved = await geo<TwoPoints>(arrows(win))
      expect(moved.p1.y - before.p1.y).toBeGreaterThan(0.25)
      expect(moved.p1.x).toBeCloseTo(before.p1.x, 2)

      // Конец стрелки (ручка) тоже правится инструментом.
      await dragOnPicture(win, [moved.p2.x, moved.p2.y], [moved.p2.x + 0.1, moved.p2.y])
      await expect(arrows(win)).toHaveCount(1)
      const handled = await geo<TwoPoints>(arrows(win))
      expect(handled.p2.x - moved.p2.x).toBeGreaterThan(0.05)
      expect(handled.p1.x).toBeCloseTo(moved.p1.x, 2)

      // На пустом месте — новая стрелка.
      await dragOnPicture(win, [0.6, 0.85], [0.9, 0.85])
      await expect(arrows(win)).toHaveCount(2)

      // Alt при нажатии на нарисованное рисует новую поверх, а не двигает.
      await win.keyboard.down('Alt')
      await dragOnPicture(win, [0.7, 0.85], [0.8, 0.95])
      await win.keyboard.up('Alt')
      await expect(arrows(win)).toHaveCount(3)
    } finally {
      await ctx.app.close()
    }
  })

  test('движущийся рисунок: правка включённым инструментом даёт автоключ', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await newProject(ctx, 'Автоключ инструментом')
      await seekVideo(win, 1)
      await win.getByTestId('tool-circle').click()
      await dragOnPicture(win, [0.15, 0.8], [0.25, 0.9])
      await expect(circles(win)).toHaveCount(1)
      await win.getByTestId('anim-start').click()
      await expect(win.getByTestId('key-count')).toHaveAttribute('data-count', '1')
      await seekVideo(win, 2.06)
      await expect(circles(win)).toHaveCount(1)
      // Инструмент «Круг» всё ещё включён: нажатие на край круга двигает его и ставит ключ.
      await expect(win.getByTestId('annotation-layer')).toHaveAttribute('data-tool', 'circle')
      await dragOnPicture(win, [0.25, 0.85], [0.65, 0.85])
      await expect(circles(win)).toHaveCount(1)
      await expect(win.getByTestId('key-count')).toHaveAttribute('data-count', '2')
    } finally {
      await ctx.app.close()
    }
  })
})

test.describe('0.16.4: подсветки не закрывают игрока', () => {
  test('круг на экране: под игроками, лёгкая заливка, её можно поднять; текст по умолчанию мельче', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await newProject(ctx, 'Лёгкие подсветки')
      await seekVideo(win, 1)
      await win.getByTestId('tool-circle').click()
      await expect(win.getByTestId('under-toggle')).toHaveAttribute('aria-pressed', 'true')
      await dragOnPicture(win, [0.3, 0.3], [0.4, 0.5])
      await expect(shapes(win, 'circle')).toHaveAttribute('data-under', 'true')
      await expect(win.getByTestId('prop-under')).toBeChecked()
      const fill = win.getByTestId('prop-fill-opacity-value')
      const percent = Number((await fill.textContent())?.replace(/\D+/g, ''))
      expect(percent).toBeGreaterThan(0)
      expect(percent).toBeLessThanOrEqual(15)
      // Заливку можно усилить; значение уходит в рисунок.
      await win.getByTestId('prop-fill-opacity').fill('30')
      await expect(fill).toContainText('30')

      // Стрелка на экране по умолчанию поверх игроков.
      await win.getByTestId('tool-arrow').click()
      await expect(win.getByTestId('under-toggle')).toHaveAttribute('aria-pressed', 'false')

      // Размеры текста: пять ступеней, по умолчанию третья (прежнего «среднего» шага вниз).
      await win.getByTestId('tool-text').click()
      await expect(win.locator('[data-testid^="text-size-"]')).toHaveCount(5)
      await expect(win.getByTestId('text-size-2')).toHaveAttribute('aria-pressed', 'true')
      await win.getByTestId('text-size-0').click()
      await expect(win.getByTestId('text-size-0')).toHaveAttribute('aria-pressed', 'true')
    } finally {
      await ctx.app.close()
    }
  })

  test('кольцо на поле: под игроками и с лёгкой заливкой', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await openPitch(ctx, 'Кольцо')
      await calibrate(win)
      await saveCalibration(win)
      await win.getByTestId('tool-circle').click()
      await expect(win.getByTestId('under-toggle')).toHaveAttribute('aria-pressed', 'true')
      await win.mouse.click(...(await centerOfPicture(win)))
      await expect(shapes(win, 'ring')).toHaveAttribute('data-under', 'true')
      const percent = Number(
        (await win.getByTestId('prop-fill-opacity-value').textContent())?.replace(/\D+/g, '')
      )
      expect(percent).toBeLessThanOrEqual(15)
    } finally {
      await ctx.app.close()
    }
  })
})

async function centerOfPicture(win: Page): Promise<[number, number]> {
  const b = await win.getByTestId('annotation-layer').boundingBox()
  expect(b).not.toBeNull()
  return [b!.x + b!.width * 0.5, b!.y + b!.height * 0.6]
}

test.describe('0.16.4: разметка поля и обложка', () => {
  test('на время разметки поля рисунки скрыты, потом возвращаются', async () => {
    const ctx = await launch()
    const { win } = ctx
    try {
      await openPitch(ctx, 'Скрытие при разметке')
      await win.getByTestId('tool-arrow').click()
      await dragOnPicture(win, [0.2, 0.4], [0.5, 0.4])
      await expect(arrows(win)).toHaveCount(1)
      await win.getByTestId('pitch-calibrate').click()
      await expect(win.getByTestId('calibration-mode')).toBeVisible()
      await expect(arrows(win).first()).toBeHidden()
      await win.getByTestId('cal-cancel').click()
      await expect(win.getByTestId('calibration-mode')).toHaveCount(0)
      await expect(arrows(win)).toHaveCount(1)
      await expect(arrows(win).first()).toBeVisible()
    } finally {
      await ctx.app.close()
    }
  })

  test('«Сделать этот кадр обложкой» пишет время в проект', async () => {
    const ctx = await launch()
    const { win, projectsDir } = ctx
    try {
      await newProject(ctx, 'Обложка')
      await seekVideo(win, 1.5)
      await win.getByTestId('project-menu-button').click()
      await win.getByTestId('menu-cover').click()
      await expect(win.getByTestId('project-dirty')).toBeVisible()
      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      const saved = JSON.parse(readFileSync(findProject(projectsDir), 'utf8')) as {
        ui: { coverTime?: number }
      }
      expect(saved.ui.coverTime).toBeGreaterThan(1.4)
      expect(saved.ui.coverTime).toBeLessThan(1.6)
    } finally {
      await ctx.app.close()
    }
  })
})
