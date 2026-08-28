import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  automationExecuteTool,
  getMousePositionTool,
  setDesktopAutomationProvider,
  type DesktopAutomationProvider,
} from '@infos/backend/tools/desktopAutomation'

function createProvider(): DesktopAutomationProvider {
  return {
    click: vi.fn().mockResolvedValue(undefined),
    doubleClick: vi.fn().mockResolvedValue(undefined),
    rightClick: vi.fn().mockResolvedValue(undefined),
    drag: vi.fn().mockResolvedValue(undefined),
    typeText: vi.fn().mockResolvedValue(undefined),
    hotkey: vi.fn().mockResolvedValue(undefined),
    sendNotification: vi.fn().mockResolvedValue(undefined),
    getMousePosition: vi.fn().mockResolvedValue({ x: 0, y: 0 }),
  }
}

describe('desktopAutomation工具', () => {
  afterEach(() => setDesktopAutomationProvider(null))

  it('应默认按0到1000归一化坐标传递点击', async () => {
    const provider = createProvider()
    setDesktopAutomationProvider(provider)

    const result = JSON.parse(
      await automationExecuteTool.execute({ action: 'click', x: 500, y: 250 }),
    )

    expect(result.success).toBe(true)
    expect(provider.click).toHaveBeenCalledWith(500, 250, {
      coordinateSpace: 'normalized',
    })
  })

  it('应完整传递截图坐标上下文', async () => {
    const provider = createProvider()
    setDesktopAutomationProvider(provider)

    await automationExecuteTool.execute({
      action: 'drag',
      x: 10,
      y: 20,
      x2: 100,
      y2: 200,
      coordinateSpace: 'screenshot',
      displayId: '7',
      screenshotWidth: 1280,
      screenshotHeight: 720,
    })

    expect(provider.drag).toHaveBeenCalledWith(10, 20, 100, 200, {
      coordinateSpace: 'screenshot',
      displayId: '7',
      screenshotWidth: 1280,
      screenshotHeight: 720,
    })
  })

  it('点击缺少坐标时应返回结构化错误且不执行', async () => {
    const provider = createProvider()
    setDesktopAutomationProvider(provider)

    const result = JSON.parse(await automationExecuteTool.execute({ action: 'click' }))

    expect(result).toEqual({
      success: false,
      error: {
        code: 'DESKTOP_COORDINATE_INVALID',
        message: 'x必须是有限数字',
      },
    })
    expect(provider.click).not.toHaveBeenCalled()
  })

  it('拖拽缺少目标坐标时应拒绝执行', async () => {
    const provider = createProvider()
    setDesktopAutomationProvider(provider)

    const result = JSON.parse(await automationExecuteTool.execute({ action: 'drag', x: 0, y: 0 }))

    expect(result.error.code).toBe('DESKTOP_COORDINATE_INVALID')
    expect(provider.drag).not.toHaveBeenCalled()
  })

  it('截图坐标缺少截图尺寸时应拒绝执行', async () => {
    const provider = createProvider()
    setDesktopAutomationProvider(provider)

    const result = JSON.parse(
      await automationExecuteTool.execute({
        action: 'click',
        x: 10,
        y: 10,
        coordinateSpace: 'screenshot',
      }),
    )

    expect(result.error.code).toBe('DESKTOP_COORDINATE_INVALID')
    expect(provider.click).not.toHaveBeenCalled()
  })

  it('文本和快捷键缺少参数时应返回结构化错误', async () => {
    const provider = createProvider()
    setDesktopAutomationProvider(provider)

    const typeResult = JSON.parse(await automationExecuteTool.execute({ action: 'type' }))
    const hotkeyResult = JSON.parse(await automationExecuteTool.execute({ action: 'hotkey' }))

    expect(typeResult.error.code).toBe('DESKTOP_TEXT_REQUIRED')
    expect(hotkeyResult.error.code).toBe('DESKTOP_HOTKEY_REQUIRED')
    expect(provider.typeText).not.toHaveBeenCalled()
    expect(provider.hotkey).not.toHaveBeenCalled()
  })

  it('应拒绝客户端返回的非法鼠标位置', async () => {
    const provider = createProvider()
    provider.getMousePosition = vi.fn().mockResolvedValue({ x: Number.NaN, y: 0 })
    setDesktopAutomationProvider(provider)

    const result = JSON.parse(await getMousePositionTool.execute({}))

    expect(result.error.code).toBe('DESKTOP_COORDINATE_INVALID')
  })

  it('服务未初始化时应返回能力不可用错误', async () => {
    setDesktopAutomationProvider(null)
    const result = JSON.parse(await automationExecuteTool.execute({ action: 'click', x: 1, y: 1 }))
    expect(result.error.code).toBe('DESKTOP_AUTOMATION_UNAVAILABLE')
  })
})
