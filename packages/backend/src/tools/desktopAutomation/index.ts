import type { BuiltinTool } from '../index'

export interface DesktopAutomationProvider {
  execute(
    args: Record<string, unknown>,
    context: Parameters<BuiltinTool['execute']>[1],
  ): Promise<unknown>
  getMousePosition(): Promise<{ x: number; y: number }>
}
let provider: DesktopAutomationProvider | null = null
export function setDesktopAutomationProvider(value: DesktopAutomationProvider | null): void {
  provider = value
}

function failure(code: string, message: string, notDispatched = false): string {
  return JSON.stringify({
    success: false,
    error: { code, message, ...(notDispatched ? { dispatched: false } : {}) },
  })
}
function finite(args: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => typeof args[key] === 'number' && Number.isFinite(args[key]))
}

/** 参数验证留在工具边界；坐标、控制权与实际输入由客户端统一处理。 */
export const automationExecuteTool: BuiltinTool = {
  name: 'automation_execute',
  async execute(args, context) {
    if (!provider) return failure('DESKTOP_AUTOMATION_UNAVAILABLE', '桌面自动化服务未初始化', true)
    const action = String(args.action ?? '')
    const actions = [
      'invoke',
      'set_value',
      'toggle',
      'select',
      'expand',
      'collapse',
      'move',
      'click',
      'double_click',
      'right_click',
      'drag',
      'scroll',
      'type',
      'hotkey',
      'key_down',
      'key_up',
      'mouse_down',
      'mouse_up',
      'wait',
      'notification',
    ]
    if (!actions.includes(action))
      return failure('DESKTOP_ACTION_UNSUPPORTED', '不支持的桌面操作', true)
    if (
      action !== 'notification' &&
      (typeof args.observationId !== 'string' || !args.observationId.trim())
    )
      return failure('DESKTOP_OBSERVATION_STALE', '请先观察桌面并提供 observationId', true)
    if (
      ['invoke', 'set_value', 'toggle', 'select', 'expand', 'collapse'].includes(action) &&
      !args.elementId
    )
      return failure('DESKTOP_ELEMENT_REQUIRED', '请提供本次观察中的 elementId', true)
    if (
      ['move', 'click', 'double_click', 'right_click', 'drag', 'mouse_down'].includes(action) ||
      (action === 'scroll' && !args.elementId)
    ) {
      if (!finite(args, action === 'drag' ? ['x', 'y', 'x2', 'y2'] : ['x', 'y']))
        return failure('DESKTOP_COORDINATE_INVALID', '请提供有限的截图坐标', true)
    }
    if (
      ['type', 'set_value', 'hotkey', 'key_down', 'key_up'].includes(action) &&
      (typeof args.text !== 'string' || (action !== 'set_value' && !args.text))
    )
      return failure('DESKTOP_TEXT_REQUIRED', '请提供输入文本或按键组合', true)
    try {
      return JSON.stringify(await provider.execute(args, context))
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      const separator = text.indexOf(':')
      const code = separator > 0 ? text.slice(0, separator) : 'DESKTOP_AUTOMATION_FAILED'
      const notDispatched = [
        'DESKTOP_WAITING',
        'DESKTOP_USER_BUSY',
        'DESKTOP_DISABLED',
        'DESKTOP_OBSERVATION_STALE',
        'DESKTOP_ELEMENT_STALE',
        'DESKTOP_INPUT_MONITOR_UNAVAILABLE',
      ].includes(code)
      return failure(code, separator > 0 ? text.slice(separator + 1).trim() : text, notDispatched)
    }
  },
}

export const getMousePositionTool: BuiltinTool = {
  name: 'get_mouse_position',
  async execute() {
    if (!provider) return failure('DESKTOP_AUTOMATION_UNAVAILABLE', '桌面自动化服务未初始化', true)
    try {
      const position = await provider.getMousePosition()
      return Number.isFinite(position.x) && Number.isFinite(position.y)
        ? JSON.stringify({ success: true, position })
        : failure('DESKTOP_COORDINATE_INVALID', '客户端返回了无效鼠标坐标', true)
    } catch (error) {
      return failure(
        'DESKTOP_MOUSE_POSITION_FAILED',
        error instanceof Error ? error.message : String(error),
      )
    }
  },
}
