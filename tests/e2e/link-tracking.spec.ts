// «Связка»: «Следить за игроками». Настоящие окно, ffmpeg и IPC; детектор — заглушка со сценарием на три фигурки
// (FLOW_DETECTOR_STUB=1). Видео cfr25.mp4 (640×360, 25 к/с, 4 с) и pitch.mp4 (связка на поле); сценарии заглушки лежат в
// tests/fixtures (stub-three*.json) и описывают игроков в долях кадра: положение = start + velocity · t.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { frameRgb, pixelAt } from '../../src/main/ffmpeg/ffmpeg.testkit'
import { SHOTS, SUFFIX, fixture, launch, makeUserData, seekVideo, stubDialog } from './helpers'
import { calibrate, openPitch, project, saveCalibration } from './pitchHelpers'
import { createProject } from './startHelpers'
import { clickAt, dragPx, geo, handleCenter, px, shapes, type Frac } from './toolsHelpers'

type Ctx = { app: ElectronApplication; win: Page; userData: string; projectsDir: string }

const FPS = 25
const STUB = { FLOW_DETECTOR_STUB: '1' }
const THREE = fixture('stub-three.json')
const THREE_LOST = fixture('stub-three-lost.json')
const ASK = fixture('stub-three-ask.json')
const AMBIGUOUS = fixture('stub-three-ambiguous.json')

const shot = (win: Page, name: string): Promise<Buffer> =>
  win.screenshot({ path: join(SHOTS, `link-tracking-${name}${SUFFIX}.png`) })

interface Pts {
  points: Array<{ x: number; y: number }>
}
const pointsOf = async (win: Page, type = 'link'): Promise<Pts['points']> =>
  (await geo<Pts>(shapes(win, type).first())).points

const trackItem = (win: Page) => win.getByTestId('track-item')
const toast = (win: Page) => win.getByTestId('toast')

const runsOf = async (win: Page): Promise<number> =>
  Number(await win.getByTestId('tracking-state').getAttribute('data-runs'))

async function waitRun(win: Page, before: number): Promise<void> {
  await expect(win.getByTestId('tracking-state')).toHaveAttribute('data-runs', String(before + 1), {
    timeout: 60_000
  })
}

/** Нажимает «Следить за игроками» и ждёт конца расчёта. */
async function runTracking(win: Page): Promise<void> {
  const before = await runsOf(win)
  await win.getByTestId('track-button').click()
  await waitRun(win, before)
}

/** Щёлкает по нижней из рамок в вопросе «Кто из них ваш?» (двойник, что ниже на экране). */
async function pickLower(win: Page): Promise<void> {
  const boxes = win.getByTestId('pick-box')
  const n = await boxes.count()
  const tops = await Promise.all(
    Array.from({ length: n }, async (_, i) => (await boxes.nth(i).boundingBox())!.y)
  )
  await boxes.nth(tops.indexOf(Math.max(...tops))).click()
}

/** Ждёт конца слежения; если оно снова спрашивает «Кто из них ваш?», отвечает нижней рамкой. */
async function settle(win: Page): Promise<number> {
  let questions = 0
  for (let round = 0; round < 8; round += 1) {
    const state = win.locator('[data-testid=tracking-host],[data-testid=tracking-state]')
    await expect(async () => {
      const phase = await state.getAttribute('data-phase')
      expect(['idle', 'asking']).toContain(phase)
    }).toPass({ timeout: 60_000 })
    if ((await state.getAttribute('data-phase')) === 'idle') return questions
    await pickLower(win)
    questions += 1
  }
  throw new Error('слежение спрашивает слишком долго')
}

async function openStub(pattern: string, extraEnv: Record<string, string> = {}): Promise<Ctx> {
  const ctx = await launch({
    env: { ...STUB, FLOW_DETECTOR_STUB_PATTERN: pattern, ...extraEnv }
  })
  await createProject(ctx, { title: 'Связка', video: fixture('cfr25.mp4') })
  await seekVideo(ctx.win, 1)
  return ctx
}

