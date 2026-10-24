// Общие помощники для тестов доски: поле в долях, постановка элементов, чтение сцены.
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { join } from 'path'

/** Прямые элементы сцены (тень прошлого кадра лежит в <g data-board-ghosts> и не считается). */
export const sceneItems = (win: Page, kind?: string): Locator =>
  win.locator(
    `[data-testid="board-stage"] [data-board-scene] > [data-board-item]${kind ? `[data-kind="${kind}"]` : ''}`
  )

export const scene = (win: Page): Locator =>
  win.locator('[data-testid="board-stage"] [data-board-scene]').first()

/** Папка досок внутри папки проектов. */
export const boardsDir = (projectsDir: string): string => join(projectsDir, 'Доски')

/** Точка на поле в долях (0..1) -> экранные координаты. */
export async function fieldPoint(win: Page, fx: number, fy: number): Promise<[number, number]> {
  const b = await scene(win).boundingBox()
  if (!b) throw new Error('сцена доски не видна')
  return [b.x + fx * b.width, b.y + fy * b.height]
}

export async function clickField(win: Page, fx: number, fy: number): Promise<void> {
  const [x, y] = await fieldPoint(win, fx, fy)
  await win.mouse.click(x, y)
}

export async function dragField(
  win: Page,
  from: [number, number],
  to: [number, number]
): Promise<void> {
  const [x0, y0] = await fieldPoint(win, from[0], from[1])
  const [x1, y1] = await fieldPoint(win, to[0], to[1])
  await win.mouse.move(x0, y0)
  await win.mouse.down()
  await win.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 })
  await win.mouse.move(x1, y1, { steps: 4 })
  await win.mouse.up()
}

/** Открывает новую доску кнопкой на начальном экране. */
export async function openNewBoard(win: Page): Promise<void> {
  await win.getByTestId('start-new-board').click()
  await expect(win.getByTestId('board-editor')).toBeVisible()
  await expect(scene(win)).toBeVisible()
}

/** Раздел -> поза/предмет -> щелчок по полю: ставит один элемент. */
export async function place(
  win: Page,
  section: string,
  tray: string,
  at: [number, number]
): Promise<void> {
  await win.getByTestId(`board-section-${section}`).click()
  await win.getByTestId(`board-tray-${tray}`).click()
  await clickField(win, at[0], at[1])
}

export const addFrame = (win: Page): Promise<void> => win.getByTestId('board-frame-add').click()
