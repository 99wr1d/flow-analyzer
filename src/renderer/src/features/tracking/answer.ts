// Слежение: отправка ответа на «Кто из них ваш?». Отклонённый ответ не должен оставлять задачу висеть молча.

export interface AnswerApi {
  resolveTracking(jobId: string, index: number | 'none', target?: number): Promise<void>
  cancelTracking(jobId: string): Promise<void>
}

/**
 * Отправляет ответ. Если main его отклонил, задача отменяется (она ждала бы ответа вечно), а вызывающему возвращается
 * сообщение для обычного сообщения об ошибке слежения. null — ответ принят.
 */
export async function sendAnswer(
  api: AnswerApi,
  jobId: string,
  index: number,
  target: number
): Promise<string | null> {
  try {
    await api.resolveTracking(jobId, index, target)
    return null
  } catch (error) {
    try {
      await api.cancelTracking(jobId)
    } catch {
      /* задача уже закончилась — нечего отменять */
    }
    return error instanceof Error ? error.message : String(error)
  }
}
