import { Notification, screen } from 'electron'
import { logger } from '../utils/logger'
import { resolveDesktopPoint, type DesktopPoint } from './desktopCoordinates'

interface NutWindow {
  title: Promise<string> | string
  focus(): Promise<void>
}

interface NutModule {
  getWindows(): Promise<NutWindow[]>
  mouse: {
    setPosition(point: unknown): Promise<void>
    getPosition(): Promise<{ x: number; y: number }>
    click(button: number): Promise<void>
    doubleClick(button: number): Promise<void>
    pressButton(button: number): Promise<void>
    releaseButton(button: number): Promise<void>
  }
  keyboard: {
    type(text: string): Promise<void>
    pressKey(...keys: number[]): Promise<void>
    releaseKey(...keys: number[]): Promise<void>
  }
  Point: new (x: number, y: number) => unknown
  Button: { LEFT: number; RIGHT: number }
  Key: Record<string, number>
}

let runtime: NutModule | null | undefined

async function loadRuntime(): Promise<NutModule> {
  if (runtime) return runtime
  if (runtime === null) throw new Error('DESKTOP_AUTOMATION_UNAVAILABLE: nut-js无法加载')
  try {
    const packageName = '@nut-tree-fork/nut-js'
    runtime = (await import(packageName)) as unknown as NutModule
    logger.info('DesktopAutomation', 'nut-js已在 Electron能力进程加载')
    return runtime
  } catch (error) {
    runtime = null
    throw new Error(`DESKTOP_AUTOMATION_UNAVAILABLE: ${error}`)
  }
}

export async function listWindows(): Promise<Array<{ processName: string; title: string }>> {
  const nut = await loadRuntime()
  const result: Array<{ processName: string; title: string }> = []
  for (const window of await nut.getWindows()) {
    try {
      const title = await window.title
      if (title) result.push({ processName: String(title), title: String(title) })
    } catch {
      //窗口可能在枚举后立即销毁，忽略该项。
    }
  }
  return result
}

export async function activateWindow(target: string): Promise<string> {
  const nut = await loadRuntime()
  for (const window of await nut.getWindows()) {
    const title = String(await window.title)
    if (title.toLowerCase().includes(target.toLowerCase())) {
      await window.focus()
      return title
    }
  }
  throw new Error(`WINDOW_NOT_FOUND: ${target}`)
}

export async function mousePosition(): Promise<{ x: number; y: number }> {
  return (await loadRuntime()).mouse.getPosition()
}

function resolveInputPoint(
  input: Record<string, unknown>,
  xKey: 'x' | 'x2',
  yKey: 'y' | 'y2',
): DesktopPoint {
  const requestedDisplayId = input.displayId == null ? undefined : String(input.displayId)
  const displays = screen.getAllDisplays()
  const display = requestedDisplayId
    ? displays.find((candidate) => String(candidate.id) === requestedDisplayId)
    : screen.getPrimaryDisplay()
  if (!display) {
    throw new Error(`DESKTOP_DISPLAY_NOT_FOUND: ${requestedDisplayId}`)
  }
  return resolveDesktopPoint(
    {
      x: input[xKey],
      y: input[yKey],
      coordinateSpace: input.coordinateSpace,
      screenshotWidth: input.screenshotWidth,
      screenshotHeight: input.screenshotHeight,
    },
    {
      id: String(display.id),
      bounds: display.bounds,
      scaleFactor: display.scaleFactor,
    },
    (point) => screen.dipToScreenPoint(point),
  )
}

export async function mouseAction(
  input: Record<string, unknown>,
): Promise<{ success: true; position: DesktopPoint; targetPosition?: DesktopPoint }> {
  const action = String(input.action ?? '')
  if (!['move', 'click', 'double_click', 'right_click', 'drag'].includes(action)) {
    throw new Error(`DESKTOP_MOUSE_ACTION_UNSUPPORTED: ${action}`)
  }
  const start = resolveInputPoint(input, 'x', 'y')
  const target = action === 'drag' ? resolveInputPoint(input, 'x2', 'y2') : undefined
  const nut = await loadRuntime()
  await nut.mouse.setPosition(new nut.Point(start.x, start.y))

  if (action === 'click') await nut.mouse.click(nut.Button.LEFT)
  else if (action === 'double_click') await nut.mouse.doubleClick(nut.Button.LEFT)
  else if (action === 'right_click') await nut.mouse.click(nut.Button.RIGHT)
  else if (action === 'drag' && target) {
    await nut.mouse.pressButton(nut.Button.LEFT)
    try {
      await nut.mouse.setPosition(new nut.Point(target.x, target.y))
    } finally {
      await nut.mouse.releaseButton(nut.Button.LEFT)
    }
  }
  return { success: true, position: start, ...(target ? { targetPosition: target } : {}) }
}

export async function keyboardAction(input: Record<string, unknown>): Promise<{ success: true }> {
  const nut = await loadRuntime()
  const action = String(input.action ?? '')
  if (action === 'type') await nut.keyboard.type(String(input.text ?? ''))
  else if (action === 'hotkey') {
    const keys = (input.keys as string[] | undefined) ?? String(input.text ?? '').split('+')
    const codes = keys
      .map((key) => nut.Key[key.trim().toUpperCase()])
      .filter((key): key is number => typeof key === 'number')
    if (codes.length !== keys.length) throw new Error('DESKTOP_HOTKEY_INVALID')
    await nut.keyboard.pressKey(...codes)
    await nut.keyboard.releaseKey(...codes.reverse())
  } else if (action === 'notification') {
    new Notification({
      title: String(input.title ?? input.text ?? 'infOS提醒'),
      body: String(input.message ?? ''),
    }).show()
  } else throw new Error(`DESKTOP_KEYBOARD_ACTION_UNSUPPORTED: ${action}`)
  return { success: true }
}
