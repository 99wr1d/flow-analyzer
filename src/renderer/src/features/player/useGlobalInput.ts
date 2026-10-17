import { useEffect } from 'react'
import { usePlayerStore } from '../../store/playerStore'
import { importDroppedFile, openVideoFromDialog } from './importVideo'
import { changeRate, toggleMute, togglePlay } from './videoElement'

/** Поля, где печатают текст: горячие клавиши плеера там не срабатывают. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true
  return target instanceof HTMLInputElement && target.type !== 'range'
}

/**
 * Горячие клавиши: Ctrl+O, Пробел, [ ], M.
 * Стрелки ←/→ не заняты — они понадобятся для покадрового перехода.
 */
export function useShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.isComposing) return

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === 'KeyO') {
        e.preventDefault()
        void openVideoFromDialog()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return

      switch (e.code) {
        case 'Space':
          // На кнопке пробел и так «нажимает» её — не дублируем.
          if (e.target instanceof HTMLButtonElement) return
          e.preventDefault()
          if (!e.repeat) togglePlay()
          break
        case 'BracketLeft':
          e.preventDefault()
          changeRate(-1)
          break
        case 'BracketRight':
          e.preventDefault()
          changeRate(1)
          break
        case 'KeyM':
          if (!e.repeat) toggleMute()
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

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
