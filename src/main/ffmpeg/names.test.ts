import { describe, expect, it } from 'vitest'
import { clipStem, compilationDefaultName, sanitizeName, timeStamp, uniqueFileName } from './names'

describe('sanitizeName', () => {
  it('сохраняет кириллицу и заменяет пробелы на подчёркивания', () => {
    expect(sanitizeName('Угловой удар')).toBe('Угловой_удар')
    expect(sanitizeName('Гол')).toBe('Гол')
  })
  it('убирает запрещённые символы Windows и управляющие символы', () => {
    expect(sanitizeName('a<b>c:d"e/f\\g|h?i*j')).toBe('abcdefghij')
    expect(sanitizeName('до\u0000\u0007\u001fпосле‮')).toBe('допосле')
  })
  it('убирает точки и пробелы по краям', () => {
    expect(sanitizeName('  ..Гол..  ')).toBe('Гол')
  })
  it('обходит зарезервированные имена', () => {
    expect(sanitizeName('CON')).toBe('_CON')
    expect(sanitizeName('nul')).toBe('_nul')
    expect(sanitizeName('COM1')).toBe('_COM1')
    expect(sanitizeName('lpt9')).toBe('_lpt9')
    expect(sanitizeName('CONSOLE')).toBe('CONSOLE')
  })
  it('ограничивает длину', () => {
    const long = sanitizeName('я'.repeat(500))
    expect(long.length).toBeLessThanOrEqual(100)
    expect(long.length).toBeGreaterThan(50)
  })
  it('пустое имя заменяется запасным', () => {
    expect(sanitizeName('???')).toBe('клип')
    expect(sanitizeName('', 'видео')).toBe('видео')
  })
})

describe('имена клипов', () => {
  it('timeStamp: минуты не обрезаются до 59', () => {
    expect(timeStamp(0)).toBe('00-00')
    expect(timeStamp(83.9)).toBe('01-23')
    expect(timeStamp(87 * 60 + 5)).toBe('87-05')
    expect(timeStamp(-3)).toBe('00-00')
  })
  it('clipStem: NNN_Тег_ММ-СС', () => {
    expect(clipStem(1, 'Гол', 83)).toBe('001_Гол_01-23')
    expect(clipStem(12, 'Угловой удар', 5)).toBe('012_Угловой_удар_00-05')
    expect(clipStem(3, 'a/b:c', 0)).toBe('003_abc_00-00')
    expect(clipStem(4, '', 10)).toBe('004_эпизод_00-10')
  })
  it('подборка: имя по умолчанию', () => {
    expect(compilationDefaultName('Матч 1 тур', 'video')).toBe('Матч_1_тур_подборка.mp4')
    expect(compilationDefaultName(null, 'game 2')).toBe('game_2_подборка.mp4')
    expect(compilationDefaultName('???', 'game')).toBe('game_подборка.mp4')
  })
})

describe('uniqueFileName', () => {
  it('свободное имя остаётся как есть', () => {
    expect(uniqueFileName('001_Гол_00-05', 'mp4', () => false)).toBe('001_Гол_00-05.mp4')
  })
  it('занятое получает (2), (3)…', () => {
    const taken = new Set(['a.mp4', 'a (2).mp4'])
    expect(uniqueFileName('a', 'mp4', (n) => taken.has(n))).toBe('a (3).mp4')
  })
  it('проверка может игнорировать регистр (Windows)', () => {
    const taken = new Set(['a.mp4'])
    expect(uniqueFileName('A', 'mp4', (n) => taken.has(n.toLowerCase()))).toBe('A (2).mp4')
  })
})
