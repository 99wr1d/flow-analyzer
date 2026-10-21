// Ожидание ответа с предельным сроком: без ответа вовремя обещание отклоняется понятной ошибкой.
export function withTimeout<T>(
  ms: number,
  message: string,
  start: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
  onTimeout?: () => void
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.()
      reject(new Error(message))
    }, ms)
    try {
      start(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error) => {
          clearTimeout(timer)
          reject(error)
        }
      )
    } catch (error) {
      // Синхронный сбой запуска: таймер не должен остаться висеть.
      clearTimeout(timer)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
