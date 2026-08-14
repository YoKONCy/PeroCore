import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    it('take_screenshot 调用应当被映射为 screen_capture 能力名传给 CapabilityBridge', async () => {
      const { registry } = createRegistry()
      // mock CapabilityBridge：捕获实际被调用的能力名
      // 必须包成 { invokeTool } 对象以符合 CapabilityBridgeLike 接口
      const invokeTool = vi.fn().mockResolvedValue({
        output: JSON.stringify({
          success: true,
          screenshots: [{ index: 0, dataUri: 'data:image/png;base64,xxx' }],
          message: '已截取屏幕',
        }),
        isError: false,
        durationMs: 50,
      })
      const executor = new RegistryToolExecutor(registry)
      executor.setCapabilityBridge({ invokeTool })

      const result = await executor.execute('take_screenshot', {}, 'desktop')

      // 关键断言：传给 CapabilityBridge 的应是映射后的 screen_capture
      expect(invokeTool).toHaveBeenCalledTimes(1)
      expect(invokeTool).toHaveBeenCalledWith('screen_capture', {})
      // 返回值应正常透传
      expect(result.isError).toBe(false)
      expect(result.output).toContain('screenshots')
    })

    it('screen_capture 工具名应当直接透传，不做映射', async () => {
      const { registry } = createRegistry()
      const invokeTool = vi.fn().mockResolvedValue({
        output: JSON.stringify({ success: true, screenshots: [] }),
        isError: false,
        durationMs: 10,
      })
      const executor = new RegistryToolExecutor(registry)
      executor.setCapabilityBridge({ invokeTool })

      await executor.execute('screen_capture', {}, 'desktop')

      // 没有映射项时，原工具名直接透传
      expect(invokeTool).toHaveBeenCalledWith('screen_capture', {})
    })

    it('clipboard_read 等其他平台工具应当直接透传', async () => {
      const { registry } = createRegistry()
      const invokeTool = vi.fn().mockResolvedValue({
        output: JSON.stringify({ text: '剪贴板内容' }),
        isError: false,
        durationMs: 5,
      })
      const executor = new RegistryToolExecutor(registry)
      executor.setCapabilityBridge({ invokeTool })

      await executor.execute('clipboard_read', {}, 'desktop')

      expect(invokeTool).toHaveBeenCalledWith('clipboard_read', {})
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

    it('CapabilityBridge 抛错时应当返回错误信息', async () => {
      const { registry } = createRegistry()
      const invokeTool = vi.fn().mockRejectedValue(new Error('节点无响应'))
      const executor = new RegistryToolExecutor(registry)
      executor.setCapabilityBridge({ invokeTool })

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
