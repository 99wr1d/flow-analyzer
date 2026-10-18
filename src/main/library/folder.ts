// Папка проектов по умолчанию: «Документы\FlowAnalyzer». Для автотестов переопределяется FLOW_LIBRARY_DIR (или FLOW_PROJECTS_DIR).
import { isAbsolute, join } from 'path'

export const PROJECTS_FOLDER_NAME = 'FlowAnalyzer'

export function resolveProjectsFolder(
  documents: string,
  override: string | undefined = process.env['FLOW_LIBRARY_DIR'] || process.env['FLOW_PROJECTS_DIR']
): string {
  if (override && isAbsolute(override)) return override
  return join(documents, PROJECTS_FOLDER_NAME)
}
