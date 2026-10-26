// Кольца у ног не наезжают на игроков (0.20.1). Видео собирается здесь же ffmpeg-ом:
//  1) бледный газон телетрансляции и белый игрок: кольцо у ног уходит ЗА белые ноги — и на экране, и в готовом видео
//     (прежний допуск ключа 0.07 + 0.05 считал белое газоном, и кольцо ложилось поверх игрока);
//  2) бегун с поднятой назад ногой: рамка детектора (заглушка) шире фигуры, середина её низа — между ног и сзади;
//     кольцо слежения встаёт у опорной ноги, а не «за игроком».
import { expect, test } from '@playwright/test'
import { mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ff, frameRgb, pixelAt } from '../../src/main/ffmpeg/ffmpeg.testkit'
import { SHOTS, SUFFIX, launch, makeUserData, seekVideo, stubDialog } from './helpers'
import { createProject } from './startHelpers'
import {
  clickAt,
  colorDiff,
  layerBox,
  readPng,
  shapes,
  type Frac,
  type Pixels
} from './toolsHelpers'

type Rgb = [number, number, number]
const W = 640
const H = 360
/** Бледный газон Лиги чемпионов (такой цвет находит estimateGrassColor на трансляции). */
const PALE_GRASS = '0x6c7b48'

function makeVideo(name: string, boxes: string[]): string {
  const dir = makeUserData()
  const path = join(dir, name)
  const r = ff([
    ...['-f', 'lavfi', '-i', `color=c=${PALE_GRASS}:s=${W}x${H}:r=25:d=3`],
    ...['-vf', ['noise=alls=6:allf=t', ...boxes].join(',')],
    ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '12', '-y', path]
  ])
  expect(r.status, r.stderr.slice(-400)).toBe(0)
  return path
}

