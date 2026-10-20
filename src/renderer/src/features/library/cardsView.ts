// Что показать на стартовом экране: вкладки, поиск, сортировка, подписи. Чистые функции.
import type { LibraryCard } from '../../../../shared/library'
import { PROJECT_TYPES } from '../../../../shared/project'
import type { LibrarySort, LibraryTab } from './libraryStore'

/** Сколько карточек в каждой вкладке (поиск не учитывается: счётчики показывают состав библиотеки). */
export function countByTab(cards: readonly LibraryCard[]): Record<LibraryTab, number> {
  const counts = { all: cards.length } as Record<LibraryTab, number>
  for (const type of PROJECT_TYPES) counts[type] = 0
  for (const card of cards) counts[card.type] += 1
  return counts
}

const norm = (text: string): string => text.toLowerCase().replace(/ё/g, 'е')

/** Поиск по названию проекта и имени видео без учёта регистра и «ё». */
export function matchesQuery(card: LibraryCard, query: string): boolean {
  const q = norm(query.trim())
  if (q === '') return true
  return norm(card.title).includes(q) || norm(card.videoFileName ?? '').includes(q)
}

export function filterCards(
  cards: readonly LibraryCard[],
  tab: LibraryTab,
  query: string
): LibraryCard[] {
  return cards.filter((c) => (tab === 'all' || c.type === tab) && matchesQuery(c, query))
}

/** Момент, по которому карточка считается «изменённой»: файл проекта, иначе последнее открытие, иначе добавление. */
export function modifiedKey(card: LibraryCard): string {
  return card.updatedAt ?? card.lastOpenedAt ?? card.addedAt
}

export function sortCards(cards: readonly LibraryCard[], sort: LibrarySort): LibraryCard[] {
  const byTitle = (a: LibraryCard, b: LibraryCard): number =>
    a.title.localeCompare(b.title, 'ru', { sensitivity: 'base', numeric: true })
  const list = [...cards]
  if (sort === 'title') return list.sort(byTitle)
  if (sort === 'date') {
    // Новые матчи выше; проекты без даты — в конце по названию.
    return list.sort((a, b) => {
      if (a.date && b.date) return b.date.localeCompare(a.date) || byTitle(a, b)
      if (a.date) return -1
      if (b.date) return 1
      return byTitle(a, b)
    })
  }
  return list.sort((a, b) => modifiedKey(b).localeCompare(modifiedKey(a)) || byTitle(a, b))
}

export function visibleCards(
  cards: readonly LibraryCard[],
  tab: LibraryTab,
  query: string,
  sort: LibrarySort
): LibraryCard[] {
  return sortCards(filterCards(cards, tab, query), sort)
}

/** «1 эпизод», «2 эпизода», «5 эпизодов». */
export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return `${n} ${few}`
  return `${n} ${many}`
}

export const episodesText = (n: number): string => plural(n, 'эпизод', 'эпизода', 'эпизодов')
export const drawingsText = (n: number): string => plural(n, 'рисунок', 'рисунка', 'рисунков')

/** «2 ч назад». now передаётся для проверки тестами. */
export function agoText(iso: string | null, now: number = Date.now()): string {
  if (!iso) return ''
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return ''
  const sec = Math.max(0, Math.round((now - time) / 1000))
  if (sec < 60) return 'только что'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} мин назад`
  const hours = Math.floor(min / 60)
  if (hours < 24) return `${hours} ч назад`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} дн. назад`
  const date = new Date(time)
  return date.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === new Date(now).getFullYear() ? undefined : 'numeric'
  })
}

const MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря'
]

/** «2026-05-17» → «17 мая 2026». */
export function dateText(date: string | undefined): string {
  const m = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null
  if (!m) return ''
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

/** Сегодняшняя дата ГГГГ-ММ-ДД по местному времени. */
export function todayIso(now: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** «1:32:10» / «45:03»; секунды отбрасываются, как в плеере (290.8 с → «4:50»). */
export function durationText(seconds: number | undefined): string {
  if (seconds === undefined || !(seconds > 0)) return ''
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
