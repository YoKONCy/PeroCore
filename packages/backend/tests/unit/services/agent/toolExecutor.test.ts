import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RegistryToolExecutor,
  type HookEmitter,
} from '@perocore/backend/services/agent/toolExecutor'
import { ToolRegistry } from '@perocore/backend/services/agent/toolRegistry'
import type { CapabilityGate } from '@perocore/backend/capabilities/capabilityGate'
import type { SkillLoader } from '@perocore/backend/capabilities/skillLoader'

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
    const executor = new RegistryToolExecutor(registry, capabilityGate, null, null, {
      agentId: 'pero',
      mode: 'work',
      sessionId: 'session-1',
    })

    const result = await executor.execute('demo.run', {}, 'desktop')

    expect(capabilityGate.isToolAllowed).toHaveBeenCalledWith(
      'pero',
      'work',
      'demo.run',
      'session-1',
    )
    expect(handler).not.toHaveBeenCalled()
    expect(result).toMatchObject({ isError: true, shouldTerminate: false })
    expect(result.output).toContain('没有权限')
  })

  it('应当通过 Hook 修改参数并在成功后触发 after Hook', async () => {
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
      { source: 'desktop', agentId: 'pero', sessionId: 'session-1' },
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
