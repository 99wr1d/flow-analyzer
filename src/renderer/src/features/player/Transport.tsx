import { ru } from '../../i18n/ru'
import { usePlayerStore } from '../../store/playerStore'
import {
  FrameBackIcon,
  FrameForwardIcon,
  PauseIcon,
  PlayIcon,
  VolumeIcon,
  VolumeMutedIcon
} from '../../ui/icons'
import { formatTime } from './format'
import { formatDurationTimecode, formatFps, formatTimecode } from './frames'
import { PLAYBACK_RATES, formatRate } from './speed'
import { useSeekPointer } from './useSeekPointer'
import {
  seekBy,
  seekTo,
  setRate,
  stepFrame,
  setVolume,
  toggleMute,
  togglePlay
} from './videoElement'

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

function FrameButton({ direction }: { direction: -1 | 1 }): React.JSX.Element {
  const ready = useReady()
  const back = direction === -1
  return (
    <button
      type="button"
      className="icon-btn"
      disabled={!ready}
      onClick={(e) => {
        stepFrame(direction)
        e.currentTarget.blur()
      }}
      title={back ? ru.transport.frameBack : ru.transport.frameForward}
      aria-label={back ? ru.transport.frameBackAria : ru.transport.frameForwardAria}
      data-testid={back ? 'frame-back' : 'frame-forward'}
    >
      {back ? <FrameBackIcon /> : <FrameForwardIcon />}
    </button>
  )
}

function CurrentTime(): React.JSX.Element {
  const time = usePlayerStore((s) => s.currentTime)
  const duration = usePlayerStore((s) => s.duration)
  const fps = usePlayerStore((s) => s.fps)
  const mode = usePlayerStore((s) => s.timeMode)
  const hours = useHoursFlag()
  const toggle = usePlayerStore((s) => s.toggleTimeMode)
  return (
    <button
      type="button"
      className="transport__time transport__time--current transport__time-btn"
      onClick={(e) => {
        toggle()
        e.currentTarget.blur()
      }}
      title={ru.transport.timeToggle}
      aria-label={ru.transport.currentTime}
      data-testid="current-time"
      data-mode={mode}
    >
      {mode === 'timecode'
        ? formatTimecode(time, fps, duration)
        : formatTime(time, { tenths: true, hours })}
    </button>
  )
}

function TotalTime(): React.JSX.Element {
  const duration = usePlayerStore((s) => s.duration)
  const fps = usePlayerStore((s) => s.fps)
  const mode = usePlayerStore((s) => s.timeMode)
  const hours = useHoursFlag()
  return (
    <span
      className="transport__time transport__time--total"
      aria-label={ru.transport.totalTime}
      data-testid="total-time"
      data-mode={mode}
    >
      {mode === 'timecode'
        ? formatDurationTimecode(duration, fps)
        : formatTime(duration, { tenths: true, hours })}
    </span>
  )
}

function FpsLabel(): React.JSX.Element {
  const ready = useReady()
  const fps = usePlayerStore((s) => s.fps)
  const source = usePlayerStore((s) => s.fpsSource)
  const variable = usePlayerStore((s) => s.fpsVariable)
  const approx = source === 'estimated' || variable
  const text = `${approx ? '≈' : ''}${formatFps(fps)} ${ru.transport.fpsUnit}${source === 'default' ? '?' : ''}`
  const why =
    source === 'container'
      ? ru.transport.fpsContainer
      : source === 'estimated'
        ? ru.transport.fpsEstimated
        : ru.transport.fpsDefault
  return (
    <span
      className={`transport__fps${source === 'default' ? ' transport__fps--unknown' : ''}`}
      title={variable ? `${why} ${ru.transport.fpsVariable}` : why}
      aria-label={ru.transport.fpsLabel}
      data-testid="fps"
      data-source={source}
      data-variable={variable}
      hidden={!ready}
    >
      {text}
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
    // Стрелки ←/→ обрабатываются глобально (покадровый переход) — см. useGlobalInput.
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
      <FrameButton direction={-1} />
      <PlayButton />
      <FrameButton direction={1} />
      <CurrentTime />
      <Scrub />
      <TotalTime />
      <FpsLabel />
      <SpeedSelect />
      <Volume />
    </div>
  )
}
