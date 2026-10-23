// Тексты карточек досок на начальном экране: «N кадров» и «изменена …».
import type { BoardCard } from '../../../../shared/board/ipc'
import { ru } from '../../i18n/ru'
import { agoText, plural } from '../library/cardsView'

/** «1 кадр», «2 кадра», «5 кадров». */
export const framesText = (n: number): string => plural(n, 'кадр', 'кадра', 'кадров')

/** Подпись под названием: число кадров и когда изменена; у карточки с ошибкой подписей нет. */
export function boardCardSummary(card: BoardCard, now: number): { frames: string; when: string } {
  if (card.status !== 'ok') return { frames: '', when: '' }
  const ago = agoText(card.updatedAt, now)
  return {
    frames: framesText(card.frames),
    when: ago ? ru.start.modified(ago) : ru.start.neverModified
  }
}
