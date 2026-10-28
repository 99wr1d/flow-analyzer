// Граф ffmpeg с рисунками «под игроками»: структура сценария (сам ffmpeg проверяет under.test.ts).
import { describe, expect, it } from 'vitest'
import type { RangePlan } from '../../shared/exportOverlays'
import type { GrassKeyValues } from '../../shared/grassKey'
import { loupeGeometry } from '../../shared/tools/loupe'
import { planDrawn } from './drawGraph'
import { grassMaskFilter, grassMaskLines } from './grassFilter'

const FPS = 25
const GRASS: GrassKeyValues = { color: '#2a7d3e', similarity: 0.07, blend: 0.05 }
const R = (start: number, end: number, freezes: RangePlan['freezes'] = []): RangePlan => ({
  start,
  end,
  freezes
})
const freeze = (frame: number, key: string): RangePlan['freezes'][number] => ({
  time: (frame + 0.5) / FPS,
  frame,
  seconds: 1,
  key
})
const both = new Map([['0-1', { over: true, under: true }]])
const underOnly = new Map([['0', { over: false, under: true }]])

describe('grassMaskFilter / grassMaskLines', () => {
  it('граф: кадр → RGB → YUV полного диапазона → chromakey и порог яркости → наибольшая прозрачность → маска «газон = белое»', () => {
    const f = grassMaskFilter(GRASS)
    // Порог яркости: Y цвета #2a7d3e (93) + LUMA_GAP (45).
    expect(f).toBe(
      'format=rgb24,scale=out_range=pc,format=yuva444p,split[ka][kb];' +
        '[ka]chromakey=color=0x2a7d3e:similarity=0.07:blend=0.05,alphaextract[kc];' +
        "[kb]extractplanes=y,lut=c0='clip((val-138)*255/20,0,255)'[kl];" +
        '[kc][kl]blend=all_mode=lighten,negate'
    )
    // Метки внутри графа — с приставкой: несколько масок в одном графе не путаются.
    expect(grassMaskFilter(GRASS, 'g1k')).toContain('[g1ka]')
  })

  it('строки: маска превращается в yuv420p, у которой все три плоскости — маска', () => {
    const lines = grassMaskLines({ id: 'g', input: '[in]', output: '[out]', key: GRASS })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/^\[in\]format=rgb24,.*,format=gray,split=3\[gm0\]\[gm1\]\[gm2\]$/)
    expect(lines[1]).toBe('[gm0][gm1][gm2]mergeplanes=0x001020:yuv444p,format=yuv420p[out]')
  })
})

