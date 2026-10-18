import { useEffect } from 'react'
import { ExportDialog } from '../features/export/ExportDialog'
import { StatsDialog } from '../features/stats/StatsDialog'
import { installExportProgress } from '../features/export/exportActions'
import { useCommandDispatcher } from '../features/commands/dispatcher'
import { installUnifiedHistory } from '../features/history/unified'
import { NewProjectDialog } from '../features/library/NewProjectDialog'
import { DeleteDialog } from '../features/library/DeleteDialog'
import { PropertiesDialog } from '../features/library/PropertiesDialog'
import { StartScreen } from '../features/library/StartScreen'
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
import { useViewStore } from './viewStore'

export function App(): React.JSX.Element {
  const loaded = useSettingsStore((s) => s.loaded)
  const dialogOpen = useSettingsStore((s) => s.dialogOpen)
  const view = useViewStore((s) => s.view)
  const booting = useViewStore((s) => s.booting)
  useCommandDispatcher()
  useDropImport()
  useProjectLifecycle()

  useEffect(() => {
    const uninstall = installUnifiedHistory()
    const uninstallExport = installExportProgress()
    void useSettingsStore.getState().load()
    return () => {
      uninstall()
      uninstallExport()
    }
  }, [])

  return (
    <div
      className={view === 'start' ? 'app app--start' : 'app'}
      data-settings={loaded ? 'loaded' : 'loading'}
      data-view={booting ? 'booting' : view}
    >
      {booting ? null : view === 'start' ? (
        <StartScreen />
      ) : (
        <>
          <TopBar />
          <ToolRail />
          <VideoStage />
          <EpisodesPanel />
          <BottomDock />
        </>
      )}
      <StatusBar />
      {dialogOpen && <SettingsDialog />}
      <NewProjectDialog />
      <PropertiesDialog />
      <DeleteDialog />
      <ExportDialog />
      <StatsDialog />
      <UnsavedDialog />
      <RelinkDialog />
    </div>
  )
}
