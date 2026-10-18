import { describe, expect, it } from 'vitest'
import { STATS_EXPORT_LIMITS, StatsExportSchema, type StatsExport } from '../../shared/statsExport'
import { buildStatsCsv, clock, defaultCsvName, numberCell, protectCell, textCell } from './csv'

const sample = (): StatsExport => ({
  fileStem: 'Матч',
  videoId: null,
  videoDuration: 600,
  tags: [
    {
      name: 'Атака',
      count: 2,
      total: 20,
      avg: 10,
      shareCount: 66.67,
      shareTime: 80,
      first: 5,
      last: 65.5
    }
  ],
  episodes: [
    { tag: 'Атака', start: 5, end: 15 },
    { tag: 'Атака', start: 65.5, end: 75.5, note: 'Угловой; "быстро"\nвторая строка' }
  ]
})

describe('ячейки CSV', () => {
  it('экранирует ; " и переносы строк', () => {
    expect(textCell('простой')).toBe('простой')
    expect(textCell('а;б')).toBe('"а;б"')
    expect(textCell('он сказал "да"')).toBe('"он сказал ""да"""')
    expect(textCell('две\nстроки')).toBe('"две\nстроки"')
    expect(textCell('с\rвозвратом')).toBe('"с\rвозвратом"')
  })

  it('защищает ячейки, похожие на формулы', () => {
    for (const bad of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
      expect(protectCell(bad).startsWith("'")).toBe(true)
    }
    expect(protectCell('нормально = ок')).toBe('нормально = ок')
    expect(textCell('=HYPERLINK("http://x";"y")')).toBe(`"'=HYPERLINK(""http://x"";""y"")"`)
  })

  it('числа с десятичной запятой, время текстом', () => {
    expect(numberCell(12.34)).toBe('12,3')
    expect(numberCell(Number.NaN)).toBe('0,0')
    expect(clock(65.5)).toBe('01:05.5')
    expect(clock(3725.04)).toBe('1:02:05.0')
    expect(clock(-3)).toBe('00:00.0')
  })

  it('имя файла по умолчанию', () => {
    expect(defaultCsvName('Матч: финал?')).toBe('Матч_финал_статистика.csv')
    expect(defaultCsvName(null)).toBe('Проект_статистика.csv')
  })
})

describe('buildStatsCsv', () => {
  const csv = buildStatsCsv(sample())

  it('начинается с BOM, строки через CRLF, два раздела', () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv.endsWith('\r\n')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('Статистика по тегам')
    expect(lines[1]).toBe(
      'Тег;Эпизодов;Время всего, с;Средняя длительность, с;Доля эпизодов, %;Доля времени, %;Первое начало;Последнее начало'
    )
    expect(lines[2]).toBe('Атака;2;20,0;10,0;66,7;80,0;00:05.0;01:05.5')
    expect(lines[3]).toBe('')
    expect(lines[4]).toBe('Эпизоды')
    expect(lines[5]).toBe('№;Тег;Начало;Конец;Длительность, с;Заметка')
    expect(lines[6]).toBe('1;Атака;00:05.0;00:15.0;10,0;')
  })

  it('заметка с ; кавычками и переносом цитируется целиком', () => {
    expect(csv).toContain('2;Атака;01:05.5;01:15.5;10,0;"Угловой; ""быстро""\nвторая строка"')
  })

  it('кириллица сохраняется в UTF-8', () => {
    const bytes = Buffer.from(csv, 'utf8')
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]))
    expect(bytes.toString('utf8')).toContain('Статистика по тегам')
  })

  it('имя тега-формулы защищено', () => {
    const data = sample()
    data.tags[0].name = '=cmd|calc'
    data.episodes[0].tag = '@x'
    const out = buildStatsCsv(data)
    expect(out).toContain("\r\n'=cmd|calc;2;")
    expect(out).toContain(";'@x;")
  })

  it('пустые данные дают заголовки без строк', () => {
    const out = buildStatsCsv({ ...sample(), tags: [], episodes: [] })
    expect(out.split('\r\n').filter(Boolean)).toHaveLength(4)
  })
})

describe('StatsExportSchema', () => {
  it('принимает корректные данные', () => {
    expect(StatsExportSchema.safeParse(sample()).success).toBe(true)
  })

  it('лишние поля отклоняются', () => {
    expect(StatsExportSchema.safeParse({ ...sample(), path: 'C:/x' }).success).toBe(false)
  })

  it('лимиты: число строк и длина текста', () => {
    const base = sample()
    const ep = base.episodes[0]
    const many = (n: number): StatsExport => ({
      ...base,
      episodes: Array.from({ length: n }, () => ep)
    })
    expect(StatsExportSchema.safeParse(many(STATS_EXPORT_LIMITS.maxEpisodes)).success).toBe(true)
    expect(StatsExportSchema.safeParse(many(STATS_EXPORT_LIMITS.maxEpisodes + 1)).success).toBe(
      false
    )
    const long = (s: number): StatsExport => ({
      ...base,
      episodes: [{ ...ep, note: 'я'.repeat(s) }]
    })
    expect(StatsExportSchema.safeParse(long(500)).success).toBe(true)
    expect(StatsExportSchema.safeParse(long(501)).success).toBe(false)
    expect(
      StatsExportSchema.safeParse({ ...base, episodes: [{ ...ep, tag: 'т'.repeat(101) }] }).success
    ).toBe(false)
    expect(StatsExportSchema.safeParse({ ...base, fileStem: 'я'.repeat(201) }).success).toBe(false)
  })

  it('числа: конечные, неотрицательные, конец не раньше начала', () => {
    const base = sample()
    const ep = base.episodes[0]
    const bad = (e: object): boolean =>
      StatsExportSchema.safeParse({ ...base, episodes: [{ ...ep, ...e }] }).success
    expect(bad({ start: -1 })).toBe(false)
    expect(bad({ start: Number.NaN })).toBe(false)
    expect(bad({ end: Number.POSITIVE_INFINITY })).toBe(false)
    expect(bad({ start: 10, end: 5 })).toBe(false)
    expect(
      StatsExportSchema.safeParse({ ...base, tags: [{ ...base.tags[0], shareTime: 101 }] }).success
    ).toBe(false)
    expect(
      StatsExportSchema.safeParse({ ...base, tags: [{ ...base.tags[0], name: '' }] }).success
    ).toBe(false)
  })

  it('не строка в тексте и не массив', () => {
    expect(StatsExportSchema.safeParse(null).success).toBe(false)
    expect(StatsExportSchema.safeParse({ ...sample(), tags: 'x' }).success).toBe(false)
  })
})