/** Игроки stub-three.json на секунде 1: ноги в нижней части рамок (рамки 0.06 × 0.28). */
const AT_ONE_THREE: Frac[] = [
  [0.17, 0.3],
  [0.49, 0.62],
  [0.68, 0.94]
]
/** stub-three-ask.json на секунде 1 (игроки движутся медленнее). */
const AT_ONE_ASK: Frac[] = [
  [0.15, 0.3],
  [0.45, 0.62],
  [0.71, 0.94]
]
/** stub-three-ambiguous.json: вторая точка стоит между двумя игроками. */
const AT_ONE_AMBIGUOUS: Frac[] = [
  [0.15, 0.26],
  [0.45, 0.55],
  [0.71, 0.94]
]

/** Рисует связку по точкам (Enter), выбирает её и ставит отрезок на seconds секунд. */
async function drawLink(win: Page, points: Frac[], seconds = 2.9): Promise<void> {
  await win.keyboard.press('k')
  for (const p of points) await clickAt(win, p)
  await win.keyboard.press('Enter')
  await win.keyboard.press('v')
  await expect(shapes(win, 'link')).toHaveCount(1)
  await win.getByTestId('duration-input').fill(String(seconds))
}

/** Ожидаемая точка связки у ног игрока stub-three.json в момент t (рамка 0.06 × 0.28, подъём 0.07 высоты рамки). */
function threeFoot(i: number, t: number): { x: number; y: number } {
  const start = [
    { x: 0.1, y: 0.04, v: 0.04 },
    { x: 0.4, y: 0.36, v: 0.06 },
    { x: 0.7, y: 0.68, v: -0.05 }
  ][i]
  return { x: start.x + start.v * t + 0.03, y: start.y + 0.28 - 0.07 * 0.28 }
}

