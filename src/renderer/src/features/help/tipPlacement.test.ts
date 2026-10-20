import { describe, expect, it } from 'vitest'
import { placeTip } from './tipPlacement'

const view = { width: 1000, height: 700 }
const card = { width: 300, height: 160 }

describe('размещение подсказки', () => {
  it('по возможности — под элементом, по центру', () => {
    const p = placeTip({ left: 400, top: 20, width: 100, height: 30 }, card, view)
    expect(p.side).toBe('bottom')
    expect(p.left).toBe(300)
    expect(p.top).toBe(64)
    expect(p.arrow).toBe(150)
  })

  it('внизу нет места — над элементом', () => {
    const p = placeTip({ left: 400, top: 640, width: 100, height: 40 }, card, view)
    expect(p.side).toBe('top')
    expect(p.top).toBe(640 - 14 - 160)
  })

  it('ни сверху, ни снизу — сбоку', () => {
    const tall = { width: 300, height: 600 }
    const p = placeTip({ left: 50, top: 300, width: 40, height: 40 }, tall, view)
    expect(p.side).toBe('right')
    expect(p.left).toBe(50 + 40 + 14)
  })

  it('не выходит за края окна, стрелка остаётся на элементе', () => {
    const p = placeTip({ left: 960, top: 10, width: 30, height: 30 }, card, view)
    expect(p.left + card.width).toBeLessThanOrEqual(view.width - 12)
    expect(p.arrow).toBeGreaterThan(16)
    expect(p.arrow).toBeLessThanOrEqual(card.width - 16)
    expect(p.left + p.arrow).toBeGreaterThan(960)
    expect(p.left + p.arrow).toBeLessThanOrEqual(990)
  })

  it('совсем тесно — всё равно внутри окна', () => {
    const p = placeTip({ left: 10, top: 10, width: 980, height: 680 }, card, view)
    expect(p.left).toBeGreaterThanOrEqual(12)
    expect(p.top).toBeGreaterThanOrEqual(12)
    expect(p.top + card.height).toBeLessThanOrEqual(view.height - 12)
  })
})
