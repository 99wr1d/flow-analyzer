import { _electron as electron, expect, test } from '@playwright/test'
import { join, resolve } from 'path'

const SHOTS =
  process.env.FLOW_SHOTS_DIR ??
  'C:/Users/user/AppData/Local/Temp/claude/C--Users-user/272a2939-769e-4218-aeb7-9ba220c997d1/scratchpad'

// ELECTRON_RUN_AS_NODE (наследуется из VS Code) ломает запуск Electron — убираем.
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v
  }
  return env
}

test('приложение запускается безопасно и показывает версию', async () => {
  const app = await electron.launch({
    args: ['.'],
    cwd: resolve('.'),
    env: cleanEnv()
  })
  try {
    const win = await app.firstWindow()
    await win.waitForLoadState('domcontentloaded')

    await expect(win).toHaveTitle('FlowAnalyzer')
    await expect(win.getByTestId('app-info')).toContainText('FlowAnalyzer 0.1.0')

    const leaks = await win.evaluate(() => {
      const w = window as unknown as Record<string, unknown>
      return {
        require: typeof w.require,
        process: typeof w.process,
        electron: typeof w.electron,
        apiKeys: Object.keys(window.api).sort()
      }
    })
    expect(leaks.require).toBe('undefined')
    expect(leaks.process).toBe('undefined')
    expect(leaks.electron).toBe('undefined')
    expect(leaks.apiKeys).toEqual(['getAppInfo'])

    await win.screenshot({ path: join(SHOTS, 'e2e-default.png') })
  } finally {
    await app.close()
  }
})