test.describe('связка: следить за игроками (заглушка детектора)', () => {
  test('кнопка у связки (не у «Только кадр»); три точки едут к ногам игроков: ключи auto, одна запись истории', async () => {
    const ctx = await openStub(THREE)
    const { app, win } = ctx
    try {
      await drawLink(win, AT_ONE_THREE)
      const button = win.getByTestId('track-button')
      await expect(button).toBeVisible()
      await expect(button).toHaveText('Следить за игроками')
      await expect(button).toHaveAttribute('data-mode', 'start')
      // «Только кадр»: кнопки нет, как у кольца.
      await win.getByTestId('mode-frame').click()
      await expect(button).toHaveCount(0)
      await win.getByTestId('mode-range').click()
      await win.getByTestId('duration-input').fill('2.9')
      await expect(button).toBeVisible()
      const before = await pointsOf(win)
      await shot(win, 'button')

      await runTracking(win)
      await expect(toast(win)).toContainText('Слежение готово')
      const keys = Number(await trackItem(win).getAttribute('data-keys'))
      expect(keys).toBeGreaterThanOrEqual(2)
      expect(keys).toBeLessThan(30)
      expect(await trackItem(win).getAttribute('data-auto-keys')).toBe(String(keys))
      await expect(win.getByTestId('track-band')).toHaveCount(1)

      // Точки встали к ногам игроков и едут за ними: на 1.5 с и 3.0 с — в местах из сценария (±0.02 кадра).
      for (const t of [1.5, 2.2, 3.0]) {
        await seekVideo(win, Math.floor(t * FPS) / FPS + 0.5 / FPS)
        const pts = await pointsOf(win)
        const tt = Math.floor(t * FPS) / FPS + 0.5 / FPS
        pts.forEach((p, i) => {
          const want = threeFoot(i, tt)
          expect(Math.abs(p.x - want.x), `t=${t} точка ${i + 1} x`).toBeLessThan(0.02)
          expect(Math.abs(p.y - want.y), `t=${t} точка ${i + 1} y`).toBeLessThan(0.02)
        })
      }
      await shot(win, 'tracked')

      // Один Ctrl+Z убирает всё слежение, Ctrl+Shift+Z возвращает.
      await win.keyboard.press('Control+z')
      await expect(trackItem(win)).toHaveAttribute('data-keys', '0')
      expect(await pointsOf(win)).toEqual(before)
      await win.keyboard.press('Control+Shift+z')
      await expect(trackItem(win)).toHaveAttribute('data-keys', String(keys))
    } finally {
      await app.close()
    }
  })

  test('вопрос на ходу по точке 2: «Точка 2: кто из них ваш?», подсвечена точка 2; ответ — слежение идёт за выбранным', async () => {
    const ctx = await openStub(ASK)
    const { app, win } = ctx
    try {
      await drawLink(win, AT_ONE_ASK)
      const before = await pointsOf(win)
      await win.getByTestId('track-button').click()
      await expect(win.getByTestId('pick-overlay')).toBeVisible({ timeout: 30_000 })
      await expect(win.getByTestId('pick-text')).toHaveText(
        'Точка 2: кто из них ваш? Щёлкните по игроку.'
      )
      // Подсвечена именно точка 2: кольцо с номером «2», больше подсвеченных точек нет.
      const mark = win.getByTestId('pick-point')
      await expect(mark).toHaveCount(1)
      await expect(mark).toHaveAttribute('data-point', '2')
      await expect(mark).toHaveText('2')
      // Метка стоит на точке 2 связки (в рисунке она ещё не сдвинута слежением).
      const layer = (await win.getByTestId('annotation-layer').boundingBox())!
      const m = (await mark.boundingBox())!
      const cx = (m.x + m.width / 2 - layer.x) / layer.width
      const cy = (m.y + m.height / 2 - layer.y) / layer.height
      expect(Math.abs(cx - before[1].x)).toBeLessThan(0.01)
      expect(Math.abs(cy - before[1].y)).toBeLessThan(0.01)
      await expect(win.getByTestId('pick-box')).toHaveCount(2)
      await shot(win, 'ask-point-2')
      // Выбираем нижнего двойника (рамка ниже на экране).
      await pickLower(win)
      await settle(win)
      expect(Number(await trackItem(win).getAttribute('data-auto-keys'))).toBeGreaterThanOrEqual(2)
      // К концу точка 2 — у ног нижнего двойника (рамка y 0.48–0.76), точки 1 и 3 — на своих.
      await seekVideo(win, 2.5)
      const end = await pointsOf(win)
      expect(Math.abs(end[1].y - (0.76 - 0.07 * 0.28))).toBeLessThan(0.03)
      expect(Math.abs(end[0].y - (0.32 - 0.07 * 0.28))).toBeLessThan(0.03)
      expect(Math.abs(end[2].y - (0.96 - 0.07 * 0.28))).toBeLessThan(0.03)
    } finally {
      await app.close()
    }
  })

  test('«Моего игрока тут нет — остановить здесь»: стоп на последнем надёжном кадре, обрезанный результат применён, сообщение с номером точки', async () => {
    const ctx = await openStub(ASK)
    const { app, win } = ctx
    try {
      await drawLink(win, AT_ONE_ASK)
      await win.getByTestId('track-button').click()
      await expect(win.getByTestId('pick-overlay')).toBeVisible({ timeout: 30_000 })
      await expect(win.getByTestId('pick-none')).toHaveText(
        'Моего игрока тут нет — остановить здесь'
      )
      await win.getByTestId('pick-none').click()
      await expect(win.getByTestId('tracking-state')).toHaveAttribute('data-phase', 'idle', {
        timeout: 60_000
      })
      await expect(toast(win)).toContainText(
        'Точка 2: игрок не найден — слежение остановлено на последнем надёжном кадре'
      )
      // Результат до остановки сохранён: авто-ключи есть, последний — до появления двойников (1.2 с).
      const keys = Number(await trackItem(win).getAttribute('data-auto-keys'))
      expect(keys).toBeGreaterThanOrEqual(2)
      await expect(win.getByTestId('track-band')).toHaveAttribute('data-count', String(keys))
      // После остановки точки стоят на месте последнего ключа: слежение дальше не считалось.
      await seekVideo(win, 2.0)
      const a = await pointsOf(win)
      await seekVideo(win, 3.0)
      expect(await pointsOf(win)).toEqual(a)
      // Ctrl+Z — одна запись.
      await win.keyboard.press('Control+z')
      await expect(trackItem(win)).toHaveAttribute('data-keys', '0')
    } finally {
      await app.close()
    }
  })

  test('вопрос на старте: точка 2 между двумя игроками — «Точка 2: кто из них ваш?», выбранный игрок, точка у его ног', async () => {
    const ctx = await openStub(AMBIGUOUS)
    const { app, win } = ctx
    try {
      await drawLink(win, AT_ONE_AMBIGUOUS, 1.8)
      await win.getByTestId('track-button').click()
      await expect(win.getByTestId('pick-overlay')).toBeVisible({ timeout: 30_000 })
      await expect(win.getByTestId('pick-text')).toHaveText(
        'Точка 2: кто из них ваш? Щёлкните по игроку.'
      )
      await expect(win.getByTestId('pick-point')).toHaveAttribute('data-point', '2')
      await expect(win.getByTestId('pick-box')).toHaveCount(2)
      await shot(win, 'ask-start')
      // Нижняя рамка (B: y 0.38–0.64); если слежение спросит снова (рядом стоят двойники), отвечаем так же.
      await pickLower(win)
      await settle(win)
      expect(Number(await trackItem(win).getAttribute('data-auto-keys'))).toBeGreaterThanOrEqual(2)
      await seekVideo(win, 2.5)
      const pts = await pointsOf(win)
      // Нижний двойник к 2.5 с: рамка y = 0.23 + 0.15 · 2.5 = 0.605 … 0.865.
      expect(Math.abs(pts[1].y - (0.605 + 0.26 - 0.07 * 0.26))).toBeLessThan(0.03)
      expect(Math.abs(pts[0].y - (0.28 - 0.07 * 0.26))).toBeLessThan(0.03)
    } finally {
      await app.close()
    }
  })

  test('две точки на одном игроке: понятное сообщение с номером точки, рисунок не меняется', async () => {
    const ctx = await openStub(THREE)
    const { app, win } = ctx
    try {
      await drawLink(win, [AT_ONE_THREE[0], [0.18, 0.28], AT_ONE_THREE[2]])
      const before = await pointsOf(win)
      await win.getByTestId('track-button').click()
      await expect(toast(win)).toContainText('Точка 2 стоит на одном игроке с другой точкой', {
        timeout: 30_000
      })
      await expect(win.getByTestId('pick-overlay')).toHaveCount(0)
      await expect(win.getByTestId('tracking-state')).toHaveAttribute('data-phase', 'idle')
      await expect(trackItem(win)).toHaveAttribute('data-keys', '0')
      expect(await pointsOf(win)).toEqual(before)
    } finally {
      await app.close()
    }
  })

  test('под точкой нет игрока: сообщение с номером точки, ничего не меняется', async () => {
    const ctx = await openStub(THREE)
    const { app, win } = ctx
    try {
      await drawLink(win, [AT_ONE_THREE[0], [0.9, 0.5], AT_ONE_THREE[2]])
      await win.getByTestId('track-button').click()
      await expect(toast(win)).toContainText('Точка 2: не вижу игрока под точкой', {
        timeout: 30_000
      })
      await expect(trackItem(win)).toHaveAttribute('data-keys', '0')
    } finally {
      await app.close()
    }
  })

  test('потеря точки 2 (закрыт): вся связка остановлена на последнем надёжном кадре, сообщение с номером точки и причиной', async () => {
    const ctx = await launch({
      env: { ...STUB, FLOW_DETECTOR_STUB_PATTERN: THREE_LOST }
    })
    try {
      const { win } = ctx
      await createProject(ctx, { title: 'Связка', video: fixture('cfr25.mp4') })
      await seekVideo(win, 0.3)
      await drawLink(win, [
        [0.12, 0.3],
        [0.43, 0.62],
        [0.71, 0.94]
      ])
      await runTracking(win)
      await expect(toast(win)).toContainText('Точка 2: игрок потерян на')
      await expect(toast(win)).toContainText('закрыт другими игроками')
      await expect(toast(win)).toContainText('Вся связка остановлена')
      await shot(win, 'lost')
      const keys = Number(await trackItem(win).getAttribute('data-auto-keys'))
      expect(keys).toBeGreaterThanOrEqual(2)
      // Все три точки останавливаются на одном и том же кадре (последнем ключе): после него не двигаются.
      await seekVideo(win, 1.5)
      const a = await pointsOf(win)
      await seekVideo(win, 3.0)
      const b = await pointsOf(win)
      expect(b).toEqual(a)
    } finally {
      await ctx.app.close()
    }
  })

  test('отмена (кнопка и Esc): ничего не записано, Ctrl+Z пуст', async () => {
    const ctx = await openStub(THREE, { FLOW_DETECTOR_STUB_DELAY_MS: '120' })
    const { app, win } = ctx
    try {
      await drawLink(win, AT_ONE_THREE)
      const before = await pointsOf(win)
      for (const how of ['button', 'esc'] as const) {
        const runs = await runsOf(win)
        await win.getByTestId('track-button').click()
        await expect(win.getByTestId('tracking-progress')).toBeVisible()
        await expect(win.getByTestId('tracking-progress')).not.toHaveAttribute('data-done', '0', {
          timeout: 30_000
        })
        if (how === 'button') await win.getByTestId('tracking-cancel').click()
        else await win.keyboard.press('Escape')
        await waitRun(win, runs)
        await expect(trackItem(win)).toHaveAttribute('data-keys', '0')
        expect(await pointsOf(win)).toEqual(before)
      }
    } finally {
      await app.close()
    }
  })

  test('ручная правка точки — опора; «Продолжить слежение» идёт от последнего ключа и не трогает правку', async () => {
    const ctx = await openStub(ASK)
    const { app, win } = ctx
    try {
      await drawLink(win, AT_ONE_ASK)
      await win.getByTestId('track-button').click()
      await expect(win.getByTestId('pick-overlay')).toBeVisible({ timeout: 30_000 })
      // Нижнего двойника нет на кадре остановки: «Моего игрока тут нет» оставляет результат до 1.2 с.
      await win.getByTestId('pick-none').click()
      await expect(win.getByTestId('tracking-state')).toHaveAttribute('data-phase', 'idle', {
        timeout: 60_000
      })
      const auto = Number(await trackItem(win).getAttribute('data-auto-keys'))
      expect(auto).toBeGreaterThanOrEqual(2)
      await expect(win.getByTestId('track-button')).toHaveText('Продолжить слежение')
      await expect(win.getByTestId('track-button')).toHaveAttribute('data-mode', 'continue')

      // Тренер правит точку 2 на 2.0 с (перетаскивает на ноги нижнего двойника): ключ без auto — опора.
      await seekVideo(win, 2.02)
      const h = await handleCenter(win, 'v1')
      const to = await px(win, [0.4 + 0.02 * 2.02 + 0.03, 0.76 - 0.07 * 0.28])
      await dragPx(win, h, to)
      await expect(win.getByTestId('track-key')).toHaveCount(1)
      // На ручном ключе кнопка «Следить» стартует отсюда (не «продолжает»).
      await expect(win.getByTestId('track-button')).toHaveAttribute('data-mode', 'start')
      // Вне ключа — «Продолжить слежение» с последнего ключа.
      await seekVideo(win, 1.5)
      await expect(win.getByTestId('track-button')).toHaveAttribute('data-mode', 'continue')
      const runs = await runsOf(win)
      await win.getByTestId('track-button').click()
      // Последний ключ — правка тренера: слежение продолжается от неё, точка 2 стоит на ногах нижнего двойника — вопроса нет.
      await waitRun(win, runs)
      await expect(toast(win)).toContainText('Слежение готово')
      // Ручной ключ остался, авто-ключей стало больше, слежение дошло до конца отрезка (3.9 с) за своими игроками.
      await expect(win.getByTestId('track-key')).toHaveCount(1)
      expect(Number(await trackItem(win).getAttribute('data-auto-keys'))).toBeGreaterThan(auto)
      await seekVideo(win, 3.5)
      const end = await pointsOf(win)
      expect(Math.abs(end[1].y - (0.76 - 0.07 * 0.28))).toBeLessThan(0.03)
      expect(Math.abs(end[1].x - (0.4 + 0.02 * 3.5 + 0.03))).toBeLessThan(0.03)
      expect(Math.abs(end[0].x - (0.1 + 0.02 * 3.5 + 0.03))).toBeLessThan(0.03)
      expect(Math.abs(end[2].x - (0.7 - 0.02 * 3.5 + 0.03))).toBeLessThan(0.03)
    } finally {
      await app.close()
    }
  })
})

