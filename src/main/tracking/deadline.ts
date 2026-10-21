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
  })
}
