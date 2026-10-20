// Справка: окно «О программе» и подсказки первого запуска.
import { create } from 'zustand'
import { useSettingsStore } from '../settings/settingsStore'

export const TIPS_COUNT = 4

interface HelpState {
  aboutOpen: boolean
  /** Подсказки: идёт ли тур и на каком он шаге (с 0). */
  tipsActive: boolean
  tipsStep: number
}

export const useHelpStore = create<HelpState>()(() => ({
  aboutOpen: false,
  tipsActive: false,
  tipsStep: 0
}))

export const openAbout = (): void => useHelpStore.setState({ aboutOpen: true })
export const closeAbout = (): void => useHelpStore.setState({ aboutOpen: false })

/** Запускает тур подсказок с первого шага (из меню «Справка» и при первом запуске). */
export const startTips = (): void => useHelpStore.setState({ tipsActive: true, tipsStep: 0 })
export const stopTips = (): void => useHelpStore.setState({ tipsActive: false, tipsStep: 0 })

export function goTip(step: number): void {
  useHelpStore.setState({ tipsStep: Math.min(TIPS_COUNT - 1, Math.max(0, step)) })
}

/** Запоминает в настройках, что подсказки уже показаны (главный файл настроек, один раз). */
export async function markOnboardingSeen(): Promise<void> {
  const { settings, apply } = useSettingsStore.getState()
  if (settings.onboardingSeen) return
  const next = { ...settings, onboardingSeen: true }
  // Сначала в памяти (чтобы подсказки не запустились второй раз), потом на диск.
  apply(next)
  try {
    apply(await window.api.saveSettings(next))
  } catch {
    /* не записалось — подсказки покажутся ещё раз при следующем запуске, это не страшно */
  }
}

/** Первый запуск: показать подсказки, если они ещё не показывались (автотесты отключают это флагом FLOW_NO_TIPS). */
export async function autoStartTips(): Promise<void> {
  if (useSettingsStore.getState().settings.onboardingSeen) return
  try {
    const info = await window.api.getAppInfo()
    if (info.testFlags.noTips) return
  } catch {
    return
  }
  if (!useSettingsStore.getState().settings.onboardingSeen) startTips()
}