test.describe('связка на поле → экранная', () => {
  /** Заглушка: три игрока стоят ногами в точках поля (12, 16), (12, 24), (12, 33) на кадре pitch.mp4. */
  function pitchPattern(): string {
    const file = join(makeUserData(), 'stub-pitch-three.json')
    const players = [16, 24, 33].map((y, i) => {
      const foot = project(12, y)
      return {
        start: { x: foot.x - 0.006 - 0.01, y: foot.y - 0.04, w: 0.012, h: 0.04 },
        velocity: { x: 0.01, y: 0 },
        look: i
      }
    })
    writeFileSync(file, JSON.stringify({ players, cuts: [] }))
    return file
  }

  test('связка на поле: слежение делает её экранной с подсказкой, метры пропадают; Ctrl+Z возвращает связку на поле с метрами', async () => {
    test.setTimeout(150_000)
    const ctx = await launch({ env: { ...STUB, FLOW_DETECTOR_STUB_PATTERN: pitchPattern() } })
    const { app, win } = ctx
    try {
      await openPitch(ctx)
      await calibrate(win)
      await saveCalibration(win)
      await win.getByTestId('tool-link').click()
      for (const y of [16, 24, 33]) {
        const p = project(12, y)
        await clickAt(win, [p.x, p.y])
      }
      await win.keyboard.press('Enter')
      await win.keyboard.press('v')
      const plink = shapes(win, 'plink')
      await expect(plink).toHaveCount(1)
      await win.getByTestId('mode-range').click()
      await win.getByTestId('duration-input').fill('1.9')
      await expect(plink.getByTestId('segment-label')).toHaveCount(2)
      await seekVideo(win, 1)
      await expect(win.getByTestId('track-button')).toHaveText('Следить за игроками')
      await runTracking(win)
      await expect(toast(win)).toContainText(
        'Связка «на поле» стала экранной: её точки поедут за игроками, но метры больше не показываются.'
      )
      await expect(shapes(win, 'plink')).toHaveCount(0)
      const link = shapes(win, 'link')
      await expect(link).toHaveCount(1)
      await expect(link).toHaveAttribute('data-space', 'screen')
      await expect(link.getByTestId('segment-label')).toHaveCount(0)
      expect(Number(await trackItem(win).getAttribute('data-auto-keys'))).toBeGreaterThanOrEqual(2)
      await shot(win, 'pitch-to-screen')

      // Одно Ctrl+Z: связка на поле с метрами, без ключей.
      await win.keyboard.press('Control+z')
      await expect(shapes(win, 'link')).toHaveCount(0)
      await expect(shapes(win, 'plink')).toHaveCount(1)
      await expect(shapes(win, 'plink').getByTestId('segment-label')).toHaveCount(2)
      await expect(trackItem(win)).toHaveAttribute('data-keys', '0')
    } finally {
      await app.close()
    }
  })
})

