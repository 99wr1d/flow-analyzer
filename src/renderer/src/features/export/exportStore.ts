// Состояние окна экспорта: настройки, ход работы, результат.
import { create } from 'zustand'
import type {
  ExportEncoderChoice,
  ExportEncoderInfo,
  ExportMode,
  ExportPrecision,
  ExportProgress,
  ExportResult
} from '../../../../shared/export'
import type { Scope } from './selection'

/** Форма настроек → идёт экспорт → результат. */
export type ExportPhase = 'form' | 'running' | 'result'

export interface ExportState {
  open: boolean
  phase: ExportPhase
  scope: Scope
  /** Отмеченные вручную эпизоды (id). */
  picked: string[]
  mode: ExportMode
  precision: ExportPrecision
  /** Чем кодировать: «Авто» — видеокарта, если есть, или всегда процессор. */
  encoder: ExportEncoderChoice
  /** Что нашла проверка кодеров; null — проверка ещё идёт. */
  encoderInfo: ExportEncoderInfo | null
  /** «С рисунками»: null — по умолчанию (включено, если рисунки попадают в экспорт). */
  withDrawings: boolean | null
  /** Идёт подготовка картинок с рисунками (до запуска ffmpeg): сделано / всего. */
  preparing: { done: number; total: number } | null
  /** Подготовка покадровых картинок движущихся рисунков: сделано / всего кадров. */
  animPreparing: { done: number; total: number } | null
  /** Запас по краям — текст поля (проверяется при вводе). */
  padding: string
  progress: ExportProgress | null
  /** Когда начался экспорт (мс), для таймера на экране. */
  startedAt: number | null
  cancelling: boolean
  result: ExportResult | null
  /** Запрос не принят до начала работы (понятный текст). */
  error: string | null
  /** Окно приложения хотят закрыть во время экспорта — ждём ответа пользователя. */
  closePrompt: boolean
}

export const useExportStore = create<ExportState>()(() => ({
  open: false,
  phase: 'form',
  scope: 'all',
  picked: [],
  mode: 'files',
  precision: 'precise',
  encoder: 'auto',
  encoderInfo: null,
  withDrawings: null,
  preparing: null,
  animPreparing: null,
  padding: '0',
  progress: null,
  startedAt: null,
  cancelling: false,
  result: null,
  error: null,
  closePrompt: false
}))
