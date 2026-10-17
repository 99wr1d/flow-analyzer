import { ru } from '../i18n/ru'

const TICKS = Array.from({ length: 11 }, (_, i) => i)

export function BottomDock(): React.JSX.Element {
  return (
    <div className="dock">
      <div className="transport" role="group" aria-label={ru.transport.label}>
        <span className="transport__time">00:00</span>
      </div>
      <section className="timeline" aria-label={ru.timeline.label}>
        <div className="timeline__ruler" aria-hidden="true">
          {TICKS.map((i) => (
            <div key={i} className="timeline__tick" style={{ left: `${i * 10}%` }}>
              {i === 0 && <span className="timeline__tick-label">00:00</span>}
            </div>
          ))}
        </div>
        <div className="timeline__track">
          <span className="timeline__empty">{ru.timeline.empty}</span>
        </div>
      </section>
    </div>
  )
}
