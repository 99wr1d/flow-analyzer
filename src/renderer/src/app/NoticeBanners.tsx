// Плашки, общие для рабочей области и стартового экрана: ошибка импорта видео и предупреждение о настройках.
import { useSettingsStore } from '../features/settings/settingsStore'
import { ru } from '../i18n/ru'
import { usePlayerStore } from '../store/playerStore'
import { CloseIcon } from '../ui/icons'

export function ImportBanner(): React.JSX.Element | null {
  const message = usePlayerStore((s) => s.importError)
  if (!message) return null
  return (
    <div className="banner" role="alert" data-testid="import-error">
      <span>{message}</span>
      <button
        type="button"
        className="icon-btn icon-btn--small"
        onClick={() => usePlayerStore.getState().setImportError(null)}
        aria-label={ru.stage.dismiss}
        title={ru.stage.dismiss}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  )
}

/** Разовое предупреждение о настройках (например, файл был повреждён). */
export function SettingsWarning(): React.JSX.Element | null {
  const warning = useSettingsStore((s) => s.warning)
  if (!warning) return null
  return (
    <div
      className="banner banner--warn"
      role="alert"
      aria-label={ru.settings.warningLabel}
      data-testid="settings-warning"
    >
      <span>{warning}</span>
      <button
        type="button"
        className="icon-btn icon-btn--small"
        onClick={() => useSettingsStore.getState().dismissWarning()}
        aria-label={ru.stage.dismiss}
        title={ru.stage.dismiss}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  )
}
