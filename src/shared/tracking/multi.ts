// Слежение за несколькими игроками (Связка): N независимых SingleTracker, питаемых одним проходом детектора на кадр.
//
// Что добавляет этот слой к одиночному слежению:
//  * Исключительность: две цели никогда не владеют одной рамкой. Если две уверенно ведомые цели сошлись на одной рамке
//    (CONVERGE_IOU / CONVERGE_DIST в tuning.ts), одна из них — та, что дальше от своего прогноза — получает вопрос
//    «Кто из них ваш?». Кандидаты вопроса не включают рамки, закреплённые за другими целями; если предложить нечего —
//    остановка всех (lost с номером цели).
//  * Согласование: решения «сомнение/вопрос/потеря» принимает сам SingleTracker цели. Потеря любой цели — потеря всей задачи
//    (остальные не ведутся «втёмную»). Вопрос по одной цели ставит на паузу всех: пока он не решён, step/resolve
//    возвращают следующий вопрос или итог кадра, а следующий кадр вызывающий не берёт.
//  * Одна цель ведёт себя ровно как SingleTracker: проверки исключительности без соседей не срабатывают.
import { iou, SingleTracker } from './tracker'
import {
  ASK_MAX_CANDIDATES,
  CONVERGE_DIST,
  CONVERGE_IOU,
  GATE_MAX,
  MIN_NORM_HEIGHT,
  SIZE_RATIO_MAX,
  SIZE_RATIO_MIN
} from './tuning'
import type { Box, Detection, FrameInput, TrackerOptions } from './types'

export interface MultiStart {
  det: Detection
  opts?: TrackerOptions
}

export type LostReason = 'cut' | 'out' | 'occluded'

export type MultiStep =
  | { kind: 'track'; boxes: Box[]; coasting: boolean[] }
  | { kind: 'ask'; target: number; candidates: Detection[] }
  | { kind: 'lost'; target: number; reason: LostReason }

type Slot =
  | { kind: 'track'; box: Box; coasting: boolean; det: Detection | null }
  | { kind: 'ask'; cands: Detection[]; contested: Box | null }
  | { kind: 'user'; box: Box }
  | { kind: 'lost'; reason: LostReason }

const centre = (b: Box): { x: number; y: number } => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/** Рамки «слились»: фактически один и тот же человек. */
export function converges(a: Box, b: Box): boolean {
  if (iou(a, b) >= CONVERGE_IOU) return true
  const ca = centre(a)
  const cb = centre(b)
  return Math.hypot(ca.x - cb.x, ca.y - cb.y) < CONVERGE_DIST * Math.min(a.h, b.h)
}

const sameBox = (a: Box, b: Box): boolean =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

export class MultiTracker {
  private readonly trackers: SingleTracker[]
  private slots: Slot[] = []
  private preds: Box[] = []
  private dets: Detection[] = []
  private dead: MultiStep | null = null

  constructor(starts: MultiStart[], fps: number, frame?: { w: number; h: number }) {
    this.trackers = starts.map(
      (s) => new SingleTracker(s.det, fps, { ...(frame ? { frame } : {}), ...s.opts })
    )
  }

  get size(): number {
    return this.trackers.length
  }

  /** Где каждая цель ожидается на кадре index (для выреза детектора). */
  predictBoxes(index: number): Box[] {
    return this.trackers.map((t) => t.predictBox(index))
  }

  /** Один кадр: все цели по одним и тем же детекциям. Вопрос по цели — ответ через resolve. */
  step(f: FrameInput): MultiStep {
    if (this.dead) return this.dead
    this.preds = this.predictBoxes(f.index)
    this.dets = f.detections
    this.slots = this.trackers.map((t): Slot => {
      const r = t.step(f)
      if (r.kind === 'lost') return { kind: 'lost', reason: r.reason }
      if (r.kind === 'ask') return { kind: 'ask', cands: r.candidates, contested: null }
      const det = r.coasting ? null : (f.detections.find((d) => sameBox(d.box, r.box)) ?? null)
      return { kind: 'track', box: r.box, coasting: r.coasting, det }
    })
    return this.settle()
  }

  /** Ответ пользователя: рамка выбрана для цели (объект из списка candidates последнего вопроса). */
  resolve(target: number, det: Detection): MultiStep {
    if (this.dead) return this.dead
    const slot = this.slots[target]
    if (!slot || slot.kind !== 'ask') throw new Error('По этой цели вопроса нет')
    if (this.ownedByOthers(target, slot.contested).some((b) => converges(det.box, b))) {
      throw new Error('Эта рамка уже занята другой целью')
    }
    this.trackers[target].resolve(det)
    this.slots[target] = { kind: 'user', box: { ...det.box } }
    return this.settle()
  }

