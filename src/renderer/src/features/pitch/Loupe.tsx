// Лупа: увеличенный кусочек текущего кадра рядом с курсором — чтобы точно поставить точку разметки.
import { useEffect, useRef } from 'react'
import { getVideoElement } from '../player/videoElement'

const SIZE = 132
const ZOOM = 4
/** Сторона увеличиваемого квадрата в пикселях видео. */
const SOURCE = SIZE / ZOOM

interface Props {
  /** Положение курсора в пикселях контейнера. */
  x: number
  y: number
  /** Точка на кадре, доли ширины/высоты. */
  image: { x: number; y: number }
  /** Куда привязалась точка (доли кадра), если привязка сработала: показываем голубой маркер. */
  snapped?: { x: number; y: number } | null
  /** Размер контейнера — чтобы лупа не вылезала за край. */
  bounds: { w: number; h: number }
}

export function Loupe({ x, y, image, snapped, bounds }: Props): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    const video = getVideoElement()
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.fillStyle = '#05070a'
    ctx.fillRect(0, 0, SIZE, SIZE)
    if (video && video.videoWidth > 0) {
      ctx.imageSmoothingEnabled = false
      const cx = image.x * video.videoWidth
      const cy = image.y * video.videoHeight
      try {
        ctx.drawImage(video, cx - SOURCE / 2, cy - SOURCE / 2, SOURCE, SOURCE, 0, 0, SIZE, SIZE)
      } catch {
        /* кадр ещё не готов: лупа остаётся тёмной */
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(SIZE / 2 + 0.5, 0)
    ctx.lineTo(SIZE / 2 + 0.5, SIZE / 2 - 7)
    ctx.moveTo(SIZE / 2 + 0.5, SIZE / 2 + 7)
    ctx.lineTo(SIZE / 2 + 0.5, SIZE)
    ctx.moveTo(0, SIZE / 2 + 0.5)
    ctx.lineTo(SIZE / 2 - 7, SIZE / 2 + 0.5)
    ctx.moveTo(SIZE / 2 + 7, SIZE / 2 + 0.5)
    ctx.lineTo(SIZE, SIZE / 2 + 0.5)
    ctx.stroke()
    ctx.strokeStyle = '#ffd60a'
    ctx.beginPath()
    ctx.arc(SIZE / 2 + 0.5, SIZE / 2 + 0.5, 3.5, 0, Math.PI * 2)
    ctx.stroke()
    if (snapped && video && video.videoWidth > 0) {
      const mx = SIZE / 2 + (snapped.x - image.x) * video.videoWidth * ZOOM
      const my = SIZE / 2 + (snapped.y - image.y) * video.videoHeight * ZOOM
      ctx.strokeStyle = '#2bd6ff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(mx + 0.5, my + 0.5, 6, 0, Math.PI * 2)
      ctx.stroke()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- зависим от координат, а не от нового объекта на каждый ход
  }, [image.x, image.y, snapped?.x, snapped?.y])

  // Лупа появляется справа-сверху от курсора; у края перепрыгивает на другую сторону.
  let left = x + 26
  let top = y - SIZE - 26
  if (left + SIZE > bounds.w - 6) left = x - SIZE - 26
  if (top < 6) top = y + 26
  if (top + SIZE > bounds.h - 6) top = Math.max(6, bounds.h - SIZE - 6)
  left = Math.max(6, left)

  return (
    <canvas
      ref={ref}
      className="cal-loupe"
      data-testid="cal-loupe"
      width={SIZE}
      height={SIZE}
      style={{ left, top }}
    />
  )
}
