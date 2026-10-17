import { mkdtemp, readdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { sampleProject } from '../../shared/project.testkit'
import {
  RECOVERY_DIR,
  deleteRecovery,
  isRecoveryKey,
  listRecovery,
  readRecovery,
  recoveryFileName,
  recoveryKey,
  writeRecovery
} from './recovery'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow-recovery-test-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('имена копий', () => {
  it('для проекта с путём — хэш пути, для безымянного — untitled-<сессия>', () => {
    const key = recoveryKey(join(dir, 'a.flowproj'), 'deadbeef')
    expect(key).toMatch(/^p-[0-9a-f]{16}$/)
    expect(recoveryKey(join(dir, 'a.flowproj'), 'другая-сессия')).toBe(key)
    expect(recoveryKey(join(dir, 'b.flowproj'), 'deadbeef')).not.toBe(key)
    expect(recoveryKey(null, 'deadbeef')).toBe('untitled-deadbeef')
    expect(recoveryFileName(key)).toBe(`${key}.flowproj.recovery`)
  })

  it('ключ из чужих рук проверяется (нельзя выйти из папки)', () => {
    expect(isRecoveryKey('untitled-0a1b2c3d')).toBe(true)
    expect(isRecoveryKey('p-0123456789abcdef')).toBe(true)
    for (const bad of ['../x', 'untitled-', 'p-xyz', '', 5, null, 'untitled-0a1b2c3d/../..']) {
      expect(isRecoveryKey(bad)).toBe(false)
    }
  })
})

describe('копии работы', () => {
  const key = 'untitled-0a1b2c3d'

  it('записывается, читается, перечисляется и удаляется', async () => {
    await writeRecovery(dir, key, null, sampleProject(), new Date('2026-05-05T12:00:00Z'))
    expect(await readdir(join(dir, RECOVERY_DIR))).toEqual([recoveryFileName(key)])
    const file = await readRecovery(dir, key)
    expect(file?.project.annotations).toHaveLength(1)
    expect(file?.savedAt).toBe('2026-05-05T12:00:00.000Z')

    const list = await listRecovery(dir)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ key, name: 'Новый проект', projectPath: null })

    await deleteRecovery(dir, key)
    expect(await listRecovery(dir)).toEqual([])
    await deleteRecovery(dir, key) // повторное удаление не ошибка
  })

  it('список — от новых к старым; имя берётся из пути проекта', async () => {
    const path = join(dir, 'Финал.flowproj')
    await writeRecovery(dir, 'untitled-00000001', null, sampleProject(), new Date('2026-01-01Z'))
    await writeRecovery(dir, recoveryKey(path, 'x'), path, sampleProject(), new Date('2026-02-01Z'))
    const list = await listRecovery(dir)
    expect(list.map((i) => i.name)).toEqual(['Финал', 'Новый проект'])
  })

  it('повреждённые файлы пропускаются', async () => {
    await writeRecovery(dir, key, null, sampleProject())
    await writeFile(join(dir, RECOVERY_DIR, recoveryFileName('untitled-ffffffff')), '{ битый')
    expect((await listRecovery(dir)).map((i) => i.key)).toEqual([key])
    expect(await readRecovery(dir, 'untitled-ffffffff')).toBeNull()
  })

  it('чужой ключ не пишется', async () => {
    await expect(writeRecovery(dir, '../evil', null, sampleProject())).rejects.toThrow()
  })

  it('нет папки — пустой список', async () => {
    expect(await listRecovery(join(dir, 'nothing'))).toEqual([])
  })
})
