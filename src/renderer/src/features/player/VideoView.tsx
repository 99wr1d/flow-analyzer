import { useCallback, useEffect } from 'react'
import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { getVideoElement, setVideoElement } from './videoElement'

/** Сам <video>. key=id пересоздаёт элемент при каждом новом файле — состояние сбрасывается полностью. */
export function VideoView({ id, url }: { id: string; url: string }): React.JSX.Element {
  const hidden = usePlayerStore((s) => s.status === 'error')
  const playing = usePlayerStore((s) => s.playing)

  const attach = useCallback((el: HTMLVideoElement | null) => {
    setVideoElement(el)
    if (el) {
      const { volume, muted } = usePlayerStore.getState()
      el.volume = volume
      el.muted = muted
    }
  }, [])

  // Плавное обновление положения, пока видео играет (timeupdate срабатывает лишь ~4 раза в секунду).
  useEffect(() => {
    if (!playing) return
    let frame = 0
    const tick = (): void => {
      const el = getVideoElement()
      if (el) usePlayerStore.getState().setCurrentTime(el.currentTime)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  return (
    <video
      key={id}
      ref={attach}
      className="stage__video"
      src={url}
      preload="auto"
      playsInline
      style={hidden ? { display: 'none' } : undefined}
      aria-label={ru.stage.label}
      onLoadedMetadata={(e) => usePlayerStore.getState().setMetadata(e.currentTarget.duration)}
      onPlay={() => usePlayerStore.getState().setPlaying(true)}
      onPause={() => usePlayerStore.getState().setPlaying(false)}
      onEnded={(e) => {
        const s = usePlayerStore.getState()
        s.setPlaying(false)
        s.setCurrentTime(e.currentTarget.currentTime)
      }}
      onTimeUpdate={(e) => usePlayerStore.getState().setCurrentTime(e.currentTarget.currentTime)}
      onSeeked={(e) => usePlayerStore.getState().setCurrentTime(e.currentTarget.currentTime)}
      onRateChange={(e) => usePlayerStore.getState().setPlaybackRate(e.currentTarget.playbackRate)}
      onVolumeChange={(e) =>
        usePlayerStore.getState().setVolumeState(e.currentTarget.volume, e.currentTarget.muted)
      }
      onError={() => usePlayerStore.getState().setPlaybackError(ru.stage.playbackError)}
    />
  )
}
