import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

export const SHOTS = process.env.FLOW_SHOTS_DIR ?? join(tmpdir(), 'flowanalyzer-e2e')

// Если задан FLOW_EXE — тесты запускаются на собранном приложении (dist/win-unpacked/FlowAnalyzer.exe).
export const EXE = process.env.FLOW_EXE
// Если Windows (Smart App Control) не даёт запустить неподписанный exe, можно проверить упакованный код так:
// FLOW_ASAR=dist/win-unpacked/resources/app.asar — подписанный Electron из node_modules запускает собранный app.asar.
export const ASAR = process.env.FLOW_ASAR ? resolve(process.env.FLOW_ASAR) : undefined
export const SUFFIX = EXE || ASAR ? '-packaged' : ''

/** Версия приложения из package.json: тесты не привязаны к конкретному номеру. */
export const APP_VERSION = (
  JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
).version

export const FIXTURES = resolve('tests/fixtures')
export const fixture = (name: string): string => join(FIXTURES, name)

// ELECTRON_RUN_AS_NODE (наследуется из VS Code) ломает запуск Electron — убираем.
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v
  }
  return env
}

/** Создаёт пустую папку данных приложения для одного теста: настоящие настройки пользователя не трогаются. */
export function makeUserData(): string {
  mkdirSync(SHOTS, { recursive: true })
  return mkdtempSync(join(SHOTS, `${USERDATA_PREFIX}-`))
}
export const USERDATA_PREFIX = 'flow-ud'

export interface LaunchOptions {
  /** Папка данных; по умолчанию — новая пустая. Передайте прежнюю, чтобы проверить сохранение между запусками. */
  userData?: string
  /** Записать в settings.json перед запуском (объект — как JSON, строка — как есть). */
  settingsFile?: unknown
  /** Аргументы командной строки приложения (например, путь к .flowproj). */
  args?: string[]
  /** Дополнительные переменные окружения. */
  env?: Record<string, string>
  /** true — подсказки первого запуска показываются (по умолчанию тесты их отключают флагом FLOW_NO_TIPS). */
  tips?: boolean
}

export async function launch(options: LaunchOptions = {}): Promise<{
  app: ElectronApplication
  win: Page
  userData: string
  /** Папка проектов по умолчанию (FLOW_LIBRARY_DIR) — временная. */
  projectsDir: string
}> {
  const userData = options.userData ?? makeUserData()
  if (options.settingsFile !== undefined) {
    const text =
      typeof options.settingsFile === 'string'
        ? options.settingsFile
        : JSON.stringify(options.settingsFile)
    writeFileSync(join(userData, 'settings.json'), text, 'utf8')
  }
  // Папка проектов по умолчанию — тоже временная: настоящие «Документы» тесты не трогают.
  const projectsDir = join(userData, 'Projects')
  const env = {
    ...cleanEnv(),
    FLOW_USER_DATA: userData,
    FLOW_LIBRARY_DIR: projectsDir,
    // FLOW_SHOW_WINDOW=1 — показать окно на экране при отладке тестов.
    ...(process.env.FLOW_SHOW_WINDOW === '1' ? {} : { FLOW_BACKGROUND_WINDOW: '1' }),
    ...(options.tips ? {} : { FLOW_NO_TIPS: '1' }),
    ...options.env
  }
  const extra = options.args ?? []
  const app = await electron.launch(
    EXE
      ? { executablePath: EXE, args: extra, env }
      : { args: [ASAR ?? '.', ...extra], cwd: resolve('.'), env }
  )
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  // Ждём, пока React отрисует интерфейс, повесит обработчики и загрузятся настройки.
  await win.getByTestId('open-video').waitFor()
  await win.locator('.app[data-settings="loaded"]').waitFor()
  await win.waitForTimeout(100)
  return { app, win, userData, projectsDir }
}

/** Подменяет системный диалог выбора файла: он «выбирает» указанный путь. */
export async function stubDialog(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] })
  }, path)
}

