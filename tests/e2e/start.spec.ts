// Стартовый экран: библиотека проектов, «Новый проект», карточки, свойства, восстановление.
// Каждый тест — в своих папках данных и проектов (FLOW_USER_DATA, FLOW_LIBRARY_DIR); настоящие данные не затрагиваются.
import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import {
  SHOTS,
  SUFFIX,
  closeWindow,
  crashApp,
  fixture,
  launch,
  makeUserData,
  saveDialogCalls,
  seekVideo,
  stubDialog,
  stubSaveDialog
} from './helpers'
import {
  cardByTitle,
  cards,
  createProject,
  quickOpen,
  seedLibrary,
  seedProject
} from './startHelpers'

// Небольшая пауза: переходы цвета у кнопок должны закончиться, иначе на снимке они «наполовину».
const shot = async (win: Page, name: string): Promise<Buffer> => {
  await win.waitForTimeout(300)
  return win.screenshot({ path: join(SHOTS, `${name}${SUFFIX}.png`) })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (path: string): any => JSON.parse(readFileSync(path, 'utf8'))
const start = (win: Page) => win.getByTestId('start-screen')
const rows = (win: Page) => win.getByTestId('episode-row')

async function stubReveal(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { __revealed: string[] }
    g.__revealed = []
    shell.showItemInFolder = (p: string) => {
      g.__revealed.push(p)
    }
  })
}
const revealed = (app: ElectronApplication): Promise<string[]> =>
  app.evaluate(() => (globalThis as unknown as { __revealed?: string[] }).__revealed ?? [])

/** Папки данных и проектов, подготовленные до запуска (чтобы положить туда файлы). */
function prepare(): { userData: string; projectsDir: string } {
  const userData = makeUserData()
  const projectsDir = join(userData, 'Projects')
  mkdirSync(projectsDir, { recursive: true })
  return { userData, projectsDir }
}

async function windowTitle(app: ElectronApplication): Promise<string> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle())
}

