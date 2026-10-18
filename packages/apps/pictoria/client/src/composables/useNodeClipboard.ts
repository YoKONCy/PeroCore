import { onBeforeUnmount } from 'vue'
import {
  clipboardMime,
  decodeNodes,
  encodeNodes,
  type NodeClipboard,
} from '../services/nodeClipboard'

interface Options {
  enabled(): boolean
  context(): string
  snapshot(): NodeClipboard | undefined
  paste(value: NodeClipboard, offset: number): void
  message(value: string): void
  error(value: string): void
}
export function useNodeClipboard(options: Options) {
  let previous = '',
    previousContext = '',
    count = 0
  function editable(target: EventTarget | null) {
    return (
      target instanceof HTMLElement &&
      Boolean(
        target.closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"],.creation-dock,.workflow-sidebar,.workflow-palette,.canvas-panel',
        ),
      )
    )
  }
  function failure(value: unknown) {
    options.error(value instanceof Error ? value.message : '剪贴板操作失败')
  }
  function insert(text: string) {
    const value = decodeNodes(text)
    if (!value) return false
    const repeated = text === previous && options.context() === previousContext,
      offset = repeated ? (count + 1) * 24 : 0
    options.paste(value, offset)
    count = repeated ? count + 1 : 0
    previous = text
    previousContext = options.context()
    return true
  }
  function copyEvent(event: ClipboardEvent) {
    if (
      !options.enabled() ||
      editable(event.target) ||
      window.getSelection()?.toString() ||
      !event.clipboardData
    )
      return
    try {
      const value = options.snapshot()
      if (!value) return
      const text = encodeNodes(value)
      event.clipboardData.setData('text/plain', text)
      event.clipboardData.setData(clipboardMime, text)
      event.preventDefault()
      options.message('已复制')
    } catch (value) {
      failure(value)
    }
  }
  function pasteEvent(event: ClipboardEvent) {
    if (!options.enabled() || event.defaultPrevented || editable(event.target)) return
    const text =
      event.clipboardData?.getData(clipboardMime) ||
      event.clipboardData?.getData('text/plain') ||
      ''
    if (!text.startsWith('PICTORIA_NODES_V1\n')) return
    event.preventDefault()
    try {
      insert(text)
    } catch (value) {
      failure(value)
    }
  }
  async function copy() {
    if (!options.enabled()) return
    try {
      const value = options.snapshot()
      if (!value) return
      await navigator.clipboard.writeText(encodeNodes(value))
      options.message('已复制')
    } catch {
      options.error('无法写入剪贴板，请按 Ctrl+C 复制')
    }
  }
  async function paste() {
    if (!options.enabled()) return
    const context = options.context()
    try {
      const text = await navigator.clipboard.readText()
      if (!options.enabled() || options.context() !== context) return
      if (!insert(text)) options.error('剪贴板中没有节点')
    } catch (value) {
      if (
        value instanceof DOMException &&
        ['NotAllowedError', 'SecurityError'].includes(value.name)
      )
        options.error('无法读取剪贴板，请按 Ctrl+V 粘贴')
      else failure(value)
    }
  }
  window.addEventListener('copy', copyEvent)
  window.addEventListener('paste', pasteEvent)
  onBeforeUnmount(() => {
    window.removeEventListener('copy', copyEvent)
    window.removeEventListener('paste', pasteEvent)
  })
  return { copy, paste }
}
