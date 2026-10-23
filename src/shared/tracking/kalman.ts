// Фильтр Калмана с постоянной скоростью по одной оси (положение, скорость; шаг — кадр).

export class Kalman1D {
  p: number
  v: number
  // Ковариация 2×2: [[pp, pv], [pv, vv]]
  private pp: number
  private pv = 0
  private vv: number

  constructor(
    p: number,
    private readonly q: number,
    private readonly r: number
  ) {
    this.p = p
    this.v = 0
    this.pp = r
    this.vv = 25
  }

  /** Независимая копия состояния (для отката шага). */
  clone(): Kalman1D {
    const k = new Kalman1D(this.p, this.q, this.r)
    k.v = this.v
    k.pp = this.pp
    k.pv = this.pv
    k.vv = this.vv
    return k
  }

  /** Дисперсия положения (пиксели²): неопределённость прогноза (только чтение). */
  get variance(): number {
    return this.pp
  }

  /** Прогноз на dt кадров вперёд. */
  predict(dt = 1): void {
    this.p += this.v * dt
    const { pp, pv, vv } = this
    this.pp = pp + 2 * dt * pv + dt * dt * vv + this.q * dt * dt * dt * dt * 0.25
    this.pv = pv + dt * vv + this.q * dt * dt * dt * 0.5
    this.vv = vv + this.q * dt * dt
  }

  /** Поправка по измеренному положению. */
  update(z: number): void {
    const s = this.pp + this.r
    const kp = this.pp / s
    const kv = this.pv / s
    const y = z - this.p
    this.p += kp * y
    this.v += kv * y
    const { pp, pv } = this
    this.pp = (1 - kp) * pp
    this.pv = (1 - kp) * pv
    this.vv = this.vv - kv * pv
  }
}
