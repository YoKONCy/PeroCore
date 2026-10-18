import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  automationExecuteTool,
  getMousePositionTool,
  setDesktopAutomationProvider,
  type DesktopAutomationProvider,
} from '@infos/backend/tools/desktopAutomation'

const context = {
  agentId: 'pero',
  threadId: 'thread-1',
  sessionId: 'thread-1',
  source: 'desktop',
  channel: 'desktop',
}
function createProvider(): DesktopAutomationProvider {
  return {
    execute: vi.fn().mockResolvedValue({ success: true }),
    getMousePosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
  }
}
async function execute(args: Record<string, unknown>, tool = automationExecuteTool) {
  const result = await tool.execute(args, context)
  return JSON.parse(typeof result === 'string' ? result : result.output)
}

describe('桌面自动化工具边界', () => {
  afterEach(() => setDesktopAutomationProvider(null))

  it('没有观察凭据时不能发出输入，通知不需要借用桌面', async () => {
    const provider = createProvider()
    setDesktopAutomationProvider(provider)
    const rejected = await execute({ action: 'click', x: 10, y: 20 })
    expect(rejected.error.dispatched).toBe(false)
    expect(provider.execute).not.toHaveBeenCalled()
    await execute({ action: 'notification', text: '提醒' })
    expect(provider.execute).toHaveBeenCalledTimes(1)
  })

  it('保留观察绑定与调用方取消信号，截图尺寸由客户端管理', async () => {
    const provider = createProvider()
    setDesktopAutomationProvider(provider)
    const signal = new AbortController().signal
    const args = { action: 'click', observationId: 'observation', x: 10, y: 20 }
    await automationExecuteTool.execute(args, { ...context, signal })
    expect(provider.execute).toHaveBeenCalledWith(
      args,
      expect.objectContaining({ threadId: context.threadId, signal }),
    )
  })

  it.each([
    { action: 'click', x: Number.NaN, y: 10 },
    { action: 'drag', x: 0, y: 0, x2: 20 },
    { action: 'scroll', x: Infinity, y: 20 },
  ])('非法或缺失坐标不能进入执行器：$action', async (args) => {
    const provider = createProvider()
    setDesktopAutomationProvider(provider)
    const result = await execute({ ...args, observationId: 'observation' })
    expect(result.error.code).toBe('DESKTOP_COORDINATE_INVALID')
    expect(provider.execute).not.toHaveBeenCalled()
  })

  it('控件操作需要控件引用，文本操作需要文本', async () => {
    const provider = createProvider()
    setDesktopAutomationProvider(provider)
    expect(
      (await execute({ action: 'invoke', observationId: 'observation' })).error.dispatched,
    ).toBe(false)
    expect((await execute({ action: 'type', observationId: 'observation' })).error.dispatched).toBe(
      false,
    )
    expect(provider.execute).not.toHaveBeenCalled()
    await execute({
      action: 'set_value',
      observationId: 'observation',
      elementId: 'element',
      text: '',
    })
    expect(provider.execute).toHaveBeenCalledTimes(1)
  })

  it('结果不明不能标记为未执行，避免恢复后重复操作', async () => {
    const provider = createProvider()
    setDesktopAutomationProvider(provider)
    provider.execute = vi
      .fn()
      .mockRejectedValue(new Error('DESKTOP_RESULT_UNCERTAIN: 输入后连接中断'))
    const result = await execute({ action: 'type', observationId: 'observation', text: '内容' })
    expect(result.error.code).toBe('DESKTOP_RESULT_UNCERTAIN')
    expect(result.error.dispatched).not.toBe(false)
  })

  it('拒绝客户端返回的非法鼠标位置', async () => {
    const provider = createProvider()
    provider.getMousePosition = vi.fn().mockResolvedValue({ x: Number.NaN, y: 0 })
    setDesktopAutomationProvider(provider)
    expect((await execute({}, getMousePositionTool)).error.code).toBe('DESKTOP_COORDINATE_INVALID')
  })

  it('未配置执行器时不能报告输入成功', async () => {
    setDesktopAutomationProvider(null)
    expect(
      (await execute({ action: 'click', observationId: 'observation', x: 1, y: 1 })).success,
    ).toBe(false)
  })
})
