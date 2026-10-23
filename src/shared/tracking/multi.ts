// Слежение за несколькими игроками (Связка): N независимых SingleTracker, питаемых одним проходом детектора на кадр.
//
// Что добавляет этот слой к одиночному слежению:
//  * Исключительность: две цели никогда не владеют одной детекцией (converges: та же рамка либо IoU >= CONVERGE_IOU).
//    Спорная цель (дальше от своего прогноза, при равенстве — старший номер) откатывается к состоянию до кадра и
//    проходит кадр заново без этой детекции: «пережидает» либо берёт другую, как решит её трекер (примета не
//    портится — шаг откачен целиком). Если пережидание затянется, трекер сам спросит или потеряет цель.
//  * Личность только с запасом по всем целям одной формы (главное правило). Детекция подтверждает цель i — звеном
//    цепочки или уверенной рамкой трекера, — только если она однозначно продолжение i с учётом ВСЕХ целей такой же
//    формы, чьё место сейчас не известно (пережидают, спрошены, идут по неподтверждённой цепочке). Проверка — совместное
//    назначение (joint): всем таким целям рядом раздаются детекции или «пропуск» (детектор не видит игрока), и
//    назначение с i → эта детекция должно быть лучше любого другого на CHAIN_RUNNER_UP. Пропущенный игрок соседа —
//    «виртуальная детекция»: сосед не может «заполнить» пропуск. Нет запаса — сомнение: если детекций хватает на всех
//    спорящих, вопрос сейчас (настоящий игрок на кадре есть); если нет — цель пережидает (вопрос мог бы остаться без
//    правильного ответа), эпизод отмечается цепочкой, и при возвращении она будет подтверждена цепочкой или спрошена.
//    Ответ пользователя — известное место: после него проверка повторяется для остальных (вердикты тоже).
//  * Непрерывность (цепочка, см. tuning.ts): цель, пережидающая рядом с игроком такой же приметы, при возвращении
//    подтверждается цепочкой сырых детекций, а не только прогнозом. Расхождение или разрыв — вопрос по цели.
//    Прогноз ведёт к чужому при отскоке, поэтому сравнение «прямо или наоборот» по прогнозу не используется.
//  * Вопрос всегда с возможностью правильного ответа: рамки других целей, слившиеся с вариантом (IoU >= CONVERGE_IOU,
//    но не та же рамка), означают, что настоящий игрок мог быть отфильтрован, — тогда безопасный стоп, а не вопрос.
//  * Согласование: решения «сомнение/вопрос/потеря» принимает SingleTracker цели. Потеря любой цели — потеря всей
//    задачи. Вопрос по одной цели ставит на паузу всех: step/resolve возвращают вопросы по одному, следующий кадр
//    вызывающий не берёт, пока кадр не решён.
//  * Одна цель ведёт себя ровно как SingleTracker: соседей нет, проверки не срабатывают, варианты вопроса те же.
import { appearanceDistance } from './appearance'
import { minCostAssignment, perfectMatching } from './assign'
import { iou, SingleTracker, type TrackerSnapshot } from './tracker'
import {
  ASK_MAX_CANDIDATES,
  ASK_MAX_CANDIDATES_TOTAL,
  CHAIN_COUNT_RADIUS,
  CHAIN_MAX_SHIFT,
  CHAIN_MISS_COST,
  CHAIN_NEIGHBOUR_DIST,
  CHAIN_RUNNER_UP,
  CHAIN_SIMILAR_LOOK,
  CONVERGE_IOU,
  GATE_GROW,
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
  /** det — рамка, которую трекер цели взял уверенно, но личность не доказана (вопрос можно отложить: пережидать). */
  | { kind: 'ask'; cands: Detection[]; det?: Detection | null }
  | { kind: 'user'; box: Box }
  | { kind: 'lost'; reason: LostReason }

/** Цепочка непрерывности цели в эпизоде одинаковой формы: последняя рамка и детекция, к которой она привела. */
interface Chain {
  box: Box
  /** Рамка цепочки до последнего звена. */
  prev: Box
  det: Detection | null
  broken: boolean
}

/** Возможное место игрока цели: рамка и допуск вокруг неё (в высотах). */
interface Place {
  b: Box
  slack: number
}

const centre = (b: Box): { x: number; y: number } => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 })

/** Рамки «слились»: почти совпадающие (одна и та же детекция даёт IoU 1). */
export function converges(a: Box, b: Box): boolean {
  return iou(a, b) >= CONVERGE_IOU
}

