import { BottomDock } from './BottomDock'
import { EpisodesPanel } from './EpisodesPanel'
import { StatusBar } from './StatusBar'
import { ToolRail } from './ToolRail'
import { TopBar } from './TopBar'
import { VideoStage } from './VideoStage'

export function App(): React.JSX.Element {
  return (
    <div className="app">
      <TopBar />
      <ToolRail />
      <VideoStage />
      <EpisodesPanel />
      <BottomDock />
      <StatusBar />
    </div>
  )
}
