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
//  * Безымянные игроки той же формы (Ghost): игроки рядом с целями, которых никто не ведёт (партнёры по команде), — лёгкие
//    следы (ближайший сосед + постоянная скорость). В совместном назначении они такие же соперники, как цели с неизвестным
//    местом: чужой игрок не может «заполнить» пропуск детектора, исчезновение соседа — сомнение, а не повод взять его
//    рамку. Действует и для одной цели (одиночное кольцо): без соседей той же формы поведение = SingleTracker.
//  * Непрерывность (цепочка, см. tuning.ts): цель, пережидающая рядом с игроком такой же приметы, при возвращении
//    подтверждается цепочкой сырых детекций, а не только прогнозом. Расхождение или разрыв — вопрос по цели.
//    Прогноз ведёт к чужому при отскоке, поэтому сравнение «прямо или наоборот» по прогнозу не используется.
//  * Вопрос всегда с возможностью правильного ответа: рамки других целей, слившиеся с вариантом (IoU >= CONVERGE_IOU,
//    но не та же рамка), означают, что настоящий игрок мог быть отфильтрован, — тогда безопасный стоп, а не вопрос.
//  * Согласование: решения «сомнение/вопрос/потеря» принимает SingleTracker цели. Потеря любой цели — потеря всей
//    задачи. Вопрос по одной цели ставит на паузу всех: step/resolve возвращают вопросы по одному, следующий кадр
//    вызывающий не берёт, пока кадр не решён.
//  * Одна цель без соседей той же формы ведёт себя ровно как SingleTracker: проверки не срабатывают, варианты те же.
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
  KALMAN_R,
  NEWCOMER_SIGMAS,
  CONVERGE_IOU,
  GATE_GROW,
  LOST_SECONDS,
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

/**
 * Безымянный игрок той же формы рядом с целью (не цель): лёгкий след — последняя рамка, скорость, кадр, когда видели.
 * Нужен, чтобы пропавшую из детектора цель не «заполнил» чужой игрок: в совместном назначении он соперник цели.
 */
interface Ghost {
  box: Box
  vx: number
  vy: number
  seen: number
  look: Float32Array
  /**
   * След заведён на «подозрительной» рамке цели (возможно, новичок, возможно, её же игрок вернулся не там): для
   * вопросов этой цели он не считается отдельным игроком — иначе вопрос с её собственным игроком был бы невозможен.
   */
  suspectOf?: number
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
  /** Детекции прошлого кадра: «новая» рамка — та, которой рядом на прошлом кадре не было. */
  private prevDets: Detection[] = []
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
  /**
   * Кадр, когда цель вернулась уверенно после «пережидания» (игрок не был виден), не подтверждённая цепочкой или ответом:
   * её личность после возвращения не доказана. Пока не прошло LOST_SECONDS, новый игрок той же формы без истории рядом
   * с ней — сомнение (см. newcomerDoubt).
   */
  private readonly recoveredAt: Array<number | null>
  /**
   * Кадр последнего возвращения цели после пропуска, не подтверждённого ответом пользователя (в отличие от recoveredAt
   * не сбрасывается вопросом): рамки с этого кадра могут быть на неотличимом новичке (см. provenUntil).
   */
  private readonly unprovenSince: Array<number | null>
  /** Безымянные игроки той же формы рядом с целями (см. Ghost). */
  private ghosts: Ghost[] = []
  private readonly lostFrames: number

  constructor(starts: MultiStart[], fps: number, frame?: { w: number; h: number }) {
    this.trackers = starts.map(
      (s) => new SingleTracker(s.det, fps, { ...(frame ? { frame } : {}), ...s.opts })
    )
    this.chains = starts.map(() => null)
    this.lastConf = starts.map((s) => ({ ...s.det.box }))
    this.lastConfIndex = starts.map(() => null)
    this.recoveredAt = starts.map(() => null)
    this.unprovenSince = starts.map(() => null)
    this.lostFrames = Math.max(1, Math.round(LOST_SECONDS * fps))
  }

