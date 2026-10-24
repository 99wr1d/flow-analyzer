// Реестр команд: id, подпись, группа, стандартные клавиши и действие. Все горячие клавиши приложения проходят через него.
import { DEFAULT_TAG_KEYS, tagCommandId, type TagDef } from '../../../../shared/settings'
import { usePlayerStore } from '../../store/playerStore'
import { useAnnotationsStore, type Tool } from '../annotations/annotationsStore'
import { addKeyHere, canUseKeys, gotoKey } from '../annotations/keyActions'
import { useEpisodesStore } from '../episodes/episodesStore'
import { cancelPolyDraft, finishPolyDraft, polyDraftActive } from '../annotations/polyDraft'
import { useCalibrationsStore } from '../pitch/calibrationsStore'
import { canCalibrate, explainNeedCalibration, startCalibration } from '../pitch/pitchActions'
import { applyTag, markIn, markOut, rateCurrent } from '../episodes/tagging'
import { canExport, openExportDialog } from '../export/exportActions'
import { redoAny, undoAny } from '../history/unified'
import { canOpenStats, openStats } from '../stats/statsActions'
import { openVideoFromDialog } from '../player/importVideo'
import {
  canSave,
  goHome,
  newProject,
  openProject,
  saveProject,
  saveProjectAs
} from '../project/actions'
import { useViewStore } from '../../app/viewStore'
import { changeRate, stepFrame, stepSecond, toggleMute, togglePlay } from '../player/videoElement'
import { useSettingsStore } from '../settings/settingsStore'
import { makeBinding, type Binding } from './binding'
import type { CommandMeta } from './keymap'
import { deleteSelection } from './selectionFocus'
import {
  addFrameHere,
  boardEscape,
  boardRedo,
  boardUndo,
  canEditBoard,
  deleteSelected,
  saveBoard,
  saveImage,
  selectBoardTool,
  stepBoardFrame,
  toggleBoardPlay
} from '../board/boardActions'
import { MAX_FRAMES } from '../../../../shared/board/schema'
import { useBoardStore } from '../board/boardStore'
import { useBoardUi } from '../board/boardUi'

export interface Command extends CommandMeta {
  run: () => void
  /** По умолчанию команда доступна всегда. */
  enabled?: () => boolean
}

const ready = (): boolean => usePlayerStore.getState().status === 'ready'
const key = (code: string, mods: { ctrl?: boolean; shift?: boolean } = {}): Binding =>
  makeBinding(code, mods)

function setTool(tool: Tool): () => void {
  return () => useAnnotationsStore.getState().setTool(tool)
}

function runRuler(): void {
  if (useCalibrationsStore.getState().items.length === 0) explainNeedCalibration()
  else useAnnotationsStore.getState().setTool('ruler')
}

/** Команда выбора нового инструмента этапа 15. */
function tool(id: Tool, name: string, code: string): Command {
  return {
    id: `draw:${id}`,
    label: `Инструмент «${name}»`,
    group: 'Рисование',
    defaults: [key(code)],
    run: setTool(id),
    enabled: ready
  }
}

/** Esc: сначала инструмент → «Выбор», затем снять выделение рисунка, затем сбросить метки, затем снять выделение эпизода. */
function escape(): void {
  // Недорисованная зона или связь: Esc отменяет только её, инструмент остаётся.
  if (cancelPolyDraft()) return
  const annotations = useAnnotationsStore.getState()
  if (annotations.tool !== 'select') return annotations.setTool('select')
  if (annotations.selectedId) return annotations.select(null)
  const episodes = useEpisodesStore.getState()
  if (episodes.inPoint !== null || episodes.outPoint !== null) return episodes.clearMarks()
  if (episodes.selectedId) episodes.select(null)
}

