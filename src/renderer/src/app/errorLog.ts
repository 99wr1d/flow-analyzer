// Запись сбоев интерфейса в журнал (через main) и сборка текста «подробностей» для пользователя.
import { clampLogEntry, type LogEntry } from '../../../shared/log'
import { useProjectStore } from '../features/project/projectStore'
import { buildSaveRequest } from '../features/project/snapshot'

/** Отправляет запись в журнал. Сбой журнала не должен порождать новых сбоев, поэтому все ошибки проглатываются. */
export function logToMain(entry: LogEntry): void {
  try {
    void window.api.writeLog(clampLogEntry(entry)).catch(() => undefined)
  } catch {
    /* preload недоступен — писать некуда */
  }
}

function describe(value: unknown): { message: string; stack?: string } {
  if (value instanceof Error) return { message: value.message || value.name, stack: value.stack }
  if (typeof value === 'string') return { message: value }
  try {
    return { message: JSON.stringify(value) ?? String(value) }
  } catch {
    return { message: String(value) }
  }
}

export function logError(source: string, value: unknown, extraStack?: string): void {
  const { message, stack } = describe(value)
  const full = [stack, extraStack].filter(Boolean).join('\n')
  logToMain({ level: 'error', source, message, ...(full ? { stack: full } : {}) })
}

/** Ошибки вне React: window.onerror и необработанные отклонения промисов. Возвращает функцию отключения. */
export function installGlobalErrorLogging(): () => void {
  const onError = (event: ErrorEvent): void => {
    logError('window.onerror', event.error ?? event.message)
  }
  const onRejection = (event: PromiseRejectionEvent): void => {
    logError('unhandledrejection', event.reason)
  }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}

/** Текст для «Скопировать подробности»: версия программы, область, ошибка и стек (содержимое проекта не включается). */
export async function buildErrorReport(
  area: string,
  error: Error,
  componentStack: string
): Promise<string> {
  let head = 'FlowAnalyzer'
  try {
    const about = await window.api.getAboutInfo()
    head = `${about.name} ${about.version} (Electron ${about.electron}, Chromium ${about.chromium})`
  } catch {
    /* версия неизвестна — отчёт всё равно полезен */
  }
  return [
    head,
    `Область: ${area}`,
    `Время: ${new Date().toISOString()}`,
    `Ошибка: ${error.name}: ${error.message}`,
    '',
    error.stack ?? '(стека нет)',
    '',
    'Компоненты:',
    componentStack.trim() || '(нет)'
  ].join('\n')
}

/** Копирует текст в буфер обмена; запасной путь — скрытое поле и execCommand. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    /* запасной путь ниже */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch {
    return false
  }
}

/** Перезагрузка окна. Перед ней пробуем сохранить копию работы, чтобы после перезапуска её можно было восстановить. */
export async function restartWindow(): Promise<void> {
  try {
    const project = useProjectStore.getState()
    if (project.dirty) {
      const request = buildSaveRequest(project.path)
      if (request) {
        await Promise.race([
          window.api.autosaveProject(request),
          new Promise((resolve) => setTimeout(resolve, 1500))
        ])
      }
    }
  } catch {
    /* состояние могло сломаться вместе с интерфейсом — перезагружаем всё равно */
  }
  window.location.reload()
}
