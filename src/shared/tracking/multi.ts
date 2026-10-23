// Слежение за несколькими игроками (Связка): N независимых SingleTracker, питаемых одним проходом детектора на кадр.
//
// Что добавляет этот слой к одиночному слежению:
//  * Исключительность: две цели никогда не владеют одной детекцией (converges: та же рамка либо IoU >= CONVERGE_IOU).
//    Спорная цель (дальше от своего прогноза, при равенстве — старший номер) откатывается к состоянию до кадра и
//    проходит кадр заново без этой детекции: «пережидает» либо берёт другую, как решит её трекер (примета не
//    портится — шаг откачен целиком). Если пережидание затянется, трекер сам спросит или потеряет цель.
//  * Непрерывность (цепочка, см. tuning.ts): цель, пережидающая рядом с игроком такой же приметы, при возвращении
//    подтверждается цепочкой сырых детекций, а не только прогнозом. Расхождение или разрыв — вопрос по цели.
//    Прогноз ведёт к чужому при отскоке, поэтому сравнение «прямо или наоборот» по прогнозу не используется.
//  * Согласование: решения «сомнение/вопрос/потеря» принимает SingleTracker цели. Потеря любой цели — потеря всей
//    задачи. Вопрос по одной цели ставит на паузу всех: step/resolve возвращают вопросы по одному, следующий кадр
//    вызывающий не берёт, пока кадр не решён.
//  * Одна цель ведёт себя ровно как SingleTracker: соседей нет, проверки не срабатывают.
import { appearanceDistance } from './appearance'
import { iou, SingleTracker, type TrackerSnapshot } from './tracker'
import {
  ASK_MAX_CANDIDATES,
  CHAIN_MAX_SHIFT,
  CHAIN_NEIGHBOUR_DIST,
  CHAIN_RUNNER_UP,
  CHAIN_SIMILAR_LOOK,
  CONVERGE_IOU,
  GATE_MAX,
  MIN_NORM_HEIGHT,
  SIZE_RATIO_MAX,
  SIZE_RATIO_MIN
} from './tuning'
import type { Box, Detection, FrameInput, StepResult, TrackerOptions } from './types'

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
  | { kind: 'ask'; cands: Detection[] }
  | { kind: 'user'; box: Box }
  | { kind: 'lost'; reason: LostReason }

/** Цепочка непрерывности пережидающей цели: последняя рамка и детекция, к которой она привела. */
interface Chain {
  box: Box
  det: Detection | null
  broken: boolean
}

const centre = (b: Box): { x: number; y: number } => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/** Рамки «слились»: почти совпадающие (одна и та же детекция даёт IoU 1). */
export function converges(a: Box, b: Box): boolean {
  return iou(a, b) >= CONVERGE_IOU
}

const sameBox = (a: Box, b: Box): boolean =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

export class MultiTracker {
  private readonly trackers: SingleTracker[]
  private slots: Slot[] = []
  private preds: Box[] = []
  private dets: Detection[] = []
  private frame: FrameInput | null = null
  private snaps: TrackerSnapshot[] = []
  private excluded: Detection[][] = []
  private readonly chains: Array<Chain | null>
  /** Рамка последнего уверенного кадра каждой цели (старт — рамка старта). */
  private readonly lastConf: Box[]
  private dead: MultiStep | null = null

  constructor(starts: MultiStart[], fps: number, frame?: { w: number; h: number }) {
    this.trackers = starts.map(
      (s) => new SingleTracker(s.det, fps, { ...(frame ? { frame } : {}), ...s.opts })
    )
    this.chains = starts.map(() => null)
    this.lastConf = starts.map((s) => ({ ...s.det.box }))
  }

  get size(): number {
    return this.trackers.length
  }

  /** Примета цели (только чтение; для проверок). */
  lookOf(target: number): Float32Array {
    return this.trackers[target].appearance
  }

  /** Где каждая цель ожидается на кадре index (для выреза детектора). */
  predictBoxes(index: number): Box[] {
    return this.trackers.map((t) => t.predictBox(index))
  }