export const STATIC_COMMANDS: readonly Command[] = [
  {
    id: 'playback:toggle',
    label: 'Пуск / пауза',
    group: 'Воспроизведение',
    defaults: [key('Space')],
    run: togglePlay,
    enabled: ready
  },
  {
    id: 'playback:frame-back',
    label: 'Кадр назад',
    group: 'Воспроизведение',
    defaults: [key('ArrowLeft')],
    repeat: true,
    run: () => stepFrame(-1),
    enabled: ready
  },
  {
    id: 'playback:frame-forward',
    label: 'Кадр вперёд',
    group: 'Воспроизведение',
    defaults: [key('ArrowRight')],
    repeat: true,
    run: () => stepFrame(1),
    enabled: ready
  },
  {
    id: 'playback:second-back',
    label: 'Секунда назад',
    group: 'Воспроизведение',
    defaults: [key('ArrowLeft', { shift: true })],
    repeat: true,
    run: () => stepSecond(-1),
    enabled: ready
  },
  {
    id: 'playback:second-forward',
    label: 'Секунда вперёд',
    group: 'Воспроизведение',
    defaults: [key('ArrowRight', { shift: true })],
    repeat: true,
    run: () => stepSecond(1),
    enabled: ready
  },
  {
    id: 'playback:slower',
    label: 'Скорость медленнее',
    group: 'Воспроизведение',
    defaults: [key('BracketLeft')],
    run: () => changeRate(-1),
    enabled: ready
  },
  {
    id: 'playback:faster',
    label: 'Скорость быстрее',
    group: 'Воспроизведение',
    defaults: [key('BracketRight')],
    run: () => changeRate(1),
    enabled: ready
  },
  {
    id: 'playback:mute',
    label: 'Звук вкл / выкл',
    group: 'Воспроизведение',
    defaults: [key('KeyM')],
    run: toggleMute,
    enabled: ready
  },
  {
    id: 'draw:select',
    label: 'Инструмент «Выбор»',
    group: 'Рисование',
    defaults: [key('KeyV')],
    run: setTool('select'),
    enabled: ready
  },
  {
    id: 'draw:arrow',
    label: 'Инструмент «Стрелка»',
    group: 'Рисование',
    defaults: [key('KeyA')],
    run: setTool('arrow'),
    enabled: ready
  },
  {
    id: 'draw:line',
    label: 'Инструмент «Линия»',
    group: 'Рисование',
    defaults: [key('KeyL')],
    run: setTool('line'),
    enabled: ready
  },
  {
    id: 'draw:circle',
    label: 'Инструмент «Круг»',
    group: 'Рисование',
    defaults: [key('KeyC')],
    run: setTool('circle'),
    enabled: ready
  },
  {
    id: 'draw:text',
    label: 'Инструмент «Текст»',
    group: 'Рисование',
    defaults: [key('KeyT')],
    run: setTool('text'),
    enabled: ready
  },
  {
    id: 'draw:ruler',
    label: 'Инструмент «Линейка»',
    group: 'Рисование',
    defaults: [key('KeyR')],
    run: runRuler,
    enabled: ready
  },
  tool('spot', 'Прожектор', 'KeyS'),
  tool('curve', 'Изогнутая стрелка', 'KeyB'),
  tool('pen', 'Перо', 'KeyD'),
  tool('zone', 'Зона', 'KeyZ'),
  tool('chain', 'Связи игроков', 'KeyN'),
  tool('link', 'Связка', 'KeyK'),
  tool('loupe', 'Лупа', 'KeyG'),
  {
    id: 'anim:key-prev',
    label: 'К предыдущему ключу рисунка',
    group: 'Рисование',
    defaults: [key('Comma')],
    run: () => void gotoKey(-1),
    enabled: () => ready() && canUseKeys()
  },
  {
    id: 'anim:key-next',
    label: 'К следующему ключу рисунка',
    group: 'Рисование',
    defaults: [key('Period')],
    run: () => void gotoKey(1),
    enabled: () => ready() && canUseKeys()
  },
  {
    id: 'anim:key-add',
    label: 'Ключ анимации здесь',
    group: 'Рисование',
    defaults: [key('KeyJ')],
    run: () => void addKeyHere(),
    enabled: () => ready() && canUseKeys()
  },
  {
    id: 'draw:finish',
    label: 'Завершить зону или связи',
    group: 'Рисование',
    defaults: [key('Enter')],
    run: () => void finishPolyDraft(),
    enabled: () => ready() && polyDraftActive()
  },
  {
    id: 'pitch:calibrate',
    label: 'Разметить поле',
    group: 'Рисование',
    defaults: [key('KeyP')],
    run: startCalibration,
    enabled: () => ready() && canCalibrate()
  },
  {
    id: 'episodes:in',
    label: 'Метка «Начало»',
    group: 'Эпизоды',
    defaults: [key('KeyI')],
    run: markIn,
    enabled: ready
  },
  {
    id: 'episodes:out',
    label: 'Метка «Конец»',
    group: 'Эпизоды',
    defaults: [key('KeyO')],
    run: markOut,
    enabled: ready
  },
  {
    id: 'episodes:rate-good',
    label: 'Оценка: хорошо',
    group: 'Эпизоды',
    defaults: [key('Equal')],
    run: () => rateCurrent('good'),
    enabled: ready
  },
  {
    id: 'episodes:rate-bad',
    label: 'Оценка: плохо',
    group: 'Эпизоды',
    defaults: [key('Minus')],
    run: () => rateCurrent('bad'),
    enabled: ready
  },
  {
    id: 'episodes:review',
    label: 'Разобрать',
    group: 'Эпизоды',
    defaults: [key('Slash')],
    run: () => rateCurrent('review'),
    enabled: ready
  },
  {
    id: 'project:save',
    label: 'Сохранить',
    group: 'Проект',
    defaults: [key('KeyS', { ctrl: true })],
    run: () => void saveProject(),
    enabled: canSave
  },
  {
    id: 'project:save-as',
    label: 'Сохранить как…',
    group: 'Проект',
    defaults: [key('KeyS', { ctrl: true, shift: true })],
    run: () => void saveProjectAs(),
    enabled: canSave
  },
  {
    id: 'project:open',
    label: 'Открыть проект',
    group: 'Проект',
    defaults: [key('KeyO', { ctrl: true, shift: true })],
    run: () => void openProject()
  },
  {
    id: 'project:new',
    label: 'Новый проект',
    group: 'Проект',
    defaults: [key('KeyN', { ctrl: true })],
    run: () => void newProject()
  },
  {
    id: 'project:home',
    label: 'На главную',
    group: 'Проект',
    defaults: [key('KeyH', { ctrl: true })],
    run: () => void goHome(),
    enabled: () => useViewStore.getState().view === 'workspace'
  },
  {
    id: 'stats:open',
    label: 'Статистика',
    group: 'Анализ',
    defaults: [key('KeyI', { ctrl: true })],
    run: openStats,
    enabled: canOpenStats
  },
  {
    id: 'export:open',
    label: 'Экспорт клипов',
    group: 'Экспорт',
    defaults: [key('KeyE', { ctrl: true })],
    run: openExportDialog,
    enabled: canExport
  },
  {
    id: 'general:open-video',
    label: 'Открыть видео',
    group: 'Общее',
    defaults: [key('KeyO', { ctrl: true })],
    run: () => void openVideoFromDialog()
  },
  {
    id: 'general:settings',
    label: 'Настройки',
    group: 'Общее',
    defaults: [key('Comma', { ctrl: true })],
    run: () => useSettingsStore.getState().openDialog()
  },
  {
    id: 'general:undo',
    label: 'Отменить',
    group: 'Общее',
    defaults: [key('KeyZ', { ctrl: true })],
    run: undoAny,
    enabled: ready
  },
  {
    id: 'general:redo',
    label: 'Повторить',
    group: 'Общее',
    defaults: [key('KeyY', { ctrl: true }), key('KeyZ', { ctrl: true, shift: true })],
    run: redoAny,
    enabled: ready
  },
  {
    id: 'general:escape',
    label: 'Отмена / снять выделение',
    group: 'Общее',
    defaults: [key('Escape')],
    run: escape,
    enabled: ready
  },
  {
    id: 'general:delete',
    label: 'Удалить выбранное',
    group: 'Общее',
    defaults: [key('Delete'), key('Backspace')],
    run: () => void deleteSelection(),
    enabled: ready
  }
]

