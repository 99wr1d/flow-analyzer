/** Текущее сохранение видео доски. У каждого сохранения свои token и AbortController: старое не трогает новое. */

export interface VideoJob {
  token: string
  abort: AbortController
}

let current: VideoJob | null = null

export function beginVideoJob(token: string): VideoJob {
  const job: VideoJob = { token, abort: new AbortController() }
  current = job
  return job
}

/** Сохранение закончилось: забывается, только если оно всё ещё текущее. true — было текущим. */
export function endVideoJob(job: VideoJob): boolean {
  if (current !== job) return false
  current = null
  return true
}

export const isCurrentVideoJob = (job: VideoJob): boolean => current === job
export const currentVideoJob = (): VideoJob | null => current

/** Отменяет текущее сохранение: прерывает рисование кадров и просит main убрать временные файлы. */
export function cancelCurrentVideoJob(cancelInMain: (token: string) => void): boolean {
  const job = current
  if (!job) return false
  job.abort.abort()
  cancelInMain(job.token)
  return true
}