const luma = ([r, g, b]: [number, number, number]): number => 0.299 * r + 0.587 * g + 0.114 * b

function windowLuma(frame: Buffer, w: number, h: number, [fx, fy]: Frac, r = 1): number {
  let sum = 0
  let n = 0
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      sum += luma(pixelAt(frame, w, Math.round(fx * w) + dx, Math.round(fy * h) + dy))
      n += 1
    }
  }
  return sum / n
}

test.describe('экспорт отслеженной связки', () => {
  test('клип начинается посреди отрезка: кольца у точек там же, где на экране (по пикселям)', async () => {
    const ctx = await openStub(THREE)
    const { app, win } = ctx
    try {
      const W = 640
      const H = 360
      await win.keyboard.press('k')
      // С 0.16.4 новые рисунки лежат под игроками; на этом видео газона нет — кладём поверх, чтобы пиксели не прятались.
      await win.getByTestId('under-toggle').click()
      await win.getByTestId('width-2').click()
      for (const p of AT_ONE_THREE) await clickAt(win, p)
      await win.keyboard.press('Enter')
      await win.keyboard.press('v')
      await win.getByTestId('duration-input').fill('2.9')
      await runTracking(win)
      expect(Number(await trackItem(win).getAttribute('data-auto-keys'))).toBeGreaterThanOrEqual(2)

      // Эпизод 2.0–3.5 с начинается посреди отрезка связки (1.0–3.9).
      await seekVideo(win, 2.0)
      await win.keyboard.press('i')
      await seekVideo(win, 3.5)
      await win.keyboard.press('o')
      await win.keyboard.press('Digit1')
      await win.keyboard.press('Escape')

      const out = join(makeUserData(), 'out')
      mkdirSync(out)
      await stubDialog(app, out)
      await win.getByTestId('export-open').click()
      await expect(win.getByTestId('export-drawings')).toBeChecked()
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toBeVisible({ timeout: 90_000 })
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done')
      const file = join(out, readdirSync(out)[0])

      const rx = (0.015 * H) / W
      for (const k of [1, 18, 34]) {
        const index = 50 + k
        // Точки на экране в момент кадра клипа.
        await seekVideo(win, (index + 0.5) / FPS)
        const pts = await pointsOf(win)
        const exported = frameRgb(file, k, W, H)
        const src = frameRgb(fixture('cfr25.mp4'), index, W, H)
        pts.forEach((p, i) => {
          const edge: Frac = [p.x - rx, p.y]
          const lit = windowLuma(exported, W, H, edge) - windowLuma(src, W, H, edge)
          console.log(
            `Экспорт связки: кадр клипа ${k}, точка ${i + 1}, кольцо светлее исходника на ${lit.toFixed(0)}`
          )
          expect(lit, `кадр ${k} точка ${i + 1}`).toBeGreaterThan(20)
          // Там, где точка была в начале отрезка (1.0 с), на этом кадре колец нет.
          const old = threeFoot(i, 1.0)
          const away: Frac = [old.x - rx, old.y]
          if (Math.hypot((old.x - p.x) * W, (old.y - p.y) * H) > 40) {
            expect(windowLuma(exported, W, H, away) - windowLuma(src, W, H, away)).toBeLessThan(12)
          }
        })
      }
    } finally {
      await app.close()
    }
  })
})
