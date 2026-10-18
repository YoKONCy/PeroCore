import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ToolContextService,
  type ToolContextSource,
} from '@infos/backend/services/context/toolContextService'
import { ContextRegionSelector } from '@infos/backend/services/context/contextRegionRuntime'
import type { ThreadMessageInfo } from '@infos/backend/services/thread/threadService'

const scope = { threadId: 'thread-1', agentId: 'pero', pairId: 'pair-1', channel: 'desktop' }
const workspace = {
  validatePath: (_agentId: string, requested: string) => ({
    allowed: true,
    resolvedPath: path.resolve(requested),
  }),
}

function message(sources: ToolContextSource[], pairId = scope.pairId): ThreadMessageInfo {
  return {
    id: 1,
    threadId: scope.threadId,
    agentId: scope.agentId,
    pairId,
    role: 'assistant',
    content: '读取完成',
    rawContent: null,
    senderId: null,
    revision: 1,
    metadataJson: JSON.stringify({ toolSources: sources }),
    timestamp: new Date().toISOString(),
    status: 'active',
  }
}

function capture(service: ToolContextService, output: string, pairId = scope.pairId) {
  return service.capture(
    { ...scope, pairId },
    {
      name: 'read_file',
      args: { file_path: 'notes/a.md' },
      output,
      isError: false,
      callId: 'read-1',
    },
    10_000,
  )!
}

describe('近期工具上下文', () => {
  it('跨消息恢复的文件指纹只描述历史读写事实，不能作为定稿或停止编辑依据', async () => {
    const service = new ToolContextService(workspace as never)
    const file = path.resolve('notes/a.md')
    const row = message([])
    row.metadataJson = JSON.stringify({
      fileWorkingState: [{ path: file, version: 'a'.repeat(64), kind: 'write', callId: 'write-1' }],
    })
    const regions = await service.regions(scope.threadId, scope.agentId, [row])
    const state = regions.find((region) => region.regionId === 'file-working-state')
    expect(state?.content).toContain('不能据此判定任务完成')
    expect(state?.content).toContain('可按任务继续编辑，成功写入后会更新记录')
    expect(state?.content).toContain('尚未核验当前磁盘内容')
    expect(state?.content).toContain(`SHA-256=${'a'.repeat(64)}`)
  })

  it('知识资料更新后丢弃旧检索正文，重启后也只保留重新检索的来源', async () => {
    let version = 'a'.repeat(64)
    const service = new ToolContextService(workspace as never, () => version)
    const source = service.capture(
      scope,
      {
        name: 'search_knowledge',
        args: { keywords: ['规章'] },
        output: '旧版本知识正文',
        isError: false,
        callId: 'knowledge-1',
        metadata: { hash: version },
      },
      10_000,
    )!
    const rows = [message([source])]
    expect((await service.regions(scope.threadId, scope.agentId, rows))[0]?.content).toContain(
      '旧版本知识正文',
    )
    expect(JSON.stringify(source)).not.toContain('旧版本知识正文')
    version = 'b'.repeat(64)
    const updated = await service.regions(scope.threadId, scope.agentId, rows)
    expect(updated[0]?.content).toContain(source.sourceRef)
    expect(updated[0]?.content).not.toContain('旧版本知识正文')
    const restarted = new ToolContextService(workspace as never, () => version)
    expect((await restarted.regions(scope.threadId, scope.agentId, rows))[0]?.content).toContain(
      'knowledge://documents',
    )
  })
  it('跨轮保留本次实际返回正文的后段，持久化快照与重启后仅保留来源', async () => {
    const service = new ToolContextService(workspace as never)
    const output = '开头'.repeat(900) + '后段关键内容'
    const source = capture(service, output)
    const rows = [message([source])]
    const regions = await service.regions(scope.threadId, scope.agentId, rows)
    expect(regions[0]?.content).toContain('后段关键内容')
    expect(JSON.stringify(source)).not.toContain('后段关键内容')
    const audited = service.auditMessages([{ role: 'user', content: regions[0]!.content }])
    expect(audited[0]?.content).not.toContain('后段关键内容')
    expect(audited[0]?.content).toContain(source.sourceRef)
    expect(regions[0]?.content).toContain('后段关键内容')
    const restarted = new ToolContextService(workspace as never)
    const recovered = await restarted.regions(scope.threadId, scope.agentId, rows)
    expect(recovered[0]?.content).toContain(source.sourceRef)
    expect(recovered[0]?.content).not.toContain('后段关键内容')
  })

  it('统一 Region 预算不足时保留来源并记录 fallback', async () => {
    const service = new ToolContextService(workspace as never)
    const source = capture(service, '正文'.repeat(1500))
    const regions = await service.regions(scope.threadId, scope.agentId, [message([source])])
    const selector = new ContextRegionSelector({
      tokenizerId: '字符计费',
      countTokens: (text) => text.length,
    })
    const budget = regions[0]!.fallbackContent!.length
    const selected = await selector.compileAsync(regions, budget)
    expect(selected.selected[0]?.content).toContain(source.sourceRef)
    expect(selected.selected[0]?.content).not.toContain('<tool_output>')
    expect(selected.usedTokens).toBeLessThanOrEqual(budget)
    expect(selected.manifest[0]).toMatchObject({ selected: true, reason: 'fallback' })
  })

  it('文件版本变化后立即释放旧正文', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'infos-tool-context-'))
    try {
      const file = path.join(directory, 'note.md')
      await writeFile(file, '旧正文', 'utf8')
      const service = new ToolContextService(workspace as never)
      const source = service.capture(
        scope,
        {
          name: 'read_file',
          args: { file_path: file },
          output: '旧正文',
          isError: false,
          callId: 'file-1',
          metadata: { sourceRef: file, hash: createHash('sha256').update('旧正文').digest('hex') },
        },
        10_000,
      )!
      await writeFile(file, '磁盘已更新的新正文', 'utf8')
      const regions = await service.regions(scope.threadId, scope.agentId, [message([source])])
      expect(regions[0]?.content).toContain(source.sourceRef)
      expect(regions[0]?.content).not.toContain('<tool_output>')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('同一来源采用最新读取，并隔离其他角色、窗口退出与回滚', async () => {
    const service = new ToolContextService(workspace as never)
    const first = capture(service, '较早正文')
    const second = capture(service, '较新正文', 'pair-2')
    const rows = [message([first]), { ...message([second], 'pair-2'), id: 2 }]
    const recent = await service.regions(scope.threadId, scope.agentId, rows)
    expect(recent).toHaveLength(1)
    expect(recent[0]?.content).toContain('较新正文')
    expect(await service.regions(scope.threadId, 'nana', rows)).toHaveLength(0)
    service.deletePairs(scope.threadId, ['pair-2'])
    const rolledBack = await service.regions(scope.threadId, scope.agentId, rows)
    expect(rolledBack).toHaveLength(1)
    expect(rolledBack[0]!.content).toContain(second.sourceRef)
    expect(rolledBack[0]!.content).not.toContain('<tool_output>')
    const third = capture(service, '离开窗口的正文', 'pair-3')
    await service.regions(scope.threadId, scope.agentId, [])
    const recovered = await service.regions(scope.threadId, scope.agentId, [
      message([third], 'pair-3'),
    ])
    expect(recovered).toHaveLength(1)
    expect(recovered[0]!.content).toContain(third.sourceRef)
    expect(recovered[0]!.content).not.toContain('<tool_output>')
  })
})
