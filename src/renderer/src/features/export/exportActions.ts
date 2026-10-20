// Действия экспорта: открыть окно, запустить, отменить, показать результат. Их вызывают и кнопки, и команда Ctrl+E.
import { isMoving, keysOf, movingIndices } from '../../../../shared/animation'
import type { Episode } from '../../../../shared/episodes'
import { OVERLAY_LIMITS, type ExportRequest } from '../../../../shared/export'
import { UNTITLED_PROJECT } from '../../../../shared/project'
import { usePlayerStore } from '../../store/playerStore'
import { useAnnotationsStore } from '../annotations/annotationsStore'
import { useCalibrationsStore } from '../pitch/calibrationsStore'
import { effectiveKey, ensureGrassEstimate, grassValues, useGrassStore } from '../under/grassStore'
import { sortEpisodes, useEpisodesStore } from '../episodes/episodesStore'
import { getVideoElement } from '../player/videoElement'
import { useProjectStore } from '../project/projectStore'
import { planExportView, WHOLE_VIDEO_LABEL, type ExportPlan } from './exportPlan'
import { useExportStore, type ExportState } from './exportStore'
import {
  RenderCancelled,
  animationLayers,
  renderAnimationFrames,
  renderOverlayImages
} from './renderOverlays'
import { chooseEpisodes, parsePadding } from './selection'

const UNKNOWN_ERROR = 'Не удалось выполнить экспорт'
export const DRAWINGS_ERRORS = {
  tooMany: `Слишком много разных наборов рисунков для одного экспорта (больше ${OVERLAY_LIMITS.maxKeys}). Экспортируйте по частям или отключите «С рисунками»`,
  noVideo: 'Не удалось определить размер видео для рисунков. Откройте видео заново',
  tooBig: 'Видео слишком большое, чтобы нанести на него рисунки. Отключите «С рисунками»',
  render:
    'Не удалось подготовить рисунки для экспорта. Попробуйте ещё раз или отключите «С рисунками»',
  animTooMany: `Слишком много кадров с анимацией (больше ${OVERLAY_LIMITS.maxAnimFrames}). Выберите отрезки покороче или экспортируйте по частям`
} as const

const set = useExportStore.setState
const get = useExportStore.getState

/** Экспорт возможен, когда видео открыто: эпизодов может не быть — тогда экспортируется всё видео целиком. */
export function canExport(): boolean {
  return usePlayerStore.getState().status === 'ready'
}

export const isExportRunning = (): boolean => get().open && get().phase === 'running'

/** Открывает окно настроек экспорта. Если экспорт уже идёт — просто показывает его. */
export function openExportDialog(): void {
  if (get().open) return
  if (!canExport()) return
  const { items, filter, ratingFilter } = useEpisodesStore.getState()
  set({
    open: true,
    phase: 'form',
    scope:
      items.length === 0
        ? 'whole'
        : filter.length > 0 || ratingFilter.length > 0
          ? 'visible'
          : 'all',
    picked: items.map((e) => e.id),
    encoder: 'auto',
    encoderInfo: null,
    withDrawings: null,
    preparing: null,
    animPreparing: null,
    progress: null,
    startedAt: null,
    cancelling: false,
    result: null,
    error: null,
    closePrompt: false
  })
  // Проверка видеокарты занимает до пары секунд и запоминается; окно при этом уже открыто.
  void window.api
    .getExportEncoderInfo()
    .then((info) => {
      if (get().open) set({ encoderInfo: info })
    })
    .catch(() => {
      if (get().open) set({ encoderInfo: { gpuLabel: null } })
    })
}

export function closeExportDialog(): void {
  if (get().phase === 'running') return
  set({ open: false, result: null, progress: null, error: null })
}

/** Эпизоды, которые сейчас выбраны в окне экспорта (по порядку начала). */
export function selectedForExport(): Episode[] {
  const { items, filter, ratingFilter } = useEpisodesStore.getState()
  const { scope, picked } = get()
  return chooseEpisodes(scope, sortEpisodes(items), filter, new Set(picked), ratingFilter)
}

/** План экспорта по текущим настройкам окна (для сводки, переключателя «С рисунками» и запуска). */
export function currentExportPlan(
  state: ExportState = get(),
  episodes: readonly Episode[] = selectedForExport()
): ExportPlan {
  const player = usePlayerStore.getState()
  const padding = parsePadding(state.padding)
  return planExportView({
    scope: state.scope,
    episodes,
    mode: state.mode,
    padding: padding.ok ? padding.value : 0,
    duration: player.duration,
    fps: player.fps,
    timings: useAnnotationsStore.getState().items.map((a) => a.timing),
    animated: new Set(movingIndices(useAnnotationsStore.getState().items))
  })
}

