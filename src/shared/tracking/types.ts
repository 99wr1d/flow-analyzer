// Слежение за игроком: общие типы трекера (чистый TS, без Electron, DOM и ONNX).

/** Рамка в пикселях кадра детектора (кадры декодируются в 960×540). */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface Detection {
  box: Box
  score: number
  /** HSV-гистограммы верхней и нижней половин рамки: 2×(3×16), каждая гистограмма нормирована (lookOf). */
  look: Float32Array
}

export interface FrameInput {
  index: number
  /** Середина кадра, секунды видео. */
  t: number
  detections: Detection[]
  /** Гистограмма всего кадра 3×16 для смены плана (frameHistOf). */
  frameHist: Float32Array
}

export type StepResult =
  | { kind: 'track'; box: Box; coasting: boolean }
  | { kind: 'ask'; candidates: Detection[] }
  | { kind: 'lost'; reason: 'cut' | 'out' | 'occluded' }

export type StartPick =
  { kind: 'ok'; det: Detection } | { kind: 'ambiguous'; candidates: Detection[] } | { kind: 'none' }

export interface TrackerOptions {
  /** Размер кадра детектора; нужен для вывода «ушёл за край». */
  frame?: { w: number; h: number }
  /** Старт был «грязным» (рамка пересекалась с соседом): примета берётся заново с первого чистого кадра. */
  dirtyStart?: boolean
}
