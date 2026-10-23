import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { PITCH_VIEW_IDS } from '../../../../../shared/board/ids'
import { BOARD_H, BOARD_W } from './constants'
import { PITCH_VIEWS, pitchView } from './pitchViews'

describe('виды поля', () => {
  it('логический размер доски 1600×900', () => {
    expect(BOARD_W).toBe(1600)
    expect(BOARD_H).toBe(900)
  })

  it('виды идут в порядке PITCH_VIEW_IDS, у каждого подпись', () => {
    expect(PITCH_VIEWS.map((v) => v.id)).toEqual([...PITCH_VIEW_IDS])
    expect(PITCH_VIEWS.map((v) => v.label)).toEqual([
      'Штрафная спереди',
      'Половина поля',
      'Всё поле сверху'
    ])
  })

  it.each(PITCH_VIEW_IDS)('фон %s рисуется', (id) => {
    const { Background } = pitchView(id)
    const html = renderToStaticMarkup(
      <svg viewBox="0 0 1600 900">
        <Background />
      </svg>
    )
    expect(html).toMatch(/<path|<rect/)
    expect(html.length).toBeGreaterThan(500)
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('Infinity')
  })

  it.each(['box-front', 'half-angle'] as const)(
    'scaleAt (y в долях 0..1) растёт с y для %s и не выходит за 0.2..4',
    (id) => {
      const v = pitchView(id)
      let prev = v.scaleAt(0)
      expect(prev).toBeGreaterThanOrEqual(0.2)
      for (let i = 1; i <= 20; i++) {
        const s = v.scaleAt(i / 20)
        expect(s).toBeGreaterThan(prev)
        expect(s).toBeLessThanOrEqual(4)
        prev = s
      }
      // перспектива заметная: внизу фигура заметно крупнее, чем посередине
      expect(v.scaleAt(1)).toBeGreaterThan(v.scaleAt(0.5) * 1.15)
    }
  )

  it('full-top: постоянный масштаб 0.45', () => {
    const v = pitchView('full-top')
    expect(v.scaleAt(0)).toBe(0.45)
    expect(v.scaleAt(0.5)).toBe(0.45)
    expect(v.scaleAt(1)).toBe(0.45)
  })
})
