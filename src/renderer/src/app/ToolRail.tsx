import { ru } from '../i18n/ru'

// Инструменты рисования появятся позже; сейчас — только поверхность панели.
export function ToolRail(): React.JSX.Element {
  return <nav className="tool-rail" aria-label={ru.toolRail.label} />
}
