import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MAX_RECENT } from '../../shared/project'
import { addToRecent, listRecent, readRecent, rememberProject, RECENT_FILE } from './recent'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'flow-recent-test-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const at = (n: number): Date => new Date(Date.UTC(2026, 0, 1, 0, n))

describe('список недавних: чистая логика', () => {
  it('новый проект — в начало, имя берётся из файла', () => {
    const list = addToRecent(addToRecent([], '/p/a.flowproj', at(1)), '/p/b.flowproj', at(2))
    expect(list.map((r) => r.name)).toEqual(['b', 'a'])
  })

  it('повтор не дублируется, а поднимается наверх', () => {
    let list = addToRecent([], '/p/a.flowproj', at(1))
    list = addToRecent(list, '/p/b.flowproj', at(2))
    list = addToRecent(list, '/p/a.flowproj', at(3))
    expect(list.map((r) => r.path)).toEqual(['/p/a.flowproj', '/p/b.flowproj'])
    expect(list[0].openedAt).toBe(at(3).toISOString())
  })

  it('не больше 10', () => {
    let list: ReturnType<typeof addToRecent> = []
    for (let i = 0; i < 15; i++) list = addToRecent(list, `/p/${i}.flowproj`, at(i))
    expect(list).toHaveLength(MAX_RECENT)
    expect(list[0].path).toBe('/p/14.flowproj')
    expect(list.at(-1)?.path).toBe('/p/5.flowproj')
  })
})

describe('список недавних: файл', () => {
  it('нет файла или он повреждён — пустой список', async () => {
    expect(await readRecent(dir)).toEqual([])
    await writeFile(join(dir, RECENT_FILE), '{ не json', 'utf8')
    expect(await readRecent(dir)).toEqual([])
    await writeFile(join(dir, RECENT_FILE), JSON.stringify({ version: 1, items: [{ path: 5 }] }))
    expect(await readRecent(dir)).toEqual([])
  })

  it('сохраняется между «запусками»', async () => {
    const a = join(dir, 'a.flowproj')
    const b = join(dir, 'b.flowproj')
    await writeFile(a, 'x')
    await writeFile(b, 'x')
    await rememberProject(dir, a, at(1))
    await rememberProject(dir, b, at(2))
    await rememberProject(dir, a, at(3))
    const list = await readRecent(dir)
    expect(list.map((r) => r.path)).toEqual([a, b])
    expect(JSON.parse(await readFile(join(dir, RECENT_FILE), 'utf8')).version).toBe(1)
  })

  it('при показе пропавшие файлы убираются (и из файла)', async () => {
    const a = join(dir, 'a.flowproj')
    const gone = join(dir, 'gone.flowproj')
    await writeFile(a, 'x')
    await writeFile(gone, 'x')
    await rememberProject(dir, a)
    await rememberProject(dir, gone)
    await rm(gone)
    expect((await listRecent(dir)).map((r) => r.path)).toEqual([a])
    expect((await readRecent(dir)).map((r) => r.path)).toEqual([a])
  })
})
