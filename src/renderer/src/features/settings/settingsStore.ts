import { create } from 'zustand'
import { defaultSettings, type Settings } from '../../../../shared/settings'

interface SettingsState {
  settings: Settings
  loaded: boolean
  /** Разовое неблокирующее предупреждение (например, файл настроек был повреждён). */
  warning: string | null
  dialogOpen: boolean
}

interface SettingsActions {
  load: () => Promise<void>
  /** Применить сохранённые настройки (после успешного saveSettings). */
  apply: (settings: Settings) => void
  dismissWarning: () => void
  openDialog: () => void
  closeDialog: () => void
}

// Загрузка выполняется один раз: предупреждение о повреждённом файле main выдаёт только при первом запросе.
let loadStarted = false

export const useSettingsStore = create<SettingsState & SettingsActions>()((set) => ({
  settings: defaultSettings(),
  loaded: false,
  warning: null,
  dialogOpen: false,

  load: async () => {
    if (loadStarted) return
    loadStarted = true
    try {
      const { settings, warning } = await window.api.getSettings()
      set({ settings, warning, loaded: true })
    } catch (error) {
      const reason = error instanceof Error && error.message ? ` (${error.message})` : ''
      set({
        settings: defaultSettings(),
        loaded: true,
        warning: `Не удалось прочитать настройки${reason}. Использованы стандартные.`
      })
    }
  },
  apply: (settings) => set({ settings }),
  dismissWarning: () => set({ warning: null }),
  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false })
}))