  get size(): number {
    return this.trackers.length
  }

  /** Примета цели (только чтение; для проверок). */
  lookOf(target: number): Float32Array {
    return this.trackers[target].appearance
  }

  /**
   * До какого кадра (номер, включительно) рамкам цели можно верить: до кадра перед последним возвращением после пропуска,
   * не подтверждённым ответом (короткая подмена на неотличимом новичке могла начаться там), иначе — до последнего
   * уверенного кадра. null — уверенных кадров ещё не было. Только чтение (для ответа «моего тут нет»).
   */
  provenUntil(target: number): number | null {
    const since = this.unprovenSince[target]
    if (since !== null) return since - 1
    return this.lastConfIndex[target]
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
    this.prevDets = this.dets
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
    this.recoveredAt[target] = null
    this.unprovenSince[target] = null
    // Ответ снимает подозрение, но не забывает соседей: подозреваемые цели остаются обычными безымянными следами
    // (иначе на следующем кадре, если её рамка пропадёт, сосед рядом прошёл бы молча — ответ обнуляет скорость Калмана).
    // След, сидевший на выбранной рамке (по месту, без допуска давности), — это сама цель: он удаляется.
    const norm = Math.max(det.box.h, MIN_NORM_HEIGHT)
    this.ghosts = this.ghosts.filter(
      (g) => !this.ghostPlaces(g).some((p) => apart(det.box, p.b, norm) <= CHAIN_MAX_SHIFT / 2)
    )
    for (const g of this.ghosts) if (g.suspectOf === target) g.suspectOf = undefined
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
    // Участники: цель i, цели той же формы с неизвестным местом и безымянные игроки той же формы (они всегда «неизвестны»).
    const look = this.trackers[i].appearance
    const candidates: Place[][] = []
    for (let j = 0; j < this.slots.length; j += 1) {
      if (j !== i && this.uncertain(j) && this.similar(i, j)) candidates.push(this.places(j))
    }
    for (const g of this.ghosts) {
      if (det === null && g.suspectOf === i) continue
      if (appearanceDistance(look, g.look) < CHAIN_SIMILAR_LOOK)
        candidates.push(this.ghostPlaces(g))
    }
    const costOf = (pl: Place[], d: Detection): number =>
      Math.min(...pl.map((p) => Math.max(0, apart(d.box, p.b, norm) - p.slack)))
    const members: Place[][] = [ownPlaces]
    for (const pl of candidates) {
      if (seeds.some((d) => costOf(pl, d) <= CHAIN_COUNT_RADIUS)) members.push(pl)
    }
    const group = members.map((_, k) => k)
    const cost = (k: number, d: Detection): number => costOf(members[k], d)
    const known = this.ownedByOthers(i)
    const pool = this.dets.filter(
      (d) =>
        seeds.includes(d) ||
        (!known.some((b) => sameBox(d.box, b)) &&
          appearanceDistance(look, d.look) < CHAIN_SIMILAR_LOOK &&
          group.some((j) => cost(j, d) <= CHAIN_COUNT_RADIUS))
    )
    // Соперников нет: запас бесконечен, но и тогда вопрос задаётся, только если игрок цели может быть на кадре
    // (какая-то детекция рядом объясняет его дешевле пропуска).
    if (group.length === 1) {
      return { margin: Infinity, full: pool.some((d) => cost(0, d) < CHAIN_MISS_COST) }
    }
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
    // full — у каждой участницы может быть своя детекция (назначение без пропусков), и лучшее назначение считает
    // игрока цели i видимым на кадре (с детекцией дешевле, чем с пропуском). Иначе вопрос мог бы остаться без
    // правильного ответа: лишние детекции рядом могут быть чужими, которых никто не ведёт.
    const seen = matrix(all, -1)
    seen[0][pool.length] = Infinity
    const missing = CHAIN_MISS_COST + minCostAssignment(matrix(all.slice(1), -1))
    const full =
      perfectMatching(reach.map((row) => row.map((c) => Number.isFinite(c)))) &&
      minCostAssignment(seen) < missing
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
    const look = this.trackers[i].appearance
    return this.ghosts.some(
      (g) =>
        appearanceDistance(look, g.look) < CHAIN_SIMILAR_LOOK &&
        apart(g.box, mine, norm) <= CHAIN_NEIGHBOUR_DIST
    )
  }

