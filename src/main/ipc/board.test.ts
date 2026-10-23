// IPC досок без Electron: ipcMain, dialog и shell подменены, файлы настоящие (во временной папке).
import { mkdtemp, readFile, rm, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
const trashItem = vi.fn(async (path: string) => {
  const { rm: remove } = await import('fs/promises')
  await remove(path)
})
const showItemInFolder = vi.fn()
const showSaveDialog = vi.fn()

vi.mock('electron', () => ({
  app: { getPath: () => 'C:\\nowhere' },
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showSaveDialog: (...a: unknown[]) => showSaveDialog(...a) },
  shell: {
    trashItem: (p: string) => trashItem(p),
    showItemInFolder: (p: string) => showItemInFolder(p)
  },
  ipcMain: {
    handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => unknown) =>
      handlers.set(ch, fn)
  }
}))
let trusted = true
vi.mock('../security', () => ({ isTrustedSender: () => trusted }))

import { newBoard } from '../../shared/board/schema'
import { registerBoardHandlers } from './board'

type Res = { ok: boolean; data?: any; error?: string } // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (channel: string, ...args: unknown[]): Promise<Res> =>
  (await handlers.get(channel)!({ sender: {} }, ...args)) as Res

let root: string
const board = (title = 'Атака'): ReturnType<typeof newBoard> =>
  newBoard(title, new Date('2026-02-03T10:00:00Z'))
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'board-ipc-'))
  process.env['FLOW_LIBRARY_DIR'] = root
  trusted = true
  handlers.clear()
  trashItem.mockClear()
  showItemInFolder.mockClear()
  showSaveDialog.mockReset()
  registerBoardHandlers()
})
afterEach(async () => {
  delete process.env['FLOW_LIBRARY_DIR']
  await rm(root, { recursive: true, force: true })
})

describe('IPC досок', () => {
  it('новая доска попадает в «Доски» и открывается обратно; повторное имя получает (2)', async () => {
    const a = await call('board:save', { path: null, board: board('Бросок: 1/2?') })
    expect(a.ok).toBe(true)
    expect(a.data.path).toBe(join(root, 'Доски', 'Бросок 12.flowboard'))
    const b = await call('board:save', { path: null, board: board('Бросок: 1/2?') })
    expect(b.data.path).toBe(join(root, 'Доски', 'Бросок 12 (2).flowboard'))
    const opened = await call('board:open', a.data.path)
    expect(opened.data).toMatchObject({ ok: true, path: a.data.path })
    expect(opened.data.board.title).toBe('Бросок: 1/2?')
    const list = await call('board:list')
    expect(list.data).toHaveLength(2)
  })

  it('сохранение в существующий путь перезаписывает файл', async () => {
    const a = await call('board:save', { path: null, board: board('Один') })
    const again = await call('board:save', { path: a.data.path, board: board('Другое') })
    expect(again.data.path).toBe(a.data.path)
    const text = await readFile(a.data.path, 'utf8')
    expect(text).toContain('Другое')
  })

  it('невалидная доска отклоняется и файл не создаётся', async () => {
    const bad = { ...board(), frameCount: 0 }
    const r = await call('board:save', { path: null, board: bad })
    expect(r.ok).toBe(false)
    await expect(stat(join(root, 'Доски'))).rejects.toThrow()
  })

  it('пути вне папки досок отклоняются: открыть, сохранить, удалить, показать', async () => {
    const outside = join(root, 'чужой.flowboard')
    await writeFile(outside, '{}')
    const nested = join(root, 'Доски', 'sub', 'x.flowboard')
    expect((await call('board:open', outside)).ok).toBe(false)
    expect((await call('board:open', nested)).ok).toBe(false)
    expect((await call('board:save', { path: outside, board: board() })).ok).toBe(false)
    expect((await call('board:delete', outside)).ok).toBe(false)
    expect((await call('board:reveal', outside)).ok).toBe(false)
    expect((await call('board:open', 42)).ok).toBe(false)
    expect(trashItem).not.toHaveBeenCalled()
    expect(showItemInFolder).not.toHaveBeenCalled()
    // Не .flowboard внутри папки досок тоже нельзя.
    expect(
      (await call('board:save', { path: join(root, 'Доски', 'a.txt'), board: board() })).ok
    ).toBe(false)
  })

  it('повреждённый файл в папке досок открывается как ok:false с сообщением', async () => {
    const saved = await call('board:save', { path: null, board: board() })
    await writeFile(saved.data.path, 'мусор')
    const r = await call('board:open', saved.data.path)
    expect(r.ok).toBe(true)
    expect(r.data.ok).toBe(false)
    expect(r.data.message).toBeTruthy()
  })

  it('удаление уходит в Корзину, показ вызывает проводник', async () => {
    const saved = await call('board:save', { path: null, board: board() })
    expect((await call('board:reveal', saved.data.path)).ok).toBe(true)
    expect(showItemInFolder).toHaveBeenCalledWith(saved.data.path)
    expect((await call('board:delete', saved.data.path)).ok).toBe(true)
    expect(trashItem).toHaveBeenCalledWith(saved.data.path)
    expect((await call('board:list')).data).toHaveLength(0)
  })

  it('чужой отправитель получает отказ', async () => {
    trusted = false
    expect((await call('board:list')).ok).toBe(false)
  })

  describe('картинка', () => {
    it('сохраняет PNG в выбранный файл и добавляет .png', async () => {
      const target = join(root, 'кадр')
      showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
      const r = await call('board:save-image', { suggestedName: 'Кадр', png: PNG })
      expect(r.data).toEqual({ path: `${target}.png` })
      expect(new Uint8Array(await readFile(`${target}.png`))).toEqual(PNG)
    })

    it('отмена диалога даёт null', async () => {
      showSaveDialog.mockResolvedValue({ canceled: true })
      expect((await call('board:save-image', { suggestedName: 'x', png: PNG })).data).toBeNull()
    })

    it('не PNG и слишком большой файл отклоняются до диалога', async () => {
      const notPng = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9])
      expect((await call('board:save-image', { suggestedName: 'x', png: notPng })).ok).toBe(false)
      const big = new Uint8Array(20 * 1024 * 1024 + 1)
      big.set(PNG)
      expect((await call('board:save-image', { suggestedName: 'x', png: big })).ok).toBe(false)
      expect((await call('board:save-image', { suggestedName: 'x', png: 'строка' })).ok).toBe(false)
      expect(showSaveDialog).not.toHaveBeenCalled()
    })
  })
})
