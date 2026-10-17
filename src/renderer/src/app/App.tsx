import { useAnnotationShortcuts } from '../features/annotations/useAnnotationShortcuts'
import { useDropImport, useShortcuts } from '../features/player/useGlobalInput'
import { BottomDock } from './BottomDock'
import { EpisodesPanel } from './EpisodesPanel'
import { StatusBar } from './StatusBar'
import { ToolRail } from './ToolRail'
import { TopBar } from './TopBar'
import { VideoStage } from './VideoStage'

export function App(): React.JSX.Element {
  useShortcuts()
  useDropImport()
  useAnnotationShortcuts()
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