  /** Один кадр: все цели по одним и тем же детекциям. Вопрос по цели — ответ через resolve. */
  step(f: FrameInput): MultiStep {
    if (this.dead) return this.dead
    this.frame = f
    this.dets = f.detections
    this.preds = this.predictBoxes(f.index)
    this.snaps = this.trackers.map((t) => t.snapshot())
    this.excluded = this.trackers.map(() => [])
    this.slots = this.trackers.map((t) => this.toSlot(t.step(f), f.detections))
    this.updateChains()
    return this.settle(true)
  }

  /** Ответ пользователя: рамка выбрана для цели (объект из списка candidates последнего вопроса). */
  resolve(target: number, det: Detection): MultiStep {
    if (this.dead) return this.dead
    const slot = this.slots[target]
    if (!slot || slot.kind !== 'ask') throw new Error('По этой цели вопроса нет')
    if (this.ownedByOthers(target).some((b) => converges(det.box, b))) {
      throw new Error('Эта рамка уже занята другой целью')
    }
    this.trackers[target].resolve(det)
    this.chains[target] = null
    this.slots[target] = { kind: 'user', box: { ...det.box } }
    return this.settle(false)
  }

  private toSlot(r: StepResult, dets: Detection[]): Slot {
    if (r.kind === 'lost') return { kind: 'lost', reason: r.reason }
    if (r.kind === 'ask') return { kind: 'ask', cands: r.candidates }
    const det = r.coasting ? null : (dets.find((d) => sameBox(d.box, r.box)) ?? null)
    return { kind: 'track', box: r.box, coasting: r.coasting, det }
  }

  /** Рамка цели, если за ней закреплён человек (уверенный кадр или ответ пользователя); при «пережидании» — нет. */
  private owned(i: number): Box | null {
    const s = this.slots[i]
    if (s.kind === 'user') return s.box
    if (s.kind === 'track' && !s.coasting) return s.box
    return null
  }

