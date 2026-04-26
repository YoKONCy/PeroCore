/**
 * usePetWindow — Pet 窗口 Electron 交互 composable
 *
 * 封装桌宠窗口的所有平台特有交互逻辑：
 * - 像素级鼠标穿透 (setIgnoreMouseEvents + forward)
 * - 窗口拖拽 (1ms 主进程轮询)
 * - 全局鼠标追踪 (30fps, 跨窗口视线跟随)
 *
 * 全部通过 ipcAdapter 调用，Browser 模式自动降级为空操作。
 *
 * @module packages/frontend/src/composables/pet/usePetWindow
 */

import { ref, onMounted, onUnmounted } from 'vue'
import { invoke, listen, send, isElectron } from '../../utils/ipcAdapter'
import { logger } from '../../lib/logger'

/** 全局鼠标坐标 (相对于 Pet 窗口) */
export interface GlobalMousePosition {
  x: number
  y: number
}

export function usePetWindow() {
  // ── 状态 ──

  /** 当前是否处于穿透状态 */
  const isClickThrough = ref(false)
  /** 是否正在拖拽 */
  const isDragging = ref(false)
  /** 全局鼠标位置 (由主进程推送) */
  const globalMouse = ref<GlobalMousePosition>({ x: 0, y: 0 })

  // ── 鼠标穿透 ──

  /** 上一次的穿透状态 (防抖, 避免高频 IPC) */
  let lastIgnoreState: boolean | null = null

  /**
   * 设置鼠标穿透状态
   *
   * @param ignore true=穿透(鼠标事件透过窗口), false=可交互
   */
  function setMousePassthrough(ignore: boolean): void {
    if (lastIgnoreState === ignore) return
    lastIgnoreState = ignore
    isClickThrough.value = ignore
    invoke('set-ignore-mouse', ignore).catch(() => {
      // Browser 模式静默忽略
    })
  }

  /** 鼠标进入可交互区域 (3D 角色 / UI 元素) → 关闭穿透 */
  function onInteractableEnter(): void {
    setMousePassthrough(false)
  }

  /** 鼠标离开可交互区域 → 恢复穿透 (拖拽期间不生效) */
  function onInteractableLeave(): void {
    if (!isDragging.value) {
      setMousePassthrough(true)
    }
  }

  // ── 窗口拖拽 ──

  let dragStartX = 0
  let dragStartY = 0

  /**
   * 开始拖拽检测 (mousedown 回调)
   *
   * 使用主进程 1ms 轮询 setCursorScreenPoint + setBounds 实现最大平滑度。
   * 拖拽期间锁定为非穿透状态。
   */
  function onDragMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return

    dragStartX = e.screenX
    dragStartY = e.screenY

    const onMouseMove = (moveEvent: MouseEvent) => {
      const movedX = Math.abs(moveEvent.screenX - dragStartX)
      const movedY = Math.abs(moveEvent.screenY - dragStartY)

      // 超过 5px 阈值才判定为拖拽 (区分点击)
      if (!isDragging.value && (movedX > 5 || movedY > 5)) {
        isDragging.value = true
        setMousePassthrough(false)

        const offsetX = e.screenX - window.screenX
        const offsetY = e.screenY - window.screenY

        // 使用 send (fire-and-forget) 减少延迟
        send('window-drag-start', { offsetX, offsetY })
      }
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)

      if (isDragging.value) {
        isDragging.value = false
        send('window-drag-end')
        // 拖拽结束后短暂保持可交互，防止误穿透
        setTimeout(() => {
          setMousePassthrough(false)
        }, 100)
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  // ── 窗口置顶修复 ──

  /** 强制刷新置顶状态 (某些 Windows 版本会掉置顶) */
  function fixTopmost(): void {
    invoke('set-fix-window-topmost').catch(() => {})
  }

  // ── 窗口大小调整 ──

  /**
   * 动态调整 Pet 窗口大小
   */
  async function resizeWindow(width: number, height: number): Promise<boolean> {
    try {
      const result = await invoke('resize-pet-window', { width, height })
      return result as boolean
    } catch {
      return false
    }
  }

  // ── 生命周期 ──

  const cleanupFns: Array<() => void> = []

  onMounted(async () => {
    if (!isElectron()) return

    // 1. 初始状态: 开启穿透 (透明区域不挡事)
    setMousePassthrough(true)

    // 2. 强制置顶
    fixTopmost()

    // 3. 注册全局鼠标追踪
    try {
      const unlistenMouse = await listen('global-mouse-move', (data: unknown) => {
        const pos = data as GlobalMousePosition
        globalMouse.value = pos
      })
      cleanupFns.push(unlistenMouse)
    } catch {
      logger.warn('PetWindow', '全局鼠标追踪注册失败')
    }

    // 4. 注册拖拽事件
    window.addEventListener('mousedown', onDragMouseDown)
    cleanupFns.push(() => window.removeEventListener('mousedown', onDragMouseDown))

    // 5. 定期修复置顶 (某些 Windows 更新会打断 alwaysOnTop)
    const topmostTimer = setInterval(fixTopmost, 30000)
    cleanupFns.push(() => clearInterval(topmostTimer))
  })

  onUnmounted(() => {
    cleanupFns.forEach((fn) => fn())
    cleanupFns.length = 0
  })

  return {
    // 状态
    isClickThrough,
    isDragging,
    globalMouse,

    // 穿透控制
    setMousePassthrough,
    onInteractableEnter,
    onInteractableLeave,

    // 窗口操作
    resizeWindow,
    fixTopmost,
  }
}