  // --- Безымянные игроки той же формы ---

  /** Где может быть безымянный игрок: прогноз по постоянной скорости и последняя рамка, допуск растёт с пропуском. */
  private ghostPlaces(g: Ghost): Place[] {
    const age = Math.max(1, (this.frame?.index ?? g.seen + 1) - g.seen)
    const slack = Math.min(GATE_MAX, GATE_GROW * (age - 1))
    const pred = { ...g.box, x: g.box.x + g.vx * age, y: g.box.y + g.vy * age }
    return [
      { b: pred, slack },
      { b: g.box, slack }
    ]
  }

  /**
   * Кадр решён: обновляем безымянных игроков. Свободные детекции (не рамки целей) той же формы, что хоть одна цель,
   * связываются с безымянными по ближайшему прогнозу — только если безымянному детекция ближе, чем любой цели с
   * неизвестным местом (иначе это, возможно, игрок самой цели). Оставшиеся рядом с целями (не дальше
   * CHAIN_NEIGHBOUR_DIST) и не по силам неизвестным целям — новые безымянные. Не виденные LOST_SECONDS — забываются.
   */
  private updateGhosts(): void {
    const f = this.frame as FrameInput
    const n = this.slots.length
    const taken = new Set<Detection>()
    for (let i = 0; i < n; i += 1) {
      const b = this.owned(i)
      if (!b) continue
      for (const d of this.dets) if (sameBox(d.box, b)) taken.add(d)
    }
    const unknown = Array.from({ length: n }, (_, i) => i).filter((i) => this.uncertain(i))
    const kin = (d: Detection): boolean =>
      this.trackers.some((t) => appearanceDistance(t.appearance, d.look) < CHAIN_SIMILAR_LOOK)
    const free = this.dets.filter((d) => !taken.has(d) && kin(d))
    const targetCost = (d: Detection): number => {
      const norm = Math.max(d.box.h, MIN_NORM_HEIGHT)
      let best = Infinity
      for (const i of unknown) {
        if (appearanceDistance(this.trackers[i].appearance, d.look) >= CHAIN_SIMILAR_LOOK) continue
        for (const p of this.places(i))
          best = Math.min(best, Math.max(0, apart(d.box, p.b, norm) - p.slack))
      }
      return best
    }
    const pairs: Array<{ g: Ghost; d: Detection; c: number }> = []
    for (const g of this.ghosts) {
      for (const d of free) {
        const norm = Math.max(d.box.h, MIN_NORM_HEIGHT)
        const c = Math.min(
          ...this.ghostPlaces(g).map((p) => Math.max(0, apart(d.box, p.b, norm) - p.slack))
        )
        // «Подозреваемый» цели — её соперник по определению: связывается и там, где детекция ближе к самой цели.
        if (c <= CHAIN_MAX_SHIFT && (g.suspectOf !== undefined || c < targetCost(d)))
          pairs.push({ g, d, c })
      }
    }
    pairs.sort((a, b) => a.c - b.c)
    const usedG = new Set<Ghost>()
    const usedD = new Set<Detection>()
    for (const { g, d } of pairs) {
      if (usedG.has(g) || usedD.has(d)) continue
      usedG.add(g)
      usedD.add(d)
      const dt = Math.max(1, f.index - g.seen)
      const p = centre(g.box)
      const q = centre(d.box)
      g.vx = 0.5 * g.vx + 0.5 * ((q.x - p.x) / dt)
      g.vy = 0.5 * g.vy + 0.5 * ((q.y - p.y) / dt)
      g.box = { ...d.box }
      g.seen = f.index
      g.look = d.look
    }
    const nearTarget = (b: Box): boolean =>
      this.lastConf.some((c) => apart(b, c, Math.max(c.h, MIN_NORM_HEIGHT)) <= CHAIN_NEIGHBOUR_DIST)
    for (const d of free) {
      if (usedD.has(d) || !nearTarget(d.box)) continue
      if (targetCost(d) > CHAIN_COUNT_RADIUS) {
        this.ghosts.push({ box: { ...d.box }, vx: 0, vy: 0, seen: f.index, look: d.look })
        continue
      }
      // Рядом с целью, чьё место неизвестно, появился новый игрок той же формы (на прошлом кадре рядом никого не было):
      // это может быть её игрок, а может — вышедший из-за спины чужой. Он становится её «подозреваемым» соперником:
      // молча она его не возьмёт, а в её вопросах он не считается отдельным игроком.
      const norm = Math.max(d.box.h, MIN_NORM_HEIGHT)
      const isNew = !this.prevDets.some(
        (q) =>
          appearanceDistance(q.look, d.look) < CHAIN_SIMILAR_LOOK &&
          apart(q.box, d.box, norm) <= CHAIN_MAX_SHIFT
      )
      const owner = unknown.find((i) =>
        this.places(i).some(
          (p) => Math.max(0, apart(d.box, p.b, norm) - p.slack) <= CHAIN_COUNT_RADIUS
        )
      )
      if (isNew && owner !== undefined) {
        this.ghosts.push({
          box: { ...d.box },
          vx: 0,
          vy: 0,
          seen: f.index,
          look: d.look,
          suspectOf: owner
        })
      }
    }
    this.ghosts = this.ghosts.filter(
      (g) => f.index - g.seen <= this.lostFrames && (g.seen === f.index || nearTarget(g.box))
    )
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
      // Цепочка разорвана, но ни одна цель с неизвестным местом и ни один безымянный игрок той же формы до рамки не
      // достают (рамку прошла проверка новичка): спорить не с кем — как у одиночной цели. Цепочка разорвалась из-за
      // пропуска детектора, а не из-за соседа; личность после возвращения проверяется новичками (recoveredAt).
      if (c.broken && det && this.joint(i, det, this.places(i)).margin === Infinity) {
        this.chains[i] = null
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
    if (!(this.episodeAsk[i] || this.chains[i])) return []
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
    if (this.newcomerDoubt()) return true
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
    if (full && this.ownVisible(i)) {
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
   * Игрок той же формы, впервые появившийся рядом с целью, пока её игрок не виден, — «новичок» без истории: безымянного
   * следа у него нет (рядом с целью, чьё место неизвестно, след не заводится, иначе он «съел» бы игрока самой цели).
   * Два правила:
   *  1. Цель возвращается после пропуска на рамку дальше NEWCOMER_DIST от прогноза, у которой нет безымянной истории:
   *     это может быть новичок, а игрок цели всё ещё не виден. Если рядом есть ещё детекция той же формы — вопрос (оба
   *     на кадре), иначе цель пережидает; на сроке трекера — вопрос (его проверит askList).
   *  2. Цель недавно вернулась без доказательства (recoveredAt, не дольше LOST_SECONDS): если рядом с ней появилась
   *     новая детекция той же формы без истории (не цель, не безымянный, не по силам цели с неизвестным местом), одна из
   *     двух — возможно, её настоящий игрок: вопрос с обеими.
   * Цель, просто вернувшаяся у прогноза, без новичков рядом, подтверждается молча.
   */
  private newcomerDoubt(): boolean {
    const f = this.frame?.index
    if (f === undefined) return false
    for (let i = 0; i < this.slots.length; i += 1) {
      const s = this.slots[i]
      if (s.kind !== 'track' || s.coasting || !s.det) continue
      const c = this.chains[i]
      // Цепочка доказывает непрерывность с последней уверенной рамкой, но не то, что та была её игроком: правило 2
      // (новичок рядом после возвращения) действует и при согласной цепочке, правило 1 — нет.
      const chained = !!(c && !c.broken && c.det && sameBox(c.det.box, s.det.box))
      const det = s.det
      const look = this.trackers[i].appearance
      const norm = Math.max(det.box.h, MIN_NORM_HEIGHT)
      const known = this.ownedByOthers(i)
      const explained = (d: Detection): boolean =>
        this.ghosts.some(
          (g) =>
            Math.min(
              ...this.ghostPlaces(g).map((p) => Math.max(0, apart(d.box, p.b, norm) - p.slack))
            ) <= CHAIN_MAX_SHIFT
        )
      const othersUnknown = (d: Detection): boolean =>
        this.slots.some(
          (_, j) =>
            j !== i &&
            this.uncertain(j) &&
            this.places(j).some(
              (p) => Math.max(0, apart(d.box, p.b, norm) - p.slack) <= CHAIN_COUNT_RADIUS
            )
        )
      const kinNear = this.dets.filter(
        (d) =>
          d !== det &&
          !known.some((b) => sameBox(d.box, b)) &&
          appearanceDistance(look, d.look) < CHAIN_SIMILAR_LOOK &&
          apart(d.box, det.box, norm) <= CHAIN_COUNT_RADIUS
      )
      const last = this.lastConfIndex[i]
      const missed = last === null ? 0 : f - last - 1
      if (
        !chained &&
        missed > 0 &&
        !explained(det) &&
        apart(det.box, this.preds[i], norm) > this.newcomerReach(i, norm)
      ) {
        // Подозрительная рамка становится безымянным следом: если это новичок, он и дальше будет соперником цели
        // (её допуск со временем растёт, и иначе новичок прошёл бы позже); свой игрок, вернувшись у прогноза, его обойдёт.
        if (!explained(det)) {
          this.ghosts.push({
            box: { ...det.box },
            vx: 0,
            vy: 0,
            seen: f,
            look: det.look,
            suspectOf: i
          })
        }
        if (kinNear.length > 0 || missed + 1 >= this.lostFrames) {
          this.slots[i] = { kind: 'ask', cands: [...this.generate(i, det)], det }
          this.episodeAsk[i] = true
          for (const d of kinNear) this.addCand(i, d)
        } else {
          this.redo(i, det)
        }
        return true
      }
      const since = this.recoveredAt[i]
      if (missed === 0 && (since === null || f - since > this.lostFrames)) continue
      const fresh = kinNear.filter((d) => !explained(d) && !othersUnknown(d))
      if (fresh.length === 0) continue
      // Цель уже недавно возвращалась без доказательства: её прогноз мог уйти за чужим — новый игрок рядом может быть её,
      // где бы он ни был относительно прогноза (вопрос с обоими ниже).
      const probation = since !== null && f - since <= this.lostFrames
      if (missed > 0 && !probation) {
        // Новый игрок дальше разброса прогноза цели её игроком быть не может: сомнения нет (он станет обычным безымянным).
        const reach = this.newcomerReach(i, norm)
        if (!fresh.some((d) => apart(d.box, this.preds[i], norm) <= reach)) continue
        // Цель возвращается, а рядом сразу несколько новых игроков той же формы: какой из них её (и есть ли её среди них)
        // — неизвестно. Все новые рамки (и взятая) становятся её «подозреваемыми» соперниками, цель пережидает; свой
        // игрок, появившись у прогноза, обойдёт их с запасом, иначе будет вопрос.
        for (const d of [det, ...fresh]) {
          if (!explained(d)) {
            this.ghosts.push({
              box: { ...d.box },
              vx: 0,
              vy: 0,
              seen: f,
              look: d.look,
              suspectOf: i
            })
          }
        }
        this.redo(i, det)
        return true
      }
      this.slots[i] = { kind: 'ask', cands: [...this.generate(i, det)], det }
      this.episodeAsk[i] = true
      for (const d of fresh) this.addCand(i, d)
      this.recoveredAt[i] = null
      return true
    }
    return false
  }

  /**
   * Насколько далеко от прогноза (в единицах norm) рамка цели после пропуска ещё объяснима самой целью: NEWCOMER_SIGMAS
   * стандартных отклонений расхождения по фильтру Калмана на этот кадр (в начале слежения и после долгого пропуска
   * скорость плохо известна — допуск шире; при устоявшемся движении — узкий).
   */
  private newcomerReach(i: number, norm: number): number {
    const snap = this.snaps[i]
    const f = this.frame?.index ?? 0
    const dt = Math.max(1, f - (snap.lastIndex ?? f - 1))
    const kx = snap.kx.clone()
    const ky = snap.ky.clone()
    kx.predict(dt)
    ky.predict(dt)
    // Разброс расхождения «рамка − прогноз»: неопределённость прогноза плюс шум измерения по обеим осям.
    return (NEWCOMER_SIGMAS * Math.sqrt(kx.variance + ky.variance + 2 * KALMAN_R)) / norm
  }

  /**
   * Игрок цели может быть на кадре: есть детекция той же формы там, где его ждёт фильтр Калмана (в пределах
   * NEWCOMER_SIGMAS разброса). Назначение с допуском, растущим с пропуском, тут слишком широко: незнакомый игрок той же
   * формы, которого никто не ведёт, «объяснил» бы цель, и вопрос остался бы без правильного варианта.
   */
  private ownVisible(i: number): boolean {
    const look = this.trackers[i].appearance
    return this.dets.some((d) => {
      if (appearanceDistance(look, d.look) >= CHAIN_SIMILAR_LOOK) return false
      const norm = Math.max(d.box.h, MIN_NORM_HEIGHT)
      return apart(d.box, this.preds[i], norm) <= this.newcomerReach(i, norm)
    })
  }

  /** Добавить вариант в вопрос цели (без повторов). */
  private addCand(i: number, d: Detection): void {
    const s = this.slots[i]
    if (s.kind === 'ask' && !s.cands.includes(d)) s.cands.push(d)
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
    // «Подозреваемые» цели (новые игроки той же формы, появившиеся рядом, пока её не было видно): её игрок — один из них
    // или не виден. Если хоть один из них сейчас не виден детектору, им мог быть как раз её игрок: не спрашиваем.
    const suspects = this.ghosts.filter((g) => g.suspectOf === i)
    const visible = suspects.filter((g) =>
      this.dets.some((d) => {
        const norm = Math.max(d.box.h, MIN_NORM_HEIGHT)
        return this.ghostPlaces(g).some(
          (p) => Math.max(0, apart(d.box, p.b, norm) - p.slack) <= CHAIN_MAX_SHIFT
        )
      })
    )
    if (visible.length < suspects.length) return null
    // Вариантов больше, чем помещается в вопрос: настоящий игрок мог выпасть при обрезке — не спрашиваем.
    if (out.length > ASK_MAX_CANDIDATES_TOTAL) return null
    return out
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
          const f = this.frame?.index ?? null
          const prev = this.lastConfIndex[i]
          if (f !== null && prev !== null && prev < f - 1) {
            this.recoveredAt[i] = f
            this.unprovenSince[i] = f
          }
          this.lastConf[i] = { ...s.box }
          this.lastConfIndex[i] = f
        }
      } else if (s.kind === 'user') {
        boxes.push({ ...s.box })
        coasting.push(false)
        this.lastConf[i] = { ...s.box }
        this.lastConfIndex[i] = this.frame?.index ?? null
      }
    })
    this.updateGhosts()
    return { kind: 'track', boxes, coasting }
  }
}