test.describe('стартовый экран', () => {
  test('запуск без проектов: пустое состояние, кнопки, папка проектов; рабочей области нет', async () => {
    const { app, win, projectsDir } = await launch()
    try {
      await expect(start(win)).toBeVisible()
      await expect(win.locator('.app')).toHaveAttribute('data-view', 'start')
      await expect(win.getByTestId('lib-empty')).toBeVisible()
      await expect(win.getByText('Здесь будут ваши проекты')).toBeVisible()
      await expect(win.getByTestId('lib-empty-new')).toBeVisible()
      await expect(win.getByTestId('start-new')).toBeVisible()
      await expect(win.getByTestId('start-open-file')).toBeVisible()
      await expect(win.getByTestId('open-video')).toHaveText('Просто открыть видео')
      await expect(win.getByTestId('open-settings')).toBeVisible()
      await expect(win.getByTestId('start-folder')).toContainText(projectsDir)
      // Панели поиска нет, пока проектов нет; рабочая область не отрисована.
      await expect(win.getByTestId('lib-search')).toHaveCount(0)
      await expect(win.getByTestId('project-menu-button')).toHaveCount(0)
      await expect(win.getByTestId('play-toggle')).toHaveCount(0)
      expect(await windowTitle(app)).toBe('FlowAnalyzer')
      await shot(win, 'start-empty')
    } finally {
      await app.close()
    }
  })

  test('«Новый проект»: проверка полей, название из имени видео, Esc закрывает', async () => {
    const { app, win } = await launch()
    try {
      await win.getByTestId('start-new').click()
      const dialog = win.getByTestId('new-project-dialog')
      await expect(dialog).toBeVisible()
      await expect(win.getByTestId('np-title')).toBeFocused()
      // Дата по умолчанию — сегодня.
      const today = new Date()
      const pad = (n: number): string => String(n).padStart(2, '0')
      await expect(win.getByTestId('np-date')).toHaveValue(
        `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
      )
      await expect(win.getByTestId('np-type-match')).toHaveAttribute('aria-checked', 'true')

      // Без названия и видео создать нельзя — подсказки у полей.
      await win.getByTestId('np-create').click()
      await expect(win.getByTestId('np-title-error')).toHaveText('Введите название проекта')
      await win.getByTestId('np-title').fill('Матч без видео')
      await win.getByTestId('np-create').click()
      await expect(win.getByTestId('np-video-error')).toHaveText('Выберите видео')
      await expect(dialog).toBeVisible()

      // Пустое название заполняется именем видеофайла, своё не затирается.
      await win.getByTestId('np-title').fill('')
      await stubDialog(app, fixture('cfr25.mp4'))
      await win.getByTestId('np-video').click()
      await expect(win.getByTestId('np-video-name')).toHaveText('cfr25.mp4')
      await expect(win.getByTestId('np-title')).toHaveValue('cfr25')
      await shot(win, 'start-new-project-dialog')

      await win.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      await expect(start(win)).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('создание проекта: файл в папке проектов, название в верхней панели, Ctrl+S без диалога', async () => {
    const { app, win, projectsDir, userData } = await launch()
    try {
      await createProject(
        { app, win },
        { title: 'Матч 1', type: 'match', date: '2026-05-17', notes: 'Первый тур' }
      )
      const file = join(projectsDir, 'Матч 1.flowproj')
      expect(existsSync(file)).toBe(true)
      const created = readJson(file)
      expect(created.meta).toEqual({
        title: 'Матч 1',
        type: 'match',
        date: '2026-05-17',
        notes: 'Первый тур'
      })
      expect(created.episodes).toEqual([])
      await expect(win.getByTestId('file-name')).toHaveText('cfr25.mp4')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      expect(await windowTitle(app)).toBe('FlowAnalyzer — Матч 1')
      expect(readJson(join(userData, 'library.json')).items).toHaveLength(1)

      // Эпизод и Ctrl+S: проект уже привязан к файлу, диалога сохранения нет.
      await stubSaveDialog(app, join(userData, 'не-должен-появиться.flowproj'))
      await seekVideo(win, 2)
      await win.keyboard.press('Digit1')
      await expect(rows(win)).toHaveCount(1)
      await expect(win.getByTestId('project-dirty')).toBeVisible()
      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      expect(await saveDialogCalls(app)).toBe(0)
      const saved = readJson(file)
      expect(saved.episodes).toHaveLength(1)
      expect(saved.meta.title).toBe('Матч 1') // описание сохраняется вместе с работой
      expect(saved.video.duration).toBeGreaterThan(3)
      expect(existsSync(join(userData, 'не-должен-появиться.flowproj'))).toBe(false)

      // Второй проект с тем же названием получает свободное имя файла.
      await win.getByTestId('go-home').click()
      await expect(start(win)).toBeVisible()
      await createProject({ app, win }, { title: 'Матч 1', type: 'training' })
      expect(existsSync(join(projectsDir, 'Матч 1 (2).flowproj'))).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('главная: карточка с названием, типом, числом эпизодов и настоящим эскизом', async () => {
    const { app, win, projectsDir } = await launch()
    try {
      await createProject({ app, win }, { title: 'Финал кубка', type: 'match', date: '2026-05-17' })
      await seekVideo(win, 2)
      await win.keyboard.press('Digit1')
      await expect(rows(win)).toHaveCount(1)
      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)

      await win.getByTestId('go-home').click()
      await expect(start(win)).toBeVisible()
      const card = cardByTitle(win, 'Финал кубка')
      await expect(card).toHaveCount(1)
      await expect(card.getByTestId('card-title')).toHaveText('Финал кубка')
      await expect(card.getByTestId('card-type')).toHaveText('Матч')
      await expect(card.getByTestId('card-date')).toHaveText('17 мая 2026')
      await expect(card.getByTestId('card-stats')).toHaveText('1 эпизод · 0 рисунков')
      await expect(card.getByTestId('card-when')).toContainText('изменён')
      await expect(card).toContainText('cfr25.mp4')
      await expect(card).toHaveAttribute('data-path', join(projectsDir, 'Финал кубка.flowproj'))
      // Эскиз — настоящая картинка (кадр из видео), загруженная через blob-адрес.
      const thumb = card.getByTestId('card-thumb')
      await expect
        .poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBeGreaterThan(0)
      expect(await thumb.evaluate((img: HTMLImageElement) => img.src.startsWith('blob:'))).toBe(
        true
      )
      await shot(win, 'start-one-card')
    } finally {
      await app.close()
    }
  })

  test('вкладки по типам с числом проектов, поиск, сортировка', async () => {
    const { userData, projectsDir } = prepare()
    seedProject(join(projectsDir, 'a.flowproj'), {
      meta: { title: 'Динамо — Спартак', type: 'match', date: '2026-05-10' },
      updatedAt: '2026-05-10T10:00:00.000Z'
    })
    seedProject(join(projectsDir, 'b.flowproj'), {
      meta: { title: 'Зенит — Локомотив', type: 'match', date: '2026-05-12' },
      updatedAt: '2026-05-12T10:00:00.000Z'
    })
    seedProject(join(projectsDir, 'Тренировка среда.flowproj'), {
      meta: { title: 'Тренировка среда', type: 'training' },
      video: fixture('sample.mp4'),
      updatedAt: '2026-05-11T10:00:00.000Z'
    })
    seedProject(join(projectsDir, 'Кандидат.flowproj'), {
      meta: { title: 'Ёлкин: скаутинг', type: 'scouting', date: '2026-04-01' },
      updatedAt: '2026-04-02T10:00:00.000Z'
    })
    // Старый файл без описания: название — имя файла, тип «Другое».
    seedProject(join(projectsDir, 'Старый проект.flowproj'), {
      updatedAt: '2026-01-01T10:00:00.000Z'
    })
    const { app, win } = await launch({ userData })
    try {
      await expect(cards(win)).toHaveCount(5)
      const titles = () => win.getByTestId('card-title').allTextContents()
      // По умолчанию: сначала недавно изменённые.
      expect(await titles()).toEqual([
        'Зенит — Локомотив',
        'Тренировка среда',
        'Динамо — Спартак',
        'Ёлкин: скаутинг',
        'Старый проект'
      ])
      await expect(win.getByTestId('lib-tab-all-count')).toHaveText('5')
      await expect(win.getByTestId('lib-tab-match-count')).toHaveText('2')
      await expect(win.getByTestId('lib-tab-training-count')).toHaveText('1')
      await expect(win.getByTestId('lib-tab-scouting-count')).toHaveText('1')
      await expect(win.getByTestId('lib-tab-other-count')).toHaveText('1')
      await expect(cardByTitle(win, 'Старый проект').getByTestId('card-type')).toHaveText('Другое')

      await win.getByTestId('lib-tab-match').click()
      await expect(cards(win)).toHaveCount(2)
      await expect(win.getByTestId('lib-tab-match')).toHaveAttribute('aria-selected', 'true')
      await win.getByTestId('lib-tab-all').click()

      // Поиск по названию и по имени видео; «ё» = «е».
      await win.getByTestId('lib-search').fill('елкин')
      await expect(cards(win)).toHaveCount(1)
      await win.getByTestId('lib-search').fill('sample')
      await expect(cards(win)).toHaveCount(1)
      await expect(win.getByTestId('card-title')).toHaveText('Тренировка среда')
      await win.getByTestId('lib-search').fill('нет такого')
      await expect(win.getByTestId('lib-nomatch')).toBeVisible()
      await win.getByTestId('lib-search-clear').click()
      await expect(cards(win)).toHaveCount(5)

      // Поиск и вкладка работают вместе.
      await win.getByTestId('lib-tab-match').click()
      await win.getByTestId('lib-search').fill('зенит')
      await expect(cards(win)).toHaveCount(1)
      await win.getByTestId('lib-search-clear').click()
      await win.getByTestId('lib-tab-all').click()

      await win.getByTestId('lib-sort').selectOption('title')
      expect(await titles()).toEqual([
        'Динамо — Спартак',
        'Ёлкин: скаутинг',
        'Зенит — Локомотив',
        'Старый проект',
        'Тренировка среда'
      ])
      await win.getByTestId('lib-sort').selectOption('date')
      expect(await titles()).toEqual([
        'Зенит — Локомотив',
        'Динамо — Спартак',
        'Ёлкин: скаутинг',
        'Старый проект',
        'Тренировка среда'
      ])
    } finally {
      await app.close()
    }
  })

  test('перезапуск: проект в списке; клик по карточке открывает его с работой', async () => {
    const first = await launch()
    let { app, win } = first
    const { userData } = first
    try {
      await createProject({ app, win }, { title: 'Сохранённый', type: 'training' })
      await seekVideo(win, 2)
      await win.keyboard.press('Digit1')
      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      await app.close()

      const next = await launch({ userData })
      app = next.app
      win = next.win
      await expect(start(win)).toBeVisible()
      const card = cardByTitle(win, 'Сохранённый')
      await expect(card).toHaveCount(1)
      await expect(card.getByTestId('card-type')).toHaveText('Тренировка')
      await expect(card.getByTestId('card-stats')).toContainText('1 эпизод')

      await card.getByTestId('card-open-main').click()
      await expect(win.getByTestId('project-name')).toHaveText('Сохранённый')
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await expect(rows(win)).toHaveCount(1)
      await expect(win.locator('.app')).toHaveAttribute('data-view', 'workspace')
      expect(await windowTitle(app)).toBe('FlowAnalyzer — Сохранённый')

      // Домой и снова в список: карточка на месте.
      await win.getByTestId('go-home').click()
      await expect(cardByTitle(win, 'Сохранённый')).toHaveCount(1)
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('файл удалён снаружи: «Файл не найден» → «Убрать из списка»; запись исчезает насовсем', async () => {
    const first = await launch()
    let { app, win } = first
    const { userData, projectsDir } = first
    try {
      await createProject({ app, win }, { title: 'Скоро пропадёт' })
      await app.close()
      const file = join(projectsDir, 'Скоро пропадёт.flowproj')
      rmSync(file)

      const next = await launch({ userData })
      app = next.app
      win = next.win
      const card = cards(win)
      await expect(card).toHaveCount(1)
      await expect(card).toHaveAttribute('data-status', 'missing')
      await expect(card.getByTestId('card-missing')).toHaveText('Файл не найден')
      await expect(card.getByTestId('card-locate-btn')).toBeVisible()
      // Серая карточка не открывается кликом.
      await expect(card.getByTestId('card-open-main')).toHaveCount(0)
      await shot(win, 'start-missing-card')

      await card.getByTestId('card-remove-btn').click()
      await expect(cards(win)).toHaveCount(0)
      await expect(win.getByTestId('lib-empty')).toBeVisible()
      await expect(win.getByTestId('lib-notice')).toContainText('убран из списка')
      expect(readJson(join(userData, 'library.json')).items).toEqual([])
      await app.close()

      const again = await launch({ userData })
      app = again.app
      win = again.win
      await expect(win.getByTestId('lib-empty')).toBeVisible()
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('проект, положенный в папку проектов вручную, появляется (после запуска и после «На главную»)', async () => {
    const { userData, projectsDir } = prepare()
    seedProject(join(projectsDir, 'Подброшенный.flowproj'), {
      meta: { title: 'Подброшенный', type: 'scouting' }
    })
    // Подпапка первого уровня тоже просматривается, а второго — нет.
    seedProject(join(projectsDir, 'Сезон', 'В подпапке.flowproj'), {
      meta: { title: 'В подпапке', type: 'match' }
    })
    seedProject(join(projectsDir, 'Сезон', 'Глубже', 'Слишком глубоко.flowproj'), {
      meta: { title: 'Слишком глубоко', type: 'match' }
    })
    writeFileSync(join(projectsDir, 'не проект.txt'), 'x')
    const { app, win } = await launch({ userData })
    try {
      await expect(cards(win)).toHaveCount(2)
      await expect(cardByTitle(win, 'Подброшенный')).toHaveCount(1)
      await expect(cardByTitle(win, 'В подпапке')).toHaveCount(1)
      await expect(cardByTitle(win, 'Слишком глубоко')).toHaveCount(0)

      // Файл появился, пока приложение работало: список обновляется при возврате на главную.
      await quickOpen({ app, win })
      seedProject(join(projectsDir, 'Новенький.flowproj'), {
        meta: { title: 'Новенький', type: 'training' }
      })
      await win.getByTestId('go-home').click()
      await expect(cardByTitle(win, 'Новенький')).toHaveCount(1)
      await expect(cards(win)).toHaveCount(3)
    } finally {
      await app.close()
    }
  })

  test('проект из командной строки открывается сразу, стартовый экран не мелькает', async () => {
    const { userData, projectsDir } = prepare()
    const file = seedProject(join(projectsDir, 'Из командной строки.flowproj'), {
      meta: { title: 'Из командной строки', type: 'match' },
      episodes: [{ n: 1, start: 1, end: 3 }]
    })
    const { app, win } = await launch({ userData, args: [file] })
    try {
      await expect(win.getByTestId('project-name')).toHaveText('Из командной строки')
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await expect(rows(win)).toHaveCount(1)
      await expect(start(win)).toHaveCount(0)
      // Кнопка «Главная» возвращает к списку; проект уже в нём.
      await win.getByTestId('go-home').click()
      await expect(cardByTitle(win, 'Из командной строки')).toHaveCount(1)
    } finally {
      await app.close()
    }
  })

  test('повреждённый файл: карточка с ошибкой, без открытия; остальные работают', async () => {
    const { userData, projectsDir } = prepare()
    writeFileSync(
      join(projectsDir, 'Сломанный.flowproj'),
      '{"format":"flowanalyzer-project"',
      'utf8'
    )
    writeFileSync(join(projectsDir, 'Чужой.flowproj'), JSON.stringify({ hello: 1 }), 'utf8')
    seedProject(join(projectsDir, 'Целый.flowproj'), { meta: { title: 'Целый', type: 'match' } })
    const { app, win } = await launch({ userData })
    try {
      await expect(cards(win)).toHaveCount(3)
      const broken = win.locator('[data-testid="project-card"][data-status="error"]')
      await expect(broken).toHaveCount(2)
      await expect(broken.first().getByTestId('card-error')).toHaveText('Проект не читается')
      await expect(broken.first()).toContainText(/повреждён|не файл проекта/i)
      await expect(broken.first().getByTestId('card-open-main')).toHaveCount(0)
      await expect(cardByTitle(win, 'Целый').getByTestId('card-open-main')).toBeVisible()
      await shot(win, 'start-error-card')
    } finally {
      await app.close()
    }
  })

  test('«Найти…»: пропавший проект возвращается по новому пути; убрать из списка можно, файл остаётся', async () => {
    const { userData } = prepare()
    const work = join(makeUserData(), 'внешняя папка')
    const original = seedProject(join(work, 'Переезд.flowproj'), {
      meta: { title: 'Переезд', type: 'scouting' }
    })
    const first = await launch({ userData, args: [original] })
    await expect(first.win.getByTestId('project-name')).toHaveText('Переезд')
    await first.app.close()

    const moved = join(work, 'новое место', 'Переезд.flowproj')
    mkdirSync(join(work, 'новое место'), { recursive: true })
    renameSync(original, moved)

    const { app, win } = await launch({ userData })
    try {
      const card = cards(win)
      await expect(card).toHaveAttribute('data-status', 'missing')
      await stubDialog(app, moved)
      await card.getByTestId('card-locate-btn').click()
      await expect(win.getByTestId('lib-notice')).toContainText('найден')
      const found = cards(win)
      await expect(found).toHaveCount(1)
      await expect(found).toHaveAttribute('data-status', 'ok')
      await expect(found).toHaveAttribute('data-path', moved)
      await expect(found.getByTestId('card-title')).toHaveText('Переезд')

      // Проект вне папки по умолчанию можно убрать из списка; сам файл остаётся.
      await found.getByTestId('card-menu-btn').click()
      await expect(win.getByTestId('card-menu')).toBeVisible()
      await expect(win.getByTestId('card-keep-note')).toHaveCount(0)
      await win.getByTestId('card-remove').click()
      await expect(cards(win)).toHaveCount(0)
      expect(existsSync(moved)).toBe(true)
      expect(readJson(join(userData, 'library.json')).items).toEqual([])
    } finally {
      await app.close()
    }
  })

  test('меню карточки: проект в папке проектов не убирается (объяснение), показать в папке, свойства', async () => {
    const { userData, projectsDir } = prepare()
    const file = seedProject(join(projectsDir, 'Моя игра.flowproj'), {
      meta: { title: 'Моя игра', type: 'match', date: '2026-05-01', notes: 'старые заметки' },
      episodes: [{ n: 1, start: 1, end: 3 }]
    })
    const { app, win } = await launch({ userData })
    try {
      await stubReveal(app)
      const card = cards(win)
      await card.hover()
      await card.getByTestId('card-menu-btn').click()
      const menu = win.getByTestId('card-menu')
      await expect(menu).toBeVisible()
      await expect(win.getByTestId('card-open')).toBeVisible()
      await expect(win.getByTestId('card-remove')).toHaveCount(0)
      await expect(win.getByTestId('card-keep-note')).toContainText('не убирается')
      await shot(win, 'start-card-menu')

      await win.getByTestId('card-reveal').click()
      expect(await revealed(app)).toEqual([file])
      await expect(menu).toHaveCount(0)

      // Esc закрывает меню, правый клик открывает.
      await card.getByTestId('card-menu-btn').click()
      await win.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      await card.click({ button: 'right' })
      await expect(menu).toBeVisible()

      // Свойства: правка пишется прямо в файл проекта.
      await win.getByTestId('card-props').click()
      const dialog = win.getByTestId('properties-dialog')
      await expect(dialog).toBeVisible()
      await expect(win.getByTestId('props-title')).toHaveValue('Моя игра')
      await expect(win.getByTestId('props-notes')).toHaveValue('старые заметки')
      await win.getByTestId('props-title').fill('')
      await win.getByTestId('props-save').click()
      await expect(win.getByTestId('props-title-error')).toHaveText('Введите название проекта')
      await win.getByTestId('props-title').fill('Переименованная игра')
      await win.getByTestId('props-type-training').click()
      await win.getByTestId('props-date').fill('2026-06-02')
      await win.getByTestId('props-save').click()
      await expect(dialog).toHaveCount(0)
      const after = cards(win)
      await expect(after.getByTestId('card-title')).toHaveText('Переименованная игра')
      await expect(after.getByTestId('card-type')).toHaveText('Тренировка')
      await expect(after.getByTestId('card-date')).toHaveText('2 июня 2026')
      const written = readJson(file)
      expect(written.meta).toEqual({
        title: 'Переименованная игра',
        type: 'training',
        date: '2026-06-02',
        notes: 'старые заметки'
      })
      expect(written.episodes).toHaveLength(1) // остальное содержимое не тронуто
    } finally {
      await app.close()
    }
  })

  test('«Удалить…»: подтверждение, файл уходит в Корзину (подмена trashItem), запись исчезает', async () => {
    const { userData, projectsDir } = prepare()
    const trash = join(userData, 'FakeTrash')
    mkdirSync(trash, { recursive: true })
    const keep = seedProject(join(projectsDir, 'Остаётся.flowproj'), {
      meta: { title: 'Остаётся', type: 'match' }
    })
    const doomed = seedProject(join(projectsDir, 'Лишний проект.flowproj'), {
      meta: { title: 'Лишний проект', type: 'training' }
    })
    const { app, win } = await launch({ userData })
    try {
      await app.evaluate(({ shell }, dir) => {
        const fs = process.mainModule!.require('fs') as typeof import('fs')
        const path = process.mainModule!.require('path') as typeof import('path')
        shell.trashItem = async (p: string) => {
          fs.renameSync(p, path.join(dir, path.basename(p)))
        }
      }, trash)
      await expect(cards(win)).toHaveCount(2)
      const card = cardByTitle(win, 'Лишний проект')
      await card.hover()
      await card.getByTestId('card-menu-btn').click()
      await win.getByTestId('card-delete').click()
      const dialog = win.getByTestId('delete-dialog')
      await expect(dialog).toContainText('Корзину')
      await shot(win, 'start-delete-confirm')
      // Отмена и Esc ничего не удаляют.
      await win.getByTestId('delete-cancel').click()
      await expect(dialog).toHaveCount(0)
      expect(existsSync(doomed)).toBe(true)
      await card.getByTestId('card-menu-btn').click()
      await win.getByTestId('card-delete').click()
      await win.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      expect(existsSync(doomed)).toBe(true)

      await card.getByTestId('card-menu-btn').click()
      await win.getByTestId('card-delete').click()
      await win.getByTestId('delete-confirm').click()
      await expect(dialog).toHaveCount(0)
      await expect(cards(win)).toHaveCount(1)
      await expect(win.getByTestId('card-title')).toHaveText('Остаётся')
      expect(existsSync(doomed)).toBe(false)
      expect(existsSync(join(trash, 'Лишний проект.flowproj'))).toBe(true)
      expect(existsSync(keep)).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('свойства открытого проекта: правка помечает проект несохранённым и пишется при Ctrl+S', async () => {
    const { app, win, projectsDir } = await launch()
    try {
      await createProject({ app, win }, { title: 'Исходное название', type: 'match' })
      await win.getByTestId('project-menu-button').click()
      await win.getByTestId('menu-properties').click()
      const dialog = win.getByTestId('properties-dialog')
      await expect(dialog).toBeVisible()
      await expect(win.getByTestId('props-title')).toHaveValue('Исходное название')
      await shot(win, 'start-properties-dialog')
      await win.getByTestId('props-title').fill('Новое название')
      await win.getByTestId('props-type-scouting').click()
      await win.getByTestId('props-notes').fill('Проверить левый фланг')
      await win.getByTestId('props-save').click()
      await expect(dialog).toHaveCount(0)
      await expect(win.getByTestId('project-name')).toHaveText('Новое название')
      await expect(win.getByTestId('project-dirty')).toBeVisible()
      expect(await windowTitle(app)).toBe('FlowAnalyzer — Новое название*')

      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      const file = join(projectsDir, 'Исходное название.flowproj') // имя файла не меняется
      expect(readJson(file).meta).toMatchObject({
        title: 'Новое название',
        type: 'scouting',
        notes: 'Проверить левый фланг'
      })
    } finally {
      await app.close()
    }
  })

  test('быстрый просмотр без проекта: безымянный проект, свойства создают описание, сохранение — через диалог', async () => {
    const { app, win, userData } = await launch()
    try {
      await quickOpen({ app, win })
      await expect(win.getByTestId('project-name')).toHaveText('Новый проект')
      await win.getByTestId('project-menu-button').click()
      await win.getByTestId('menu-properties').click()
      await expect(win.getByTestId('props-title')).toHaveValue('Новый проект')
      await win.getByTestId('props-title').fill('Тренировка 5')
      await win.getByTestId('props-type-training').click()
      await win.getByTestId('props-save').click()
      await expect(win.getByTestId('project-name')).toHaveText('Тренировка 5')
      const target = join(userData, 'сохранённая', 'тренировка.flowproj')
      await stubSaveDialog(app, target)
      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      expect(await saveDialogCalls(app)).toBe(1)
      expect(readJson(target).meta).toMatchObject({ title: 'Тренировка 5', type: 'training' })
      // Сохранённый вне папки проектов, он всё равно попал в библиотеку.
      await win.getByTestId('go-home').click()
      await expect(cardByTitle(win, 'Тренировка 5')).toHaveCount(1)
    } finally {
      await app.close()
    }
  })

  test('Ctrl+H и «Главная»: несохранённое спрашивают, «Отмена» остаётся в проекте', async () => {
    const { app, win } = await launch()
    try {
      await createProject({ app, win }, { title: 'С вопросом' })
      await seekVideo(win, 2)
      await win.keyboard.press('Digit1')
      await expect(win.getByTestId('project-dirty')).toBeVisible()

      await win.keyboard.press('Control+h')
      await expect(win.getByTestId('unsaved-dialog')).toBeVisible()
      await win.getByTestId('unsaved-cancel').click()
      await expect(win.getByTestId('project-name')).toHaveText('С вопросом')
      await expect(start(win)).toHaveCount(0)

      await win.getByTestId('go-home').click()
      await win.getByTestId('unsaved-save').click()
      await expect(start(win)).toBeVisible()
      await expect(cardByTitle(win, 'С вопросом').getByTestId('card-stats')).toContainText(
        '1 эпизод'
      )

      // Без изменений вопроса нет.
      await cardByTitle(win, 'С вопросом').getByTestId('card-open-main').click()
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await win.keyboard.press('Control+h')
      await expect(start(win)).toBeVisible()
      await expect(win.getByTestId('unsaved-dialog')).toHaveCount(0)
      // Из стартового экрана Ctrl+H ничего не делает.
      await win.keyboard.press('Control+h')
      await expect(start(win)).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('Ctrl+N из рабочей области: сначала вопрос о несохранённом, затем окно; «Не сохранять» и Esc ничего не теряют', async () => {
    const { app, win, projectsDir } = await launch()
    try {
      await createProject({ app, win }, { title: 'Первый' })
      await seekVideo(win, 2)
      await win.keyboard.press('Digit1')
      await win.keyboard.press('Control+n')
      await expect(win.getByTestId('unsaved-dialog')).toBeVisible()
      await win.getByTestId('unsaved-cancel').click()
      await expect(win.getByTestId('new-project-dialog')).toHaveCount(0)

      await win.keyboard.press('Control+n')
      await win.getByTestId('unsaved-discard').click()
      await expect(win.getByTestId('new-project-dialog')).toBeVisible()
      // Окно закрыли без создания: рабочая область осталась как была.
      await win.keyboard.press('Escape')
      await expect(win.getByTestId('new-project-dialog')).toHaveCount(0)
      await expect(win.getByTestId('project-name')).toHaveText('Первый')
      await expect(rows(win)).toHaveCount(1)

      // Создание нового проекта заменяет текущий.
      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      await createProject({ app, win }, { title: 'Второй' })
      await expect(rows(win)).toHaveCount(0)
      expect(existsSync(join(projectsDir, 'Второй.flowproj'))).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('баннер восстановления после сбоя виден и на стартовом экране; «Восстановить» открывает работу', async () => {
    const env = { FLOW_AUTOSAVE_MS: '500' }
    const first = await launch({ env })
    let { app, win } = first
    const { userData, projectsDir } = first
    try {
      await createProject({ app, win }, { title: 'Аварийный' })
      await seekVideo(win, 2)
      await win.keyboard.press('Digit1')
      await win.keyboard.press('Digit6')
      const recoveryDir = join(userData, 'recovery')
      await expect
        .poll(() =>
          existsSync(recoveryDir)
            ? readdirSync(recoveryDir)
                .filter((n) => n.endsWith('.recovery'))
                .map(
                  (n) =>
                    JSON.parse(readFileSync(join(recoveryDir, n), 'utf8')).project.episodes.length
                )
            : []
        )
        .toEqual([2])
      await crashApp(app)

      const next = await launch({ userData, env })
      app = next.app
      win = next.win
      await expect(start(win)).toBeVisible()
      const banner = win.getByTestId('recovery-banner')
      await expect(banner).toBeVisible()
      await expect(banner).toContainText('Найдена несохранённая работа')
      await shot(win, 'start-recovery-banner')
      await win.getByTestId('recovery-restore').click()
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await expect(win.getByTestId('project-name')).toHaveText('Аварийный')
      await expect(rows(win)).toHaveCount(2)
      await expect(win.getByTestId('project-dirty')).toBeVisible()
      await win.keyboard.press('Control+s')
      await expect(win.getByTestId('project-dirty')).toHaveCount(0)
      expect(readJson(join(projectsDir, 'Аварийный.flowproj')).episodes).toHaveLength(2)
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('видео проекта не найдено: диалог «Указать видео…» на стартовом экране, потом проект открывается', async () => {
    const { userData, projectsDir } = prepare()
    const gone = join(userData, 'видео', 'потерянное.mp4')
    mkdirSync(join(userData, 'видео'), { recursive: true })
    writeFileSync(gone, 'x')
    const file = seedProject(join(projectsDir, 'Без видео.flowproj'), {
      meta: { title: 'Без видео', type: 'match' },
      video: gone
    })
    rmSync(gone)
    expect(existsSync(file)).toBe(true)
    const { app, win } = await launch({ userData })
    try {
      await cardByTitle(win, 'Без видео').getByTestId('card-open-main').click()
      await expect(win.getByTestId('relink-dialog')).toBeVisible()
      await stubDialog(app, fixture('cfr25.mp4'))
      await win.getByTestId('relink-pick').click()
      await expect(win.getByTestId('project-name')).toHaveText('Без видео')
      await expect(win.getByTestId('play-toggle')).toBeEnabled()
      await expect(win.getByTestId('project-dirty')).toBeVisible() // новый путь ещё не записан
    } finally {
      await app.close()
    }
  })

  test('Ctrl+H есть в настройках горячих клавиш и переназначается; закрытие окна на стартовом экране не спрашивает', async () => {
    const { app, win } = await launch()
    try {
      await win.getByTestId('open-settings').click()
      await win.getByRole('tab', { name: 'Горячие клавиши' }).click()
      const row = win.locator('[data-testid="keys-row"][data-command="project:home"]')
      await expect(row).toContainText('На главную')
      await expect(row).toContainText('Ctrl+H')
      await win.getByTestId('settings-cancel').click()
      await closeWindow(app)
      await app.waitForEvent('close')
    } finally {
      await app.close().catch(() => undefined)
    }
  })

  test('снимок: несколько карточек, включая пропавшую и повреждённую', async () => {
    const { userData, projectsDir } = prepare()
    const external = join(makeUserData(), 'архив')
    seedProject(join(projectsDir, 'one.flowproj'), {
      meta: { title: 'Динамо — Спартак', type: 'match', date: '2026-05-17' },
      episodes: [
        { n: 1, start: 1, end: 3 },
        { n: 2, start: 2, end: 4 }
      ],
      annotations: 3,
      duration: 5530,
      updatedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString()
    })
    seedProject(join(projectsDir, 'two.flowproj'), {
      meta: { title: 'Тренировка: стандарты', type: 'training', date: '2026-05-14' },
      video: fixture('sample.mp4'),
      episodes: [{ n: 1, start: 0.5, end: 2 }],
      duration: 2703,
      updatedAt: new Date(Date.now() - 26 * 3600 * 1000).toISOString()
    })
    seedProject(join(projectsDir, 'three.flowproj'), {
      meta: { title: 'Кандидат: Иванов', type: 'scouting' },
      video: fixture('cfr30.webm'),
      duration: 3340,
      updatedAt: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString()
    })
    seedProject(join(projectsDir, 'Старый проект.flowproj'), {})
    writeFileSync(join(projectsDir, 'Сломанный.flowproj'), '{', 'utf8')
    seedLibrary(userData, [join(external, 'Пропавший матч.flowproj')])
    const { app, win } = await launch({ userData })
    try {
      await expect(cards(win)).toHaveCount(6)
      await win.mouse.move(5, 5)
      await shot(win, 'start-several-cards')
    } finally {
      await app.close()
    }
  })
})
