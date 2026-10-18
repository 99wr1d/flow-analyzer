// Проекты: сохранение, открытие, недавние, перенос видео, ошибки, защита от потери данных, автосохранение, запуск с файлом.
// Каждый тест — в своей папке данных и своей папке проектов; настоящие данные пользователя не затрагиваются.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import {
  SHOTS,
  SUFFIX,
  closeWindow,
  crashApp,
  dragOnPicture,
  fixture,
  launch,
  makeUserData,
  saveDialogCalls,
  seekVideo,
  stubDialog,
  stubSaveDialog,
  videoState
} from './helpers'

type Ctx = { app: ElectronApplication; win: Page; userData: string }

const shot = (win: Page, name: string): Promise<Buffer> =>
  win.screenshot({ path: join(SHOTS, `${name}${SUFFIX}.png`) })

/** Новая пустая папка для проектов и видео (чистится вместе с папками данных). */
function makeWorkDir(): string {
  return makeUserData()
}

async function openFixture(ctx: Ctx, video = fixture('cfr25.mp4')): Promise<void> {
  await stubDialog(ctx.app, video)
  await ctx.win.getByTestId('open-video').click()
  await expect(ctx.win.getByTestId('play-toggle')).toBeEnabled()
  await expect(ctx.win.getByTestId('annotation-layer')).toBeVisible()
}

const shapes = (win: Page) => win.getByTestId('annotation')
const rows = (win: Page) => win.getByTestId('episode-row')
const dirtyMark = (win: Page) => win.getByTestId('project-dirty')
const unsaved = (win: Page) => win.getByTestId('unsaved-dialog')

async function draw(win: Page, key: string, from: [number, number], to: [number, number]) {
  await win.keyboard.press(key)
  await dragOnPicture(win, from, to)
  await win.keyboard.press('v')
}

async function tag(win: Page, tagId: string): Promise<void> {
  await win.locator(`[data-testid="tag-button"][data-tag-id="${tagId}"]`).click()
}

/** Рисунки и эпизоды в виде, удобном для сравнения «до» и «после». */
async function workState(win: Page) {
  const annotations = await shapes(win).evaluateAll((els) =>
    els.map((e) => ({
      type: e.getAttribute('data-type'),
      geo: e.getAttribute('data-geo'),
      color: e.getAttribute('data-color')
    }))
  )
  const episodes = await rows(win).evaluateAll((els) =>
    els.map((e) => ({
      tag: e.getAttribute('data-tag-id'),
      start: e.getAttribute('data-start'),
      end: e.getAttribute('data-end')
    }))
  )
  return { annotations, episodes }
}

/** Размечает видео: стрелка, круг и два эпизода. */
async function makeWork(win: Page): Promise<void> {
  await seekVideo(win, 1)
  await draw(win, 'a', [0.15, 0.2], [0.55, 0.45])
  await draw(win, 'c', [0.6, 0.5], [0.8, 0.8])
  await seekVideo(win, 3)
  await tag(win, 'attack')
  await seekVideo(win, 6)
  await tag(win, 'goal')
  await expect(shapes(win)).toHaveCount(0) // в 6 с рисунков уже нет, но они в списке
}

/** Содержимое файла проекта или копии работы (поля, которые проверяют тесты). */
interface SavedFile {
  format: string
  version: number
  appVersion: string
  projectPath: string | null
  video: { path: string; fileName: string; sizeBytes: number; relativePath: string | null }
  annotations: unknown[]
  episodes: unknown[]
  tags: unknown[]
  ui: { lastTime: number }
  project: { annotations: unknown[]; episodes: unknown[] }
}
const readJson = (path: string): SavedFile => JSON.parse(readFileSync(path, 'utf8'))

const title = (app: ElectronApplication): Promise<string> =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())

async function openMenu(win: Page): Promise<void> {
  await win.getByTestId('project-menu-button').click()
  await expect(win.getByTestId('project-menu')).toBeVisible()
}

async function openRecent(win: Page): Promise<void> {
  await openMenu(win)
  await win.getByTestId('menu-recent').click()
  await expect(win.getByTestId('recent-menu')).toBeVisible()
}

async function waitFor(check: () => boolean, ms = 8000): Promise<void> {
  await expect.poll(check, { timeout: ms }).toBe(true)
}

