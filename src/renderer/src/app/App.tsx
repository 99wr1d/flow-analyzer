import { useEffect } from 'react'
import { useCommandDispatcher } from '../features/commands/dispatcher'
import { installUnifiedHistory } from '../features/history/unified'
import { useDropImport } from '../features/player/useGlobalInput'
import { RelinkDialog } from '../features/project/RelinkDialog'
import { UnsavedDialog } from '../features/project/UnsavedDialog'
import { useProjectLifecycle } from '../features/project/useProjectLifecycle'
import { SettingsDialog } from '../features/settings/SettingsDialog'
import { useSettingsStore } from '../features/settings/settingsStore'
import { BottomDock } from './BottomDock'
import { EpisodesPanel } from './EpisodesPanel'
import { StatusBar } from './StatusBar'
import { ToolRail } from './ToolRail'
import { TopBar } from './TopBar'
import { VideoStage } from './VideoStage'

export function App(): React.JSX.Element {
  const loaded = useSettingsStore((s) => s.loaded)
  const dialogOpen = useSettingsStore((s) => s.dialogOpen)
  useCommandDispatcher()
  useDropImport()
  useProjectLifecycle()

  useEffect(() => {
    const uninstall = installUnifiedHistory()
    void useSettingsStore.getState().load()
    return uninstall
  }, [])

  return (
    <div className="app" data-settings={loaded ? 'loaded' : 'loading'}>
      <TopBar />
      <ToolRail />
      <VideoStage />
      <EpisodesPanel />
      <BottomDock />
      <StatusBar />
      {dialogOpen && <SettingsDialog />}
      <UnsavedDialog />
      <RelinkDialog />
    </div>
  )
}
