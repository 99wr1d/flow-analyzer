import { describe, expect, it } from 'vitest'
import type { RangePlan } from '../../shared/exportOverlays'
import { buildDrawnArgs } from './args'
import { framesInWindow, planDrawn, splitRange } from './drawGraph'
const FPS = 25

const freeze = (frame: number, seconds = 1, key = '0'): RangePlan['freezes'][number] => ({
  time: (frame + 0.5) / FPS,
  frame,
  seconds,
  key
})
const R = (start: number, end: number, freezes: RangePlan['freezes'] = []): RangePlan => ({
  start,
  end,
  freezes
})

describe('splitRange: куски отрезка и стоп-кадры', () => {
  it('без стоп-кадров — один кусок', () => {
    const pieces = splitRange(R(1, 3), FPS)
    expect(pieces).toHaveLength(1)
    expect(pieces[0]).toMatchObject({ kind: 'cut', start: 1, end: 3 })
  })

  it('стоп-кадр в середине: до, стоп-кадр, после; звук режется по границам кадра', () => {
    const f = freeze(50)
    const pieces = splitRange(R(1, 3, [f]), FPS)
    expect(pieces.map((p) => p.kind)).toEqual(['cut', 'freeze', 'cut'])
    const [a, , b] = pieces as Array<{
      start: number
      end: number
      audioStart: number
      audioEnd: number
    }>
    // Видео режется по серединам между кадрами, звук — по границам кадра 50 (2.00 и 2.04).
    expect(a.end).toBeCloseTo(1.98, 6)
    expect(a.audioEnd).toBeCloseTo(2.0, 6)
    expect(b.start).toBeCloseTo(2.02, 6)
    expect(b.audioStart).toBeCloseTo(2.04, 6)
  })

  it('стоп-кадр на первом кадре: куска до него нет', () => {
    const pieces = splitRange(R(1, 3, [freeze(25)]), FPS)
    expect(pieces.map((p) => p.kind)).toEqual(['freeze', 'cut'])
  })

  it('стоп-кадр на последнем кадре: куска после него нет', () => {
    const pieces = splitRange(R(1, 3, [freeze(74)]), FPS)
    expect(pieces.map((p) => p.kind)).toEqual(['cut', 'freeze'])
  })

  it('соседние кадры: между стоп-кадрами пустого куска нет', () => {
    const pieces = splitRange(R(1, 3, [freeze(50), freeze(51)]), FPS)
    expect(pieces.map((p) => p.kind)).toEqual(['cut', 'freeze', 'freeze', 'cut'])
  })

  it('начало отрезка внутри кадра: кусок короче половины кадра пропускается', () => {
    const pieces = splitRange(R(1.01, 3, [freeze(26)]), FPS)
    expect(pieces.map((p) => p.kind)).toEqual(['freeze', 'cut'])
  })
})

