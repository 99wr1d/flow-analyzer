// Сборка CSV для русского Excel: UTF-8 с BOM, разделитель «;», десятичная запятая, CRLF.
import type { StatsExport } from '../../shared/statsExport'
import { sanitizeName } from '../ffmpeg/names'

export const CSV_BOM = '﻿'
const EOL = '\r\n'

/** Ячейка, которую Excel мог бы принять за формулу, получает впереди апостроф (защита от CSV-инъекций). */
export function protectCell(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

/** Текстовая ячейка: защита от формул и кавычки, если внутри «;», кавычка или перенос строки. */
export function textCell(value: string): string {
  const safe = protectCell(value)
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Число с десятичной запятой (Excel в русской локали читает его как число). */
export function numberCell(value: number, digits = 1): string {
  const safe = Number.isFinite(value) ? value : 0
  return safe.toFixed(digits).replace('.', ',')
}

/** Время «ММ:СС.д» (или «Ч:ММ:СС.д» от часа). Текст, а не число, чтобы Excel не превращал его в дату. */
export function clock(seconds: number): string {
  const tenths = Math.floor(Math.max(0, seconds) * 10 + 1e-6)
  const total = Math.floor(tenths / 10)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  const base = h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
  return `${base}.${tenths % 10}`
}

const row = (cells: string[]): string => cells.join(';')

export const CSV_HEADERS = {
  tagsTitle: 'Статистика по тегам',
  tags: [
    'Тег',
    'Эпизодов',
    'Время всего, с',
    'Средняя длительность, с',
    'Доля эпизодов, %',
    'Доля времени, %',
    'Первое начало',
    'Последнее начало'
  ],
  episodesTitle: 'Эпизоды',
  episodes: ['№', 'Тег', 'Начало', 'Конец', 'Длительность, с', 'Заметка']
} as const

/** Один файл: заголовок раздела, строка столбцов, строки; между разделами пустая строка. */
export function buildStatsCsv(data: StatsExport): string {
  const lines: string[] = []
  lines.push(textCell(CSV_HEADERS.tagsTitle))
  lines.push(row(CSV_HEADERS.tags.map(textCell)))
  for (const t of data.tags) {
    lines.push(
      row([
        textCell(t.name),
        String(t.count),
        numberCell(t.total),
        numberCell(t.avg),
        numberCell(t.shareCount),
        numberCell(t.shareTime),
        textCell(clock(t.first)),
        textCell(clock(t.last))
      ])
    )
  }
  lines.push('')
  lines.push(textCell(CSV_HEADERS.episodesTitle))
  lines.push(row(CSV_HEADERS.episodes.map(textCell)))
  data.episodes.forEach((e, i) => {
    lines.push(
      row([
        String(i + 1),
        textCell(e.tag),
        textCell(clock(e.start)),
        textCell(clock(e.end)),
        numberCell(e.end - e.start),
        textCell(e.note ?? '')
      ])
    )
  })
  return CSV_BOM + lines.join(EOL) + EOL
}

/** Имя файла по умолчанию: «<проект>_статистика.csv». */
export function defaultCsvName(stem: string | null): string {
  return `${sanitizeName(stem ?? '', 'Проект')}_статистика.csv`
}
