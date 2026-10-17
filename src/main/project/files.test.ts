import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_PROJECT_BYTES } from '../../shared/project'
import { sampleProject } from '../../shared/project.testkit'
import {
  checkProjectPath,
  ensureProjectExtension,
  readProjectFile,
  writeProjectFile
} from './files'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow-project-test-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('запись проекта', () => {
  it('записывает JSON и читает его обратно', async () => {
    const target = join(dir, 'a.flowproj')
    const project = sampleProject()
    await writeProjectFile(target, project)
    const result = await readProjectFile(target)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.project).toEqual(project)
    expect(JSON.parse(await readFile(target, 'utf8')).format).toBe('flowanalyzer-project')
  })

  it('не оставляет временных файлов и создаёт недостающие папки', async () => {
    const target = join(dir, 'новая', 'папка', 'a.flowproj')
    await writeProjectFile(target, sampleProject())
    expect(await readdir(join(dir, 'новая', 'папка'))).toEqual(['a.flowproj'])
  })

  it('перезапись не ломает файл: старый остаётся целым, пока новый не записан', async () => {
    const target = join(dir, 'a.flowproj')
    const first = sampleProject()
    await writeProjectFile(target, first)
    const second = { ...first, updatedAt: '2026-03-03T10:00:00.000Z' }
    await Promise.all([writeProjectFile(target, first), writeProjectFile(target, second)])
    const result = await readProjectFile(target)
    expect(result.ok).toBe(true)
    expect((await readdir(dir)).filter((n) => n.endsWith('.flowtmp'))).toEqual([])
  })

  it('понятная ошибка, если записать нельзя', async () => {
    // Вместо папки лежит файл — создать каталог невозможно.
    await writeFile(join(dir, 'file'), 'x')
    await expect(
      writeProjectFile(join(dir, 'file', 'a.flowproj'), sampleProject())
    ).rejects.toThrow(/Не удалось|Нет доступа/)
    await mkdir(join(dir, 'ok'))
  })
})

describe('чтение проекта', () => {
  it('нет файла', async () => {
    const result = await readProjectFile(join(dir, 'нет.flowproj'))
    expect(result).toEqual({ ok: false, message: 'Файл проекта не найден' })
  })

  it('это папка, а не файл', async () => {
    await mkdir(join(dir, 'd.flowproj'))
    const result = await readProjectFile(join(dir, 'd.flowproj'))
    expect(result.ok).toBe(false)
  })

  it('повреждённый JSON', async () => {
    const target = join(dir, 'bad.flowproj')
    await writeFile(target, '{"format": "flowanalyzer-project", ', 'utf8')
    const result = await readProjectFile(target)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/повреждён/)
  })

  it('неверная структура', async () => {
    const target = join(dir, 'bad.flowproj')
    await writeFile(target, JSON.stringify({ ...sampleProject(), annotations: 'нет' }), 'utf8')
    const result = await readProjectFile(target)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.details).toContain('annotations')
  })

  it('слишком большой файл не читается', async () => {
    const target = join(dir, 'big.flowproj')
    await writeFile(target, Buffer.alloc(MAX_PROJECT_BYTES + 1, 0x20))
    const result = await readProjectFile(target)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/слишком большой/)
  })

  it('новая версия формата', async () => {
    const target = join(dir, 'new.flowproj')
    await writeFile(target, JSON.stringify({ ...sampleProject(), version: 2 }), 'utf8')
    const result = await readProjectFile(target)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toBe('Файл создан более новой версией FlowAnalyzer')
  })
})

describe('пути', () => {
  it('checkProjectPath: только абсолютные .flowproj', () => {
    expect(checkProjectPath(join(dir, 'a.flowproj'))).toBeNull()
    expect(checkProjectPath(join(dir, 'A.FLOWPROJ'))).toBeNull()
    expect(checkProjectPath('a.flowproj')).not.toBeNull()
    expect(checkProjectPath(join(dir, 'a.txt'))).not.toBeNull()
    expect(checkProjectPath(join(dir, 'a\0.flowproj'))).not.toBeNull()
    expect(checkProjectPath(42)).not.toBeNull()
    expect(checkProjectPath('')).not.toBeNull()
  })

  it('ensureProjectExtension добавляет расширение один раз', () => {
    expect(ensureProjectExtension('/x/a')).toBe('/x/a.flowproj')
    expect(ensureProjectExtension('/x/a.flowproj')).toBe('/x/a.flowproj')
    expect(ensureProjectExtension('/x/a.FlowProj')).toBe('/x/a.FlowProj')
  })
})