describe('planDrawn: граф фильтров', () => {
  const audio = { sampleRate: 44100, mono: false }

  it('наложение: enable сдвинут на полкадра и отсчитывается от смещения', () => {
    const g = planDrawn({
      ranges: [R(1, 3)],
      segments: [{ start: 1.5, end: 2, key: '4-5' }],
      fps: FPS,
      audio: null
    })
    expect(g.offset).toBe(1)
    expect(g.span).toBe(2)
    expect(g.inputKeys).toEqual(['4-5'])
    // 1.5 − 1 − (0.02 + 0.0001) = 0.4799; 2 − 1 − 0.0201 = 0.9799
    expect(g.script).toContain("enable='gte(t,0.4799)*lt(t,0.9799)'")
    expect(g.script).toContain('overlay=x=0:y=0:eof_action=repeat')
    expect(g.script).toContain('[outv]')
    expect(g.script).not.toContain('[outa]')
    expect(g.outputSeconds).toBe(2)
  })

  it('окно сегмента, обрезанного концом отрезка экспорта, продлено на кадр (последний кадр не теряет рисунок)', () => {
    const g = planDrawn({
      ranges: [R(1, 3)],
      segments: [
        { start: 1, end: 2, key: '0' },
        { start: 2, end: 3, key: '1' }
      ],
      fps: FPS,
      audio: null
    })
    // Первый сегмент кончается внутри отрезка (граница 2 с): 2 − 1 − 0.0201 = 0.9799.
    expect(g.script).toContain('lt(t,0.9799)')
    // Второй — концом отрезка (3 с): продлён на 0.04 → 2 + 0.04 − 0.0201 = 2.0199.
    expect(g.script).toContain('lt(t,2.0199)')
  })

  it('один набор рисунков на нескольких отрезках — одно наложение с несколькими окнами', () => {
    const g = planDrawn({
      ranges: [R(1, 3), R(10, 12)],
      segments: [
        { start: 1, end: 2, key: '0' },
        { start: 10, end: 11, key: '0' }
      ],
      fps: FPS,
      audio: null
    })
    expect(g.inputKeys).toEqual(['0'])
    expect(g.script.match(/overlay=/g)).toHaveLength(1)
    expect(g.script).toContain(')+gte(t,')
    expect(g.offset).toBe(1)
    expect(g.span).toBe(11)
  })

  it('стоп-кадр со звуком: тишина нужной длины, число кадров задано явно, concat со звуком', () => {
    const g = planDrawn({
      ranges: [R(1, 3, [freeze(50, 1.5)])],
      segments: [],
      fps: FPS,
      audio
    })
    expect(g.inputKeys).toEqual(['0'])
    expect(g.script).toContain('tpad=stop_mode=clone')
    // 1.5 с = 37.5 → 38 кадров + сам кадр = 39.
    expect(g.script).toContain('trim=end_frame=39')
    // Тишина — те же 38 кадров: 1.52 с.
    expect(g.script).toContain('anullsrc=r=44100:cl=stereo:d=1.520')
    expect(g.script).toContain('concat=n=3:v=1:a=1[cv][outa]')
    expect(g.script).toContain('aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo')
    expect(g.outputSeconds).toBeCloseTo(3.5, 6)
  })

  it('моно-звук сохраняется', () => {
    const g = planDrawn({
      ranges: [R(1, 3, [freeze(50)])],
      segments: [],
      fps: FPS,
      audio: { sampleRate: 48000, mono: true }
    })
    expect(g.script).toContain('anullsrc=r=48000:cl=mono')
    expect(g.script).toContain('channel_layouts=mono')
  })

  it('без звука: нет аудио-цепочек', () => {
    const g = planDrawn({
      ranges: [R(1, 3, [freeze(50)])],
      segments: [{ start: 1, end: 2, key: '1' }],
      fps: FPS,
      audio: null
    })
    expect(g.script).not.toMatch(/\[0:a\]|anullsrc|atrim|\[outa\]/)
    expect(g.script).toContain('concat=n=3:v=1:a=0[cv]')
  })

  it('одна картинка нужна и в цепочке, и на стоп-кадре — split', () => {
    const g = planDrawn({
      ranges: [R(1, 3, [freeze(50, 1, '0')])],
      segments: [{ start: 1, end: 3, key: '0' }],
      fps: FPS,
      audio: null
    })
    expect(g.inputKeys).toEqual(['0'])
    expect(g.script).toContain('[1:v]format=rgba,split=2[pc0][pf0_0]')
  })

  it('размер PNG не совпал с видео — масштаб', () => {
    const g = planDrawn({
      ranges: [R(1, 3)],
      segments: [{ start: 1, end: 2, key: '0' }],
      fps: FPS,
      audio: null,
      videoSize: { w: 640, h: 360 },
      pngSize: { w: 1280, h: 720 }
    })
    expect(g.script).toContain('[1:v]scale=640:360,format=rgba,null[pc0]')
  })

  it('чётные размеры в конце, граф не содержит путей к файлам (экранировать нечего)', () => {
    const g = planDrawn({
      ranges: [R(1, 3)],
      segments: [{ start: 1, end: 2, key: '0' }],
      fps: FPS,
      audio
    })
    expect(g.script).toContain('[cv]scale=trunc(iw/2)*2:trunc(ih/2)*2[outv]')
    expect(g.script).not.toMatch(/[A-Za-z]:\\|\.png/)
  })

  it('подборка: несколько отрезков склеиваются в порядке вывода', () => {
    const g = planDrawn({
      ranges: [R(1, 2), R(5, 6, [freeze(130, 1, '1')])],
      segments: [],
      fps: FPS,
      audio: null
    })
    expect(g.offset).toBe(1)
    expect(g.span).toBe(5)
    // кусок 1, кусок 2 до стоп-кадра, стоп-кадр, кусок 2 после него
    expect(g.script).toContain('concat=n=4:v=1:a=0[cv]')
    expect(g.outputSeconds).toBeCloseTo(3, 6)
  })
})

