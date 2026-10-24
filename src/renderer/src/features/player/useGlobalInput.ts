import { useEffect } from 'react'
import { useViewStore } from '../../app/viewStore'
import { usePlayerStore } from '../../store/playerStore'
import { importDroppedFile } from './importVideo'

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

/** Перетаскивание видеофайла на окно: подсветка и импорт. Всё остальное браузер не обрабатывает. */
export function useDropImport(): void {
  useEffect(() => {
    let depth = 0
    const { setDragActive } = usePlayerStore.getState()

    const onEnter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth += 1
      setDragActive(true)
    }
    const onOver = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragActive(false)
    }
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragActive(false)
      // На доске тренера видео не открывается: иначе доска закрылась бы без вопроса.
      if (useViewStore.getState().view === 'board') return
      const file = e.dataTransfer?.files[0]
      if (file) void importDroppedFile(file)
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [])
}