test.describe('проекты', () => {
  test('сохранение, перезапуск, открытие из недавних: всё возвращается', async () => {
    const work = makeWorkDir()
    const file = join(work, 'Финал.flowproj')
    const ctx = await launch()
    let { app, win } = ctx
    const userData = ctx.userData
    try {
      // Без видео сохранять нечего: пункты неактивны, меню показывает пустой список недавних.
      await expect(win.getByTestId('project-name')).toHaveText('Новый проект')
      await expect(win).toHaveTitle('FlowAnalyzer')
      await openMenu(win)
      await expect(win.getByTestId('menu-save')).toBeDisabled()
      await expect(win.getByTestId('menu-save-as')).toBeDisabled()
      await expect(win.getByTestId('menu-new')).toBeDisabled()
      await expect(win.getByTestId('menu-open')).toBeEnabled()
      await win.getByTestId('menu-recent').click()
      await expect(win.getByTestId('recent-none')).toBeDisabled()
      await expect(win.getByTestId('recent-none')).toHaveText('Нет недавних')
      await shot(win, 'project-menu-empty')
      await win.keyboard.press('Escape')
      await expect(win.getByTestId('recent-menu')).toHaveCount(0)
      await win.keyboard.press('Escape')
      await expect(win.getByTestId('project-menu')).toHaveCount(0)

      await openFixture(ctx)
      await expect(dirtyMark(win)).toHaveCount(0)
      await makeWork(win)
      await expect(dirtyMark(win)).toBeVisible()
      await expect.poll(() => title(app)).toBe('FlowAnalyzer — Новый проект*')
      await seekVideo(win, 4.2)
      await openMenu(win)
      await expect(win.getByTestId('menu-save')).toBeEnabled()
      await expect(win.getByTestId('menu-save')).toContainText('Ctrl+S')
      await expect(win.getByTestId('menu-save-as')).toContainText('Ctrl+Shift+S')
      await expect(win.getByTestId('menu-open')).toContainText('Ctrl+Shift+O')
      await expect(win.getByTestId('menu-new')).toContainText('Ctrl+N')
      await shot(win, 'project-menu')
      await win.keyboard.press('Escape')

      const before = await workState(win)
      expect(before.annotations).toHaveLength(0) // в 4.2 с рисунки (1–4 с) уже скрыты
      await seekVideo(win, 2)
      const visible = await workState(win)
      expect(visible.annotations).toHaveLength(2)
      expect(visible.episodes).toHaveLength(2)
      await seekVideo(win, 4.2)

      // Ctrl+S: диалога нет, пока путь не известен; он появляется один раз.
      await stubSaveDialog(app, file)
      await win.keyboard.press('Control+s')
      await expect(dirtyMark(win)).toHaveCount(0)
      await expect(win.getByTestId('toast')).toHaveText('Проект «Финал» сохранён')
      expect(await saveDialogCalls(app)).toBe(1)
      expect(existsSync(file)).toBe(true)
      await expect(win.getByTestId('project-name')).toHaveText('Финал')
      await expect.poll(() => title(app)).toBe('FlowAnalyzer — Финал')

      const saved = readJson(file)
      expect(saved.format).toBe('flowanalyzer-project')
      expect(saved.version).toBe(1)
      expect(saved.appVersion).toBe('0.8.0')
      expect(saved.video.path).toBe(fixture('cfr25.mp4'))
      expect(saved.video.fileName).toBe('cfr25.mp4')
      expect(saved.video.sizeBytes).toBeGreaterThan(0)
      expect(typeof saved.video.relativePath).toBe('string')
      expect(saved.annotations).toHaveLength(2)
      expect(saved.episodes).toHaveLength(2)
      expect(saved.tags.length).toBeGreaterThanOrEqual(9)
      expect(saved.ui.lastTime).toBeGreaterThan(3.8)
      expect(saved.ui.lastTime).toBeLessThan(4.5)
      expect(readdirSync(work).filter((n) => n.endsWith('.flowtmp'))).toEqual([])

      // Повторное Ctrl+S после правки перезаписывает файл без диалога.
      await seekVideo(win, 2)
      await draw(win, 'l', [0.1, 0.8], [0.4, 0.9])
      await expect(dirtyMark(win)).toBeVisible()
      await expect.poll(() => title(app)).toBe('FlowAnalyzer — Финал*')
      await win.keyboard.press('Control+s')
      await expect(dirtyMark(win)).toHaveCount(0)
      expect(await saveDialogCalls(app)).toBe(1)
      expect(readJson(file).annotations).toHaveLength(3)

      // Перемотка проект не «пачкает».
      await seekVideo(win, 5)
      await win.keyboard.press('ArrowRight')
      await expect(dirtyMark(win)).toHaveCount(0)

      // Вернём 2 рисунка для сравнения после перезапуска: удаляем линию (отмена).
      await win.keyboard.press('Control+z')
      await expect(dirtyMark(win)).toBeVisible()
      await seekVideo(win, 4.2)
      const savedTime = (await videoState(win))!.currentTime
      await win.keyboard.press('Control+s')
      await expect(dirtyMark(win)).toHaveCount(0)
      expect(readJson(file).annotations).toHaveLength(2)
      expect(Math.abs(readJson(file).ui.lastTime - savedTime)).toBeLessThan(0.05)
      await seekVideo(win, 2)
      const expected = await workState(win)
      await app.close()

      // Перезапуск: проект в списке недавних, открывается одним щелчком.
      const second = await launch({ userData })
      app = second.app
      win = second.win
      await openRecent(win)
      await expect(win.getByTestId('recent-item')).toHaveCount(1)
      await expect(win.getByTestId('recent-item')).toContainText('Финал')
      await shot(win, 'project-recent')
      await win.getByTestId('recent-item').click()
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await expect(win.getByTestId('project-name')).toHaveText('Финал')
      await expect(dirtyMark(win)).toHaveCount(0)
      await expect
        .poll(async () => Math.abs(((await videoState(win))?.currentTime ?? 0) - savedTime))
        .toBeLessThan(0.05)
      await expect(win.getByTestId('episode-count')).toHaveText('2')
      await seekVideo(win, 2)
      await expect.poll(() => workState(win)).toEqual(expected)
      await shot(win, 'project-restored')
      await expect.poll(() => title(app)).toBe('FlowAnalyzer — Финал')
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('Сохранить как и Открыть проект через диалог', async () => {
    const work = makeWorkDir()
    const first = join(work, 'one.flowproj')
    const second = join(work, 'two')
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openFixture(ctx)
      await seekVideo(win, 1)
      await draw(win, 'a', [0.2, 0.2], [0.5, 0.5])
      await stubSaveDialog(app, first)
      await win.keyboard.press('Control+s')
      await expect(dirtyMark(win)).toHaveCount(0)

      // «Сохранить как» всегда спрашивает файл; расширение добавляется само.
      await stubSaveDialog(app, second)
      await win.keyboard.press('Control+Shift+S')
      await expect(win.getByTestId('project-name')).toHaveText('two')
      expect(await saveDialogCalls(app)).toBe(1)
      expect(existsSync(`${second}.flowproj`)).toBe(true)
      expect(existsSync(second)).toBe(false)

      // Через меню.
      await stubSaveDialog(app, join(work, 'three.flowproj'))
      await openMenu(win)
      await win.getByTestId('menu-save-as').click()
      await expect(win.getByTestId('project-name')).toHaveText('three')

      // Открыть проект (Ctrl+Shift+O) — файл выбирается в диалоге.
      await stubDialog(app, first)
      await win.keyboard.press('Control+Shift+O')
      await expect(win.getByTestId('project-name')).toHaveText('one')
      await expect(shapes(win)).toHaveCount(1)
    } finally {
      await app.close()
    }
  })

  test('видео перенесли: вместе с проектом находится само, отдельно — через «Указать видео»', async () => {
    const work = makeWorkDir()
    mkdirSync(join(work, 'videos'))
    mkdirSync(join(work, 'projects'))
    const video = join(work, 'videos', 'match.mp4')
    copyFileSync(fixture('cfr25.mp4'), video)
    const file = join(work, 'projects', 'game.flowproj')

    const ctx = await launch()
    let { app, win } = ctx
    const userData = ctx.userData
    try {
      await openFixture(ctx, video)
      await seekVideo(win, 1)
      await draw(win, 'a', [0.2, 0.2], [0.5, 0.5])
      await stubSaveDialog(app, file)
      await win.keyboard.press('Control+s')
      await expect(dirtyMark(win)).toHaveCount(0)
      await app.close()

      // 1) Папку с видео и проектом перенесли целиком: относительный путь работает без вопросов.
      const moved = join(work, 'moved')
      mkdirSync(join(moved, 'projects'), { recursive: true })
      mkdirSync(join(moved, 'videos'), { recursive: true })
      renameSync(video, join(moved, 'videos', 'match.mp4'))
      const movedFile = join(moved, 'projects', 'game.flowproj')
      renameSync(file, movedFile)
      let next = await launch({ userData })
      app = next.app
      win = next.win
      await stubDialog(app, movedFile)
      await win.keyboard.press('Control+Shift+O')
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await expect(win.getByTestId('relink-dialog')).toHaveCount(0)
      await expect(win.getByTestId('project-name')).toHaveText('game')
      await expect(dirtyMark(win)).toHaveCount(0)
      await app.close()

      // 2) Видео переехало отдельно: приложение просит указать его.
      const elsewhere = join(work, 'elsewhere')
      mkdirSync(elsewhere)
      const newVideo = join(elsewhere, 'renamed.mp4')
      renameSync(join(moved, 'videos', 'match.mp4'), newVideo)
      next = await launch({ userData })
      app = next.app
      win = next.win
      await stubDialog(app, movedFile)
      await win.keyboard.press('Control+Shift+O')
      const dialog = win.getByTestId('relink-dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog).toContainText('match.mp4')
      await shot(win, 'project-relink')

      // «Отмена»: ничего не загружено.
      await win.getByTestId('relink-cancel').click()
      await expect(dialog).toHaveCount(0)
      await expect(win.getByTestId('file-name')).toHaveCount(0)
      await expect(win.getByTestId('play-toggle')).toBeDisabled()

      // Снова, теперь с указанием видео.
      await win.keyboard.press('Control+Shift+O')
      await expect(dialog).toBeVisible()
      await stubDialog(app, newVideo)
      await win.getByTestId('relink-pick').click()
      await expect(dialog).toHaveCount(0)
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await expect(win.getByTestId('file-name')).toHaveText('renamed.mp4')
      await expect(shapes(win)).toHaveCount(1)
      // Новый путь к видео нигде не записан — предлагаем сохранить.
      await expect(dirtyMark(win)).toBeVisible()
      await win.keyboard.press('Control+s')
      await expect(dirtyMark(win)).toHaveCount(0)
      expect(readJson(movedFile).video.path).toBe(newVideo)
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('другое видео вместо исходного: открывается с предупреждением', async () => {
    const work = makeWorkDir()
    const video = join(work, 'v.mp4')
    copyFileSync(fixture('cfr25.mp4'), video)
    const file = join(work, 'p.flowproj')
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openFixture(ctx, video)
      await seekVideo(win, 1)
      await draw(win, 'a', [0.2, 0.2], [0.5, 0.5])
      await expect(dirtyMark(win)).toBeVisible()
      await stubSaveDialog(app, file)
      await win.keyboard.press('Control+s')
      await expect(dirtyMark(win)).toHaveCount(0)
      await expect(win.getByTestId('project-name')).toHaveText('p')
      await win.keyboard.press('Control+n')
      await expect(win.getByTestId('play-toggle')).toBeDisabled()
      // В проекте записан другой размер видео — как будто файл заменили на другой с тем же именем.
      const saved = readJson(file)
      saved.video.sizeBytes += 1000
      writeFileSync(file, JSON.stringify(saved), 'utf8')
      await stubDialog(app, file)
      await win.keyboard.press('Control+Shift+O')
      await expect(win.getByTestId('project-warning')).toContainText('Размер видеофайла отличается')
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await expect(shapes(win)).toHaveCount(1)
    } finally {
      await app.close()
    }
  })

  test('повреждённые файлы: понятная ошибка, текущая работа не меняется', async () => {
    const work = makeWorkDir()
    const file = join(work, 'good.flowproj')
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openFixture(ctx)
      await seekVideo(win, 1)
      await draw(win, 'a', [0.2, 0.2], [0.5, 0.5])
      await stubSaveDialog(app, file)
      await win.keyboard.press('Control+s')
      await expect(dirtyMark(win)).toHaveCount(0)
      const before = await workState(win)

      const open = async (path: string): Promise<void> => {
        await stubDialog(app, path)
        await win.keyboard.press('Control+Shift+O')
        await expect(win.getByTestId('project-error')).toBeVisible()
      }
      const state = async (): Promise<void> => {
        expect(await workState(win)).toEqual(before)
        await expect(win.getByTestId('project-name')).toHaveText('good')
        await expect(win.getByTestId('file-name')).toHaveText('cfr25.mp4')
        await expect(dirtyMark(win)).toHaveCount(0)
      }

      const garbage = join(work, 'garbage.flowproj')
      writeFileSync(garbage, '{ "format": "flowanalyzer-project", ', 'utf8')
      await open(garbage)
      await expect(win.getByTestId('project-error-message')).toHaveText(
        'Файл проекта повреждён: это не JSON'
      )
      await expect(win.locator('.banner__details')).not.toHaveAttribute('open', '')
      await win.locator('.banner__details summary').click()
      await expect(win.getByTestId('project-error-details')).toBeVisible()
      await shot(win, 'project-error')
      await state()

      const wrong = join(work, 'wrong.flowproj')
      const good = readJson(file)
      writeFileSync(wrong, JSON.stringify({ ...good, annotations: [{ type: 'arrow' }] }), 'utf8')
      await open(wrong)
      await expect(win.getByTestId('project-error-message')).toContainText('неверные данные')
      await state()

      const newer = join(work, 'newer.flowproj')
      writeFileSync(newer, JSON.stringify({ ...good, version: 7 }), 'utf8')
      await open(newer)
      await expect(win.getByTestId('project-error-message')).toHaveText(
        'Файл создан более новой версией FlowAnalyzer'
      )
      await state()

      const foreign = join(work, 'foreign.flowproj')
      writeFileSync(foreign, JSON.stringify({ hello: 'world' }), 'utf8')
      await open(foreign)
      await expect(win.getByTestId('project-error-message')).toHaveText(
        'Это не файл проекта FlowAnalyzer'
      )
      await state()

      const big = join(work, 'big.flowproj')
      writeFileSync(big, Buffer.alloc(21 * 1024 * 1024, 0x20))
      await open(big)
      await expect(win.getByTestId('project-error-message')).toHaveText(
        'Файл проекта слишком большой'
      )
      await state()

      // Баннер закрывается, и приложение работает дальше.
      await win.getByRole('button', { name: 'Закрыть сообщение' }).click()
      await expect(win.getByTestId('project-error')).toHaveCount(0)
    } finally {
      await app.close()
    }
  })

  test('Ctrl+N и открытие видео при несохранённом: вопрос с тремя ответами', async () => {
    const work = makeWorkDir()
    const file = join(work, 'a.flowproj')
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openFixture(ctx)
      await seekVideo(win, 1)
      await draw(win, 'a', [0.2, 0.2], [0.5, 0.5])
      await expect(dirtyMark(win)).toBeVisible()

      // Esc и «Отмена» оставляют всё как есть.
      await win.keyboard.press('Control+n')
      await expect(unsaved(win)).toBeVisible()
      await expect(unsaved(win)).toContainText('Сохранить изменения в проекте «Новый проект»?')
      await shot(win, 'project-save-prompt')
      await win.keyboard.press('Escape')
      await expect(unsaved(win)).toHaveCount(0)
      await win.keyboard.press('Control+n')
      await win.getByTestId('unsaved-cancel').click()
      await expect(unsaved(win)).toHaveCount(0)
      await expect(shapes(win)).toHaveCount(1)
      await expect(dirtyMark(win)).toBeVisible()
      await expect(win.getByTestId('file-name')).toHaveText('cfr25.mp4')

      // Пока вопрос открыт, клавиши команд молчат.
      await win.keyboard.press('Control+n')
      await expect(unsaved(win)).toBeVisible()
      await win.keyboard.press('Control+z')
      await win.keyboard.press('Control+n')
      await expect(shapes(win)).toHaveCount(1)
      await win.getByTestId('unsaved-cancel').click()

      // Открыть другое видео при несохранённом — тот же вопрос; «Отмена» — диалог выбора файла не появляется.
      await stubDialog(app, fixture('sample.mp4'))
      await win.keyboard.press('Control+o')
      await expect(unsaved(win)).toBeVisible()
      await win.getByTestId('unsaved-cancel').click()
      await expect(win.getByTestId('file-name')).toHaveText('cfr25.mp4')

      // «Не сохранять» — новый чистый проект.
      await win.keyboard.press('Control+n')
      await win.getByTestId('unsaved-discard').click()
      await expect(unsaved(win)).toHaveCount(0)
      await expect(win.getByTestId('play-toggle')).toBeDisabled()
      await expect(win.getByTestId('file-name')).toHaveCount(0)
      await expect(shapes(win)).toHaveCount(0)
      await expect(rows(win)).toHaveCount(0)
      await expect(dirtyMark(win)).toHaveCount(0)
      await expect(win.getByTestId('project-name')).toHaveText('Новый проект')
      await expect.poll(() => title(app)).toBe('FlowAnalyzer')

      // «Сохранить» — записывает и затем очищает.
      await openFixture(ctx)
      await seekVideo(win, 1)
      await draw(win, 'c', [0.2, 0.2], [0.5, 0.5])
      await stubSaveDialog(app, file)
      await win.keyboard.press('Control+n')
      await win.getByTestId('unsaved-save').click()
      await expect(unsaved(win)).toHaveCount(0)
      await expect(win.getByTestId('play-toggle')).toBeDisabled()
      expect(readJson(file).annotations).toHaveLength(1)

      // Если в диалоге сохранения пользователь передумал — ничего не очищается.
      await openFixture(ctx)
      await seekVideo(win, 1)
      await draw(win, 'c', [0.2, 0.2], [0.5, 0.5])
      await app.evaluate(({ dialog }) => {
        dialog.showSaveDialog = async () => ({ canceled: true, filePath: '' })
      })
      await win.keyboard.press('Control+n')
      await win.getByTestId('unsaved-save').click()
      await expect(unsaved(win)).toHaveCount(0)
      await expect(shapes(win)).toHaveCount(1)
      await expect(dirtyMark(win)).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('закрытие окна при несохранённом: вопрос; Отмена, Не сохранять, Сохранить', async () => {
    const work = makeWorkDir()
    const file = join(work, 'close.flowproj')
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openFixture(ctx)
      await seekVideo(win, 1)
      await draw(win, 'a', [0.2, 0.2], [0.5, 0.5])
      await closeWindow(app)
      await expect(unsaved(win)).toBeVisible()
      await shot(win, 'project-close-prompt')
      // Повторная попытка закрыть, пока вопрос открыт, ничего не ломает.
      await closeWindow(app)
      await win.getByTestId('unsaved-cancel').click()
      await expect(unsaved(win)).toHaveCount(0)
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(
        1
      )
      await expect(shapes(win)).toHaveCount(1)

      // После отмены окно снова можно закрыть.
      await closeWindow(app)
      await expect(unsaved(win)).toBeVisible()
      await stubSaveDialog(app, file)
      const closed = app.waitForEvent('close')
      await win.getByTestId('unsaved-save').click()
      await closed
      expect(existsSync(file)).toBe(true)
      expect(readJson(file).annotations).toHaveLength(1)
    } finally {
      await app.close().catch(() => undefined)
    }

    // «Не сохранять»: окно закрывается, файла нет.
    const other = await launch()
    try {
      await openFixture(other)
      await seekVideo(other.win, 1)
      await draw(other.win, 'a', [0.2, 0.2], [0.5, 0.5])
      await closeWindow(other.app)
      const closed = other.app.waitForEvent('close')
      await other.win.getByTestId('unsaved-discard').click()
      await closed
    } finally {
      await other.app.close().catch(() => undefined)
    }

    // Нет изменений — закрывается сразу, без вопросов.
    const clean = await launch()
    try {
      await openFixture(clean)
      const closed = clean.app.waitForEvent('close')
      await closeWindow(clean.app)
      await closed
    } finally {
      await clean.app.close().catch(() => undefined)
    }
  })

  test('окно закрывается, даже если интерфейс завис', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await openFixture(ctx)
      await seekVideo(win, 1)
      await draw(win, 'a', [0.2, 0.2], [0.5, 0.5])
      // Интерфейс уходит в бесконечный цикл и не отвечает на запрос main.
      void win.evaluate(() => {
        setTimeout(() => {
          for (;;) {
            /* завис */
          }
        }, 0)
      })
      await win.waitForTimeout(300)
      const closed = app.waitForEvent('close')
      await closeWindow(app)
      await closed
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('автосохранение: копия работы появляется, после «сбоя» предлагается восстановить', async () => {
    const work = makeWorkDir()
    const file = join(work, 'auto.flowproj')
    const env = { FLOW_AUTOSAVE_MS: '500' }
    const ctx = await launch({ env })
    let { app, win } = ctx
    const userData = ctx.userData
    const recoveryDir = join(userData, 'recovery')
    const recoveryFiles = (): string[] =>
      existsSync(recoveryDir)
        ? readdirSync(recoveryDir).filter((n) => n.endsWith('.flowproj.recovery'))
        : []
    try {
      await openFixture(ctx)
      // Пока ничего не менялось — копий нет.
      await win.waitForTimeout(1500)
      expect(recoveryFiles()).toEqual([])

      await makeWork(win)
      await seekVideo(win, 2)
      const expected = await workState(win)
      // Копия обновляется по мере работы: ждём ту, где уже есть оба эпизода.
      const readCopy = (): SavedFile | null => {
        try {
          return readJson(join(recoveryDir, recoveryFiles()[0]))
        } catch {
          return null
        }
      }
      await waitFor(() => readCopy()?.project.episodes.length === 2)
      const copy = readCopy()!
      expect(copy.format).toBe('flowanalyzer-recovery')
      expect(copy.projectPath).toBeNull()
      expect(copy.project.annotations).toHaveLength(2)
      expect(copy.project.episodes).toHaveLength(2)

      // «Сбой»: процесс убит без закрытия окна.
      await crashApp(app)

      const next = await launch({ userData, env })
      app = next.app
      win = next.win
      const banner = win.getByTestId('recovery-banner')
      await expect(banner).toBeVisible()
      await expect(banner).toContainText('Найдена несохранённая работа от')
      await shot(win, 'project-recovery-banner')
      await expect(win.getByTestId('play-toggle')).toBeDisabled() // само ничего не загружается

      await win.getByTestId('recovery-restore').click()
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await expect(banner).toHaveCount(0)
      await expect(dirtyMark(win)).toBeVisible()
      await expect(win.getByTestId('episode-count')).toHaveText('2')
      await seekVideo(win, 2)
      expect(await workState(win)).toEqual(expected)
      expect(recoveryFiles()).toHaveLength(1) // копия остаётся, пока работа не сохранена

      // Сохранение убирает копию.
      await stubSaveDialog(app, file)
      await win.keyboard.press('Control+s')
      await expect(dirtyMark(win)).toHaveCount(0)
      await waitFor(() => recoveryFiles().length === 0)
      expect(readJson(file).annotations).toHaveLength(2)
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('копию работы можно удалить; «Не сохранять» при закрытии её тоже удаляет', async () => {
    const env = { FLOW_AUTOSAVE_MS: '500' }
    const ctx = await launch({ env })
    let { app, win } = ctx
    const userData = ctx.userData
    const recoveryDir = join(userData, 'recovery')
    const recoveryFiles = (): string[] =>
      existsSync(recoveryDir) ? readdirSync(recoveryDir).filter((n) => n.endsWith('.recovery')) : []
    try {
      await openFixture(ctx)
      await seekVideo(win, 1)
      await draw(win, 'a', [0.2, 0.2], [0.5, 0.5])
      await waitFor(() => recoveryFiles().length === 1)

      await crashApp(app)

      const next = await launch({ userData, env })
      app = next.app
      win = next.win
      await expect(win.getByTestId('recovery-banner')).toBeVisible()
      await win.getByTestId('recovery-discard').click()
      await expect(win.getByTestId('recovery-banner')).toHaveCount(0)
      await waitFor(() => recoveryFiles().length === 0)

      // Новая работа → копия → закрытие с «Не сохранять» → копии нет.
      await openFixture(next)
      await seekVideo(win, 1)
      await draw(win, 'a', [0.2, 0.2], [0.5, 0.5])
      await waitFor(() => recoveryFiles().length === 1)
      await closeWindow(app)
      const closed = app.waitForEvent('close')
      await win.getByTestId('unsaved-discard').click()
      await closed
      expect(recoveryFiles()).toEqual([])
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('в настройках есть команды проекта; клавиши можно переназначить', async () => {
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await win.getByTestId('open-settings').click()
      await win.getByTestId('settings-tab-keys').click()
      const value = (id: string) =>
        win.locator(
          `[data-testid="hotkey-field"][data-command="${id}"] [data-testid="hotkey-value"]`
        )
      await expect(win.locator('.keys-group__title', { hasText: 'Проект' })).toBeVisible()
      await expect(value('project:save')).toHaveText('Ctrl+S')
      await expect(value('project:save-as')).toHaveText('Ctrl+Shift+S')
      await expect(value('project:open')).toHaveText('Ctrl+Shift+O')
      await expect(value('project:new')).toHaveText('Ctrl+N')
      await expect(
        win.locator('[data-testid="keys-row"][data-command="project:new"] .keys-row__label')
      ).toHaveText('Новый проект')
      await shot(win, 'project-settings-keys')

      // Переназначаем «Сохранить» на Ctrl+Alt+K.
      await win.locator('[data-testid="hotkey-edit"][data-command="project:save"]').click()
      await win.keyboard.press('Control+Alt+KeyK')
      await expect(value('project:save')).toHaveText('Ctrl+Alt+K')
      await win.getByTestId('settings-save').click()
      await expect(win.getByTestId('settings-dialog')).toHaveCount(0)

      const work = makeWorkDir()
      const file = join(work, 'rebound.flowproj')
      await openFixture(ctx)
      await seekVideo(win, 1)
      await draw(win, 'a', [0.2, 0.2], [0.5, 0.5])
      await stubSaveDialog(app, file)
      await win.keyboard.press('Control+s') // прежнее сочетание больше не работает
      await win.waitForTimeout(300)
      expect(existsSync(file)).toBe(false)
      await win.keyboard.press('Control+Alt+KeyK')
      await expect(dirtyMark(win)).toHaveCount(0)
      expect(existsSync(file)).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('проект из командной строки открывается при запуске; второй экземпляр передаёт файл первому', async () => {
    const work = makeWorkDir()
    const fileA = join(work, 'A.flowproj')
    const fileB = join(work, 'B.flowproj')

    // Готовим два проекта: A с одним рисунком, B с двумя.
    const prep = await launch()
    try {
      await openFixture(prep)
      await seekVideo(prep.win, 1)
      await draw(prep.win, 'a', [0.2, 0.2], [0.5, 0.5])
      await stubSaveDialog(prep.app, fileA)
      await prep.win.keyboard.press('Control+s')
      await expect(dirtyMark(prep.win)).toHaveCount(0)
      await draw(prep.win, 'c', [0.5, 0.5], [0.7, 0.7])
      await stubSaveDialog(prep.app, fileB)
      await prep.win.keyboard.press('Control+Shift+S')
      await expect(prep.win.getByTestId('project-name')).toHaveText('B')
    } finally {
      await prep.app.close()
    }

    // Мусор в аргументах (нет файла, не тот тип) игнорируется.
    const plain = await launch({ args: [join(work, 'нет.flowproj'), join(work, 'x.txt')] })
    try {
      await expect(plain.win.getByTestId('play-toggle')).toBeDisabled()
      await expect(plain.win.getByTestId('project-name')).toHaveText('Новый проект')
    } finally {
      await plain.app.close()
    }

    // Запуск с файлом.
    const ctx = await launch({ args: [fileA] })
    const { app, win } = ctx
    try {
      await expect(win.getByTestId('project-name')).toHaveText('A')
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await expect(shapes(win)).toHaveCount(1)
      await expect.poll(() => title(app)).toBe('FlowAnalyzer — A')

      // Второй запуск с другим файлом: новый процесс завершается, первое окно открывает B.
      await expect(launch({ userData: ctx.userData, args: [fileB] })).rejects.toThrow()
      await expect(win.getByTestId('project-name')).toHaveText('B', { timeout: 10_000 })
      await seekVideo(win, 1.5)
      await expect(shapes(win)).toHaveCount(2)
      expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(
        1
      )
    } finally {
      await app.close().catch(() => undefined)
    }
  })
})
