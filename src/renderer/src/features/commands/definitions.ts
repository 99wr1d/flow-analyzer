// Реестр команд: id, подпись, группа, стандартные клавиши и действие. Все горячие клавиши приложения проходят через него.
import { DEFAULT_TAG_KEYS, tagCommandId, type TagDef } from '../../../../shared/settings'
import { usePlayerStore } from '../../store/playerStore'
import { useAnnotationsStore, type Tool } from '../annotations/annotationsStore'
import { useEpisodesStore } from '../episodes/episodesStore'
import { applyTag, markIn, markOut } from '../episodes/tagging'
import { redoAny, undoAny } from '../history/unified'
import { openVideoFromDialog } from '../player/importVideo'
import { canSave, newProject, openProject, saveProject, saveProjectAs } from '../project/actions'
import { changeRate, stepFrame, stepSecond, toggleMute, togglePlay } from '../player/videoElement'
import { useSettingsStore } from '../settings/settingsStore'
import { makeBinding, type Binding } from './binding'
import type { CommandMeta } from './keymap'
import { deleteSelection } from './selectionFocus'

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

/** Esc: сначала инструмент → «Выбор», затем снять выделение рисунка, затем сбросить метки, затем снять выделение эпизода. */
function escape(): void {
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
    run: () => void newProject(),
    enabled: canSave
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
  return [...STATIC_COMMANDS, ...tags.map(tagCommand)]
}
