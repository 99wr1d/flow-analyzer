import { _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
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

export async function launch(): Promise<{ app: ElectronApplication; win: Page }> {
  const app = await electron.launch(
    EXE
      ? { executablePath: EXE, env: cleanEnv() }
      : { args: [ASAR ?? '.'], cwd: resolve('.'), env: cleanEnv() }
  )
  const win = await app.firstWindow()
  await win.waitForLoadState('domcontentloaded')
  // Ждём, пока React отрисует интерфейс и повесит обработчики.
  await win.getByTestId('open-video').waitFor()
  await win.waitForTimeout(100)
  return { app, win }
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
