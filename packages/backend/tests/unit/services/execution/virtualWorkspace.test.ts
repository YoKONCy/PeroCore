import path from 'node:path'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ExecutionSessionManager,
  createDefaultSandboxProfile,
  type ExecutionSession,
} from '@infos/backend/services/execution/executionSession'
import { VirtualWorkspace } from '@infos/backend/services/execution/virtualWorkspace'

let root = ''
let session: ExecutionSession

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'infos-execution-'))
  const manager = new ExecutionSessionManager()
  session = await manager.getOrCreate({
    ownerAgentId: 'pero',
    threadId: 'thread-1',
    channel: 'desktop',
    workspaceRoot: root,
    sandboxProfile: createDefaultSandboxProfile('workspace-write', root),
  })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('VirtualWorkspace', () => {
  it('设备级只读工具可访问 Workspace 外路径，但写入权限不会随之扩大', async () => {
    const externalRoot = await mkdtemp(path.join(tmpdir(), 'infos-device-read-'))
    const externalFile = path.join(externalRoot, 'outside.md')
    await writeFile(externalFile, '# 设备文件\n只读内容', 'utf8')
    const workspace = new VirtualWorkspace()
    try {
      await expect(workspace.read(session, externalFile)).rejects.toThrow('超出可读范围')
      const read = await workspace.read(session, externalFile, { deviceScope: true })
      expect(read.content).toContain('设备文件')

      const files = await workspace.glob(session, {
        cwd: externalRoot,
        pattern: '*.md',
        deviceScope: true,
      })
      expect(files).toEqual(['outside.md'])
      await expect(
        workspace.write(session, { path: externalFile, content: '禁止写入' }),
      ).rejects.toThrow('超出可写范围')
    } finally {
      await rm(externalRoot, { recursive: true, force: true })
    }
  })

  it('审批后的单次编辑可访问工作区外绝对路径，未授权调用仍被拒绝', async () => {
    const externalRoot = await mkdtemp(path.join(tmpdir(), 'infos-approved-write-'))
    const externalFile = path.join(externalRoot, 'outside.txt')
    await writeFile(externalFile, '修改前', 'utf8')
    const workspace = new VirtualWorkspace()
    try {
      await expect(
        workspace.edit(session, {
          path: externalFile,
          oldText: '修改前',
          newText: '修改后',
        }),
      ).rejects.toThrow('超出可写范围')

      const result = await workspace.edit(session, {
        path: externalFile,
        oldText: '修改前',
        newText: '修改后',
        deviceScope: true,
      })
      expect(result.success).toBe(true)
      expect((await workspace.read(session, externalFile, { deviceScope: true })).content).toBe(
        '修改后',
      )
    } finally {
      await rm(externalRoot, { recursive: true, force: true })
    }
  })

  it('支持按行与尾部读取并返回哈希', async () => {
    await writeFile(path.join(root, 'sample.txt'), '第一行\n第二行\n第三行\n第四行', 'utf8')
    const workspace = new VirtualWorkspace()
    const lines = await workspace.read(session, 'sample.txt', { lineStart: 2, lineEnd: 3 })
    expect(lines.content).toBe('第二行\n第三行')
    expect(lines.hash).toHaveLength(64)
    expect(lines.truncated).toBe(true)
    // 返回文件总行数，Agent 可感知整体规模
    expect(lines.totalLines).toBe(4)

    const tail = await workspace.read(session, 'sample.txt', { tailLines: 2 })
    expect(tail.content).toBe('第三行\n第四行')
    expect(tail.totalLines).toBe(4)

    const beyondEnd = await workspace.read(session, 'sample.txt', {
      lineStart: 10,
      lineEnd: 20,
    })
    expect(beyondEnd.content).toBe('')
    expect(beyondEnd.totalLines).toBe(4)
    expect(beyondEnd.lineStart).toBe(10)
    expect(beyondEnd.lineEnd).toBe(9)

    await expect(
      workspace.read(session, 'sample.txt', { lineStart: 3, lineEnd: 2 }),
    ).rejects.toThrow('line_end 不能小于 line_start')
  })

  it('Glob 支持双星号并限制在工作区', async () => {
    const workspace = new VirtualWorkspace()
    await workspace.atomicWrite(path.join(root, 'src', 'a.ts'), 'export const a = 1')
    await workspace.atomicWrite(path.join(root, 'src', 'nested', 'b.ts'), 'export const b = 2')
    await workspace.atomicWrite(path.join(root, 'src', 'ignored.js'), 'x')
    const files = await workspace.glob(session, { pattern: '**/*.ts' })
    expect(files.sort()).toEqual(['src/a.ts', 'src/nested/b.ts'])
  })

  it('精确编辑要求唯一匹配并校验哈希', async () => {
    const workspace = new VirtualWorkspace()
    await workspace.atomicWrite(path.join(root, 'edit.ts'), 'const value = 1\n')
    const before = await workspace.read(session, 'edit.ts')
    const result = await workspace.edit(session, {
      path: 'edit.ts',
      oldText: 'value = 1',
      newText: 'value = 2',
      expectedHash: before.hash,
    })
    expect(result.oldHash).toBe(before.hash)
    expect((await workspace.read(session, 'edit.ts')).content).toContain('value = 2')
    await expect(
      workspace.edit(session, {
        path: 'edit.ts',
        oldText: 'value = 2',
        newText: 'value = 3',
        expectedHash: before.hash,
      }),
    ).rejects.toThrow('expected_hash')
  })

  it('拒绝跨 Agent 复用同名 Thread 会话', async () => {
    const manager = new ExecutionSessionManager()
    const peroRoot = await mkdtemp(path.join(tmpdir(), 'infos-pero-'))
    const nanaRoot = await mkdtemp(path.join(tmpdir(), 'infos-nana-'))
    try {
      const pero = await manager.getOrCreate({
        ownerAgentId: 'pero',
        threadId: 'shared',
        channel: 'desktop',
        workspaceRoot: peroRoot,
      })
      const nana = await manager.getOrCreate({
        ownerAgentId: 'nana',
        threadId: 'shared',
        channel: 'desktop',
        workspaceRoot: nanaRoot,
      })
      expect(nana.id).not.toBe(pero.id)
      expect(nana.workspaceRoot).toBe(path.resolve(nanaRoot))
    } finally {
      await rm(peroRoot, { recursive: true, force: true })
      await rm(nanaRoot, { recursive: true, force: true })
    }
  })

  it('拒绝 workspace 内符号链接指向外部路径', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'infos-outside-'))
    try {
      await writeFile(path.join(outside, 'secret.txt'), 'secret', 'utf8')
      const linkType = process.platform === 'win32' ? 'junction' : 'dir'
      await symlink(outside, path.join(root, 'escape'), linkType)
      await expect(new VirtualWorkspace().read(session, 'escape/secret.txt')).rejects.toThrow(
        '符号链接',
      )
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('拒绝路径逃逸和受保护目录', async () => {
    const workspace = new VirtualWorkspace()
    await expect(workspace.read(session, '../outside.txt')).rejects.toThrow('可读范围')
    await expect(
      workspace.edit(session, {
        path: '.git/config',
        oldText: 'a',
        newText: 'b',
      }),
    ).rejects.toThrow('路径受保护')
  })

  it('编辑返回真实行级 diff 统计与改动行号', async () => {
    const workspace = new VirtualWorkspace()
    await workspace.atomicWrite(
      path.join(root, 'diff.ts'),
      'const a = 1\nconst b = 2\nconst c = 3\n',
      'utf8',
    )
    const result = await workspace.edit(session, {
      path: 'diff.ts',
      oldText: 'const a = 1\nconst b = 2\nconst c = 3',
      newText: 'const a = 1\nconst b = 9\nconst c = 3',
    })
    // 仅第 2 行内容被修改 → +1/-1，改动范围覆盖第 1-3 行
    expect(result.success).toBe(true)
    expect(result.operation).toBe('edit')
    expect(result.editRange).toEqual({ startLine: 1, endLine: 3 })
    expect(result.insertions).toBe(1)
    expect(result.deletions).toBe(1)
  })

  it('拒绝 old_text 与 new_text 完全相同的空编辑', async () => {
    const workspace = new VirtualWorkspace()
    await workspace.atomicWrite(path.join(root, 'noop.ts'), 'const value = 1\n', 'utf8')
    await expect(
      workspace.edit(session, {
        path: 'noop.ts',
        oldText: 'const value = 1',
        newText: 'const value = 1',
      }),
    ).rejects.toThrow('完全相同')
  })

  it('write 返回创建/覆写的行级 diff 统计', async () => {
    const workspace = new VirtualWorkspace()
    const created = await workspace.write(session, { path: 'new.txt', content: 'a\nb\nc\n' })
    expect(created.operation).toBe('create')
    expect(created.insertions).toBe(3)
    expect(created.deletions).toBe(0)

    const overwritten = await workspace.write(session, { path: 'new.txt', content: 'a\nb\n' })
    expect(overwritten.operation).toBe('overwrite')
    expect(overwritten.insertions).toBe(0)
    expect(overwritten.deletions).toBe(1)
  })

  it('安全重命名并删除工作区普通文件', async () => {
    const workspace = new VirtualWorkspace()
    await workspace.atomicWrite(path.join(root, 'before.txt'), '内容', 'utf8')
    const renamed = await workspace.renameFile(session, 'before.txt', 'after.txt')
    expect(renamed).toEqual({ oldPath: 'before.txt', newPath: 'after.txt', name: 'after.txt' })
    expect((await workspace.read(session, 'after.txt')).content).toBe('内容')
    await expect(workspace.read(session, 'before.txt')).rejects.toThrow()

    await workspace.deleteFile(session, 'after.txt')
    await expect(workspace.read(session, 'after.txt')).rejects.toThrow()
  })

  it('重命名拒绝目录路径与覆盖已有文件', async () => {
    const workspace = new VirtualWorkspace()
    await workspace.atomicWrite(path.join(root, 'a.txt'), 'a', 'utf8')
    await workspace.atomicWrite(path.join(root, 'b.txt'), 'b', 'utf8')
    await expect(workspace.renameFile(session, 'a.txt', '../escape.txt')).rejects.toThrow(
      '不能包含目录路径',
    )
    await expect(workspace.renameFile(session, 'a.txt', 'b.txt')).rejects.toThrow('同名文件已存在')
  })
})