/** Команды доски тренера: действуют только на её экране (scope 'board'). */
const boardCommand = (c: Omit<Command, 'group' | 'scope'>): Command => ({
  ...c,
  group: 'Доска',
  scope: 'board'
})
const board = (): ReturnType<typeof useBoardStore.getState> => useBoardStore.getState()

export const BOARD_COMMANDS: readonly Command[] = [
  boardCommand({
    id: 'board:undo',
    label: 'Отменить',
    defaults: [key('KeyZ', { ctrl: true })],
    run: boardUndo,
    enabled: () => canEditBoard() && board().past.length > 0
  }),
  boardCommand({
    id: 'board:redo',
    label: 'Повторить',
    defaults: [key('KeyY', { ctrl: true }), key('KeyZ', { ctrl: true, shift: true })],
    run: boardRedo,
    enabled: () => canEditBoard() && board().future.length > 0
  }),
  boardCommand({
    id: 'board:delete',
    label: 'Удалить выбранное',
    defaults: [key('Delete'), key('Backspace')],
    run: deleteSelected,
    enabled: () => canEditBoard() && board().selection.length > 0
  }),
  boardCommand({
    id: 'board:play',
    label: 'Проиграть / пауза',
    defaults: [key('Space')],
    run: toggleBoardPlay,
    enabled: () => (board().board?.frameCount ?? 0) > 1 && !useBoardUi.getState().dragging
  }),
  boardCommand({
    id: 'board:prev-frame',
    label: 'Предыдущий кадр',
    defaults: [key('ArrowLeft')],
    run: () => stepBoardFrame(-1),
    enabled: () => canEditBoard() && board().frame > 0
  }),
  boardCommand({
    id: 'board:next-frame',
    label: 'Следующий кадр',
    defaults: [key('ArrowRight')],
    run: () => stepBoardFrame(1),
    enabled: () => canEditBoard() && board().frame < (board().board?.frameCount ?? 1) - 1
  }),
  boardCommand({
    id: 'board:add-frame',
    label: 'Добавить кадр',
    defaults: [key('Equal', { shift: true }), key('NumpadAdd'), key('Equal')],
    run: addFrameHere,
    enabled: () => canEditBoard() && (board().board?.frameCount ?? MAX_FRAMES) < MAX_FRAMES
  }),
  boardCommand({
    id: 'board:save',
    label: 'Сохранить доску',
    defaults: [key('KeyS', { ctrl: true })],
    run: () => void saveBoard(),
    enabled: () => board().board !== null
  }),
  boardCommand({
    id: 'board:save-image',
    label: 'Сохранить картинку',
    defaults: [key('KeyS', { ctrl: true, shift: true })],
    run: () => void saveImage(),
    enabled: () => board().board !== null
  }),
  boardCommand({
    id: 'board:select',
    label: 'Инструмент «Выбор»',
    defaults: [key('KeyV')],
    run: selectBoardTool,
    enabled: canEditBoard
  }),
  boardCommand({
    id: 'board:escape',
    label: 'Отмена / снять выделение',
    defaults: [key('Escape')],
    run: boardEscape
  })
]

/** Команда создания эпизода для тега. Клавиша по умолчанию есть только у стандартных тегов (1–9). */
export function tagCommand(tag: TagDef): Command {
  const code = DEFAULT_TAG_KEYS[tag.id]
  return {
    id: tagCommandId(tag.id),
    label: `Тег «${tag.name}»`,
    group: 'Теги',
    defaults: code ? [makeBinding(code)] : [],
    run: () => applyTag(tag.id),
    enabled: ready
  }
}

export function allCommands(tags: readonly TagDef[]): Command[] {
  return [...STATIC_COMMANDS, ...BOARD_COMMANDS, ...tags.map(tagCommand)]
}
