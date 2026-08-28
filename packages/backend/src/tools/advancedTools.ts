/**
 * 高级工具抽屉。
 *
 * 工具按包维护，仅在当前 ReAct 主动展开后发送给模型；展开不会授予权限，
 * CapabilityGate、审批、节点 Trust 和 ToolExecutor 校验仍然完整生效。
 */
export const EXPAND_ADVANCED_TOOLS = 'expand_advanced_tools'

export const ADVANCED_TOOL_PACKAGES = {
  browser: [
    'browser_open_url',
    'browser_click',
    'browser_type',
    'browser_scroll',
    'browser_back',
    'browser_get_content',
    'browser_search',
    'browser_screenshot',
    'browser_page_image',
    'browser_wait',
    'browser_tabs',
    'browser_interact',
    'browser_query_dom',
    'browser_dialog',
    'browser_network',
    'browser_download',
    'browser_upload',
    'browser_storage',
    'browser_emulate',
    'browser_evaluate',
    'browser_status',
  ],
  computerUse: ['automation_execute', 'get_mouse_position'],
  remoteTerminal: [
    'remote_terminal_nodes',
    'remote_terminal_create',
    'remote_terminal_list',
    'remote_terminal_get',
    'remote_terminal_read',
    'remote_terminal_wait',
    'remote_terminal_write',
    'remote_terminal_interrupt',
    'remote_terminal_kill',
    'remote_terminal_close',
  ],
} as const

export const ADVANCED_TOOL_NAMES = new Set<string>(Object.values(ADVANCED_TOOL_PACKAGES).flat())

export function isAdvancedTool(name: string): boolean {
  return ADVANCED_TOOL_NAMES.has(name)
}
