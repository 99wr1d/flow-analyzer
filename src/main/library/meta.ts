// Правка описания проекта прямо в файле (из карточки на стартовом экране, когда проект не открыт).
import { type Project, type ProjectMeta } from '../../shared/project'
import { readProjectFile, writeProjectFile } from '../project/files'

export function withMeta(project: Project, meta: ProjectMeta, now: Date): Project {
  return { ...project, meta, updatedAt: now.toISOString() }
}

/** Читает проект, меняет описание и записывает обратно. Бросает Error с понятным текстом. */
export async function updateMetaInFile(
  path: string,
  meta: ProjectMeta,
  now: Date = new Date()
): Promise<void> {
  const parsed = await readProjectFile(path)
  if (!parsed.ok) throw new Error(parsed.message)
  await writeProjectFile(path, withMeta(parsed.project, meta, now))
}
