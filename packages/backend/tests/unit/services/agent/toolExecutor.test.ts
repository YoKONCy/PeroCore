import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplicationRealmManager } from '@infos/backend/applications/applicationRealm'
import { RegistryToolExecutor, type HookEmitter } from '@infos/backend/services/agent/toolExecutor'
import { ToolRegistry } from '@infos/backend/services/agent/toolRegistry'
import type { CapabilityGate } from '@infos/backend/capabilities/capabilityGate'
import type { SkillLoader } from '@infos/backend/capabilities/skillLoader'
import { PolicyEngine } from '@infos/backend/services/execution/policyEngine'
import { ApprovalService } from '@infos/backend/services/execution/approvalService'

function createRegistry() {
  const registry = new ToolRegistry()
  const handler = vi.fn().mockResolvedValue('执行结果')
  registry.register(
    { name: 'demo.run', description: '演示工具', parameters: { type: 'object' } },
    handler,
  )
  return { registry, handler }
}

describe('RegistryToolExecutor', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('工具执行超过原30秒边界仍保持挂起，直到工具自身完成', async () => {
    vi.useFakeTimers()
    const registry = new ToolRegistry()
    let finish: ((value: string) => void) | undefined
    registry.register(
      { name: 'wait.forever', description: '等待外部输入', parameters: { type: 'object' } },
      () =>
        new Promise<string>((resolve) => {
          finish = resolve
        }),
    )
    const executor = new RegistryToolExecutor(registry)
    let settled = false
    const execution = executor.execute('wait.forever', {}, 'desktop').finally(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(31_000)
    expect(settled).toBe(false)

    finish?.('用户已回复')
    await expect(execution).resolves.toMatchObject({
      output: '用户已回复',
      isError: false,
    })
  })

  it('Application Realm工具不得被主应用或其他Realm调用', async () => {
    const registry = new ToolRegistry()
    const realms = new ApplicationRealmManager(registry)
    const arca = realms.register({
      realmId: 'infos.arca',
      appId: 'infos.arca',
      principalId: 'application:infos.arca',
      instanceId: 'managed',
    })
    const handler = vi.fn().mockResolvedValue('已提交')
    arca.registerTool(
      { name: 'arca_changeset_propose', description: '提交变更', parameters: { type: 'object' } },
      handler,
    )
    const executor = new RegistryToolExecutor(registry)
    executor.setApplicationRealmManager(realms)

    await expect(executor.execute('arca_changeset_propose', {}, 'desktop')).resolves.toMatchObject({
      isError: true,
    })
    await expect(
      executor.execute('arca_changeset_propose', {}, 'desktop', { realmId: 'infos.social' }),
    ).resolves.toMatchObject({ isError: true })
    await expect(
      executor.execute('arca_changeset_propose', {}, 'desktop', { realmId: 'infos.arca' }),
    ).resolves.toMatchObject({ isError: false, output: '已提交' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('据点group通道应只注入并执行据点工具与固定协议工具', async () => {
    const registry = new ToolRegistry()
    const strongholdHandler = vi.fn().mockResolvedValue('已移动')
    const terminalHandler = vi.fn().mockResolvedValue('不应执行')
    registry.register(
      { name: 'stronghold_move_to_room', description: '移动房间', parameters: {} },
      strongholdHandler,
      ['group'],
    )
    registry.register(
      { name: 'terminal_execute', description: '执行终端命令', parameters: {} },
      terminalHandler,
    )
    registry.register(
      { name: 'finish_task', description: '结束任务', parameters: {} },
      vi.fn().mockResolvedValue('已结束'),
    )
    const executor = new RegistryToolExecutor(registry)

    expect(registry.getDefinitions('group').map((tool) => tool.name)).toEqual([
      'stronghold_move_to_room',
      'finish_task',
    ])
    await expect(
      executor.execute('terminal_execute', { command: 'pwd' }, 'group'),
    ).resolves.toMatchObject({ isError: true, output: expect.stringContaining('不允许') })
    expect(terminalHandler).not.toHaveBeenCalled()
  })

  it('工具定义通道限制应同时阻止执行，避免手工FC绕过', async () => {
    const registry = new ToolRegistry()
    const handler = vi.fn().mockResolvedValue('已移动')
    registry.register(
      { name: 'stronghold_move_to_room', description: '移动房间', parameters: {} },
      handler,
      ['group'],
    )
    const executor = new RegistryToolExecutor(registry)

    expect(registry.getDefinitions('desktop').map((tool) => tool.name)).not.toContain(
      'stronghold_move_to_room',
    )
    expect(registry.getDefinitions('group').map((tool) => tool.name)).toContain(
      'stronghold_move_to_room',
    )
    await expect(
      executor.execute('stronghold_move_to_room', { room_name: '卧室' }, 'desktop'),
    ).resolves.toMatchObject({ isError: true, output: expect.stringContaining('不允许') })
    expect(handler).not.toHaveBeenCalled()
  })

  it('应将旧工具的JSON错误结果归一化为失败状态', async () => {
    const registry = new ToolRegistry()
    registry.register(
      { name: 'legacy.read', description: '旧读取工具', parameters: { type: 'object' } },
      vi.fn().mockResolvedValue(JSON.stringify({ error: '文件不存在' })),
    )
    const executor = new RegistryToolExecutor(registry)

    await expect(executor.execute('legacy.read', {}, 'desktop')).resolves.toMatchObject({
      isError: true,
      output: expect.stringContaining('文件不存在'),
    })
  })

  it('应将旧工具的 success=false 结果归一化为失败状态', async () => {
    const registry = new ToolRegistry()
    registry.register(
      { name: 'legacy.edit', description: '旧编辑工具', parameters: { type: 'object' } },
      vi.fn().mockResolvedValue(JSON.stringify({ success: false, error: '编辑失败' })),
    )
    const executor = new RegistryToolExecutor(registry)

    await expect(executor.execute('legacy.edit', {}, 'desktop')).resolves.toMatchObject({
      isError: true,
    })
  })

  it('应当直接执行 finish_task 并返回终止信号', async () => {
    const { registry } = createRegistry()
    const executor = new RegistryToolExecutor(registry)

    const result = await executor.execute('finish_task', { summary: '完成啦' }, 'desktop')

    expect(result).toMatchObject({
      output: '完成啦',
      isError: false,
      shouldTerminate: true,
    })
  })

  it('应当拒绝 CapabilityGate 不允许的工具', async () => {
    const { registry, handler } = createRegistry()
    const capabilityGate = {
      isToolAllowed: vi.fn().mockReturnValue(false),
    } as unknown as CapabilityGate
    // AIOS: mode 已改为 channel（Work 模式废弃，按对话通道鉴权）
    const executor = new RegistryToolExecutor(registry, capabilityGate, null, null, {
      agentId: 'pero',
      channel: 'desktop',
      sessionId: 'session-1',
    })

    const result = await executor.execute('demo.run', {}, 'desktop')

    expect(capabilityGate.isToolAllowed).toHaveBeenCalledWith(
      'pero',
      'desktop',
      'demo.run',
      'session-1',
      undefined,
    )
    expect(handler).not.toHaveBeenCalled()
    expect(result).toMatchObject({ isError: true, shouldTerminate: false })
    expect(result.output).toContain('没有权限')
  })

  it('即使旧 Thread 禁用列表含系统协议工具也应继续执行', async () => {
    const registry = new ToolRegistry()
    const finishHandler = vi.fn(async () => JSON.stringify({ success: true }))
    registry.register(
      { name: 'finish_task', description: '完成任务', parameters: {} },
      finishHandler,
    )
    const capabilityGate = {
      isToolAllowed: vi.fn().mockReturnValue(true),
    } as unknown as CapabilityGate
    const executor = new RegistryToolExecutor(registry, capabilityGate)

    const result = await executor.execute('finish_task', { reply: '完成' }, 'desktop', {
      agentId: 'pero',
      threadId: 'thread-1',
      channel: 'desktop',
      disabledTools: ['finish_task', 'load_skill'],
    })

    expect(finishHandler).toHaveBeenCalledOnce()
    expect(result.isError).toBe(false)
    expect(result.shouldTerminate).toBe(true)
  })

  it('应当在任何内置捷径和 CapabilityGate 之前拒绝本会话禁用工具', async () => {
    const { registry, handler } = createRegistry()
    const capabilityGate = {
      isToolAllowed: vi.fn().mockReturnValue(true),
    } as unknown as CapabilityGate
    const executor = new RegistryToolExecutor(registry, capabilityGate)

    const result = await executor.execute('demo.run', {}, 'desktop', {
      agentId: 'pero',
      threadId: 'thread-1',
      channel: 'desktop',
      disabledTools: ['demo.run'],
    })

    expect(capabilityGate.isToolAllowed).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
    expect(result).toMatchObject({ isError: true, shouldTerminate: false })
    expect(result.output).toContain('已在本会话中禁用')
  })

  it('应当允许会话未禁用且 CapabilityGate 授权的工具', async () => {
    const { registry, handler } = createRegistry()
    const capabilityGate = {
      isToolAllowed: vi.fn().mockReturnValue(true),
    } as unknown as CapabilityGate
    const hookEmitter = {
      emitHook: vi.fn(async (event: string, data: unknown) => {
        if (event === 'tool:beforeCall') return { ...(data as object), args: { value: 'hooked' } }
        return data
      }),
    } as HookEmitter & { emitHook: ReturnType<typeof vi.fn> }
    const executor = new RegistryToolExecutor(registry, capabilityGate, null, hookEmitter, {
      agentId: 'pero',
      sessionId: 'session-1',
    })

    const result = await executor.execute('demo.run', { value: 'raw' }, 'desktop')

    expect(handler).toHaveBeenCalledWith(
      { value: 'hooked' },
      // AIOS: ToolContext 新增 threadId + channel 字段
      {
        source: 'desktop',
        agentId: 'pero',
        sessionId: 'session-1',
        threadId: 'session-1',
        channel: 'desktop',
      },
    )
    expect(hookEmitter.emitHook).toHaveBeenCalledWith('tool:afterCall', {
      name: 'demo.run',
      args: { value: 'hooked' },
      output: '执行结果',
      durationMs: expect.any(Number),
      isError: false,
    })
    expect(result).toMatchObject({ output: '执行结果', isError: false, shouldTerminate: false })
  })

  it('审批允许后恢复原工具调用并向 Agent 回传附言', async () => {
    const { registry, handler } = createRegistry()
    const capabilityGate = {
      isToolAllowed: vi.fn().mockReturnValue(true),
      getToolPermission: vi.fn().mockReturnValue({
        toolName: 'demo.run',
        resourceScope: { scope: 'system', allowedRoots: [], deniedPaths: [] },
        requiresApproval: true,
      }),
    } as unknown as CapabilityGate
    const approvals = new ApprovalService()
    const executor = new RegistryToolExecutor(registry, capabilityGate, null, null, {
      agentId: 'pero',
      channel: 'desktop',
      sessionId: 'approval-thread',
    })
    executor.setPolicyRuntime(new PolicyEngine(), approvals)

    const execution = executor.execute('demo.run', { value: 1 }, 'desktop')
    await vi.waitFor(() => expect(approvals.list({ status: 'pending' })).toHaveLength(1))
    const request = approvals.list({ status: 'pending' })[0]!
    approvals.resolve(request.id, 'allow_once', '请谨慎执行')
    const result = await execution

    expect(handler).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({
      output: '执行结果',
      isError: false,
      approvalObservation: '【用户审批】决策：allow_once；附言：请谨慎执行',
    })
    expect(approvals.get(request.id)?.status).toBe('consumed')
  })

  it('敏感命令工具在审批运行时不可用时应失败关闭', async () => {
    const registry = new ToolRegistry()
    const handler = vi.fn().mockResolvedValue('不应执行')
    registry.register(
      { name: 'terminal_execute', description: '执行命令', parameters: { type: 'object' } },
      handler,
    )
    const capabilityGate = {
      isToolAllowed: vi.fn().mockReturnValue(true),
      isPathAllowed: vi.fn().mockReturnValue(true),
    } as unknown as CapabilityGate
    const executor = new RegistryToolExecutor(registry, capabilityGate)

    const result = await executor.execute(
      'terminal_execute',
      { command: 'move C:\\outside\\a.txt C:\\outside\\b.txt' },
      'desktop',
    )

    expect(result.isError).toBe(true)
    expect(result.output).toContain('APPROVAL_UNAVAILABLE')
    expect(handler).not.toHaveBeenCalled()
  })

  it('终端命令即使曾被始终允许也必须逐次重新审批', async () => {
    const registry = new ToolRegistry()
    const handler = vi.fn().mockResolvedValue('命令完成')
    registry.register(
      { name: 'terminal_execute', description: '执行命令', parameters: { type: 'object' } },
      handler,
    )
    const capabilityGate = {
      isToolAllowed: vi.fn().mockReturnValue(true),
      isPathAllowed: vi.fn().mockReturnValue(true),
      getToolPermission: vi.fn().mockReturnValue({
        toolName: 'terminal_execute',
        resourceScope: {
          scope: 'principal_workspace',
          allowedRoots: ['C:/workspace'],
          deniedPaths: [],
        },
        requiresApproval: false,
      }),
    } as unknown as CapabilityGate
    const approvals = new ApprovalService()
    const executor = new RegistryToolExecutor(registry, capabilityGate, null, null, {
      agentId: 'pero',
      channel: 'desktop',
      sessionId: 'terminal-thread',
    })
    executor.setPolicyRuntime(new PolicyEngine(), approvals)
    const args = { command: 'Write-Output "hello"' }

    const firstExecution = executor.execute('terminal_execute', args, 'desktop')
    await vi.waitFor(() => expect(approvals.list({ status: 'pending' })).toHaveLength(1))
    expect(handler).not.toHaveBeenCalled()
    approvals.resolve(approvals.list({ status: 'pending' })[0]!.id, 'allow_once')
    expect((await firstExecution).isError).toBe(false)
    expect(handler).toHaveBeenCalledWith(
      args,
      expect.objectContaining({ approvedSensitiveAction: true }),
    )
    expect(handler).toHaveBeenCalledTimes(1)

    const secondExecution = executor.execute('terminal_execute', args, 'desktop')
    await vi.waitFor(() => expect(approvals.list({ status: 'pending' })).toHaveLength(1))
    expect(handler).toHaveBeenCalledTimes(1)
    approvals.resolve(approvals.list({ status: 'pending' })[0]!.id, 'deny_once')
    expect((await secondExecution).isError).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('自动执行模式仅保留终端与工作区外删除审批', async () => {
    const registry = new ToolRegistry()
    const browserHandler = vi.fn().mockResolvedValue('完成')
    const terminalHandler = vi.fn().mockResolvedValue('命令完成')
    const deleteHandler = vi.fn().mockResolvedValue('已删除')
    registry.register(
      { name: 'browser_type', description: '输入', parameters: { type: 'object' } },
      browserHandler,
    )
    registry.register(
      { name: 'terminal_execute', description: '终端', parameters: { type: 'object' } },
      terminalHandler,
    )
    registry.register(
      { name: 'delete_file', description: '删除', parameters: { type: 'object' } },
      deleteHandler,
    )
    const capabilityGate = {
      isToolAllowed: vi.fn().mockReturnValue(true),
      isPathAllowed: vi.fn().mockReturnValue(true),
      getToolPermission: vi.fn(),
    } as unknown as CapabilityGate
    const approvals = new ApprovalService()
    const executor = new RegistryToolExecutor(registry, capabilityGate, null, null, {
      agentId: 'pero',
      channel: 'desktop',
      sessionId: 'auto-thread',
    })
    executor.setPathBoundaryChecker(
      (_agentId, _channel, inputPath) => !inputPath.includes('outside'),
    )
    executor.setPolicyRuntime(new PolicyEngine(), approvals)

    await expect(
      executor.execute('browser_type', { text: 'hello' }, 'desktop', {
        autoExecuteTools: true,
      }),
    ).resolves.toMatchObject({ isError: false })
    expect(browserHandler).toHaveBeenCalledTimes(1)

    const terminal = executor.execute('terminal_execute', { command: 'echo ok' }, 'desktop', {
      autoExecuteTools: true,
    })
    await vi.waitFor(() => expect(approvals.list({ status: 'pending' })).toHaveLength(1))
    approvals.resolve(approvals.list({ status: 'pending' })[0]!.id, 'deny_once')
    expect((await terminal).isError).toBe(true)
    expect(terminalHandler).not.toHaveBeenCalled()

    const outsideDelete = executor.execute(
      'delete_file',
      { file_path: 'C:/outside/old.txt' },
      'desktop',
      { autoExecuteTools: true },
    )
    await vi.waitFor(() => expect(approvals.list({ status: 'pending' })).toHaveLength(1))
    approvals.resolve(approvals.list({ status: 'pending' })[0]!.id, 'deny_once')
    expect((await outsideDelete).isError).toBe(true)
    expect(deleteHandler).not.toHaveBeenCalled()

    await expect(
      executor.execute('delete_file', { file_path: 'notes/old.txt' }, 'desktop', {
        autoExecuteTools: true,
      }),
    ).resolves.toMatchObject({ isError: false })
    expect(deleteHandler).toHaveBeenCalledWith(
      { file_path: 'notes/old.txt' },
      expect.objectContaining({ approvedSensitiveAction: true }),
    )
  })

  it('远程终端只按自动执行开关决定是否逐次审批', async () => {
    const registry = new ToolRegistry()
    const handler = vi.fn().mockResolvedValue('远程终端完成')
    registry.register(
      { name: 'remote_terminal_read', description: '读取远程终端', parameters: { type: 'object' } },
      handler,
    )
    const capabilityGate = {
      isToolAllowed: vi.fn().mockReturnValue(true),
      isPathAllowed: vi.fn().mockReturnValue(true),
      getToolPermission: vi.fn(),
    } as unknown as CapabilityGate
    const approvals = new ApprovalService()
    const executor = new RegistryToolExecutor(registry, capabilityGate, null, null, {
      agentId: 'pero',
      channel: 'desktop',
      sessionId: 'remote-shell-thread',
    })
    executor.setPolicyRuntime(new PolicyEngine(), approvals)

    const guarded = executor.execute(
      'remote_terminal_read',
      { node_id: 'gpu-1', terminal_id: 'term-1' },
      'desktop',
      { autoExecuteTools: false },
    )
    await vi.waitFor(() => expect(approvals.list({ status: 'pending' })).toHaveLength(1))
    approvals.resolve(approvals.list({ status: 'pending' })[0]!.id, 'allow_always')
    await expect(guarded).resolves.toMatchObject({ isError: false })
    expect(handler).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ approvedSensitiveAction: true }),
    )

    approvals.clearSession('remote-shell-thread')
    handler.mockClear()
    await expect(
      executor.execute(
        'remote_terminal_read',
        { node_id: 'gpu-1', terminal_id: 'term-1' },
        'desktop',
        { autoExecuteTools: true },
      ),
    ).resolves.toMatchObject({ isError: false })
    expect(approvals.list({ status: 'pending' })).toHaveLength(0)
    expect(handler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ approvedSensitiveAction: true }),
    )
  })

  it('纯读取工具应获得设备只读范围且不触发越界审批', async () => {
    const registry = new ToolRegistry()
    const handler = vi.fn().mockResolvedValue('内容')
    registry.register(
      { name: 'read_file_range', description: '范围读取', parameters: { type: 'object' } },
      handler,
    )
    const capabilityGate = {
      isToolAllowed: vi.fn().mockReturnValue(true),
      isPathAllowed: vi.fn().mockReturnValue(false),
      getToolPermission: vi.fn(),
    } as unknown as CapabilityGate
    const approvals = new ApprovalService()
    const executor = new RegistryToolExecutor(registry, capabilityGate, null, null, {
      agentId: 'pero',
      channel: 'desktop',
      sessionId: 'read-thread',
    })
    executor.setPathBoundaryChecker(() => false)
    executor.setPolicyRuntime(new PolicyEngine(), approvals)

    const result = await executor.execute(
      'read_file_range',
      { path: 'C:/outside/file.txt', line_start: 1, line_end: 10 },
      'desktop',
    )

    expect(result.isError).toBe(false)
    expect(approvals.list({ status: 'pending' })).toHaveLength(0)
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'C:/outside/file.txt' }),
      expect.objectContaining({ deviceReadScope: true }),
    )
  })

  it('工作区外路径必须审批后才执行，并仅向本次工具上下文授予越界能力', async () => {
    const { registry, handler } = createRegistry()
    const capabilityGate = {
      isToolAllowed: vi.fn().mockReturnValue(true),
      isPathAllowed: vi.fn().mockReturnValue(false),
      getToolPermission: vi.fn().mockReturnValue({
        toolName: 'demo.run',
        resourceScope: {
          scope: 'principal_workspace',
          allowedRoots: ['C:/workspace'],
          deniedPaths: [],
        },
        requiresApproval: false,
      }),
    } as unknown as CapabilityGate
    const approvals = new ApprovalService()
    const executor = new RegistryToolExecutor(registry, capabilityGate, null, null, {
      agentId: 'pero',
      channel: 'desktop',
      sessionId: 'outside-thread',
    })
    executor.setPathBoundaryChecker(() => false)
    executor.setPolicyRuntime(new PolicyEngine(), approvals)

    const execution = executor.execute('demo.run', { path: 'C:/outside/file.txt' }, 'desktop')
    await vi.waitFor(() => expect(approvals.list({ status: 'pending' })).toHaveLength(1))
    expect(handler).not.toHaveBeenCalled()
    const request = approvals.list({ status: 'pending' })[0]!
    expect(request.reason).toContain('资源范围外路径')

    approvals.resolve(request.id, 'allow_once')
    const result = await execution

    expect(result.isError).toBe(false)
    expect(handler).toHaveBeenCalledWith(
      { path: 'C:/outside/file.txt' },
      expect.objectContaining({ approvedOutsideWorkspace: true }),
    )

    const secondExecution = executor.execute(
      'demo.run',
      { path: 'C:/outside/another.txt' },
      'desktop',
    )
    await vi.waitFor(() => expect(approvals.list({ status: 'pending' })).toHaveLength(1))
    expect(handler).toHaveBeenCalledTimes(1)
    approvals.resolve(approvals.list({ status: 'pending' })[0]!.id, 'deny_once')
    const denied = await secondExecution
    expect(denied.isError).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('文件读取结果应保留工具自身限定的完整行数', async () => {
    const registry = new ToolRegistry()
    const fullRead = Array.from({ length: 800 }, (_, index) => `第${index + 1}行内容`).join('\n')
    const rangeRead = JSON.stringify({
      content: fullRead,
      lineStart: 1,
      lineEnd: 800,
      totalLines: 2_000,
      truncated: true,
    })
    registry.register(
      { name: 'read_file', description: '完整读取', parameters: {} },
      vi.fn().mockResolvedValue(fullRead),
    )
    registry.register(
      { name: 'read_file_range', description: '范围读取', parameters: {} },
      vi.fn().mockResolvedValue(rangeRead),
    )
    const executor = new RegistryToolExecutor(registry)

    const full = await executor.execute('read_file', { file_path: 'large.txt' }, 'desktop')
    const range = await executor.execute(
      'read_file_range',
      { path: 'large.txt', line_start: 1, line_end: 2_000 },
      'desktop',
    )

    expect(full.output).toBe(fullRead)
    expect(JSON.parse(range.output)).toMatchObject({
      content: fullRead,
      lineStart: 1,
      lineEnd: 800,
    })
    expect(full.output).not.toContain('truncated by system')
    expect(range.output).not.toContain('truncated by system')
  })

  it('应当处理未知工具、执行异常与长输出截断', async () => {
    const registry = new ToolRegistry()
    registry.register(
      { name: 'broken', description: '坏工具', parameters: {} },
      vi.fn().mockRejectedValue(new Error('坏掉了')),
    )
    registry.register(
      { name: 'long', description: '长输出', parameters: {} },
      vi.fn().mockResolvedValue('x'.repeat(8010)),
    )
    const hookEmitter = {
      emitHook: vi.fn(async <T>(_event: string, data: T) => data),
    } as HookEmitter & { emitHook: ReturnType<typeof vi.fn> }
    const executor = new RegistryToolExecutor(registry, null, null, hookEmitter)

    const missing = await executor.execute('missing', {}, 'desktop')
    const broken = await executor.execute('broken', {}, 'desktop')
    const long = await executor.execute('long', {}, 'desktop')

    expect(missing).toMatchObject({ output: '未找到工具: missing', isError: true })
    expect(broken.output).toContain('执行失败: 坏掉了')
    expect(broken.isError).toBe(true)
    expect(long.output.endsWith('\n...(truncated by system)')).toBe(true)
    expect(hookEmitter.emitHook).toHaveBeenCalledWith(
      'tool:afterCall',
      expect.objectContaining({ isError: true }),
    )
  })

  it('应当加载 Skill、注入参数并递归解锁依赖工具', async () => {
    const { registry } = createRegistry()
    const capabilityGate = {
      unlockSkillTools: vi.fn(),
    } as unknown as CapabilityGate
    const skillLoader = {
      loadSkillContentWithParams: vi.fn().mockReturnValue('技能内容'),
      getManifest: vi.fn((skillId: string) => {
        if (skillId === 'parent') return { dependsOnSkills: ['child'] }
        if (skillId === 'child') return { dependsOnSkills: [] }
        return undefined
      }),
    } as unknown as SkillLoader
    const executor = new RegistryToolExecutor(registry, capabilityGate, skillLoader, null, {
      sessionId: 'session-1',
    })

    const result = await executor.execute(
      'load_skill',
      { skill_id: 'parent', params: { topic: '猫' } },
      'desktop',
    )

    expect(skillLoader.loadSkillContentWithParams).toHaveBeenCalledWith('parent', { topic: '猫' })
    expect(capabilityGate.unlockSkillTools).toHaveBeenCalledWith('session-1', 'parent')
    expect(capabilityGate.unlockSkillTools).toHaveBeenCalledWith('session-1', 'child')
    expect(result).toMatchObject({ output: '技能内容', isError: false, shouldTerminate: false })
  })

  it('Skill临时解锁工具首次调用应审批且会话允许后可复用', async () => {
    const { registry, handler } = createRegistry()
    const capabilityGate = {
      isToolAllowed: vi.fn().mockReturnValue(true),
      isSkillUnlockedTool: vi.fn().mockReturnValue(true),
      isPathAllowed: vi.fn().mockReturnValue(true),
      getToolPermission: vi.fn(),
    } as unknown as CapabilityGate
    const approvals = new ApprovalService()
    const executor = new RegistryToolExecutor(registry, capabilityGate, null, null, {
      agentId: 'pero',
      channel: 'desktop',
      sessionId: 'skill-thread',
    })
    executor.setPolicyRuntime(new PolicyEngine(), approvals)

    const first = executor.execute('demo.run', { value: 1 }, 'desktop')
    await vi.waitFor(() => expect(approvals.list({ status: 'pending' })).toHaveLength(1))
    expect(handler).not.toHaveBeenCalled()
    approvals.resolve(approvals.list({ status: 'pending' })[0]!.id, 'allow_session')
    expect((await first).isError).toBe(false)

    const second = await executor.execute('demo.run', { value: 2 }, 'desktop')
    expect(second.isError).toBe(false)
    expect(approvals.list({ status: 'pending' })).toHaveLength(0)
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('应当处理 load_skill 参数缺失、系统未初始化与内容缺失', async () => {
    const { registry } = createRegistry()
    const executorWithoutLoader = new RegistryToolExecutor(registry)
    const skillLoader = {
      loadSkillContentWithParams: vi.fn().mockReturnValue(null),
    } as unknown as SkillLoader
    const executorWithLoader = new RegistryToolExecutor(registry, null, skillLoader)

    const missingId = await executorWithoutLoader.execute('load_skill', {}, 'desktop')
    const noLoader = await executorWithoutLoader.execute('load_skill', { skill_id: 'x' }, 'desktop')
    const missingContent = await executorWithLoader.execute(
      'load_skill',
      { skillId: 'x' },
      'desktop',
    )

    expect(missingId).toMatchObject({ output: '缺少参数 skill_id', isError: true })
    expect(noLoader).toMatchObject({ output: 'Skill 系统未初始化', isError: true })
    expect(missingContent).toMatchObject({ output: 'Skill "x" 不存在或加载失败', isError: true })
  })

  // ── 第七阶段修复（批次 A2）：平台能力工具名 → 能力名映射 ──
  describe('平台能力工具路由', () => {
    it('take_screenshot调用应映射为screenCapture Desktop Port操作', async () => {
      const { registry } = createRegistry()
      const invoke = vi.fn().mockResolvedValue({
        success: true,
        screenshots: [{ index: 0, dataUri: 'data:image/png;base64,xxx' }],
        message: '已截取屏幕',
      })
      const executor = new RegistryToolExecutor(registry)
      executor.setDesktopCapabilities({ invoke })

      const result = await executor.execute('take_screenshot', {}, 'desktop')

      expect(invoke).toHaveBeenCalledTimes(1)
      expect(invoke).toHaveBeenCalledWith(
        'screenCapture',
        {},
        expect.objectContaining({ principalId: 'pero' }),
      )
      expect(result.isError).toBe(false)
      expect(result.output).toContain('screenshots')
    })

    it('screen_capture工具名映射到同一screenCapture操作', async () => {
      const { registry } = createRegistry()
      const invoke = vi.fn().mockResolvedValue({ success: true, screenshots: [] })
      const executor = new RegistryToolExecutor(registry)
      executor.setDesktopCapabilities({ invoke })

      await executor.execute('screen_capture', {}, 'desktop')

      expect(invoke).toHaveBeenCalledWith('screenCapture', {}, expect.any(Object))
    })

    it('clipboard_read 等其他平台工具应当直接透传', async () => {
      const { registry } = createRegistry()
      const invoke = vi.fn().mockResolvedValue({ text: '剪贴板内容' })
      const executor = new RegistryToolExecutor(registry)
      executor.setDesktopCapabilities({ invoke })

      await executor.execute('clipboard_read', {}, 'desktop')

      expect(invoke).toHaveBeenCalledWith('clipboardRead', {}, expect.any(Object))
    })

    it('CapabilityBridge 未注入时应当返回友好错误', async () => {
      const { registry } = createRegistry()
      // 不调用 setCapabilityBridge，模拟非 Daemon 模式
      const executor = new RegistryToolExecutor(registry)

      const result = await executor.execute('take_screenshot', {}, 'desktop')

      expect(result.isError).toBe(true)
      expect(result.output).toContain('不可用')
      expect(result.shouldTerminate).toBe(false)
    })

    it('Desktop Capability Port抛错时应返回错误信息', async () => {
      const { registry } = createRegistry()
      const invoke = vi.fn().mockRejectedValue(new Error('节点无响应'))
      const executor = new RegistryToolExecutor(registry)
      executor.setDesktopCapabilities({ invoke })

      const result = await executor.execute('take_screenshot', {}, 'desktop')

      expect(result.isError).toBe(true)
      expect(result.output).toContain('节点无响应')
    })
  })

  it('应当在 before Hook 失败时继续执行工具', async () => {
    const { registry, handler } = createRegistry()
    const hookEmitter = {
      emitHook: vi.fn(async (event: string, data: unknown) => {
        if (event === 'tool:beforeCall') throw new Error('Hook 坏了')
        return data
      }),
    } as HookEmitter & { emitHook: ReturnType<typeof vi.fn> }
    const executor = new RegistryToolExecutor(registry, null, null, hookEmitter)

    const result = await executor.execute('demo.run', { value: 1 }, 'desktop')

    expect(handler).toHaveBeenCalledWith({ value: 1 }, expect.any(Object))
    expect(result.isError).toBe(false)
  })
})
