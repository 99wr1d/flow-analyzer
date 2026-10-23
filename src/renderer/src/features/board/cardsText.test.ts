import { describe, expect, it } from 'vitest'
import type { BoardCard } from '../../../../shared/board/ipc'
import { boardCardSummary, framesText } from './cardsText'
import { leavePlan, needsCloseQuestion } from './leave'

const card = (over: Partial<BoardCard> = {}): BoardCard => ({
  path: 'a.flowboard',
  title: 'Угловой',
  updatedAt: '2026-10-23T10:00:00.000Z',
  frames: 3,
  thumb: null,
  status: 'ok',
  ...over
})

describe('framesText', () => {
  it('склоняет «кадр»', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111].map(framesText)).toEqual([
      '1 кадр',
      '2 кадра',
      '5 кадров',
      '11 кадров',
      '12 кадров',
      '21 кадр',
      '22 кадра',
      '25 кадров',
      '111 кадров'
    ])
  })
})

describe('boardCardSummary', () => {
  const now = Date.parse('2026-10-23T12:00:00.000Z')
  it('кадры и давность', () => {
    expect(boardCardSummary(card(), now)).toEqual({ frames: '3 кадра', when: 'изменён 2 ч назад' })
  })
  it('без даты', () => {
    expect(boardCardSummary(card({ updatedAt: null }), now).when).toBe('ещё не сохранялся')
  })
  it('с ошибкой подписей нет', () => {
    expect(boardCardSummary(card({ status: 'error', error: 'x' }), now)).toEqual({
      frames: '',
      when: ''
    })
  })
})

describe('leavePlan', () => {
  it('вне доски вопросов нет', () => {
    expect(needsCloseQuestion(leavePlan({ onBoard: false, dirty: true, videoRunning: true }))).toBe(
      false
    )
  })
  it('чистая доска без видео — без вопросов', () => {
    expect(
      needsCloseQuestion(leavePlan({ onBoard: true, dirty: false, videoRunning: false }))
    ).toBe(false)
  })
  it('изменения — спросить про сохранение', () => {
    expect(leavePlan({ onBoard: true, dirty: true, videoRunning: false })).toEqual({
      askStopVideo: false,
      askSave: true
    })
  })
  it('идёт видео — спросить про остановку', () => {
    expect(leavePlan({ onBoard: true, dirty: false, videoRunning: true }).askStopVideo).toBe(true)
  })
})
