// Как часто интерфейс присылает копию работы.
export const DEFAULT_AUTOSAVE_MS = 2 * 60 * 1000
const MIN_AUTOSAVE_MS = 200
const MAX_AUTOSAVE_MS = 60 * 60 * 1000

/** Интервал автосохранения. Для автотестов его можно сократить переменной FLOW_AUTOSAVE_MS. */
export function parseAutosaveMs(value: string | undefined): number {
  if (!value || !/^\d{1,8}$/.test(value)) return DEFAULT_AUTOSAVE_MS
  const ms = Number(value)
  return ms >= MIN_AUTOSAVE_MS && ms <= MAX_AUTOSAVE_MS ? ms : DEFAULT_AUTOSAVE_MS
}

export const autosaveInterval = (): number => parseAutosaveMs(process.env['FLOW_AUTOSAVE_MS'])
