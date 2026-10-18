import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileRangeTool } from '@infos/backend/tools/workspaceProductivity'
import {
  fileEditOwner,
  prepareFileEditArguments,
  releaseFileEditReferences,
} from '@infos/backend/services/execution/fileEditing'
import type { StructuredToolResult } from '@infos/backend/services/execution/toolResult'
import type { ExecutionSession } from '@infos/backend/services/execution/executionSession'
import type { FileReadResult } from '@infos/backend/services/execution/virtualWorkspace'

const runtime = vi.hoisted(() => ({
  read: vi.fn(),
  resolveReadablePath: vi.fn(),
  session: { id: 'symbol-session', ownerAgentId: 'nana', threadId: 'symbol-thread' },
}))
vi.mock('@infos/backend/tools/productivityRuntimeHolder', () => ({
  getProductivityRuntime: () => ({ virtualWorkspace: runtime }),
  resolveExecutionSession: async () => runtime.session,
}))
vi.mock('@infos/backend/tools/fileOps', () => ({ buildToolDiff: vi.fn() }))

const context = {
  agentId: 'nana',
  threadId: 'symbol-thread',
  channel: 'desktop',
  source: 'desktop',
  sessionId: 'symbol-thread',
}
const execute = (args: Record<string, unknown>, signal?: AbortSignal) =>
  readFileRangeTool.execute(args, { ...context, signal }) as Promise<StructuredToolResult>

function provideSource(content: string, truncated = false): void {
  const result: FileReadResult = {
    content,
    encoding: 'utf-8',
    eol: 'lf',
    totalBytes: Buffer.byteLength(content),
    totalLines: content.split('\n').length,
    hash: 'version-one',
    truncated,
  }
  runtime.read.mockResolvedValue(result)
}

beforeEach(() => {
  vi.clearAllMocks()
  runtime.resolveReadablePath.mockImplementation(
    async (_session: unknown, inputPath: string) => inputPath,
  )
})
afterEach(() => releaseFileEditReferences({ threadId: 'symbol-thread' }))

describe('符号读取自动回退', () => {
  it('Python 只定位声明，选中后返回实际源码和版本化引用', async () => {
    const content = 'class Store:\n    def save(self):\n        return "中文🎉"\n'
    provideSource(content)
    const outline = await execute({ path: '/source.py', outline: true })
    expect(JSON.parse(outline.output).symbols[1]).toMatchObject({
      name: 'Store.save',
      locationOnly: true,
    })
    const result = await execute({ path: '/source.py', symbol: 'Store.save' })
    expect(result.ok).toBe(true)
    const output = JSON.parse(result.output)
    expect(output.content).toBe(content)
    expect(output.symbolFallback.declaration.name).toBe('Store.save')
    expect(output.symbol).toBeUndefined()
    expect(
      prepareFileEditArguments(
        { read_ref: output.read_ref, new_text: content },
        fileEditOwner(runtime.session as ExecutionSession),
      ),
    ).toMatchObject({ path: '/source.py', expected_hash: 'version-one' })
    expect(() => prepareFileEditArguments({ read_ref: output.read_ref }, '其他会话')).toThrow(
      '不属于',
    )
  })

  it.each([
    { filePath: '/source.py', content: 'value = f"{render()}"', request: { outline: true } },
    { filePath: '/source.ts', content: 'function broken(', request: { symbol: 'broken' } },
    { filePath: '/source.txt', content: '普通源码', request: { outline: true } },
    { filePath: '/source.ts', content: 'function save() {}', request: { symbol: 'missing' } },
  ])(
    '无法可靠定位 $filePath 时自动返回源码，保持调用成功',
    async ({ filePath, content, request }) => {
      provideSource(content)
      const result = await execute({ path: filePath, ...request })
      const output = JSON.parse(result.output)
      expect(result.ok).toBe(true)
      expect(output.content).toBe(content)
      expect(output.read_ref).toMatch(/^read:/)
      expect(output.symbolFallback.reason).toBeTruthy()
      expect(result.metadata?.hash).toBe('version-one')
      expect(runtime.read).toHaveBeenCalledTimes(1)
    },
  )

  it('源码超预算时复用同一快照，限制窗口且保留继续读取的偏移', async () => {
    provideSource('甲'.repeat(15_999) + '🎉' + '乙'.repeat(112_000), true)
    const result = await execute({ path: '/large.py', outline: true })
    const output = JSON.parse(result.output)
    expect(output.content).toBe('甲'.repeat(15_999))
    expect(output.nextOffset).toBe(15_999)
    expect(output.truncated).toBe(true)
    expect(output.symbolFallback.reason).toContain('预算')
    expect(runtime.read).toHaveBeenCalledTimes(1)
  })

  it('目标在文件后部时返回目标附近的窗口，而不是从文件头开始', async () => {
    const prefix = '# 说明\n'.repeat(4000)
    provideSource(prefix + 'def target():\n    return 1\n')
    const result = await execute({ path: '/source.py', symbol: 'target' })
    const output = JSON.parse(result.output)
    expect(output.offset).toBeGreaterThan(0)
    expect(output.content).toContain('def target():')
    expect(output.lineStart).toBe(3998)
    expect(output.content).toBe((prefix + 'def target():\n    return 1\n').slice(output.offset))
  })

  it('JS/TS 解析成功仍返回精确符号，定位歧义不随意挑选', async () => {
    provideSource('function save() { return 1 }\nfunction save() { return 2 }')
    const pending = JSON.parse((await execute({ path: '/source.ts', symbol: 'save' })).output)
    expect(pending.needsSelection).toBe(true)
    const selected = JSON.parse(
      (await execute({ path: '/source.ts', symbol: 'save', symbol_pick: 2 })).output,
    )
    expect(selected.content).toBe('function save() { return 2 }')
    expect(selected.symbolFallback).toBeUndefined()
    expect(selected.read_ref).toMatch(/^read:/)
  })

  it('前置超长行不会把目标声明挤出回退窗口', async () => {
    const content = '# ' + '说明'.repeat(15_000) + '\ndef target():\n    return 1\n'
    provideSource(content)
    const output = JSON.parse((await execute({ path: '/source.py', symbol: 'target' })).output)
    expect(output.offset).toBeGreaterThan(0)
    expect(output.content.length).toBeLessThanOrEqual(16_000)
    expect(output.content).toContain('def target():')
    expect(output.content).toBe(content.slice(output.offset))
  })

  it('取消与文件权限失败不转换为成功回退', async () => {
    provideSource('def target(): pass')
    const controller = new AbortController()
    controller.abort(new Error('任务已停止'))
    await expect(execute({ path: '/source.py', outline: true }, controller.signal)).rejects.toThrow(
      '任务已停止',
    )
    runtime.read.mockRejectedValueOnce(new Error('文件不在权限范围内'))
    await expect(execute({ path: '/source.py', outline: true })).rejects.toThrow('权限范围')
  })
})
