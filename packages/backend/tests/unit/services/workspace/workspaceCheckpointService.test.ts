import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceCheckpointService } from '@infos/backend/services/workspace/workspaceCheckpointService'

describe('WorkspaceCheckpointService 工具上下文映射', () => {
  const cleanup: string[] = []
  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
  })
  it('将 ToolContext.toolCallId 显式映射为快照 callId', async () => {
    const service = new WorkspaceCheckpointService({} as never, {} as never)
    const capture = vi.spyOn(service, 'captureBefore').mockResolvedValue(null)

    await service.captureToolMutation(
      {
        source: 'desktop',
        agentId: 'nana',
        sessionId: 'thread-1',
        threadId: 'thread-1',
        channel: 'desktop',
        pairId: 'pair-1',
        toolCallId: 'call-1',
      },
      'turtle_soup_truth.txt',
    )

    expect(capture).toHaveBeenCalledWith(
      {
        agentId: 'nana',
        threadId: 'thread-1',
        pairId: 'pair-1',
        callId: 'call-1',
        channel: 'desktop',
        taskId: undefined,
      },
      'turtle_soup_truth.txt',
    )
  })

  it('文件在会话结束后被人工修改时应保留当前内容', async () => {
    const root = await mkdtemp(join(tmpdir(), 'infos-rewind-'))
    cleanup.push(root)
    const filePath = join(root, 'note.md')
    await writeFile(filePath, '用户后续修改', 'utf8')
    const sha = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')
    const snapshot = {
      filePath: 'note.md',
      operation: 'modify',
      originalContent: '修改前',
      finalSha256: sha('Agent 修改后'),
      historyContinuous: true,
    }
    const repo = {
      getThreadAgent: vi.fn().mockResolvedValue('nana'),
      listSnapshots: vi.fn().mockResolvedValue([snapshot]),
    }
    const workspace = {
      getWorkspaceRoot: () => root,
      resolve: vi.fn((_agentId: string, relative: string) => join(root, relative)),
    }
    const service = new WorkspaceCheckpointService(repo as never, workspace as never)

    const result = await service.rollback({
      threadId: 'thread-1',
      wholeThread: false,
      pairIds: ['pair-1'],
      pairCount: 1,
      createdCount: 0,
      editedCount: 1,
      preservedCount: 0,
      files: [],
      forceWarning: true,
    })

    expect(await readFile(filePath, 'utf8')).toBe('用户后续修改')
    expect(result).toMatchObject({ preservedCount: 1, rolledBackCount: 0 })
    expect(result.files).toMatchObject([{ path: 'note.md', action: 'preserve_changed' }])
  })

  it('文件仍等于 Agent 最终版本时应正常恢复修改前内容', async () => {
    const root = await mkdtemp(join(tmpdir(), 'infos-rewind-'))
    cleanup.push(root)
    const filePath = join(root, 'note.md')
    await writeFile(filePath, 'Agent 修改后', 'utf8')
    const finalSha256 = createHash('sha256').update('Agent 修改后', 'utf8').digest('hex')
    const snapshot = {
      filePath: 'note.md',
      operation: 'modify',
      originalContent: '修改前',
      finalSha256,
      historyContinuous: true,
    }
    const repo = {
      getThreadAgent: vi.fn().mockResolvedValue('nana'),
      listSnapshots: vi.fn().mockResolvedValue([snapshot]),
    }
    const workspace = {
      getWorkspaceRoot: () => root,
      resolve: vi.fn((_agentId: string, relative: string) => join(root, relative)),
    }
    const service = new WorkspaceCheckpointService(repo as never, workspace as never)

    const result = await service.rollback({
      threadId: 'thread-1',
      wholeThread: false,
      pairIds: ['pair-1'],
      pairCount: 1,
      createdCount: 0,
      editedCount: 1,
      preservedCount: 0,
      files: [],
      forceWarning: true,
    })

    expect(await readFile(filePath, 'utf8')).toBe('修改前')
    expect(result).toMatchObject({ preservedCount: 0, rolledBackCount: 1 })
  })

  const hash = (value: string) => createHash('sha256').update(value).digest('hex')
  const preview = (pairIds: string[]) => ({
    threadId: 'thread-1',
    wholeThread: false,
    pairIds,
    pairCount: pairIds.length,
    createdCount: 0,
    editedCount: 1,
    preservedCount: 0,
    files: [],
    forceWarning: true,
  })
  async function fixture(snapshots: Array<Record<string, unknown>>) {
    const root = await mkdtemp(join(tmpdir(), 'infos-rewind-'))
    cleanup.push(root)
    const service = new WorkspaceCheckpointService(
      {
        getThreadAgent: async () => 'nana',
        listSnapshots: async () =>
          snapshots.map((snapshot) => ({ historyContinuous: true, ...snapshot })),
        upsert: async (snapshot: Record<string, unknown>) => {
          snapshots.push(snapshot)
        },
      } as never,
      {
        getWorkspaceRoot: () => root,
        resolve: (_agentId: string, relative: string) => join(root, relative),
        validatePath: (_agentId: string, relative: string) => ({
          allowed: true,
          resolvedPath: join(root, relative),
        }),
      } as never,
    )
    return { root, service }
  }

  it('跨轮夹入手工修改时，撤回早期轮次保留整个文件', async () => {
    const agentA = '原文\nAgent A 修改\n'
    const manual = `${agentA}用户补充\n`
    const agentB = `${manual}Agent B 修改\n`
    const { root, service } = await fixture([
      {
        pairId: 'A',
        filePath: 'note.md',
        operation: 'modify',
        originalContent: '原文\n',
        finalSha256: hash(agentA),
      },
      {
        pairId: 'B',
        filePath: 'note.md',
        operation: 'modify',
        originalContent: manual,
        finalSha256: hash(agentB),
      },
    ])
    await writeFile(join(root, 'note.md'), agentB)
    const result = await service.rollback(preview(['A', 'B']))
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe(agentB)
    expect(result.preservedCount).toBe(1)
    expect(result.rolledBackCount).toBe(0)
  })

  it('按轮次顺序恢复连续变更，早期新建文件会被删除', async () => {
    const { root, service } = await fixture([
      {
        pairId: 'B',
        filePath: 'new.md',
        operation: 'modify',
        originalContent: '第一版',
        finalSha256: hash('第二版'),
      },
      {
        pairId: 'A',
        filePath: 'new.md',
        operation: 'create',
        originalContent: null,
        finalSha256: hash('第一版'),
      },
    ])
    await writeFile(join(root, 'new.md'), '第二版')
    const result = await service.rollback(preview(['A', 'B']))
    await expect(readFile(join(root, 'new.md'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(result.files).toMatchObject([{ path: 'new.md', action: 'delete_created' }])
  })

  it('同轮已发现外部修改时，即使磁盘匹配最终哈希也不覆盖', async () => {
    const { root, service } = await fixture([
      {
        pairId: 'A',
        filePath: 'note.md',
        operation: 'modify',
        originalContent: '初始',
        finalSha256: hash('最终'),
        historyContinuous: false,
      },
    ])
    await writeFile(join(root, 'note.md'), '最终')
    await service.rollback(preview(['A']))
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('最终')
  })

  it('旧快照缺少连续性依据时保留磁盘文件', async () => {
    const { root, service } = await fixture([
      {
        pairId: 'A',
        filePath: 'note.md',
        operation: 'modify',
        originalContent: '初始',
        finalSha256: hash('最终'),
        historyContinuous: null,
      },
    ])
    await writeFile(join(root, 'note.md'), '最终')
    const result = await service.rollback(preview(['A']))
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('最终')
    expect(result.preservedCount).toBe(1)
  })

  it('工具写完至快照提交之间夹入的手工修改不归为可恢复的 Agent 输出', async () => {
    const { root, service } = await fixture([])
    await writeFile(join(root, 'note.md'), '初始')
    const captured = await service.captureBefore(
      { agentId: 'nana', threadId: 'thread-1', pairId: 'A', callId: 'call-1' },
      'note.md',
    )
    await writeFile(join(root, 'note.md'), 'Agent 写入的版本')
    await writeFile(join(root, 'note.md'), '用户刚保存的版本')
    await service.commitFromDisk(captured, {
      oldHash: hash('初始'),
      newHash: hash('Agent 写入的版本'),
    })
    await service.rollback(preview(['A']))
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('用户刚保存的版本')
  })

  it('消息删除失败时补偿已经恢复和删除的文件', async () => {
    const { root, service } = await fixture([
      {
        pairId: 'A',
        filePath: 'edited.md',
        operation: 'modify',
        originalContent: '修改前',
        finalSha256: hash('修改后'),
      },
      {
        pairId: 'A',
        filePath: 'created.md',
        operation: 'create',
        originalContent: null,
        finalSha256: hash('新文件'),
      },
    ])
    await writeFile(join(root, 'edited.md'), '修改后')
    await writeFile(join(root, 'created.md'), '新文件')
    await expect(
      service.rollback(preview(['A']), async () => {
        throw new Error('消息删除失败')
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await readFile(join(root, 'edited.md'), 'utf8')).toBe('修改后')
    expect(await readFile(join(root, 'created.md'), 'utf8')).toBe('新文件')
  })

  it('补偿不覆盖再次出现的人工修改，并留下可恢复的撤回前版本', async () => {
    const { root, service } = await fixture([
      {
        pairId: 'A',
        filePath: 'note.md',
        operation: 'modify',
        originalContent: '修改前',
        finalSha256: hash('Agent 修改后'),
      },
    ])
    await writeFile(join(root, 'note.md'), 'Agent 修改后')
    const failure = await service
      .rollback(preview(['A']), async () => {
        await writeFile(join(root, 'note.md'), '用户的新修改')
        throw new Error('消息删除失败')
      })
      .catch((error: { data: { recoveryPath: string } }) => error)
    if (!('data' in failure)) throw new Error('应该报告未能补偿的文件')
    cleanup.push(failure.data.recoveryPath)
    expect(await readFile(join(root, 'note.md'), 'utf8')).toBe('用户的新修改')
    const receipt = JSON.parse(
      await readFile(join(failure.data.recoveryPath, 'recovery.json'), 'utf8'),
    ) as { files: Array<{ path: string; backup: string }> }
    expect(await readFile(join(failure.data.recoveryPath, receipt.files[0]!.backup), 'utf8')).toBe(
      'Agent 修改后',
    )
  })
})