/** «Быстро» (копирование потока) выбрано и действует: для «Подборки» оно недоступно. */
export function isFastMode(state: Pick<ExportState, 'scope' | 'mode' | 'precision'>): boolean {
  const compilation = state.scope !== 'whole' && state.mode === 'compilation'
  return !compilation && state.precision === 'fast'
}

/** Наносить ли рисунки: выбор пользователя, а по умолчанию — да, если рисунки попадают в экспорт. «Быстро» рисунки не умеет. */
export function drawingsEnabled(
  state: Pick<ExportState, 'scope' | 'mode' | 'precision' | 'withDrawings'>,
  plan: ExportPlan
): boolean {
  return plan.hasDrawings && !isFastMode(state) && (state.withDrawings ?? true)
}

let currentRun: Promise<void> | null = null
let prepareCancelled = false

type DrawingsRequest = NonNullable<ExportRequest['drawings']>

/**
 * Готовит рисунки: рисует PNG по плану, отправляет их в main и возвращает данные для запроса.
 * null — рисунков нет; { error } — понятная ошибка; 'cancelled' — пользователь остановил подготовку.
 */
async function prepareDrawings(
  plan: ExportPlan | null
): Promise<DrawingsRequest | { error: string } | 'cancelled' | null> {
  if (!plan) return null
  if (plan.keys.length > OVERLAY_LIMITS.maxKeys) return { error: DRAWINGS_ERRORS.tooMany }
  if (plan.animFrames.length > OVERLAY_LIMITS.maxAnimFrames) {
    return { error: DRAWINGS_ERRORS.animTooMany }
  }
  const video = getVideoElement()
  const source = usePlayerStore.getState().source
  const width = video?.videoWidth ?? 0
  const height = video?.videoHeight ?? 0
  if (!(width > 0 && height > 0)) return { error: DRAWINGS_ERRORS.noVideo }
  if (width > OVERLAY_LIMITS.maxSide || height > OVERLAY_LIMITS.maxSide) {
    return { error: DRAWINGS_ERRORS.tooBig }
  }
  const annotations = useAnnotationsStore.getState().items
  const fps = usePlayerStore.getState().fps
  try {
    set({ preparing: { done: 0, total: plan.keys.length }, animPreparing: null })
    const images = await renderOverlayImages({
      annotations,
      calibrations: useCalibrationsStore.getState().items,
      keys: plan.keys,
      width,
      height,
      isCancelled: () => prepareCancelled,
      onProgress: (done, total) => set({ preparing: { done, total } })
    })
    if (prepareCancelled) return 'cancelled'
    const { token } = await window.api.stageExportOverlays({
      width,
      height,
      images: images.map((i) => ({ key: i.key, data: i.data, layer: i.layer }))
    })
    if (prepareCancelled) return 'cancelled'
    // Движущиеся рисунки: по картинке на каждый кадр, порциями (в main они складываются во временную папку).
    const animLayers = animationLayers(annotations, plan.animFrames)
    if (plan.animFrames.length > 0 && (animLayers.over || animLayers.under)) {
      set({ animPreparing: { done: 0, total: plan.animFrames.length } })
      await renderAnimationFrames({
        annotations,
        calibrations: useCalibrationsStore.getState().items,
        frames: plan.animFrames,
        fps,
        width,
        height,
        layers: animLayers,
        isCancelled: () => prepareCancelled,
        onProgress: (done, total) => set({ animPreparing: { done, total } }),
        flush: async (layer, frames) => {
          if (prepareCancelled) throw new RenderCancelled()
          await window.api.stageExportFrames({ token, layer, frames })
        }
      })
      if (prepareCancelled) return 'cancelled'
    }
    const loupes = annotations.flatMap((a, index) =>
      a.type === 'loupe'
        ? [
            {
              index,
              pos: a.pos,
              src: a.src,
              radius: a.radius,
              zoom: a.zoom,
              ...(isMoving(a)
                ? {
                    keys: keysOf(a).map((k) => ({
                      t: k.t,
                      ...(k.ease ? { ease: k.ease } : {}),
                      pos: k.geom.pos as { x: number; y: number },
                      src: k.geom.src as { x: number; y: number }
                    }))
                  }
                : {})
            }
          ]
        : []
    )
    // Есть рисунки «под игроками»: ключ газона берётся из тех же настроек, что и на экране.
    let grass: DrawingsRequest['grass']
    if (images.some((i) => i.layer === 'under') || animLayers.under) {
      ensureGrassEstimate()
      const grassState = useGrassStore.getState()
      grass = grassValues(effectiveKey(grassState, source?.id))
    }
    return {
      token,
      fps,
      timings: annotations.map((a) => a.timing),
      loupes,
      animated: [...movingIndices(annotations)],
      animLayers,
      ...(grass ? { grass } : {})
    }
  } catch (error) {
    if (error instanceof RenderCancelled) return 'cancelled'
    // Понятное сообщение от main (например, «слишком много рисунков») показываем как есть.
    const text = error instanceof Error ? error.message : ''
    return { error: /[А-Яа-я]/.test(text) ? text : DRAWINGS_ERRORS.render }
  }
}

