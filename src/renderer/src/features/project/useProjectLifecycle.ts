// Всё, что проект делает «само»: следит за изменениями, обновляет заголовок окна, автосохраняет копию работы,
// защищает от закрытия с потерей данных и принимает проект, переданный снаружи.
import { useEffect } from 'react'
import { useViewStore } from '../../app/viewStore'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { UNTITLED_PROJECT } from '../../../../shared/project'
import { installTestHooks } from '../../testHooks'
import { askStopForClose, cancelExportAndWait, isExportRunning } from '../export/exportActions'
import { cancelVideo, saveBoard } from '../board/boardActions'
import { useBoardStore } from '../board/boardStore'
import { leavePlan, needsCloseQuestion } from '../board/leave'
import { currentVideoJob } from '../board/videoJob'
import { openProject, refreshRecovery, saveProject } from './actions'
import { installDirtyTracking } from './dirty'
import { useProjectStore } from './projectStore'
import { buildSaveRequest } from './snapshot'
import { askUnsaved } from './unsavedStore'

/** Заголовок окна: имя проекта (или доски) и «*» при несохранённых изменениях. Пока ничего нет — просто название приложения. */
function syncWindowTitle(): () => void {
  let last = ''
  const update = (): void => {
    const onBoard = useViewStore.getState().view === 'board'
    const b = useBoardStore.getState()
    const p = useProjectStore.getState()
    let name: string | null
    let dirty: boolean
    if (onBoard && b.board) {
      name = b.board.title || ru.board.newTitle
      dirty = b.dirty
    } else {
      const hasProject = p.path !== null || usePlayerStore.getState().source !== null || p.dirty
      name = hasProject ? p.name || UNTITLED_PROJECT : null
      dirty = p.dirty
    }
    const key = `${name ?? ''}|${dirty}`
    if (key === last) return
    last = key
    window.api.setWindowTitle(name, dirty).catch(() => undefined)
  }
  update()
  const offs = [
    useProjectStore.subscribe(update),
    usePlayerStore.subscribe(update),
    useBoardStore.subscribe(update),
    useViewStore.subscribe(update)
  ]
  return () => offs.forEach((off) => off())
}

/** Раз в interval мс отправляет копию работы, если после прошлой отправки что-то изменилось. */
function startAutosave(intervalMs: number): () => void {
  let sentVersion = -1
  let busy = false
  const timer = window.setInterval(() => {
    const p = useProjectStore.getState()
    if (busy || p.saving || !p.dirty || p.version === sentVersion) return
    const request = buildSaveRequest(p.path)
    if (!request) return
    busy = true
    sentVersion = p.version
    window.api
      .autosaveProject(request)
      .catch(() => {
        sentVersion = -1
      })
      .finally(() => {
        busy = false
      })
  }, intervalMs)
  return () => window.clearInterval(timer)
}

/** Окно хотят закрыть: если есть несохранённое — спрашиваем, иначе main закроет окно сам. */
async function handleCloseRequested(): Promise<void> {
  const onBoard = useViewStore.getState().view === 'board'
  const plan = leavePlan({
    onBoard,
    dirty: useBoardStore.getState().dirty,
    videoRunning: currentVideoJob() !== null
  })
  const dirty = useProjectStore.getState().dirty || plan.askSave
  const exporting = isExportRunning()
  await window.api.respondClose(dirty || exporting || needsCloseQuestion(plan))
  if (!dirty && !exporting && !needsCloseQuestion(plan)) return
  if (plan.askStopVideo) {
    // Идёт сохранение видео доски: закрытие его остановит, поэтому сначала спрашиваем.
    if ((await askUnsaved('video')) !== 'discard') {
      await window.api.cancelClose()
      return
    }
    cancelVideo()
    if (!dirty && !exporting) {
      await window.api.confirmClose()
      return
    }
  }
  if (exporting) {
    // Идёт экспорт: закрытие его остановит, поэтому сначала спрашиваем.
    if (!(await askStopForClose())) {
      await window.api.cancelClose()
      return
    }
    await cancelExportAndWait()
    if (!dirty) {
      await window.api.confirmClose()
      return
    }
  }
  const choice = await askUnsaved()
  if (choice === 'save' && (await (onBoard ? saveBoard() : saveProject()))) {
    await window.api.confirmClose()
  } else if (choice === 'discard') {
    if (!onBoard) {
      await window.api.clearRecovery(useProjectStore.getState().path).catch(() => undefined)
    }
    await window.api.confirmClose()
  } else {
    await window.api.cancelClose()
  }
}

export function useProjectLifecycle(): void {
  useEffect(() => {
    const offs: Array<() => void> = [installDirtyTracking(), syncWindowTitle()]
    let cancelled = false

    window.api
      .getAppInfo()
      .then((info) => {
        const t = info.testFlags
        if (t.crash || t.bench || t.noTips) installTestHooks(t)
        if (!cancelled) offs.push(startAutosave(info.autosaveMs))
      })
      .catch(() => undefined)

    offs.push(
      window.api.onCloseRequested(() => void handleCloseRequested().catch(() => undefined)),
      window.api.onOpenProjectRequested((path) => void openProject(path))
    )

    // Проект из командной строки (двойной щелчок по .flowproj) и найденные копии работы.
    void window.api
      .takeLaunchProject()
      .then((path) => (path ? openProject(path) : undefined))
      .catch(() => undefined)
      .finally(() => useViewStore.getState().setBooting(false))
    void refreshRecovery()

    return () => {
      cancelled = true
      offs.forEach((off) => off())
    }
  }, [])
}
