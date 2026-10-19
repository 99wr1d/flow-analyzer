// Признак «есть несохранённые изменения». Меняют его только рисунки и эпизоды: перемотка, воспроизведение,
// выбор, инструменты и метки Начало/Конец проект не «пачкают».
import { useAnnotationsStore } from '../annotations/annotationsStore'
import { useEpisodesStore } from '../episodes/episodesStore'
import { useCalibrationsStore } from '../pitch/calibrationsStore'
import { useGrassStore } from '../under/grassStore'
import { useProjectStore } from './projectStore'

let suspended = 0

/** Выполняет fn, не считая изменения работы правками пользователя (загрузка проекта, сброс). */
export function withoutDirty<T>(fn: () => T): T {
  suspended += 1
  try {
    return fn()
  } finally {
    suspended -= 1
  }
}

let uninstall: (() => void) | null = null

/** Подписывается на рисунки и эпизоды. Повторный вызов безопасен. */
export function installDirtyTracking(): () => void {
  if (!uninstall) {
    const mark = (): void => {
      if (suspended === 0) useProjectStore.getState().markDirty()
    }
    const offs = [
      useAnnotationsStore.subscribe((s, prev) => {
        if (s.items !== prev.items) mark()
      }),
      useEpisodesStore.subscribe((s, prev) => {
        if (s.items !== prev.items) mark()
      }),
      useCalibrationsStore.subscribe((s, prev) => {
        if (s.items !== prev.items) mark()
      }),
      // Настройки газона: меняются только руками пользователя (найденный автоматически цвет проект не пачкает).
      useGrassStore.subscribe((s, prev) => {
        if (s.userKey !== prev.userKey) mark()
      })
    ]
    uninstall = (): void => {
      offs.forEach((off) => off())
      uninstall = null
    }
  }
  return uninstall
}