describe('planDrawn со слоем «под игроками»', () => {
  it('без слоёв граф такой же, как раньше (нет ни маски, ни слияния)', () => {
    const plain = planDrawn({
      ranges: [R(1, 3)],
      segments: [{ start: 1, end: 2, key: '0-1' }],
      fps: FPS,
      audio: null
    })
    const withMap = planDrawn({
      ranges: [R(1, 3)],
      segments: [{ start: 1, end: 2, key: '0-1' }],
      fps: FPS,
      audio: null,
      layers: new Map([['0-1', { over: true, under: false }]])
    })
    expect(withMap.script).toBe(plain.script)
    expect(plain.script).not.toContain('maskedmerge')
    expect(plain.inputs).toEqual([{ key: '0-1', layer: 'over' }])
  })

  it('«под игроками»: копия кадра + PNG, маска из кадра, maskedmerge; затем PNG «поверх всего»', () => {
    const g = planDrawn({
      ranges: [R(1, 3)],
      segments: [{ start: 1, end: 2, key: '0-1' }],
      fps: FPS,
      audio: null,
      layers: both,
      grass: GRASS
    })
    // Входы: сначала «поверх», затем «под» (PNG под номерами 1 и 2).
    expect(g.inputs).toEqual([
      { key: '0-1', layer: 'over' },
      { key: '0-1', layer: 'under' }
    ])
    expect(g.inputKeys).toEqual(['0-1', '0-1'])
    const s = g.script
    expect(s).toContain('[src]split=3[gb][gd][gk]')
    expect(s).toContain('chromakey=color=0x2a7d3e:similarity=0.07:blend=0.05')
    expect(s).toContain('[gb][gx0][gm]maskedmerge[gr]')
    // Слияние идёт раньше наложения PNG «поверх всего», а над кадром после слияния нет второго split'а.
    expect(s.indexOf('maskedmerge')).toBeLessThan(s.indexOf('[gr][pc0]overlay'))
    // Наложение «под»-картинки идёт на копию кадра и включается теми же окнами.
    expect(s).toMatch(
      /\[gd\]\[pc1\]overlay=x=0:y=0:eof_action=repeat:enable='gte\(t,[-\d.]+\)\*lt\(t,[-\d.]+\)'\[gx0\]/
    )
    expect(s.match(/\[gr\]\[pc0\]overlay/g)).toHaveLength(1)
  })

  it('только «под игроками» (подписей нет): наложения «поверх» нет вообще', () => {
    const g = planDrawn({
      ranges: [R(1, 3)],
      segments: [{ start: 1, end: 2, key: '0' }],
      fps: FPS,
      audio: null,
      layers: underOnly,
      grass: GRASS
    })
    expect(g.inputs).toEqual([{ key: '0', layer: 'under' }])
    expect(g.script).toContain('maskedmerge')
    expect(g.script.match(/overlay=/g)).toHaveLength(1)
  })

  it('без настроек ключа слой «под игроками» не строится: понятная ошибка', () => {
    expect(() =>
      planDrawn({
        ranges: [R(1, 3)],
        segments: [{ start: 1, end: 2, key: '0' }],
        fps: FPS,
        audio: null,
        layers: underOnly
      })
    ).toThrow(/газон/)
  })

  it('лупа идёт после слияния: линза увеличивает уже готовую картинку', () => {
    const g = planDrawn({
      ranges: [R(1, 3)],
      segments: [{ start: 1, end: 2, key: '0-1' }],
      fps: FPS,
      audio: null,
      layers: both,
      grass: GRASS,
      loupes: [
        {
          index: 1,
          geometry: loupeGeometry(
            { pos: { x: 0.8, y: 0.3 }, src: { x: 0.5, y: 0.5 }, radius: 0.12, zoom: 2 },
            640,
            360
          ),
          timing: { mode: 'range', start: 1, duration: 1 }
        }
      ]
    })
    expect(g.script.indexOf('maskedmerge')).toBeLessThan(g.script.indexOf('[lm0a]'))
  })

  it('стоп-кадр: те же шаги над одним кадром (split, маска, overlay «под», maskedmerge), потом «поверх»', () => {
    const g = planDrawn({
      ranges: [R(1, 3, [freeze(50, '0-1')])],
      segments: [],
      fps: FPS,
      audio: null,
      layers: both,
      grass: GRASS
    })
    const s = g.script
    expect(s).toContain('[fz0]split=3[fgb0][fgd0][fgk0]')
    expect(s).toContain('[fgd0][pf1_0]overlay=x=0:y=0:eof_action=repeat[fgx0]')
    expect(s).toContain('[fgb0][fgx0][fgm0]maskedmerge[fgr0]')
    expect(s).toContain('[fgr0][pf0_0]overlay=x=0:y=0:eof_action=repeat,tpad=stop_mode=clone')
    // На обычных кусках этого отрезка слияния нет — рисунок только на стоп-кадре.
    expect(s.match(/maskedmerge/g)).toHaveLength(1)
  })

  it('два стоп-кадра и сегмент: у каждого своя маска, метки не пересекаются', () => {
    const g = planDrawn({
      ranges: [R(1, 4, [freeze(30, '0-1'), freeze(60, '0-1')])],
      segments: [{ start: 1, end: 2, key: '0-1' }],
      fps: FPS,
      audio: null,
      layers: both,
      grass: GRASS
    })
    expect(g.script.match(/maskedmerge/g)).toHaveLength(3)
    const labels = [...g.script.matchAll(/maskedmerge\[(\w+)\]/g)].map((m) => m[1])
    expect(new Set(labels).size).toBe(labels.length)
  })
})