export const videoState = (win: Page) =>
  win.evaluate(() => {
    const v = document.querySelector('video')
    return v
      ? {
          currentTime: v.currentTime,
          duration: v.duration,
          paused: v.paused,
          ended: v.ended,
          rate: v.playbackRate,
          muted: v.muted,
          volume: v.volume
        }
      : null
  })

/** Перемотка и ожидание, пока интерфейс увидит новое время. */
export async function seekVideo(win: Page, time: number): Promise<void> {
  await win.evaluate(
    (t) =>
      new Promise<void>((resolve) => {
        const v = document.querySelector('video')!
        const go = (): void => {
          v.addEventListener('seeked', () => resolve(), { once: true })
          v.currentTime = t
        }
        // Предыдущая перемотка (например, восстановление времени проекта) ещё идёт — дождёмся её конца.
        if (v.seeking) v.addEventListener('seeked', go, { once: true })
        else go()
      }),
    time
  )
  await win.waitForTimeout(80)
}

/**
 * Нажатие клавиши «как в русской раскладке»: code — физическая клавиша, key — русская буква.
 * Playwright так не умеет, поэтому событие отправляется напрямую.
 */
export async function pressRussian(win: Page, code: string, key: string): Promise<void> {
  await win.evaluate(
    ({ code, key }) => {
      const init = { code, key, bubbles: true, cancelable: true }
      document.body.dispatchEvent(new KeyboardEvent('keydown', init))
      document.body.dispatchEvent(new KeyboardEvent('keyup', init))
    },
    { code, key }
  )
}

/** Подменяет системный диалог «Сохранить как»: он «выбирает» указанный путь и считает свои вызовы. */
export async function stubSaveDialog(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, p) => {
    const g = globalThis as unknown as { __saveCalls: number }
    g.__saveCalls = 0
    dialog.showSaveDialog = async () => {
      g.__saveCalls += 1
      return { canceled: false, filePath: p }
    }
  }, path)
}

export const saveDialogCalls = (app: ElectronApplication): Promise<number> =>
  app.evaluate(() => (globalThis as unknown as { __saveCalls?: number }).__saveCalls ?? 0)

/** Закрывает окно так, как это делает пользователь (кнопка ×): срабатывает защита от потери данных. */
export async function closeWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close()
  })
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Рамка слоя рисунков, когда она перестала меняться (две подряд одинаковые на соседних кадрах анимации): раскладка устоялась. */
export async function stableLayerBox(win: Page): Promise<Box> {
  const rect = await win.getByTestId('annotation-layer').evaluate(async (el) => {
    const read = (): string => {
      const r = el.getBoundingClientRect()
      return [r.x, r.y, r.width, r.height].join(',')
    }
    const frame = (): Promise<void> => new Promise((res) => requestAnimationFrame(() => res()))
    let prev = read()
    for (let i = 0; i < 40; i += 1) {
      await frame()
      await frame()
      const now = read()
      if (now === prev) break
      prev = now
    }
    const [x, y, width, height] = prev.split(',').map(Number)
    return { x, y, width, height }
  })
  return rect as Box
}

/** Перетаскивание мышью по картинке в долях кадра (0..1). */
export async function dragOnPicture(
  win: Page,
  from: [number, number],
  to: [number, number]
): Promise<void> {
  const b = await stableLayerBox(win)
  const at = ([fx, fy]: [number, number]): [number, number] => [
    b.x + fx * b.width,
    b.y + fy * b.height
  ]
  const [x0, y0] = at(from)
  const [x1, y1] = at(to)
  await win.mouse.move(x0, y0)
  await win.mouse.down()
  await win.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 })
  await win.mouse.move(x1, y1, { steps: 4 })
  await win.mouse.up()
}

/** Имитирует аварийное завершение: процесс приложения убивается без закрытия окна и без обработчиков выхода. */
export async function crashApp(app: ElectronApplication): Promise<void> {
  const exited = app.waitForEvent('close')
  await app.evaluate(() => process.kill(process.pid, 'SIGKILL')).catch(() => undefined)
  await exited.catch(() => undefined)
  // Пока дочерние процессы не завершились, папка данных занята.
  await new Promise((resolve) => setTimeout(resolve, 500))
}
