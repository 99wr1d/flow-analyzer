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
  APPEARANCE_REJECT,
  ASK_MAX_CANDIDATES,
  COAST_SECONDS,
  EDGE_MARGIN,
  GATE_BASE,
  GATE_GROW,
  GATE_IOU,
  GATE_MAX,
  DIRTY_CONTINUITY_DIST,
  DIRTY_CONTINUITY_IOU,
  DOUBT_APPEARANCE,
  DOUBT_DIST,
  HIDDEN_BETTER_MARGIN,
  KALMAN_Q,
  KALMAN_R,
  LOST_SECONDS,
  MERGE_WIDTH_RATIO,
  MIN_NORM_HEIGHT,
  OVERLAP_IOU,
  RECOVER_APPEARANCE_WEIGHT,
  RECOVER_DISTANCE_WEIGHT,
  RECOVER_FAR_DIST,
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
  private kx: Kalman1D
  private ky: Kalman1D
  private w: number
  private h: number
  private readonly look: Float32Array
  private dirty: boolean
  private readonly coastFrames: number
  private readonly lostFrames: number
  private readonly frame?: { w: number; h: number }
  private miss = 0
  private lastBox: Box
  private lastDets: Detection[] = []
  private doubtful: Cand[] = []
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
    }
    const pred: Box = { x: this.kx.p - this.w / 2, y: this.ky.p - this.h / 2, w: this.w, h: this.h }
    this.lastDets = f.detections
    const cands = this.candidates(f.detections, pred)

    if (this.miss === 0) {
      // Пока примета «грязная» (взята рядом с соседом), единственный кандидат в воротах — сомнение: это может быть
      // сосед, а наш игрок скрыт. Молча берём только явное продолжение движения (почти на прогнозе); примету не обновляем.
      // Иначе пережидание, по истечении срока — вопрос.
      if (this.dirty) {
        const lone = cands.length === 1 ? cands[0] : null
        if (
          lone &&
          !lone.overlapped &&
          !lone.merged &&
          lone.dist <= DIRTY_CONTINUITY_DIST &&
          lone.iou >= DIRTY_CONTINUITY_IOU
        ) {
          this.accept(lone, false)
          return { kind: 'track', box: { ...lone.det.box }, coasting: false }
        }
        return this.coast(pred)
      }
      // Рядом с прогнозом есть «чуть непохожая» рамка (возможно, наш игрок в тени): чистого соседа молча не берём.
      if (this.doubtful.length > 0) return this.coast(pred)
      const scored = cands
        .map((c) => ({
          c,
          cost:
            ASSOC_APPEARANCE_WEIGHT * c.app +
            (1 - ASSOC_APPEARANCE_WEIGHT) * (0.5 * (1 - c.iou) + 0.5 * Math.min(c.dist, 1))
        }))
        .sort((p, q) => p.cost - q.cost)
      const best = scored[0]
      // Два почти равных кандидата — не выбираем молча: пережидание (затем, при сомнении, вопрос).
      const gap = scored.length > 1 ? scored[1].cost - best.cost : Infinity
      if (
        best &&
        best.cost <= TRACK_MAX_COST &&
        !best.c.overlapped &&
        !best.c.merged &&
        gap >= ASK_GAP
      ) {
        this.accept(best.c, true)
        return { kind: 'track', box: { ...best.c.det.box }, coasting: false }
      }
      return this.coast(pred)
    }

    const recoverCost = (c: Cand): number =>
      RECOVER_APPEARANCE_WEIGHT * (this.dirty ? 0 : c.app) +
      RECOVER_DISTANCE_WEIGHT * Math.min(c.dist, 1)
    const ranked = cands
      .filter((c) => !c.overlapped && !c.merged)
      .map((c) => ({ c, cost: recoverCost(c) }))
      .sort((p, q) => p.cost - q.cost)
    // Лучше подходит рамка, которая пока слита/перекрыта, чем чистая, но хуже — ждём, пока она освободится.
    const hidden = [...cands.filter((c) => c.overlapped || c.merged), ...this.doubtful].map(
      recoverCost
    )
    // Сомнительная рамка (наш игрок, но примета ушла) не хуже чистой с запасом ASK_GAP: чистую молча не берём.
    const doubtCosts = this.doubtful.map(recoverCost)
    if (
      ranked.length > 0 &&
      ((hidden.length > 0 && Math.min(...hidden) + HIDDEN_BETTER_MARGIN < ranked[0].cost) ||
        (doubtCosts.length > 0 && ranked[0].cost > Math.min(...doubtCosts) - ASK_GAP))
    ) {
      if (this.miss + 1 >= this.coastFrames && this.doubtful.length > 0) {
        return {
          kind: 'ask',
          candidates: [...ranked.map((r) => r.c), ...this.doubtful]
            .sort((p, q) => recoverCost(p) - recoverCost(q))
            .slice(0, ASK_MAX_CANDIDATES)
            .map((c) => c.det)
        }
      }
      return this.coast(pred)
    }
    if (ranked.length > 0) {
      // С «грязной» приметой различать кандидатов нечем: больше одного — только вопрос.
      // Единственный кандидат при «грязной» примете — тоже сомнение (отрыв 0): молча не берём, по истечении срока спросим.
      const gap = this.dirty ? 0 : ranked.length > 1 ? ranked[1].cost - ranked[0].cost : Infinity
      // Далеко от прогноза: похожий игрок мог оказаться и чужим — молча не берём, по истечении срока спросим.
      const far = ranked[0].c.dist > RECOVER_FAR_DIST
      if (gap >= ASK_GAP && !far && ranked[0].cost <= RECOVER_MAX_COST) {
        this.accept(ranked[0].c, false)
        return { kind: 'track', box: { ...ranked[0].c.det.box }, coasting: false }
      }
      if (
        (gap < ASK_GAP || (far && ranked[0].cost <= RECOVER_MAX_COST)) &&
        this.miss + 1 >= this.coastFrames
      ) {
        return {
          kind: 'ask',
          candidates: ranked.slice(0, ASK_MAX_CANDIDATES).map((r) => r.c.det)
        }
      }
    }
    return this.coast(pred)
  }

  /** Где трекер ждёт игрока на кадре index (состояние не меняется): центр выреза для детектора. */
  predictBox(index: number): Box {
    const dt = this.lastIndex === null ? 1 : Math.max(1, index - this.lastIndex)
    return {
      x: this.kx.p + this.kx.v * dt - this.w / 2,
      y: this.ky.p + this.ky.v * dt - this.h / 2,
      w: this.w,
      h: this.h
    }
  }

  /** Ответ на «Кто из них ваш?»: слежение продолжается с выбранной рамки. */
  resolve(det: Detection): void {
    const clean =
      det.box.w <= this.w * MERGE_WIDTH_RATIO &&
      !this.lastDets.some((o) => o !== det && iou(o.box, det.box) > OVERLAP_IOU)
    const c = centerOf(det.box)
    // Прогноз по старой траектории больше не годится: заново с выбранной рамки.
    this.kx = new Kalman1D(c.x, KALMAN_Q, KALMAN_R)
    this.ky = new Kalman1D(c.y, KALMAN_Q, KALMAN_R)
    this.w = det.box.w
    this.h = det.box.h
    this.lastBox = { ...det.box }
    this.miss = 0
    // Рамка с примесью соседа примету не обновляет и «грязность» не снимает.
    if (clean) {
      this.look.set(det.look)
      this.dirty = false
    }
  }

  private candidates(dets: Detection[], pred: Box): Cand[] {
    this.doubtful = []
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
      const app = appearanceDistance(this.look, det.look)
      const overlapped = dets.some((o) => o !== det && iou(o.box, det.box) > OVERLAP_IOU)
      const merged = det.box.w > this.w * MERGE_WIDTH_RATIO
      // Другая форма — не наш игрок, как бы близко он ни стоял (пока примета не «грязная»). У слитой/перекрытой рамки
      // примета испорчена соседом: её не отбрасываем (взять её нельзя, но она показывает, что настоящий игрок ещё тут).
      if (!this.dirty && app > APPEARANCE_REJECT && !overlapped && !merged) {
        // Чуть непохожа, но стоит почти там, где ждали игрока: брать нельзя, но и молча брать другого рядом тоже.
        if (app <= DOUBT_APPEARANCE && dist <= DOUBT_DIST) {
          this.doubtful.push({ det, iou: ov, dist, app, overlapped, merged })
        }
        continue
      }
      out.push({ det, iou: ov, dist, app, overlapped, merged })
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
      blendLook(this.look, c.det.look, APPEARANCE_BLEND)
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
