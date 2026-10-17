// Заголовок окна. Его задаёт только main по проверенным данным: страница сама заголовок поменять не может.
export const APP_TITLE = 'FlowAnalyzer'
const MAX_NAME = 120

/** Заголовок по имени проекта и признаку «есть несохранённое». name = null — проекта нет. */
export function composeTitle(name: string | null, dirty: boolean): string {
  if (name === null) return APP_TITLE
  return `${APP_TITLE} — ${name}${dirty ? '*' : ''}`
}

/** Проверка пришедших от интерфейса данных. null — они некорректны. */
export function checkTitleInput(
  name: unknown,
  dirty: unknown
): { name: string | null; dirty: boolean } | null {
  if (typeof dirty !== 'boolean') return null
  if (name === null) return { name: null, dirty }
  if (typeof name !== 'string') return null
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (clean.length === 0 || clean.length > MAX_NAME) return null
  return { name: clean, dirty }
}
