// Что спросить, когда доску закрывают (главная, закрытие окна, чужой проект): чистая логика без экрана.

export interface LeaveState {
  /** Открыта доска. */
  onBoard: boolean
  /** В доске есть несохранённые изменения. */
  dirty: boolean
  /** Идёт сохранение видео. */
  videoRunning: boolean
}

export interface LeavePlan {
  /** Спросить, остановить ли сохранение видео. */
  askStopVideo: boolean
  /** Спросить «Сохранить изменения?». */
  askSave: boolean
}

/** Уходя с доски со «Главной» достаточно вопроса про изменения (видео просто отменяется); при закрытии окна спрашивается и видео. */
export function leavePlan(state: LeaveState): LeavePlan {
  return {
    askStopVideo: state.onBoard && state.videoRunning,
    askSave: state.onBoard && state.dirty
  }
}

/** Окну нужно спросить пользователя перед закрытием. */
export const needsCloseQuestion = (plan: LeavePlan): boolean => plan.askStopVideo || plan.askSave
