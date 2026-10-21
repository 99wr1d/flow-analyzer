// Слежение за игроком: трекер одного игрока по детекциям кадров.
//
// Правила (пороги — в tuning.ts):
//  * Обычное ведение: Калман по центру рамки; кандидат выбирается по IoU, расстоянию до прогноза и примете.
//  * Перекрытие (лучшая рамка перекрыта соседней или слита с ней в одну широкую) или пропадание: «пережидание» —
//    рамка едет по прогнозу, приметы не обновляются. Выход — по чистым кандидатам в воротах прогноза;
//    если отрыв лучшего от второго мал, ждём (вдруг разойдутся), по истечении срока — вопрос ask.
//  * Никогда не перескакиваем молча на другого: при сомнении — ask, при долгом отсутствии — lost.
//  * Приметы обновляются только на уверенных неперекрытых кадрах.
import { appearanceDistance, blendLook } from './appearance'
import { Kalman1D } from './kalman'
import { isSceneCut } from './sceneCut'
import {
  APPEARANCE_BLEND,
  ASK_GAP,
  ASSOC_APPEARANCE_WEIGHT,
  COAST_DAMPING,
  COAST_SECONDS,
  EDGE_MARGIN,
  GATE_BASE,
  GATE_GROW,
  GATE_IOU,
  GATE_MAX,
  KALMAN_Q,
  KALMAN_R,
  LOST_SECONDS,
  MERGE_WIDTH_RATIO,
  MIN_NORM_HEIGHT,
  OVERLAP_IOU,
  RECOVER_APPEARANCE_WEIGHT,
  RECOVER_DISTANCE_WEIGHT,
  RECOVER_MAX_COST,
  SIZE_BLEND,
  SIZE_RATIO_MAX,
  SIZE_RATIO_MIN,
  START_AMBIGUOUS_IOU,
  START_AMBIGUOUS_RATIO,
  START_ANCHOR_SLACK,
  TRACK_MAX_COST
} from './tuning'
import type { Box, Detection, FrameInput, StartPick, StepResult, TrackerOptions } from './types'

export function iou(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (w <= 0 || h <= 0) return 0
  const inter = w * h
  return inter / (a.w * a.h + b.w * b.h - inter)
}

const centerOf = (b: Box): { x: number; y: number } => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/**
 * Старт слежения по щелчку: ближайшая к якорю рамка, чьё тело его содержит (с запасом у ног). Неоднозначно, если
 * вторая рамка ближе чем 1,5× первой или рамка перекрыта соседней (IoU > 0,1) — «грязные» приметы не берём.
 */
export function pickStart(dets: Detection[], anchor: { x: number; y: number }): StartPick {
  const hits = dets
    .filter((d) => {
      const b = d.box
      const slack = b.h * START_ANCHOR_SLACK
      return (
        anchor.x >= b.x && anchor.x <= b.x + b.w && anchor.y >= b.y && anchor.y <= b.y + b.h + slack
      )
    })
    .map((d) => ({
      d,
      dist: Math.hypot(anchor.x - (d.box.x + d.box.w / 2), anchor.y - (d.box.y + d.box.h))
    }))
    .sort((p, q) => p.dist - q.dist)
  if (hits.length === 0) return { kind: 'none' }
  const first = hits[0].d
  const neighbours = dets.filter((d) => d !== first && iou(first.box, d.box) > START_AMBIGUOUS_IOU)
  const close = hits.length > 1 && hits[1].dist < hits[0].dist * START_AMBIGUOUS_RATIO
  if (!close && neighbours.length === 0) return { kind: 'ok', det: first }
  const candidates = [
    ...hits.map((h) => h.d),
    ...neighbours.filter((n) => !hits.some((h) => h.d === n))
  ]
  return { kind: 'ambiguous', candidates }
}

interface Cand {
  det: Detection
  iou: number
  /** Расстояние от центра до прогноза в высотах игрока. */
  dist: number
  app: number
  overlapped: boolean
  merged: boolean
}

export class SingleTracker {
  private readonly kx: Kalman1D
  private readonly ky: Kalman1D
  private w: number
  private h: number
  private readonly look: Float32Array
  private dirty: boolean
  private readonly coastFrames: number
  private readonly lostFrames: number
  private readonly frame?: { w: number; h: number }
  private miss = 0
  private lastBox: Box
  private lastIndex: number | null = null
  private prevHist: Float32Array | null = null
  private dead: StepResult | null = null

  constructor(start: Detection, fps: number, opts: TrackerOptions = {}) {
    const c = centerOf(start.box)
    this.kx = new Kalman1D(c.x, KALMAN_Q, KALMAN_R)
    this.ky = new Kalman1D(c.y, KALMAN_Q, KALMAN_R)
    this.w = start.box.w
    this.h = start.box.h
    this.look = Float32Array.from(start.look)
    this.dirty = opts.dirtyStart === true
    this.frame = opts.frame
    this.coastFrames = Math.max(1, Math.round(COAST_SECONDS * fps))
    this.lostFrames = Math.max(1, Math.round(LOST_SECONDS * fps))
    this.lastBox = { ...start.box }
  }

