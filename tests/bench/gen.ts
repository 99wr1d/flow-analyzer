// Генераторы данных для замеров: проекты с тысячами эпизодов и рисунков. Только для tests/bench.
import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { DEFAULT_TAGS } from '../../src/shared/settings'

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** Простой детерминированный генератор случайных чисел: замеры повторяемы. */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface BenchProjectOptions {
  video: string
  duration: number
  fps?: number
  episodes: number
  /** Сколько рисунков; из них animated — с ключевыми кадрами; примерно треть — на поле. */
  drawings: number
  animated?: number
  title?: string
  seed?: number
}

const style = { color: '#ffd23f', width: 0.01, dash: 'solid' }
const pt = (r: () => number): { x: number; y: number } => ({
  x: 0.1 + r() * 0.8,
  y: 0.1 + r() * 0.8
})
const world = (r: () => number): { x: number; y: number } => ({ x: 10 + r() * 80, y: 8 + r() * 50 })

export function benchProject(o: BenchProjectOptions): string {
  const r = rng(o.seed ?? 1)
  const calibrationId = uuid(9000)
  const episodes = Array.from({ length: o.episodes }, (_, i) => {
    const tag = DEFAULT_TAGS[i % DEFAULT_TAGS.length]
    const start = Math.round((((i + r() * 0.5) * (o.duration - 15)) / o.episodes) * 1000) / 1000
    const roll = r()
    return {
      id: uuid(100000 + i),
      tagId: tag.id,
      tagName: tag.name,
      tagColor: tag.color,
      start,
      end: Math.round((start + 6 + r() * 14) * 1000) / 1000,
      rating: roll < 0.25 ? 'good' : roll < 0.4 ? 'bad' : null,
      review: r() < 0.1,
      ...(i % 7 === 0 ? { note: `Заметка к эпизоду ${i}` } : {})
    }
  })
  const kinds = [
    'arrow',
    'line',
    'circle',
    'text',
    'curve',
    'pen',
    'zone',
    'chain',
    'ring',
    'parrow',
    'ptext',
    'ruler'
  ]
  const annotations = Array.from({ length: o.drawings }, (_, i) => {
    const kind = kinds[i % kinds.length]
    const timing = {
      mode: 'range',
      start: Math.round(r() * (o.duration - 10) * 1000) / 1000,
      duration: 3
    }
    const base = { id: uuid(200000 + i), timing }
    const animated = i < (o.animated ?? 0)
    switch (kind) {
      case 'arrow':
      case 'line':
      case 'circle': {
        const p1 = pt(r)
        const p2 = pt(r)
        return {
          ...base,
          space: 'screen',
          type: kind,
          p1,
          p2,
          style,
          ...(animated
            ? {
                keyframes: [
                  { t: timing.start, geom: { p1, p2 } },
                  { t: timing.start + 2, ease: 'ease', geom: { p1: pt(r), p2: pt(r) } }
                ]
              }
            : {})
        }
      }
      case 'text':
        return {
          ...base,
          space: 'screen',
          type: 'text',
          pos: pt(r),
          text: `Подпись ${i}`,
          style: { color: '#ffffff', size: 0.04, background: true }
        }
      case 'curve':
        return { ...base, space: 'screen', type: 'curve', p1: pt(r), p2: pt(r), c: pt(r), style }
      case 'pen':
        return {
          ...base,
          space: 'screen',
          type: 'pen',
          points: Array.from({ length: 40 }, () => pt(r)),
          arrow: false,
          style
        }
      case 'zone':
        return {
          ...base,
          space: 'screen',
          type: 'zone',
          points: [pt(r), pt(r), pt(r), pt(r)],
          opacity: 0.3,
          style
        }
      case 'chain':
        return {
          ...base,
          space: 'screen',
          type: 'chain',
          points: [pt(r), pt(r), pt(r)],
          fill: false,
          style
        }
      case 'ring':
        return {
          ...base,
          space: 'pitch',
          calibrationId,
          type: 'ring',
          center: world(r),
          radius: 3,
          style
        }
      case 'parrow':
        return {
          ...base,
          space: 'pitch',
          calibrationId,
          type: 'parrow',
          p1: world(r),
          p2: world(r),
          style
        }
      case 'ptext':
        return {
          ...base,
          space: 'pitch',
          calibrationId,
          type: 'ptext',
          pos: world(r),
          text: `Игрок ${i}`,
          style: { color: '#ffffff', size: 0.04, background: true }
        }
      default:
        return {
          ...base,
          space: 'pitch',
          calibrationId,
          type: 'ruler',
          p1: world(r),
          p2: world(r),
          style
        }
    }
  })
  const name = o.video.split(/[\\/]/).pop() as string
  return JSON.stringify(
    {
      format: 'flowanalyzer-project',
      version: 1,
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-02-01T10:00:00.000Z',
      appVersion: '0.14.0',
      video: {
        path: o.video,
        relativePath: null,
        fileName: name,
        sizeBytes: 1,
        fps: o.fps ?? 25,
        fpsSource: 'container',
        duration: o.duration
      },
      annotations,
      calibrations: [
        {
          id: calibrationId,
          time: 0,
          aspect: 16 / 9,
          pitch: { length: 105, width: 68 },
          template: 'penalty-left',
          points: [
            { world: { x: 0, y: 13.84 }, image: { x: 0.363, y: 0.319 } },
            { world: { x: 16.5, y: 13.84 }, image: { x: 0.58, y: 0.334 } },
            { world: { x: 16.5, y: 54.16 }, image: { x: 0.492, y: 0.746 } },
            { world: { x: 0, y: 54.16 }, image: { x: 0.127, y: 0.702 } }
          ],
          createdAt: '2026-01-01T10:00:00.000Z'
        }
      ],
      episodes,
      tags: DEFAULT_TAGS,
      ui: { lastTime: 600 },
      meta: { title: o.title ?? 'Большой проект', type: 'match', date: '2026-01-01' }
    },
    null,
    2
  )
}

export function writeBenchProject(path: string, o: BenchProjectOptions): string {
  mkdirSync(dirname(path), { recursive: true })
  const text = benchProject(o)
  writeFileSync(path, text, 'utf8')
  return path
}
