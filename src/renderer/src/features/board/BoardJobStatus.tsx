// Ход сохранения видео доски в строке состояния: полоска, подпись и «Отмена».
import type { JSX } from 'react'
import { ru } from '../../i18n/ru'
import { cancelVideo } from './boardActions'
import { useBoardUi } from './boardUi'

export function BoardJobStatus(): JSX.Element | null {
  const job = useBoardUi((s) => s.job)
  if (!job) return null
  const pct = job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0
  // Кадры рисуются примерно 70% времени, сборка MP4 — оставшиеся 30%.
  const overall = job.phase === 'render' ? pct * 0.7 : 70 + pct * 0.3
  const text =
    job.phase === 'render' ? ru.board.videoRender(job.done, job.total) : ru.board.videoEncode(pct)
  return (
    <div className="status-bar__job" role="status" data-testid="board-video-progress">
      <span>{text}</span>
      <div className="status-bar__bar" aria-hidden="true">
        <div className="status-bar__fill" style={{ width: `${overall}%` }} />
      </div>
      <button
        type="button"
        className="btn status-bar__cancel"
        data-testid="board-video-cancel"
        onClick={cancelVideo}
      >
        {ru.board.videoCancel}
      </button>
    </div>
  )
}
