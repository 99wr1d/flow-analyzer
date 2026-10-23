/** Разбор текста файла доски: схема плюс проверка, что каждое состояние даёт допустимый элемент. */
import { elementAt } from './resolve'
import { BOARD_FORMAT, BOARD_VERSION, BoardElementSchema, BoardSchema, type Board } from './schema'

export const BOARD_DAMAGED = 'Файл доски повреждён'

export type ParseBoardResult =
  | { ok: true; board: Board }
  | {
      ok: false
      error: 'json' | 'format' | 'newer' | 'invalid'
      /** Текст для пользователя (по-русски). */
      message: string
      /** Подробности для журнала (может быть не по-русски). */
      detail?: string
    }

/** Элемент в каждом кадре состояния: схема не видит содержимое geom, поэтому проверяем результат. */
function stateProblem(board: Board): string | null {
  for (const item of board.items) {
    for (const s of item.states) {
      const r = BoardElementSchema.safeParse(elementAt(item, s.frame))
      if (!r.success) {
        const issue = r.error.issues[0]
        return `Состояние кадра ${s.frame}: ${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`
      }
    }
  }
  return null
}

export function parseBoardText(text: string): ParseBoardResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'json', message: 'Файл не является корректным JSON' }
  }
  const head = (raw && typeof raw === 'object' ? raw : {}) as {
    format?: unknown
    version?: unknown
  }
  if (head.format !== BOARD_FORMAT)
    return { ok: false, error: 'format', message: 'Это не файл доски FlowAnalyzer' }
  if (typeof head.version === 'number' && head.version > BOARD_VERSION)
    return { ok: false, error: 'newer', message: 'Доска создана в более новой версии программы' }
  const r = BoardSchema.safeParse(raw)
  if (!r.success) {
    const issue = r.error.issues[0]
    return {
      ok: false,
      error: 'invalid',
      message: BOARD_DAMAGED,
      detail: `${issue?.path.join('.') ?? ''} ${issue?.message ?? ''}`
    }
  }
  const problem = stateProblem(r.data)
  if (problem) return { ok: false, error: 'invalid', message: BOARD_DAMAGED, detail: problem }
  return { ok: true, board: r.data }
}
