import { describe, expect, it } from 'vitest'
import { russianMessage } from './boardActions'

describe('сообщения об ошибках доски', () => {
  it('русское сообщение показывается как есть', () => {
    expect(russianMessage('Кадр 3 вне доски')).toBe('Кадр 3 вне доски')
  })
  it('непереведённое (проверка схемы) заменяется общим русским', () => {
    expect(russianMessage('Too big: expected number to be <=1', 'Не получилось')).toBe(
      'Не получилось'
    )
  })
})