describe('buildDrawnArgs', () => {
  it('картинки идут входами 1, 2…; -ss и -t относятся к видео; граф из файла', () => {
    const args = buildDrawnArgs({
      input: 'C:\\Видео файлы\\матч 1.mp4',
      pngPaths: ['C:\\tmp\\папка с пробелом\\o0001.png', 'C:\\tmp\\папка с пробелом\\o0002.png'],
      output: 'C:\\out\\клип.mp4.part',
      scriptPath: 'C:\\tmp\\graph.txt',
      offset: 1,
      span: 2,
      hasAudio: true
    })
    const firstInput = args.indexOf('-i')
    expect(args.slice(firstInput - 4, firstInput + 2)).toEqual([
      '-ss',
      '1.000',
      '-t',
      '2.000',
      '-i',
      'C:\\Видео файлы\\матч 1.mp4'
    ])
    expect(args.filter((a) => a === '-i')).toHaveLength(3)
    expect(args).toContain('C:\\tmp\\папка с пробелом\\o0002.png')
    expect(args).toContain('-filter_complex_script')
    expect(args).toContain('[outa]')
    expect(args[args.length - 1]).toBe('C:\\out\\клип.mp4.part')
  })

  it('без звука нет -map [outa] и аудио-кодека', () => {
    const args = buildDrawnArgs({
      input: 'a.mp4',
      pngPaths: [],
      output: 'o.mp4',
      scriptPath: 'g.txt',
      offset: 0,
      span: 1,
      hasAudio: false
    })
    expect(args).not.toContain('[outa]')
    expect(args).not.toContain('aac')
  })
})

describe('одиночные обычные кадры между стоп-кадрами', () => {
  it('framesInWindow: считает кадры по сетке частоты, в том числе при сдвинутом начале', () => {
    expect(framesInWindow(2.02, 2.06, FPS)).toBe(1)
    expect(framesInWindow(2.02, 2.1, FPS)).toBe(2)
    expect(framesInWindow(2.02, 2.02, FPS)).toBe(0)
    expect(framesInWindow(1.01, 1.05, FPS)).toBe(1)
    expect(framesInWindow(1.01, 1.09, FPS)).toBe(2)
  })

  it('один кадр между стоп-кадрами: копия кадра на полшага и отбраковка метки посередине сетки', () => {
    const g = planDrawn({
      ranges: [R(1, 3, [freeze(50), freeze(52)])],
      segments: [],
      fps: FPS,
      audio: null
    })
    expect(g.script).toContain('trim=end_frame=2,setpts=N/(2*25)/TB[v2]')
    expect(g.script).toContain("select='gt(abs(t*25-floor(t*25)-0.5),0.4)'")
    // Метки стоп-кадров идут по номеру кадра (иначе копии получают повторную метку).
    expect(g.script).toContain('trim=end_frame=26,setpts=N/25/TB[v1]')
  })

  it('0 и 2 кадра между стоп-кадрами, а также одиночный кадр в самом конце: без обходного приёма', () => {
    for (const second of [51, 53]) {
      const g = planDrawn({
        ranges: [R(1, 3, [freeze(50), freeze(second)])],
        segments: [],
        fps: FPS,
        audio: null
      })
      expect(g.script).not.toContain('select=')
      expect(g.script).not.toContain('N/(2*25)')
    }
    // Хвост из одного кадра последним куском: его длина не нужна.
    const tail = planDrawn({
      ranges: [R(1, 3, [freeze(73)])],
      segments: [],
      fps: FPS,
      audio: null
    })
    expect(tail.script).not.toContain('select=')
  })

  it('одиночный кадр на стыке отрезков подборки (не последний кусок) тоже исправляется', () => {
    const g = planDrawn({
      ranges: [R(1, 3, [freeze(73)]), R(5, 7)],
      segments: [],
      fps: FPS,
      audio: null
    })
    expect(g.script).toContain('N/(2*25)')
    expect(g.script).toContain('select=')
  })
})