  /**
   * Рамки, закреплённые за другими целями. Рамка цели с живой цепочкой (личность в эпизоде не подтверждена) не
   * считается занятой: она может быть чужой ошибкой, и настоящий игрок спрашиваемой цели не должен пропадать из вариантов.
   * Если выбрана такая рамка, её прежняя владелица откатывается и проходит кадр заново (см. settle).
   */
  private ownedByOthers(i: number): Box[] {
    const out: Box[] = []
    this.slots.forEach((s, j) => {
      const b = j === i ? null : this.owned(j)
      if (!b || (s.kind === 'track' && this.chains[j])) return
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

  /** Кандидаты вопроса для цели без надёжной цепочки: ближайшие к прогнозу, принятая рамка — в списке. */
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
    if (taken && near.length === 0) near.push(taken)
    return near
  }

  // --- Цепочки непрерывности ---

  /** Рядом с последней уверенной рамкой цели есть игрок такой же приметы (другая цель). */
  private hasSimilarNeighbour(i: number): boolean {
    const mine = this.lastConf[i]
    const c = centre(mine)
    const norm = Math.max(mine.h, MIN_NORM_HEIGHT)
    for (let j = 0; j < this.slots.length; j += 1) {
      if (j === i) continue
      const s = this.slots[j]
      if (s.kind !== 'track' && s.kind !== 'user') continue
      if (
        appearanceDistance(this.trackers[i].appearance, this.trackers[j].appearance) >=
        CHAIN_SIMILAR_LOOK
      ) {
        continue
      }
      const o = centre(s.box)
      if (Math.hypot(o.x - c.x, o.y - c.y) / norm <= CHAIN_NEIGHBOUR_DIST) return true
    }
    return false
  }

  /** Звено цепочки: детекция с наименьшим смещением центра; сомнительное звено рвёт цепочку. */
  private link(i: number): void {
    const c = this.chains[i]
    if (!c || c.broken) return
    const from = centre(c.box)
    const norm = Math.max(c.box.h, MIN_NORM_HEIGHT)
    const ranked = this.dets
      .map((d) => {
        const p = centre(d.box)
        return { d, shift: Math.hypot(p.x - from.x, p.y - from.y) / norm }
      })
      .sort((a, b) => a.shift - b.shift)
    const best = ranked[0]
    if (
      !best ||
      best.shift > CHAIN_MAX_SHIFT ||
      (ranked.length > 1 && ranked[1].shift - best.shift < CHAIN_RUNNER_UP)
    ) {
      c.broken = true
      return
    }
    c.box = { ...best.d.box }
    c.det = best.d
  }

  private ensureChain(i: number, confident = false): void {
    const s = this.slots[i]
    if (s.kind !== 'track' || (!confident && !s.coasting) || this.chains[i]) return
    if (!this.hasSimilarNeighbour(i)) return
    this.chains[i] = { box: { ...this.lastConf[i] }, det: null, broken: false }
    this.link(i)
  }

  private updateChains(): void {
    const n = this.slots.length
    for (let i = 0; i < n; i += 1) {
      const s = this.slots[i]
      if (s.kind === 'track' && s.coasting && !this.chains[i] && this.hasSimilarNeighbour(i)) {
        this.chains[i] = { box: { ...this.lastConf[i] }, det: null, broken: false }
      }
    }
    for (let i = 0; i < n; i += 1) this.link(i)
  }

  /** Одну детекцию нельзя занять дважды: две цепочки на ней, либо цепочка на рамке уверенно ведомой цели без цепочки. */
  private checkClaims(): void {
    const n = this.slots.length
    for (let i = 0; i < n; i += 1) {
      const ci = this.chains[i]
      if (!ci || ci.broken || !ci.det) continue
      for (let j = 0; j < n; j += 1) {
        if (j === i) continue
        const cj = this.chains[j]
        if (cj) {
          if (!cj.broken && cj.det && sameBox(cj.det.box, ci.det.box)) {
            ci.broken = true
            cj.broken = true
          }
        } else {
          const b = this.owned(j)
          if (b && sameBox(b, ci.det.box)) ci.broken = true
        }
      }
    }
  }

  /** Цель снова уверена: подтверждаем цепочкой; расхождение или разрыв — вопрос по цели. */
  private verdicts(): void {
    // Пока другая цель с цепочкой ещё не уверена, личность не доказана и у уверенной: цепочка живёт дальше.
    const unsettled = (i: number): boolean =>
      this.chains.some((c, j) => {
        if (!c || j === i) return false
        const sj = this.slots[j]
        return sj.kind !== 'track' || sj.coasting
      })
    for (let i = 0; i < this.slots.length; i += 1) {
      const c = this.chains[i]
      const s = this.slots[i]
      if (!c || s.kind !== 'track' || s.coasting) continue
      const det = s.det
      const agree = !c.broken && c.det && det && sameBox(c.det.box, det.box)
      if (agree) {
        if (!unsettled(i)) this.chains[i] = null
        continue
      }
      // Цепочка разорвана или ведёт к другой детекции, чем прогноз: молча не выбираем.
      this.chains[i] = null
      const cands = !c.broken && c.det && det ? [det, c.det] : this.generate(i, det)
      this.slots[i] = { kind: 'ask', cands }
    }
  }

  /**
   * Дополнительные варианты вопроса: игроки вокруг последней уверенной рамки цели. Прогноз пережидающей цели мог уйти
   * не туда (отскок), и настоящий игрок оказаться вне ворот трекера: без этих вариантов ответить правильно было бы нельзя.
   */
  private extras(i: number, have: Detection[]): Detection[] {
    const last = this.lastConf[i]
    const c0 = centre(last)
    const norm = Math.max(last.h, MIN_NORM_HEIGHT)
    return this.dets
      .filter((d) => {
        const ratio = d.box.h / last.h
        return ratio >= SIZE_RATIO_MIN && ratio <= SIZE_RATIO_MAX && !have.includes(d)
      })
      .map((d) => {
        const c = centre(d.box)
        return { d, dist: Math.hypot(c.x - c0.x, c.y - c0.y) / norm }
      })
      .filter((x) => x.dist <= GATE_MAX)
      .sort((a, b) => a.dist - b.dist)
      .slice(0, ASK_MAX_CANDIDATES)
      .map((x) => x.d)
  }

  private die(target: number, reason: LostReason): MultiStep {
    this.dead = { kind: 'lost', target, reason }
    return this.dead
  }

  /** Цель откатывается к началу кадра и проходит его заново без детекции det (и всех прежних исключённых). */
  private redo(i: number, det: Detection): void {
    this.excluded[i].push(det)
    this.trackers[i].restore(this.snaps[i])
    const rest = this.dets.filter((d) => !this.excluded[i].includes(d))
    this.slots[i] = this.toSlot(
      this.trackers[i].step({ ...(this.frame as FrameInput), detections: rest }),
      rest
    )
    // Взяла другую детекцию рядом с игроком такой же приметы — та же проверка цепочкой.
    this.ensureChain(i, true)
  }

  /**
   * Общая детекция (её уступила спорная цель) не может давать уверенную рамку, если цепочка победителя разорвана,
   * отсутствует или ведёт к другой детекции: победитель тоже откатывается (пережидает либо берёт другую).
   */
  private demoteUnprovenWinners(): boolean {
    let changed = false
    for (let i = 0; i < this.slots.length; i += 1) {
      const s = this.slots[i]
      if (s.kind !== 'track' || s.coasting || !s.det) continue
      const det = s.det
      if (!this.excluded.some((list) => list.includes(det))) continue
      const c = this.chains[i]
      if (c && !c.broken && c.det && sameBox(c.det.box, det.box)) continue
      this.redo(i, det)
      changed = true
    }
    return changed
  }

  private settle(withVerdicts: boolean): MultiStep {
    for (;;) {
      const dead = this.settleConflicts()
      if (dead) return dead
      this.checkClaims()
      if (!this.demoteUnprovenWinners()) break
    }
    return this.present(withVerdicts)
  }

  private settleConflicts(): MultiStep | null {
    for (;;) {
      for (let i = 0; i < this.slots.length; i += 1) {
        const s = this.slots[i]
        if (s.kind === 'lost') return this.die(i, s.reason)
      }
      // Исключительность: две цели с уверенной рамкой на одной детекции. Спорная цель откатывается и проходит кадр
      // без неё (при равенстве расстояний — старший номер). Подтверждённую пользователем цель не трогаем.
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
      if (s.kind !== 'track' || !s.det) return this.die(suspect, 'occluded')
      this.redo(suspect, s.det)
      // Победитель спора тоже не знает, кто из двоих на общей рамке: его личность подтверждается цепочкой.
      this.ensureChain(suspect === i ? j : i, true)
    }
    return null
  }

  private present(withVerdicts: boolean): MultiStep {
    if (withVerdicts) this.verdicts()
    for (let i = 0; i < this.slots.length; i += 1) {
      const s = this.slots[i]
      if (s.kind !== 'ask') continue
      // Рамки, закреплённые за другими целями, чужому не предлагаем.
      const others = this.ownedByOthers(i)
      const free = (c: Detection): boolean => !others.some((b) => converges(c.box, b))
      const candidates = [...s.cands.filter(free), ...this.extras(i, s.cands).filter(free)]
      if (candidates.length === 0) return this.die(i, 'occluded')
      return { kind: 'ask', target: i, candidates }
    }
    const boxes: Box[] = []
    const coasting: boolean[] = []
    this.slots.forEach((s, i) => {
      if (s.kind === 'track') {
        boxes.push(s.box)
        coasting.push(s.coasting)
        if (!s.coasting) this.lastConf[i] = { ...s.box }
      } else if (s.kind === 'user') {
        boxes.push({ ...s.box })
        coasting.push(false)
        this.lastConf[i] = { ...s.box }
      }
    })
    return { kind: 'track', boxes, coasting }
  }
}
