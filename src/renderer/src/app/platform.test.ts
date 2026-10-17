import { describe, expect, it } from 'vitest'
import { formatStatus, platformLabel } from './platform'

describe('platformLabel', () => {
  it('переводит известные платформы', () => {
    expect(platformLabel('win32')).toBe('Windows')
    expect(platformLabel('darwin')).toBe('macOS')
    expect(platformLabel('linux')).toBe('Linux')
  })
  it('для неизвестной возвращает как есть', () => {
    expect(platformLabel('freebsd')).toBe('freebsd')
  })
})

describe('formatStatus', () => {
  it('собирает строку статуса', () => {
    expect(formatStatus({ name: 'FlowAnalyzer', version: '0.1.0', platform: 'win32' })).toBe(
      'FlowAnalyzer 0.1.0 · Windows'
    )
  })
})
