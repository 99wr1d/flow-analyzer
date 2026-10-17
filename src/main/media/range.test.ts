import { describe, expect, it } from 'vitest'
import { parseRange } from './range'

describe('parseRange', () => {
  it('без заголовка отдаёт файл целиком', () => {
    expect(parseRange(null, 1000)).toEqual({ kind: 'full' })
    expect(parseRange(undefined, 1000)).toEqual({ kind: 'full' })
    expect(parseRange('', 1000)).toEqual({ kind: 'full' })
  })
  it('обычный диапазон', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ kind: 'partial', start: 0, end: 99 })
  })
  it('открытый конец', () => {
    expect(parseRange('bytes=100-', 1000)).toEqual({ kind: 'partial', start: 100, end: 999 })
  })
  it('суффикс — последние байты', () => {
    expect(parseRange('bytes=-500', 1000)).toEqual({ kind: 'partial', start: 500, end: 999 })
    expect(parseRange('bytes=-5000', 1000)).toEqual({ kind: 'partial', start: 0, end: 999 })
  })
  it('конец за пределами файла обрезается', () => {
    expect(parseRange('bytes=900-5000', 1000)).toEqual({ kind: 'partial', start: 900, end: 999 })
  })
  it('начало за пределами файла — ошибка', () => {
    expect(parseRange('bytes=1000-', 1000)).toEqual({ kind: 'invalid' })
    expect(parseRange('bytes=2000-2100', 1000)).toEqual({ kind: 'invalid' })
  })
  it('битые диапазоны — ошибка', () => {
    expect(parseRange('bytes=200-100', 1000)).toEqual({ kind: 'invalid' })
    expect(parseRange('bytes=-', 1000)).toEqual({ kind: 'invalid' })
    expect(parseRange('bytes=-0', 1000)).toEqual({ kind: 'invalid' })
    expect(parseRange('bytes=abc-def', 1000)).toEqual({ kind: 'invalid' })
    expect(parseRange('bytes=0-1', 0)).toEqual({ kind: 'invalid' })
  })
  it('чужие единицы и несколько диапазонов игнорируются', () => {
    expect(parseRange('items=0-5', 1000)).toEqual({ kind: 'full' })
    expect(parseRange('bytes=0-5,10-20', 1000)).toEqual({ kind: 'full' })
  })
})
