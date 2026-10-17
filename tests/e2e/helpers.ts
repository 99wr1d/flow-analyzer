import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'

export const SHOTS =
  process.env.FLOW_SHOTS_DIR ??
  'C:/Users/user/AppData/Local/Temp/claude/C--Users-user/272a2939-769e-4218-aeb7-9ba220c997d1/scratchpad'

// Если задан FLOW_EXE — тесты запускаются на собранном приложении (dist/win-unpacked/FlowAnalyzer.exe).
export const EXE = process.env.FLOW_EXE
// Если Windows (Smart App Control) не даёт запустить неподписанный exe, можно проверить упакованный код так:
// FLOW_ASAR=dist/win-unpacked/resources/app.asar — подписанный Electron из node_modules запускает собранный app.asar.
export const ASAR = process.env.FLOW_ASAR ? resolve(process.env.FLOW_ASAR) : undefined
export const SUFFIX = EXE || ASAR ? '-packaged' : ''

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
}

export async function launch(
  options: LaunchOptions = {}
): Promise<{ app: ElectronApplication; win: Page; userData: string }> {
  const userData = options.userData ?? makeUserData()
  if (options.settingsFile !== undefined) {
    const text =
      typeof options.settingsFile === 'string'
        ? options.settingsFile
        : JSON.stringify(options.settingsFile)
    writeFileSync(join(userData, 'settings.json'), text, 'utf8')
  }
  const env = { ...cleanEnv(), FLOW_USER_DATA: userData }
  const app = await electron.launch(
    EXE ? { executablePath: EXE, env } : { args: [ASAR ?? '.'], cwd: resolve('.'), env }
  )
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  // Ждём, пока React отрисует интерфейс, повесит обработчики и загрузятся настройки.
  await win.getByTestId('open-video').waitFor()
  await win.locator('.app[data-settings="loaded"]').waitFor()
  await win.waitForTimeout(100)
  return { app, win, userData }
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
        v.addEventListener('seeked', () => resolve(), { once: true })
        v.currentTime = t
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