  step(f: FrameInput): StepResult {
    if (this.dead) return this.dead
    if (this.prevHist && isSceneCut(this.prevHist, f.frameHist)) return this.die('cut')
    this.prevHist = f.frameHist
    const dt = this.lastIndex === null ? 1 : Math.max(1, f.index - this.lastIndex)
    this.lastIndex = f.index

    for (let i = 0; i < dt; i += 1) {
      this.kx.predict(1)
      this.ky.predict(1)
      if (this.miss >= this.coastFrames) {
        this.kx.v *= COAST_DAMPING
        this.ky.v *= COAST_DAMPING
      }
    }
    const pred: Box = { x: this.kx.p - this.w / 2, y: this.ky.p - this.h / 2, w: this.w, h: this.h }
    const cands = this.candidates(f.detections, pred)

    if (this.miss === 0) {
      let best: Cand | null = null
      let bestCost = Infinity
      for (const c of cands) {
        const appTerm = this.dirty ? 0 : ASSOC_APPEARANCE_WEIGHT * c.app
        const cost =
          appTerm + (1 - ASSOC_APPEARANCE_WEIGHT) * (0.5 * (1 - c.iou) + 0.5 * Math.min(c.dist, 1))
        if (cost < bestCost) {
          best = c
          bestCost = cost
        }
      }
      if (best && bestCost <= TRACK_MAX_COST && !best.overlapped && !best.merged) {
        this.accept(best, true)
        return { kind: 'track', box: { ...best.det.box }, coasting: false }
      }
      return this.coast(pred)
    }

    const ranked = cands
      .filter((c) => !c.overlapped && !c.merged)
      .map((c) => ({
        c,
        cost:
          RECOVER_APPEARANCE_WEIGHT * (this.dirty ? 0 : c.app) +
          RECOVER_DISTANCE_WEIGHT * Math.min(c.dist, 1)
      }))
      .sort((a, b) => a.cost - b.cost)
    if (ranked.length > 0) {
      const gap = ranked.length > 1 ? ranked[1].cost - ranked[0].cost : Infinity
      if (gap >= ASK_GAP && ranked[0].cost <= RECOVER_MAX_COST) {
        this.accept(ranked[0].c, false)
        return { kind: 'track', box: { ...ranked[0].c.det.box }, coasting: false }
      }
      if (gap < ASK_GAP && this.miss + 1 >= this.lostFrames) {
        return { kind: 'ask', candidates: ranked.map((r) => r.c.det) }
      }
    }
    return this.coast(pred)
  }

  /** Ответ на «Кто из них ваш?»: слежение продолжается с выбранной рамки. */
  resolve(det: Detection): void {
    const c = centerOf(det.box)
    this.kx.update(c.x)
    this.ky.update(c.y)
    this.w = det.box.w
    this.h = det.box.h
    this.lastBox = { ...det.box }
    this.miss = 0
  }

  private candidates(dets: Detection[], pred: Box): Cand[] {
    const radius = Math.min(GATE_MAX, GATE_BASE + GATE_GROW * this.miss)
    const norm = Math.max(this.h, MIN_NORM_HEIGHT)
    const pc = centerOf(pred)
    const out: Cand[] = []
    for (const det of dets) {
      const ratio = det.box.h / this.h
      if (ratio < SIZE_RATIO_MIN || ratio > SIZE_RATIO_MAX) continue
      const c = centerOf(det.box)
      const dist = Math.hypot(c.x - pc.x, c.y - pc.y) / norm
      const ov = iou(pred, det.box)
      if (ov < GATE_IOU && dist >= radius) continue
      out.push({
        det,
        iou: ov,
        dist,
        app: appearanceDistance(this.look, det.look),
        overlapped: dets.some((o) => o !== det && iou(o.box, det.box) > OVERLAP_IOU),
        merged: det.box.w > this.w * MERGE_WIDTH_RATIO
      })
    }
    return out
  }

  private accept(c: Cand, confident: boolean): void {
    const b = c.det.box
    const ctr = centerOf(b)
    this.kx.update(ctr.x)
    this.ky.update(ctr.y)
    this.w += SIZE_BLEND * (b.w - this.w)
    this.h += SIZE_BLEND * (b.h - this.h)
    this.lastBox = { ...b }
    this.miss = 0
    if (confident && !c.overlapped && !c.merged) {
      if (this.dirty) {
        this.look.set(c.det.look)
        this.dirty = false
      } else {
        blendLook(this.look, c.det.look, APPEARANCE_BLEND)
      }
    }
  }

  private coast(pred: Box): StepResult {
    this.miss += 1
    if (this.frame && this.leavesFrame(pred)) return this.die('out')
    if (this.miss >= this.lostFrames) return this.die('occluded')
    return { kind: 'track', box: pred, coasting: true }
  }

  /** Последняя рамка у края кадра, а прогноз вышел за этот край. */
  private leavesFrame(pred: Box): boolean {
    const fr = this.frame as { w: number; h: number }
    const mx = fr.w * EDGE_MARGIN
    const my = fr.h * EDGE_MARGIN
    const b = this.lastBox
    const c = centerOf(pred)
    return (
      (b.x < mx && c.x < 0) ||
      (b.x + b.w > fr.w - mx && c.x > fr.w) ||
      (b.y < my && c.y < 0) ||
      (b.y + b.h > fr.h - my && c.y > fr.h)
    )
  }

  private die(reason: 'cut' | 'out' | 'occluded'): StepResult {
    this.dead = { kind: 'lost', reason }
    return this.dead
  }
}