/** Видео с движущимися прямоугольниками: каждый — цвет, размер и положение (x — выражение от t, секунды). */
function makeMovingVideo(
  name: string,
  rects: Array<{ c: string; w: number; h: number; x: string; y: number }>
): string {
  const dir = makeUserData()
  const path = join(dir, name)
  const inputs = rects.flatMap((r) => [
    '-f',
    'lavfi',
    '-i',
    `color=c=${r.c}:s=${r.w}x${r.h}:r=25:d=3`
  ])
  let chain = '[0:v]noise=alls=6:allf=t[b0]'
  rects.forEach((r, i) => {
    chain += `;[b${i}][${i + 1}:v]overlay=x='${r.x}':y=${r.y}:eval=frame[b${i + 1}]`
  })
  const r = ff([
    ...['-f', 'lavfi', '-i', `color=c=${PALE_GRASS}:s=${W}x${H}:r=25:d=3`],
    ...inputs,
    ...['-filter_complex', chain, '-map', `[b${rects.length}]`],
    ...['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '12', '-t', '3', '-y', path]
  ])
  expect(r.status, r.stderr.slice(-400)).toBe(0)
  return path
}

const png = async (win: import('@playwright/test').Page, name: string): Promise<Pixels> =>
  readPng(await win.screenshot(), SHOTS, `rings-feet-${name}`)

test.describe('кольца у ног не наезжают на игроков', () => {
  test('белый игрок на бледном газоне: задняя дуга кольца — за ногами, передняя — на траве; экран = готовое видео', async () => {
    // Белый игрок: корпус 300..330, ноги 308..322 до y = 262.
    const video = makeVideo('pale.mp4', [
      'drawbox=x=300:y=150:w=30:h=70:c=0xf2f2f2:t=fill',
      'drawbox=x=308:y=220:w=14:h=42:c=0xf2f2f2:t=fill'
    ])
    const ctx = await launch()
    const { app, win } = ctx
    try {
      await createProject(ctx, { title: 'Белый игрок', video })
      await seekVideo(win, 1)
      await win.keyboard.press('Escape')
      await win.waitForTimeout(300)
      const layer = await layerBox(win)
      const at = (p: Pixels, f: Frac): Rgb =>
        p.at(layer.x + f[0] * layer.width, layer.y + f[1] * layer.height)
      const base = await png(win, 'pale-base')
      // Кольцо щелчком у ног: ширина 0.07 высоты кадра (≈ 25 px), сплющивание 0.35 → полувысота ≈ 4.4 px.
      const feet: Frac = [315 / W, 258 / H]
      await win.getByTestId('tool-circle').click()
      await clickAt(win, feet)
      await expect(shapes(win, 'circle')).toHaveCount(1)
      await expect(shapes(win, 'circle')).toHaveAttribute('data-under', 'true')
      await win.getByTestId('tool-select').click()
      await win.keyboard.press('Escape')
      await expect(win.getByTestId('under-canvas')).toHaveAttribute('data-renderer', 'webgl2')
      await win.waitForTimeout(600)
      const shot = await png(win, 'pale-ring')
      await win.screenshot({ path: join(SHOTS, `rings-feet-pale${SUFFIX}.png`) })
      // Задняя дуга (верх эллипса) проходит по белым ногам: они остаются белыми.
      const back: Frac = [315 / W, 253.8 / H]
      const front: Frac = [315 / W, 262.2 / H]
      const near = (p: Pixels, f: Frac): number => {
        let d = 0
        for (let dy = -2; dy <= 2; dy += 1) {
          const g: Frac = [f[0], f[1] + dy / layer.height]
          d = Math.max(d, colorDiff(at(p, g), at(base, g)))
        }
        return d
      }
      const dBack = near(shot, back)
      const dFront = near(shot, front)
      console.log(
        `Белые ноги под дугой: изменение ${dBack.toFixed(1)}; передняя дуга на траве: ${dFront.toFixed(1)}`
      )
      expect(dBack).toBeLessThan(15)
      expect(dFront).toBeGreaterThan(40)

      // Готовое видео: те же места.
      const out = join(makeUserData(), 'out')
      mkdirSync(out)
      await stubDialog(app, out)
      await win.getByTestId('export-open').click()
      await win.getByTestId('export-scope-whole').check()
      await expect(win.getByTestId('export-drawings')).toBeChecked()
      await win.getByTestId('export-start').click()
      await expect(win.getByTestId('export-result')).toHaveAttribute('data-status', 'done', {
        timeout: 90_000
      })
      const file = join(out, readdirSync(out)[0])
      const index = 30 // 1.2 с: кольцо видно (отрезок 3 с от 1.0)
      const exported = frameRgb(file, index, W, H)
      const source = frameRgb(video, index, W, H)
      const vdiff = (f: Frac, dy = 0): number =>
        colorDiff(
          pixelAt(exported, W, Math.round(f[0] * W), Math.round(f[1] * H) + dy),
          pixelAt(source, W, Math.round(f[0] * W), Math.round(f[1] * H) + dy)
        )
      const eBack = Math.max(vdiff(back, -1), vdiff(back), vdiff(back, 1))
      const eFront = Math.max(vdiff(front, -1), vdiff(front), vdiff(front, 1))
      console.log(
        `Готовое видео: белые ноги ${eBack.toFixed(1)}, передняя дуга ${eFront.toFixed(1)}`
      )
      expect(eBack).toBeLessThan(18)
      expect(eFront).toBeGreaterThan(35)
    } finally {
      await app.close()
    }
  })

  test('слежение: кольцо у опорной ноги, а не у середины растянутой рамки', async () => {
    // Бегун вправо 40 px/с: корпус (красный) x0..x0+16, опорная нога x0..x0+6 до y = 262, задняя нога поднята назад-влево
    // (x0−24..x0, y 236..244). Рамка заглушки — с задней ногой: x0−26..x0+18 → середина на 13 px левее опорной ноги.
    const X0 = 200
    const video = makeMovingVideo('runner.mp4', [
      { c: '0xd02030', w: 16, h: 70, x: `${X0}+40*t`, y: 150 },
      { c: '0xf0f0f0', w: 6, h: 42, x: `${X0}+40*t`, y: 220 },
      { c: '0xf0f0f0', w: 24, h: 8, x: `${X0 - 24}+40*t`, y: 236 }
    ])
    const pattern = join(makeUserData(), 'stub-runner-leg.json')
    writeFileSync(
      pattern,
      JSON.stringify({
        players: [
          {
            start: { x: (X0 - 26) / W, y: 148 / H, w: 44 / W, h: 114 / H },
            velocity: { x: 40 / W, y: 0 }
          }
        ],
        // Под рамкой нарисована настоящая фигура: точку ног заглушка уточняет по кадру, как настоящий детектор.
        feetFromFrame: true
      })
    )
    const ctx = await launch({
      env: { FLOW_DETECTOR_STUB: '1', FLOW_DETECTOR_STUB_PATTERN: pattern }
    })
    const { win } = ctx
    try {
      await createProject(ctx, { title: 'Бегун', video })
      await seekVideo(win, 0.5)
      await win.getByTestId('tool-circle').click()
      await clickAt(win, [(X0 + 20 + 3) / W, 262 / H])
      await expect(shapes(win, 'circle')).toHaveCount(1)
      await win.getByTestId('tool-select').click()
      await win.getByTestId('duration-input').fill('2')
      const runs = Number(await win.getByTestId('tracking-state').getAttribute('data-runs'))
      await win.getByTestId('track-button').click()
      await expect(win.getByTestId('tracking-state')).toHaveAttribute(
        'data-runs',
        String(runs + 1),
        {
          timeout: 60_000
        }
      )
      for (const t of [1.0, 1.5, 2.2]) {
        await seekVideo(win, t)
        const g = JSON.parse((await shapes(win, 'circle').getAttribute('data-geo'))!) as {
          p1: { x: number }
          p2: { x: number }
        }
        const cx = ((g.p1.x + g.p2.x) / 2) * W
        const leg = X0 + 40 * t + 3
        const boxCentre = X0 - 26 + 22 + 40 * t
        console.log(
          `t=${t}: кольцо ${cx.toFixed(1)} px, опорная нога ${leg}, середина рамки ${boxCentre}`
        )
        expect(Math.abs(cx - leg)).toBeLessThan(4)
      }
      await win.screenshot({ path: join(SHOTS, `rings-feet-runner${SUFFIX}.png`) })
    } finally {
      await ctx.app.close()
    }
  })
})
