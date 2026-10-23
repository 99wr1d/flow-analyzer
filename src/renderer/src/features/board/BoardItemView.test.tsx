import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { EQUIPMENT_IDS } from '../../../../shared/board/ids'
import type { BoardElement } from '../../../../shared/board/schema'
import type { ResolvedItem } from '../../../../shared/board/resolve'
import { BoardItemView, FIGURE_BASE_H, itemBox } from './BoardItemView'
import { DEFAULT_EQUIP_COLOR, EQUIPMENT_LABEL, EquipmentArt } from './art/equipment'

const ID = '11111111-1111-4111-8111-111111111111'
const item = (el: BoardElement, opacity = 1): ResolvedItem => ({ id: ID, el, opacity })
const render = (it: ResolvedItem, selected = false): string =>
  renderToStaticMarkup(
    <svg>
      <BoardItemView item={it} selected={selected} />
    </svg>
  )

const figure = (over: Record<string, unknown> = {}): BoardElement =>
  ({
    kind: 'figure',
    set: 'player',
    pose: 'stand',
    facing: 'front',
    pos: { x: 0.5, y: 0.6 },
    scale: 1,
    rotation: 0,
    color: '#f5c400',
    ...over
  }) as BoardElement

const style = { color: '#ff3366', width: 0.006, dash: 'solid' as const }
const ELEMENTS: Record<string, BoardElement> = {
  figure: figure(),
  equip: {
    kind: 'equip',
    item: 'ball',
    pos: { x: 0.3, y: 0.5 },
    scale: 1,
    rotation: 0,
    color: '#ffffff'
  },
  token: { kind: 'token', pos: { x: 0.3, y: 0.5 }, scale: 1, color: '#2266ff', label: 'A' },
  number: { kind: 'number', pos: { x: 0.3, y: 0.5 }, scale: 1, color: '#2266ff', n: 7 },
  wavy: {
    kind: 'wavy',
    p1: { x: 0.2, y: 0.5 },
    p2: { x: 0.6, y: 0.4 },
    color: '#ff3366',
    width: 0.006
  },
  hatch: {
    kind: 'hatch',
    shape: 'rect',
    p1: { x: 0.2, y: 0.2 },
    p2: { x: 0.5, y: 0.5 },
    color: '#00aa55'
  },
  shape: {
    kind: 'shape',
    ann: {
      id: ID,
      space: 'screen',
      type: 'arrow',
      p1: { x: 0.2, y: 0.5 },
      p2: { x: 0.6, y: 0.4 },
      style
    }
  } as BoardElement
}

describe('BoardItemView', () => {
  it.each(Object.keys(ELEMENTS))('вид %s несёт data-kind и id', (kind) => {
    const html = render(item(ELEMENTS[kind]))
    expect(html).toContain(`data-kind="${kind}"`)
    expect(html).toContain(`data-board-item="${ID}"`)
  })

  it('прозрачность берётся из разрешённого элемента', () => {
    expect(render(item(ELEMENTS.token, 0.4))).toContain('opacity="0.4"')
  })

  it('фигура несёт data-pose и data-facing', () => {
    const html = render(item(figure({ pose: 'run', facing: 'back-left' })))
    expect(html).toContain('data-pose="run"')
    expect(html).toContain('data-facing="back-left"')
  })

  it('масштаб 2 даёт вдвое больший scale(', () => {
    const k = (s: number): number => {
      const m = /scale\(([\d.]+)\)/.exec(render(item(figure({ scale: s }))))
      return Number(m?.[1])
    }
    expect(k(2)).toBeCloseTo(2 * k(1), 5)
    expect(k(1)).toBeCloseTo((FIGURE_BASE_H * 900) / 200, 5)
  })

  it('shape со стрелкой рисуется через ShapeView', () => {
    const html = render(item(ELEMENTS.shape))
    expect(html).toMatch(/<line|<path|<polygon/)
    expect(html.toLowerCase()).toContain('#ff3366')
  })

  it('hatch содержит pattern и цвет', () => {
    const html = render(item(ELEMENTS.hatch))
    expect(html).toContain('<pattern')
    expect(html).toContain('#00aa55')
  })

  it.each(['rect', 'tri', 'ellipse'])('hatch %s рисуется', (shape) => {
    const html = render(item({ ...ELEMENTS.hatch, shape } as BoardElement))
    expect(html).toContain('url(#')
  })

  it('wavy рисует кривую и наконечник', () => {
    const html = render(item(ELEMENTS.wavy))
    expect(html).toContain('<path')
    expect(html).toContain('#ff3366')
  })

  it('token и number показывают подпись', () => {
    expect(render(item(ELEMENTS.token))).toContain('>A<')
    expect(render(item(ELEMENTS.number))).toContain('>7<')
  })

  it('выбранный элемент получает рамку', () => {
    expect(render(item(ELEMENTS.token), true)).toContain('data-selected="true"')
    expect(render(item(ELEMENTS.token), false)).not.toContain('data-selected')
  })
})

describe('инвентарь', () => {
  it.each(EQUIPMENT_IDS)('%s: подпись, цвет и рисунок', (id) => {
    expect(EQUIPMENT_LABEL[id].length).toBeGreaterThan(0)
    expect(DEFAULT_EQUIP_COLOR[id]).toMatch(/^#[0-9a-f]{6}$/)
    const html = renderToStaticMarkup(
      <svg>
        <EquipmentArt item={id} color={DEFAULT_EQUIP_COLOR[id]} />
      </svg>
    )
    expect(html).toMatch(/<path|<ellipse|<circle/)
  })

  it('цвета по умолчанию и подписи по заданию', () => {
    expect(DEFAULT_EQUIP_COLOR).toEqual({
      ball: '#ffffff',
      disc: '#ff7a00',
      cone: '#ff7a00',
      mannequin: '#e8e8e8',
      'mini-goal': '#ffffff'
    })
    expect(EQUIPMENT_LABEL.ball).toBe('Мяч')
  })

  it('цвет фишки применяется', () => {
    const html = renderToStaticMarkup(
      <svg>
        <EquipmentArt item="disc" color="#12ab34" />
      </svg>
    )
    expect(html.toLowerCase()).toContain('#12ab34')
  })
})

describe('itemBox', () => {
  it('низ рамки стоящей фигуры ≈ pos.y, рост ≈ 0.3 высоты', () => {
    const b = itemBox(item(figure()))
    expect(b.y + b.h).toBeCloseTo(0.6, 2)
    expect(b.h).toBeCloseTo(0.3, 2)
    expect(b.x + b.w / 2).toBeCloseTo(0.5, 3)
  })

  it('вратарь в прыжке — широкая низкая рамка', () => {
    const b = itemBox(item(figure({ set: 'gk', pose: 'dive-low' })))
    expect(b.w * 1600).toBeGreaterThan(b.h * 900 * 2)
    expect(b.y + b.h).toBeCloseTo(0.6, 2)
  })

  it('масштаб увеличивает рамку', () => {
    expect(itemBox(item(figure({ scale: 2 }))).h).toBeCloseTo(2 * itemBox(item(figure())).h, 5)
  })

  it('wavy, hatch, token, shape имеют рамку внутри разумных границ', () => {
    for (const k of ['equip', 'token', 'number', 'wavy', 'hatch', 'shape']) {
      const b = itemBox(item(ELEMENTS[k]))
      expect(b.w).toBeGreaterThan(0)
      expect(b.h).toBeGreaterThan(0)
    }
  })
})