const sameBox = (a: Box, b: Box): boolean =>
  a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

/** Расстояние между центрами рамок в единицах norm (пиксели). */
const apart = (a: Box, b: Box, norm: number): number => {
  const p = centre(a)
  const q = centre(b)
  return Math.hypot(p.x - q.x, p.y - q.y) / norm
}

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
  /** Номер кадра последней уверенной рамки цели (null — ещё не было кадров). */
  private readonly lastConfIndex: Array<number | null>
  /** Вопрос по цели в этом кадре рождён эпизодом одинаковой формы (цепочкой): только к нему добавляются игроки вокруг. */
  private episodeAsk: boolean[] = []
  private dead: MultiStep | null = null

  constructor(starts: MultiStart[], fps: number, frame?: { w: number; h: number }) {
    this.trackers = starts.map(
      (s) => new SingleTracker(s.det, fps, { ...(frame ? { frame } : {}), ...s.opts })
    )
    this.chains = starts.map(() => null)
    this.lastConf = starts.map((s) => ({ ...s.det.box }))
    this.lastConfIndex = starts.map(() => null)
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
    // Старт считается уверенным кадром перед первым шагом.
    this.lastConfIndex.forEach((v, i) => {
      if (v === null) this.lastConfIndex[i] = f.index - 1
    })
    this.dets = f.detections
    this.preds = this.predictBoxes(f.index)
    this.snaps = this.trackers.map((t) => t.snapshot())
    this.excluded = this.trackers.map(() => [])
    this.episodeAsk = this.trackers.map(() => false)
    this.slots = this.trackers.map((t) => this.toSlot(t.step(f), f.detections))
    this.updateChains()
    return this.settle()
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
    return this.settle()
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
    return apart(b, this.preds[i], Math.max(this.preds[i].h, MIN_NORM_HEIGHT))
  }

  /** Кандидаты вопроса для цели без надёжной цепочки: ближайшие к прогнозу той же формы, принятая рамка — в списке. */
  private generate(i: number, taken: Detection | null): Detection[] {
    const pred = this.preds[i]
    const near = this.dets
      .filter((d) => {
        const ratio = d.box.h / pred.h
        // Игрок другой формы (трекер его не взял бы никогда) в вопрос не попадает.
        return (
          ratio >= SIZE_RATIO_MIN &&
          ratio <= SIZE_RATIO_MAX &&
          this.offset(i, d.box) <= GATE_MAX &&
          appearanceDistance(this.trackers[i].appearance, d.look) < CHAIN_SIMILAR_LOOK
        )
      })
      .sort((p, q) => this.offset(i, p.box) - this.offset(i, q.box))
      .slice(0, ASK_MAX_CANDIDATES)
    if (taken && near.length > 0 && !near.includes(taken)) near[near.length - 1] = taken
    if (taken && near.length === 0) near.push(taken)
    return near
  }

  // --- Личность с запасом по всем целям одной формы ---

  /** Две цели одной формы (приметы ближе CHAIN_SIMILAR_LOOK): по примете их не различить. */
  private similar(i: number, j: number): boolean {
    return (
      appearanceDistance(this.trackers[i].appearance, this.trackers[j].appearance) <
      CHAIN_SIMILAR_LOOK
    )
  }

  /**
   * Место цели в этом кадре не установлено: пережидает, спрошена, либо идёт по цепочке, ещё не подтверждённой
   * (эпизод одинаковой формы не закрыт). Ответ пользователя и уверенная рамка вне эпизода — место известно.
   */
  private uncertain(j: number): boolean {
    const s = this.slots[j]
    if (s.kind === 'ask') return true
    if (s.kind !== 'track') return false
    return s.coasting || this.chains[j] !== null
  }

  /**
   * Где может быть игрок цели: прогноз и последняя уверенная рамка — с допуском slack (высоты), растущим, как ворота
   * трекера, с числом кадров без уверенной рамки (давно не виденный игрок мог уйти куда угодно в этих пределах);
   * живая цепочка (прошлое и текущее звено) — точно.
   */
  private places(j: number): Place[] {
    const age =
      this.frame && this.lastConfIndex[j] !== null
        ? this.frame.index - (this.lastConfIndex[j] as number) - 1
        : 0
    const slack = Math.min(GATE_MAX, GATE_GROW * Math.max(0, age))
    const out: Place[] = [
      { b: this.preds[j], slack },
      { b: this.lastConf[j], slack }
    ]
    const c = this.chains[j]
    if (c && !c.broken) out.push({ b: c.box, slack: 0 }, { b: c.prev, slack: 0 })
    return out
  }

  /**
   * Совместное назначение с запасом. Группа — цель i и цели той же формы с неизвестным местом (см. uncertain), которым
   * детекция det (или одна из seeds) по силам (не дальше CHAIN_COUNT_RADIUS от одного из их мест). Каждой цели группы назначается своя
   * детекция той же формы рядом либо «пропуск» (детектор её игрока не видит, цена CHAIN_MISS_COST); цена детекции —
   * расстояние до ближайшего места цели (у i — ownPlaces) в высотах за вычетом допуска места. Сравниваются лучшее назначение с i → det и лучшее
   * без него: margin — их разница. Так пропущенный детектором игрок соседа — «виртуальная детекция»: его место спорит с
   * рамкой, и сосед не может «заполнить» пропуск; а устаревшее место соседа, чей игрок виден в другой рамке, не мешает.
   * full — у каждой цели группы может быть свой игрок на кадре (назначение без пропусков существует).
   */
  private joint(
    i: number,
    det: Detection | null,
    ownPlaces: Place[],
    seeds: Detection[] = det ? [det] : []
  ): { margin: number; full: boolean } {
    const norm = Math.max(seeds[0]?.box.h ?? this.preds[i].h, MIN_NORM_HEIGHT)
    const placesOf = (j: number): Place[] => (j === i ? ownPlaces : this.places(j))
    const cost = (j: number, d: Detection): number =>
      Math.min(...placesOf(j).map((p) => Math.max(0, apart(d.box, p.b, norm) - p.slack)))
    const group = [i]
    for (let j = 0; j < this.slots.length; j += 1) {
      if (j === i || !this.uncertain(j) || !this.similar(i, j)) continue
      if (seeds.some((d) => cost(j, d) <= CHAIN_COUNT_RADIUS)) group.push(j)
    }
    if (group.length === 1) return { margin: Infinity, full: true }
    const known = this.ownedByOthers(i)
    const look = this.trackers[i].appearance
    const pool = this.dets.filter(
      (d) =>
        seeds.includes(d) ||
        (!known.some((b) => sameBox(d.box, b)) &&
          appearanceDistance(look, d.look) < CHAIN_SIMILAR_LOOK &&
          group.some((j) => cost(j, d) <= CHAIN_COUNT_RADIUS))
    )
    // Матрица назначения: строки — цели группы (i первая), столбцы — детекции pool и по одному «пропуску» на цель.
    // Детекция дальше CHAIN_COUNT_RADIUS от мест цели ей запрещена. Венгерский алгоритм — O((g+P)³), без перебора.
    const reach = group.map((j) =>
      pool.map((d) => cost(j, d)).map((c) => (c <= CHAIN_COUNT_RADIUS ? c : Infinity))
    )
    const matrix = (rows: number[], banned: number): number[][] =>
      rows.map((r) => [
        ...reach[r].map((c, k) => (k === banned ? Infinity : c)),
        ...group.map((_, q) => (q === r ? CHAIN_MISS_COST : Infinity))
      ])
    const all = group.map((_, r) => r)
    const di = det ? pool.indexOf(det) : -1
    let withDet = Infinity
    if (di >= 0 && Number.isFinite(reach[0][di])) {
      // i -> det, остальные — лучшее назначение без det.
      withDet = reach[0][di] + minCostAssignment(matrix(all.slice(1), di))
    }
    // i не на det: запрещаем ей этот столбец.
    const rest = matrix(all, -1)
    if (di >= 0) rest[0][di] = Infinity
    const without = minCostAssignment(rest)
    // full — у каждой цели группы своя детекция (назначение без пропусков).
    const full = perfectMatching(reach.map((row) => row.map((c) => Number.isFinite(c))))
    return { margin: without - withDet, full }
  }

  // --- Цепочки непрерывности ---

  /** Рядом с последней уверенной рамкой цели есть игрок такой же приметы (другая цель). */
  private hasSimilarNeighbour(i: number): boolean {
    const mine = this.lastConf[i]
    const norm = Math.max(mine.h, MIN_NORM_HEIGHT)
    for (let j = 0; j < this.slots.length; j += 1) {
      if (j === i) continue
      const s = this.slots[j]
      if (s.kind !== 'track' && s.kind !== 'user') continue
      if (!this.similar(i, j)) continue
      if (apart(s.box, mine, norm) <= CHAIN_NEIGHBOUR_DIST) return true
    }
    return false
  }

  /**
   * Звено цепочки: детекция с наименьшим смещением центра. Звено рвётся, если смещение велико, вторая детекция почти так
   * же близка, или эта детекция с тем же запасом может быть игроком другой цели такой же формы (см. contested).
   */
  private link(i: number): void {
    const c = this.chains[i]
    if (!c || c.broken) return
    const norm = Math.max(c.box.h, MIN_NORM_HEIGHT)
    // Рамка цели с известным местом (уверенная вне эпизода или подтверждённая пользователем) — её игрок, не звено i.
    const known = this.ownedByOthers(i)
    const ranked = this.dets
      .filter((d) => !known.some((b) => sameBox(d.box, b)))
      .map((d) => ({ d, shift: apart(d.box, c.box, norm) }))
      .sort((a, b) => a.shift - b.shift)
    const best = ranked[0]
    if (
      !best ||
      best.shift > CHAIN_MAX_SHIFT ||
      (ranked.length > 1 && ranked[1].shift - best.shift < CHAIN_RUNNER_UP) ||
      this.joint(i, best.d, [{ b: c.box, slack: 0 }]).margin < CHAIN_RUNNER_UP
    ) {
      c.broken = true
      return
    }
    c.prev = c.box
    c.box = { ...best.d.box }
    c.det = best.d
  }

  private newChain(i: number, broken: boolean): Chain {
    const box = { ...this.lastConf[i] }
    return { box, prev: box, det: null, broken }
  }

  private ensureChain(i: number, confident = false): void {
    const s = this.slots[i]
    if (s.kind !== 'track' || (!confident && !s.coasting) || this.chains[i]) return
    if (!this.hasSimilarNeighbour(i)) return
    this.chains[i] = this.newChain(i, false)
    this.link(i)
  }

  private updateChains(): void {
    const n = this.slots.length
    for (let i = 0; i < n; i += 1) {
      const s = this.slots[i]
      if (s.kind === 'track' && s.coasting && !this.chains[i] && this.hasSimilarNeighbour(i)) {
        this.chains[i] = this.newChain(i, false)
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
      if (c && s.kind === 'ask') this.episodeAsk[i] = true
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
      this.slots[i] = { kind: 'ask', cands, det }
      this.episodeAsk[i] = true
    }
  }

  /**
   * Дополнительные варианты вопроса в эпизоде одинаковой формы (только при нескольких целях): игроки той же формы вокруг
   * последней уверенной рамки цели. Прогноз пережидающей цели мог уйти не туда (отскок), и настоящий игрок оказаться
   * вне ворот трекера: без этих вариантов ответить правильно было бы нельзя. Игроки другой формы не добавляются.
   */
  private extras(i: number, have: Detection[]): Detection[] {
    if (this.trackers.length < 2 || !(this.episodeAsk[i] || this.chains[i])) return []
    const last = this.lastConf[i]
    const norm = Math.max(last.h, MIN_NORM_HEIGHT)
    const look = this.trackers[i].appearance
    return this.dets
      .filter((d) => {
        const ratio = d.box.h / last.h
        return (
          ratio >= SIZE_RATIO_MIN &&
          ratio <= SIZE_RATIO_MAX &&
          !have.includes(d) &&
          appearanceDistance(look, d.look) < CHAIN_SIMILAR_LOOK
        )
      })
      .map((d) => ({ d, dist: apart(d.box, last, norm) }))
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
      // Уступившая цель, которой пользователь уже назвал другую рамку, общей детекцию больше не делает.
      const shared = this.excluded.some(
        (list, j) => j !== i && this.slots[j].kind !== 'user' && list.includes(det)
      )
      if (!shared) continue
      const c = this.chains[i]
      if (c && !c.broken && c.det && sameBox(c.det.box, det.box)) continue
      this.redo(i, det)
      changed = true
    }
    return changed
  }

  /**
   * Уверенная рамка, не доказанная цепочкой, которая с запасом CHAIN_RUNNER_UP может быть игроком другой цели такой же
   * формы с неизвестным местом (см. contested): сомнение. Цель откатывается и проходит кадр без этой рамки (пережидает
   * или берёт другую), эпизод отмечается разорванной цепочкой — при возвращении её спросят. Откатывается одна цель за
   * раз (с наименьшим запасом), затем всё пересчитывается: откаченная цель сама становится «неизвестной».
   */
  private demoteContested(): boolean {
    let worst: { i: number; det: Detection; full: boolean } | null = null
    let worstMargin = Infinity
    for (let i = 0; i < this.slots.length; i += 1) {
      const s = this.slots[i]
      if (s.kind !== 'track' || s.coasting || !s.det) continue
      const c = this.chains[i]
      if (c && !c.broken && c.det && sameBox(c.det.box, s.det.box)) continue
      const { margin, full } = this.joint(i, s.det, this.places(i))
      if (margin >= CHAIN_RUNNER_UP || margin >= worstMargin) continue
      worstMargin = margin
      worst = { i, det: s.det, full }
    }
    if (!worst) return false
    const { i, det, full } = worst
    if (full) {
      // У каждой спорящей цели может быть свой игрок на кадре: настоящий игрок цели есть среди детекций — спрашиваем.
      this.chains[i] = null
      this.slots[i] = { kind: 'ask', cands: this.generate(i, det), det }
      this.episodeAsk[i] = true
      return true
    }
    // Детекций меньше, чем спорящих целей: чей-то игрок пропущен детектором, вопрос мог бы остаться без правильного
    // ответа. Цель пережидает; эпизод отмечен разорванной цепочкой — при возвращении её подтвердят или спросят.
    this.chains[i] ??= this.newChain(i, true)
    this.redo(i, det)
    return true
  }

  /**
   * Кадр приводится в согласие после шага и после каждого ответа: исключительность, цепочки, доказательство личности,
   * вердикты. Вердикты нужны и после ответа: ответ мог откатить другую цель, и та взяла другую рамку — её личность
   * снова проверяется цепочкой (иначе соседняя рамка прошла бы молча).
   */
  private settle(): MultiStep {
    for (;;) {
      const dead = this.settleConflicts()
      if (dead) return dead
      this.checkClaims()
      if (this.demoteUnprovenWinners()) continue
      if (!this.demoteContested()) break
    }
    return this.present()
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

  /**
   * Варианты вопроса по цели i. Рамка, закреплённая за другой целью, не предлагается. Если вариант с ней «слился»
   * (IoU >= CONVERGE_IOU, но это другая рамка), настоящий игрок мог оказаться за ней и выпасть из списка: вопрос без
   * правильного ответа не задаём — null (безопасный стоп). Так же, если детекций рядом меньше, чем спорящих целей.
   */
  private askList(i: number, cands: Detection[]): Detection[] | null {
    const others = this.ownedByOthers(i)
    const all = [...cands]
    for (const d of this.extras(i, cands)) if (!all.includes(d)) all.push(d)
    const out: Detection[] = []
    for (const c of all) {
      if (others.some((b) => sameBox(c.box, b))) continue
      if (others.some((b) => converges(c.box, b))) return null
      out.push(c)
    }
    if (out.length === 0) return null
    // Рядом цели той же формы с неизвестным местом, а детекций на всех не хватает: игрок цели мог быть пропущен
    // детектором, и правильного варианта в вопросе может не быть — безопасный стоп (одна цель: проверка не действует).
    if (!this.joint(i, null, this.places(i), out).full) return null
    return out.slice(0, ASK_MAX_CANDIDATES_TOTAL)
  }

  private present(): MultiStep {
    this.verdicts()
    for (let i = 0; i < this.slots.length; i += 1) {
      const s = this.slots[i]
      if (s.kind !== 'ask') continue
      if (this.chains[i]) this.episodeAsk[i] = true
      const candidates = this.askList(i, s.cands)
      if (!candidates) {
        // Правильного варианта может не быть. Вопрос, рождённый уверенной рамкой, откладываем: цель пережидает без неё
        // (эпизод — разорванная цепочка), кадр согласуется заново. Вопрос самого трекера (срок вышел) — безопасный стоп.
        if (!s.det) return this.die(i, 'occluded')
        this.chains[i] = this.newChain(i, true)
        this.redo(i, s.det)
        return this.settle()
      }
      return { kind: 'ask', target: i, candidates }
    }
    const boxes: Box[] = []
    const coasting: boolean[] = []
    this.slots.forEach((s, i) => {
      if (s.kind === 'track') {
        boxes.push(s.box)
        coasting.push(s.coasting)
        if (!s.coasting) {
          this.lastConf[i] = { ...s.box }
          this.lastConfIndex[i] = this.frame?.index ?? null
        }
      } else if (s.kind === 'user') {
        boxes.push({ ...s.box })
        coasting.push(false)
        this.lastConf[i] = { ...s.box }
        this.lastConfIndex[i] = this.frame?.index ?? null
      }
    })
    return { kind: 'track', boxes, coasting }
  }
}