  /** Рамка цели, если за ней закреплён человек (уверенный кадр или ответ пользователя); при «пережидании» — нет. */
  private owned(i: number): Box | null {
    const s = this.slots[i]
    if (s.kind === 'user') return s.box
    if (s.kind === 'track' && !s.coasting) return s.box
    return null
  }

  /**
   * Рамки, закреплённые за другими целями. Рамка, из-за которой возник спор (contested), у спорящей цели не считается
   * занятой: пользователь вправе назвать её своей — тогда вопрос получит вторая цель. Рамки, подтверждённые
   * пользователем, заняты всегда.
   */
  private ownedByOthers(i: number, contested: Box | null = null): Box[] {
    const out: Box[] = []
    this.slots.forEach((s, j) => {
      const b = j === i ? null : this.owned(j)
      if (!b) return
      if (s.kind === 'track' && contested && converges(b, contested)) return
      out.push(b)
    })
    return out
  }

  /** Расстояние от центра рамки до прогноза цели в высотах. */
  private offset(i: number, b: Box): number {
    const p = centre(this.preds[i])
    const c = centre(b)
    return Math.hypot(c.x - p.x, c.y - p.y) / Math.max(this.preds[i].h, MIN_NORM_HEIGHT)
  }

  /** Кандидаты вопроса для цели, уверенно севшей на спорную рамку: ближайшие к прогнозу, спорная — в списке. */
  private generate(i: number, taken: Detection | null): Detection[] {
    const pred = this.preds[i]
    const near = this.dets
      .filter((d) => {
        const ratio = d.box.h / pred.h
        return (
          ratio >= SIZE_RATIO_MIN && ratio <= SIZE_RATIO_MAX && this.offset(i, d.box) <= GATE_MAX
        )
      })
      .sort((p, q) => this.offset(i, p.box) - this.offset(i, q.box))
      .slice(0, ASK_MAX_CANDIDATES)
    if (taken && near.length > 0 && !near.includes(taken)) near[near.length - 1] = taken
    return near
  }

  private die(target: number, reason: LostReason): MultiStep {
    this.dead = { kind: 'lost', target, reason }
    return this.dead
  }

  private settle(): MultiStep {
    for (let i = 0; i < this.slots.length; i += 1) {
      const s = this.slots[i]
      if (s.kind === 'lost') return this.die(i, s.reason)
    }
    // Исключительность: две цели с уверенной рамкой на одном человеке — вопрос по той, что дальше от своего прогноза
    // (при равенстве — по старшему номеру). Цель, уже подтверждённая пользователем в этом кадре, не трогаем.
    for (;;) {
      let pair: [number, number] | null = null
      for (let i = 0; i < this.slots.length && !pair; i += 1) {
        const a = this.owned(i)
        if (!a) continue
        for (let j = i + 1; j < this.slots.length; j += 1) {
          const b = this.owned(j)
          if (b && converges(a, b)) {
            pair = [i, j]
            break
          }
        }
      }
      if (!pair) break
      const [i, j] = pair
      const si = this.slots[i]
      const sj = this.slots[j]
      if (si.kind === 'user' && sj.kind === 'user') return this.die(j, 'occluded')
      const suspect =
        si.kind === 'user'
          ? j
          : sj.kind === 'user'
            ? i
            : this.offset(i, this.owned(i) as Box) > this.offset(j, this.owned(j) as Box)
              ? i
              : j
      const s = this.slots[suspect]
      this.slots[suspect] = {
        kind: 'ask',
        cands: this.generate(suspect, s.kind === 'track' ? s.det : null),
        contested: this.owned(suspect === i ? j : i)
      }
    }
    for (let i = 0; i < this.slots.length; i += 1) {
      const s = this.slots[i]
      if (s.kind !== 'ask') continue
      // Рамки, закреплённые за другими целями, чужому не предлагаем.
      const others = this.ownedByOthers(i, s.contested)
      const candidates = s.cands.filter((c) => !others.some((b) => converges(c.box, b)))
      if (candidates.length === 0) return this.die(i, 'occluded')
      return { kind: 'ask', target: i, candidates }
    }
    const boxes: Box[] = []
    const coasting: boolean[] = []
    for (const s of this.slots) {
      if (s.kind === 'track') {
        boxes.push(s.box)
        coasting.push(s.coasting)
      } else if (s.kind === 'user') {
        boxes.push({ ...s.box })
        coasting.push(false)
      }
    }
    return { kind: 'track', boxes, coasting }
  }
}
