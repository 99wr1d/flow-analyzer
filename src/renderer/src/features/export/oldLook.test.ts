// «Старый вид»: рисунки без полей 0.18 (проект 0.17.0 и обычные сплошные/штриховые рисунки всех видов) должны давать тот же
// SVG, что и до стилей 0.18. Эталон (__snapshots__) снят с кода ДО этапа стилей и сверен с ним; меняться он не должен.
// Если тест упал после правки отрисовки — старые проекты стали выглядеть иначе (или правка нарочно меняет вид: тогда
// это решение нужно принять осознанно, а не обновлять эталон «чтобы прошло»).
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Annotation } from '../../../../shared/annotations'
import { sampleCalibration } from '../../../../shared/pitch/pitch.testkit'
import { buildOverlaySvg } from './renderOverlays'

/**
 * Приведение SVG к сравнимому виду. Убирается только то, что не влияет на картинку:
 *  - атрибуты data-* (метки для тестов и мыши);
 *  - text-anchor="start" (значение по умолчанию);
 *  - paint-order и stroke-linejoin у <text> БЕЗ атрибута stroke (без обводки они ничего не рисуют).
 * Числа округляются до 6 знаков, атрибуты сортируются, каждый тег на своей строке. Остальное (цвета, размеры, пунктир,
 * порядок слоёв, фильтры) сравнивается как есть.
 */
export function normalizeSvg(svg: string): string {
  const out = svg.replace(
    /<([a-zA-Z]+)((?:\s+[a-zA-Z0-9:-]+="[^"]*")*)\s*(\/?)>/g,
    (_m, tag, attrs, sl) => {
      let list = [...(attrs as string).matchAll(/([a-zA-Z0-9:-]+)="([^"]*)"/g)].map((m) => [
        m[1],
        m[2]
      ])
      list = list.filter(
        ([k, v]) => !k.startsWith('data-') && !(k === 'text-anchor' && v === 'start')
      )
      if (tag === 'text' && !list.some(([k]) => k === 'stroke')) {
        list = list.filter(([k]) => k !== 'paint-order' && k !== 'stroke-linejoin')
      }
      const attr = list
        .map(([k, v]) => `${k}="${v.replace(/-?\d+\.\d{7,}/g, (n) => (+n).toFixed(6))}"`)
        .sort()
      return `<${tag}${attr.length > 0 ? ' ' : ''}${attr.join(' ')}${sl}>`
    }
  )
  return out.replace(/></g, '>\n<')
}

const timing = { mode: 'range', start: 0, duration: 3 }
const cal = sampleCalibration()

/** Рисунки каждого вида в сплошном и штриховом виде, подпись с плашкой и без, прожектор. Идентификаторы заданы вручную. */
function everyType(): Annotation[] {
  let n = 0
  const id = (): string => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
  const ss = (dash: string): object => ({ color: '#ff3b30', width: 0.008, dash })
  const out: object[] = []
  for (const dash of ['solid', 'dashed']) {
    const s = ss(dash)
    out.push(
      {
        id: id(),
        space: 'screen',
        type: 'arrow',
        p1: { x: 0.1, y: 0.2 },
        p2: { x: 0.6, y: 0.4 },
        style: s,
        timing
      },
      {
        id: id(),
        space: 'screen',
        type: 'line',
        p1: { x: 0.1, y: 0.5 },
        p2: { x: 0.6, y: 0.7 },
        style: s,
        timing
      },
      {
        id: id(),
        space: 'screen',
        type: 'circle',
        p1: { x: 0.3, y: 0.5 },
        p2: { x: 0.4, y: 0.6 },
        style: s,
        timing
      },
      {
        id: id(),
        space: 'screen',
        type: 'curve',
        p1: { x: 0.1, y: 0.2 },
        p2: { x: 0.6, y: 0.4 },
        c: { x: 0.3, y: 0.1 },
        style: s,
        timing
      },
      {
        id: id(),
        space: 'screen',
        type: 'pen',
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.3, y: 0.3 },
          { x: 0.5, y: 0.25 }
        ],
        arrow: true,
        style: s,
        timing
      },
      {
        id: id(),
        space: 'screen',
        type: 'zone',
        points: [
          { x: 0.1, y: 0.2 },
          { x: 0.3, y: 0.3 },
          { x: 0.2, y: 0.5 }
        ],
        opacity: 0.2,
        style: s,
        timing
      },
      {
        id: id(),
        space: 'pitch',
        calibrationId: cal.id,
        type: 'parrow',
        p1: { x: 30, y: 20 },
        p2: { x: 50, y: 30 },
        style: s,
        timing
      },
      {
        id: id(),
        space: 'pitch',
        calibrationId: cal.id,
        type: 'pline',
        p1: { x: 30, y: 40 },
        p2: { x: 50, y: 45 },
        style: s,
        timing
      },
      {
        id: id(),
        space: 'pitch',
        calibrationId: cal.id,
        type: 'ring',
        center: { x: 40, y: 30 },
        radius: 2,
        style: s,
        timing
      },
      {
        id: id(),
        space: 'pitch',
        calibrationId: cal.id,
        type: 'pcurve',
        p1: { x: 30, y: 20 },
        p2: { x: 50, y: 30 },
        c: { x: 40, y: 15 },
        style: s,
        timing
      },
      {
        id: id(),
        space: 'pitch',
        calibrationId: cal.id,
        type: 'ruler',
        p1: { x: 30, y: 50 },
        p2: { x: 50, y: 50 },
        style: s,
        timing
      }
    )
  }
  out.push(
    {
      id: id(),
      space: 'screen',
      type: 'text',
      pos: { x: 0.2, y: 0.3 },
      text: 'N8',
      style: { color: '#ffffff', size: 0.05, background: false },
      timing
    },
    {
      id: id(),
      space: 'screen',
      type: 'text',
      pos: { x: 0.2, y: 0.4 },
      text: 'N9',
      style: { color: '#111827', size: 0.05, background: true },
      timing
    },
    {
      id: id(),
      space: 'screen',
      type: 'spot',
      p1: { x: 0.3, y: 0.3 },
      p2: { x: 0.4, y: 0.6 },
      dim: 0.5,
      style: ss('solid'),
      timing
    }
  )
  return out as unknown as Annotation[]
}

const fixture = JSON.parse(
  readFileSync(resolve('tests/fixtures/projects/v0.17.0.flowproj'), 'utf8')
) as { annotations: Annotation[]; calibrations?: Parameters<typeof buildOverlaySvg>[3] }

describe('старый вид рисунков не изменился (эталон снят до стилей 0.18)', () => {
  const sets: Array<[string, Annotation[]]> = [
    ['проект 0.17.0', fixture.annotations],
    ['все виды, сплошные и штриховые', everyType()]
  ]
  for (const [name, items] of sets) {
    for (const part of ['all', 'over', 'under'] as const) {
      it(`${name}, слой ${part}`, () => {
        const svg = buildOverlaySvg(items, 1280, 720, [cal, ...(fixture.calibrations ?? [])], {
          part
        })
        expect(normalizeSvg(svg)).toMatchSnapshot()
      })
    }
  }
})
