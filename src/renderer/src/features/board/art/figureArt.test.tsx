import { describe, expect, it } from 'vitest'
import type { JSX } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FACINGS, FIGURE_POSES, FIGURE_SETS } from '../../../../../shared/board/ids'
import { FIGURE_ART_HEIGHT, FigureArt, poseLabel } from './figureArt'
import { DEFAULT_COLOR, kitFor } from './figures/kit'

const markup = (el: JSX.Element): string => renderToStaticMarkup(<svg>{el}</svg>)

const luminance = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)
}

describe('рисунки фигур', () => {
  it('рост рисунка — 200', () => {
    expect(FIGURE_ART_HEIGHT).toBe(200)
  })

  for (const set of FIGURE_SETS) {
    for (const pose of FIGURE_POSES[set]) {
      it.each(FACINGS)(`${set}/${pose}/%s рисуется`, (facing) => {
        const html = markup(
          <FigureArt set={set} pose={pose} facing={facing} color={DEFAULT_COLOR[set]} />
        )
        expect(html).toMatch(/<path|<ellipse/)
        expect(html.length).toBeGreaterThan(300)
      })

      it(`${set}/${pose}: «влево» — зеркало «вправо»`, () => {
        const left = markup(<FigureArt set={set} pose={pose} facing="left" color="#f5c400" />)
        const right = markup(<FigureArt set={set} pose={pose} facing="right" color="#f5c400" />)
        expect(left).toContain('scale(-1 1)')
        expect(right).not.toContain('scale(-1 1)')
      })

      it(`${set}/${pose}: лицом и спиной различаются`, () => {
        const front = markup(<FigureArt set={set} pose={pose} facing="front" color="#f5c400" />)
        const back = markup(<FigureArt set={set} pose={pose} facing="back" color="#f5c400" />)
        expect(front).not.toBe(back)
      })
    }
  }

  it('неизвестная поза не падает и рисует основную', () => {
    const html = markup(<FigureArt set="gk" pose="nope" facing="front" color="#f5c400" />)
    const set = markup(<FigureArt set="gk" pose="set" facing="front" color="#f5c400" />)
    expect(html).toBe(set)
    expect(() =>
      markup(<FigureArt set="coach" pose="nope" facing="back-left" color="#2a62d9" />)
    ).not.toThrow()
  })

  it('цвет формы меняет рисунок', () => {
    const a = markup(<FigureArt set="player" pose="run" facing="front" color="#d9342b" />)
    const b = markup(<FigureArt set="player" pose="run" facing="front" color="#2a62d9" />)
    expect(a).not.toBe(b)
  })

  it('подписи поз', () => {
    expect(FIGURE_POSES.gk.map((p) => poseLabel('gk', p))).toEqual([
      'стойка',
      'шаг',
      'низкий бросок',
      'высокий бросок',
      'высокий мяч',
      'выход в ноги'
    ])
    expect(FIGURE_POSES.player.map((p) => poseLabel('player', p))).toEqual(['стоит', 'бег'])
    expect(FIGURE_POSES.coach.map((p) => poseLabel('coach', p))).toEqual([
      'с мячом',
      'бросок рукой'
    ])
  })
})

describe('форма', () => {
  it('цвета по умолчанию', () => {
    expect(DEFAULT_COLOR).toEqual({ gk: '#f5c400', player: '#d9342b', coach: '#2a62d9' })
  })

  it('тень формы темнее, блик светлее', () => {
    const k = kitFor('gk', '#f5c400')
    expect(k.shirt).toBe('#f5c400')
    expect(luminance(k.shirtShade)).toBeLessThan(luminance(k.shirt))
    expect(luminance(k.shirtLight)).toBeGreaterThan(luminance(k.shirt))
  })

  it('вратарь: тёмные шорты, гетры цвета формы, белые перчатки', () => {
    const k = kitFor('gk', '#f5c400')
    expect(luminance(k.shorts)).toBeLessThan(80)
    expect(k.socks).toBe('#f5c400')
    expect(luminance(k.gloves ?? '#000000')).toBeGreaterThan(230)
  })

  it('игрок: белые шорты, гетры цвета формы; тренер: тёмные брюки, без перчаток', () => {
    const p = kitFor('player', '#d9342b')
    expect(luminance(p.shorts)).toBeGreaterThan(230)
    expect(p.socks).toBe('#d9342b')
    expect(p.gloves).toBeUndefined()
    const c = kitFor('coach', '#2a62d9')
    expect(luminance(c.shorts)).toBeLessThan(80)
    expect(c.gloves).toBeUndefined()
  })
})
