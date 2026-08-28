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
    }
    const repo = {
      getThreadAgent: vi.fn().mockResolvedValue('nana'),
      listSnapshots: vi.fn().mockResolvedValue([snapshot]),
    }
    const workspace = {
      resolve: vi.fn((_agentId: string, relative: string) => join(root, relative)),
      write: vi.fn(),
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
    expect(workspace.write).not.toHaveBeenCalled()
    expect(result).toMatchObject({ preservedCount: 1, rolledBackCount: 0 })
    expect(result.files).toEqual([{ path: 'note.md', action: 'preserve_changed' }])
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
    }
    const repo = {
      getThreadAgent: vi.fn().mockResolvedValue('nana'),
      listSnapshots: vi.fn().mockResolvedValue([snapshot]),
    }
    const workspace = {
      resolve: vi.fn((_agentId: string, relative: string) => join(root, relative)),
      write: vi.fn(async (_agentId: string, relative: string, content: string) => {
        await writeFile(join(root, relative), content, 'utf8')
      }),
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
})
