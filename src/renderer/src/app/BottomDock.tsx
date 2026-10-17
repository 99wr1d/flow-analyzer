import { Timeline } from '../features/player/Timeline'
import { Transport } from '../features/player/Transport'

export function BottomDock(): React.JSX.Element {
  return (
    <div className="dock">
      <Transport />
      <Timeline />
    </div>
  )
}
