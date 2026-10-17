import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import { PauseIcon, PlayIcon, VolumeIcon, VolumeMutedIcon } from '../../ui/icons'
import { formatTime } from './format'
import { PLAYBACK_RATES, formatRate } from './speed'
import { useSeekPointer } from './useSeekPointer'
import { seekBy, seekTo, setRate, setVolume, toggleMute, togglePlay } from './videoElement'

function useReady(): boolean {
  return usePlayerStore((s) => s.status === 'ready')
}

function useHoursFlag(): boolean {
  return usePlayerStore((s) => s.duration >= 3600)
}

function PlayButton(): React.JSX.Element {
  const ready = useReady()
  const playing = usePlayerStore((s) => s.playing)
  return (
    <button
      type="button"
      className="icon-btn icon-btn--primary"
      disabled={!ready}
      onClick={togglePlay}
      title={playing ? ru.transport.pause : ru.transport.play}
      aria-label={playing ? ru.transport.pauseAria : ru.transport.playAria}
      data-testid="play-toggle"
    >
      {playing ? <PauseIcon /> : <PlayIcon />}
    </button>
  )
}

function CurrentTime(): React.JSX.Element {
  const time = usePlayerStore((s) => s.currentTime)
  const hours = useHoursFlag()
  return (
    <span
      className="transport__time transport__time--current"
      aria-label={ru.transport.currentTime}
      data-testid="current-time"
    >
      {formatTime(time, { tenths: true, hours })}
    </span>
  )
}

function TotalTime(): React.JSX.Element {
  const duration = usePlayerStore((s) => s.duration)
  const hours = useHoursFlag()
  return (
    <span
      className="transport__time transport__time--total"
      aria-label={ru.transport.totalTime}
      data-testid="total-time"
    >
      {formatTime(duration, { tenths: true, hours })}
    </span>
  )
}

function Scrub(): React.JSX.Element {
  const ready = useReady()
  const time = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const pointer = useSeekPointer()
  const percent = duration > 0 ? Math.min(100, (time / duration) * 100) : 0

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (!ready) return
    // Стрелки ←/→ намеренно не трогаем: они зарезервированы под покадровый переход.
    switch (e.key) {
      case 'Home':
        seekTo(0)
        break
      case 'End':
        seekTo(duration)
        break
      case 'PageUp':
        seekBy(10)
        break
      case 'PageDown':
        seekBy(-10)
        break
      default:
        return
    }
    e.preventDefault()
  }

  return (
    <div
      className="scrub"
      role="slider"
      tabIndex={ready ? 0 : -1}
      aria-label={ru.transport.seek}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration * 10) / 10}
      aria-valuenow={Math.round(time * 10) / 10}
      aria-valuetext={formatTime(time, { tenths: true })}
      aria-disabled={!ready}
      title={ru.transport.seekTitle}
      data-testid="scrub"
      style={{ '--p': `${percent}%` } as React.CSSProperties}
      onKeyDown={onKeyDown}
      {...pointer}
    >
      <div className="scrub__rail">
        <div className="scrub__fill" />
      </div>
      <div className="scrub__thumb" />
    </div>
  )
}

function SpeedSelect(): React.JSX.Element {
  const ready = useReady()
  const rate = usePlayerStore((s) => s.playbackRate)
  return (
    <select
      className="select"
      disabled={!ready}
      value={rate}
      onChange={(e) => {
        setRate(Number(e.target.value))
        e.currentTarget.blur()
      }}
      aria-label={ru.transport.speed}
      title={ru.transport.speedTitle}
      data-testid="speed"
    >
      {PLAYBACK_RATES.map((r) => (
        <option key={r} value={r}>
          {formatRate(r)}
        </option>
      ))}
    </select>
  )
}

function Volume(): React.JSX.Element {
  const ready = useReady()
  const volume = usePlayerStore((s) => s.volume)
  const muted = usePlayerStore((s) => s.muted)
  const shown = muted ? 0 : volume
  return (
    <div className="volume">
      <button
        type="button"
        className="icon-btn"
        disabled={!ready}
        onClick={toggleMute}
        title={muted ? ru.transport.unmute : ru.transport.mute}
        aria-label={muted ? ru.transport.unmuteAria : ru.transport.muteAria}
        aria-pressed={muted}
        data-testid="mute"
      >
        {muted || volume === 0 ? <VolumeMutedIcon /> : <VolumeIcon />}
      </button>
      <input
        type="range"
        className="range"
        min={0}
        max={1}
        step={0.01}
        value={shown}
        disabled={!ready}
        onChange={(e) => setVolume(Number(e.target.value))}
        aria-label={ru.transport.volume}
        title={ru.transport.volumeTitle}
        style={{ '--p': `${shown * 100}%` } as React.CSSProperties}
        data-testid="volume"
      />
    </div>
  )
}

export function Transport(): React.JSX.Element {
  return (
    <div className="transport" role="group" aria-label={ru.transport.label}>
      <PlayButton />
      <CurrentTime />
      <Scrub />
      <TotalTime />
      <SpeedSelect />
      <Volume />
    </div>
  )
}