/** Запускает экспорт. Папку или файл спросит main системным диалогом. */
export function startExport(): Promise<void> {
  const state = get()
  if (state.phase === 'running') return currentRun ?? Promise.resolve()
  const player = usePlayerStore.getState()
  const source = player.source
  const padding = parsePadding(state.padding)
  const whole = state.scope === 'whole'
  const episodes = selectedForExport()
  if (!source || !padding.ok || (!whole && episodes.length === 0)) return Promise.resolve()
  if (whole && !(player.duration > 0)) return Promise.resolve()

  const project = useProjectStore.getState()
  const plan = currentExportPlan(state, episodes)
  const withDrawings = drawingsEnabled(state, plan)
  const mode = whole ? 'files' : state.mode
  const request: ExportRequest = {
    videoId: source.id,
    clips: whole
      ? [{ start: 0, end: player.duration, label: WHOLE_VIDEO_LABEL }]
      : episodes.map((e) => ({ start: e.start, end: e.end, label: e.tagName })),
    mode,
    // Подборку без перекодирования собрать нельзя, рисунки нанести тоже — тогда всегда «Точно».
    precision: mode === 'compilation' || withDrawings ? 'precise' : state.precision,
    encoder: state.encoder,
    quality: state.quality,
    padding: whole ? 0 : padding.value,
    projectName: project.path !== null && project.name !== UNTITLED_PROJECT ? project.name : null
  }

  prepareCancelled = false
  set({
    phase: 'running',
    progress: null,
    startedAt: Date.now(),
    cancelling: false,
    result: null,
    error: null,
    preparing: null
  })
  const backToForm = (error: string | null): void =>
    set({
      phase: 'form',
      startedAt: null,
      progress: null,
      preparing: null,
      animPreparing: null,
      error
    })

  currentRun = prepareDrawings(withDrawings ? plan : null)
    .then((drawings) => {
      if (drawings === 'cancelled') return backToForm(null)
      if (drawings && 'error' in drawings) return backToForm(drawings.error)
      set({ preparing: null, animPreparing: null })
      // Остановку нажали, пока подготовка заканчивалась: до запуска ffmpeg ещё можно отказаться.
      if (get().cancelling) return backToForm(null)
      return window.api
        .startExport(drawings ? { ...request, drawings } : request)
        .then((result) => {
          if (result.status === 'dialog-cancelled') set({ phase: 'form', startedAt: null })
          else set({ phase: 'result', result, startedAt: null, progress: null })
        })
    })
    .catch((error: unknown) => {
      set({
        phase: 'form',
        startedAt: null,
        progress: null,
        preparing: null,
        animPreparing: null,
        error: error instanceof Error && error.message ? error.message : UNKNOWN_ERROR
      })
    })
    .finally(() => {
      set({ cancelling: false })
      currentRun = null
      // Окно хотели закрыть, а экспорт закончился сам — закрывать можно без вопроса.
      if (get().closePrompt) answerClosePrompt(true)
    })
  return currentRun
}

/** Просит остановить экспорт. Недописанный файл main удаляет сам. */
export async function cancelExport(): Promise<void> {
  if (get().phase !== 'running') return
  // Рисунки ещё готовятся (ffmpeg не запущен): останавливаем подготовку.
  if (get().preparing !== null) prepareCancelled = true
  set({ cancelling: true })
  try {
    await window.api.cancelExport()
  } catch {
    /* если отменить не удалось, экспорт просто дойдёт до конца */
  }
}

/** Останавливает экспорт и ждёт, пока main уберёт недописанные файлы (для закрытия окна). */
export async function cancelExportAndWait(): Promise<void> {
  await cancelExport()
  await currentRun
}

export function revealExport(): void {
  window.api.revealExport().catch(() => undefined)
}

// --- Закрытие окна приложения во время экспорта ---

let closeResolver: ((stop: boolean) => void) | null = null

/** Спрашивает пользователя: остановить экспорт и закрыть окно (true) или продолжить экспорт (false). */
export function askStopForClose(): Promise<boolean> {
  closeResolver?.(false)
  return new Promise((resolve) => {
    closeResolver = resolve
    set({ closePrompt: true })
  })
}

export function answerClosePrompt(stop: boolean): void {
  const resolve = closeResolver
  closeResolver = null
  set({ closePrompt: false })
  resolve?.(stop)
}

/** Подписка на ход экспорта от main. */
export function installExportProgress(): () => void {
  return window.api.onExportProgress((progress) => {
    if (get().phase === 'running') set({ progress })
  })
}
