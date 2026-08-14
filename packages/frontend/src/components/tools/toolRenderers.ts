/**
 * toolRenderers — 工具轨迹样式渲染器注册表
 *
 * 前端按工具 display.style 选择格式化渲染组件（如 edit 显示 +N/-M、search 显示匹配统计）。
 * 社区自定义工具可通过 registerToolStyleRenderer() 注册新的 style 渲染器，
 * 或按工具名在注册表外层覆盖，未注册的 style 一律回退 ToolCardGeneric。
 *
 * @module packages/frontend/src/components/tools/toolRenderers
 */

import type { Component } from 'vue'
import ToolCardGeneric from './renderers/ToolCardGeneric.vue'
import ToolCardEdit from './renderers/ToolCardEdit.vue'
import ToolCardRead from './renderers/ToolCardRead.vue'
import ToolCardSearch from './renderers/ToolCardSearch.vue'
import ToolCardTerminal from './renderers/ToolCardTerminal.vue'
import ToolCardWeb from './renderers/ToolCardWeb.vue'

/** 渲染器统一 props（由 ToolCallCard 注入） */
export interface ToolCardRendererProps {
  /** 工具调用参数（原始 JSON 字符串） */
  args: string
  /** 工具执行结果文本 */
  result?: string
  /** 是否执行失败 */
  isError?: boolean
}

const styleRenderers = new Map<string, Component>()

/** 注册一个 style 渲染器（社区扩展预留接口） */
export function registerToolStyleRenderer(style: string, component: Component): void {
  styleRenderers.set(style, component)
}

/** 获取指定 style 的渲染器；未注册回退 generic */
export function getToolStyleRenderer(style?: string): Component {
  if (style && styleRenderers.has(style)) return styleRenderers.get(style)!
  return ToolCardGeneric
}

// ── 预置官方 style 渲染器 ──
registerToolStyleRenderer('edit', ToolCardEdit)
registerToolStyleRenderer('read', ToolCardRead)
registerToolStyleRenderer('search', ToolCardSearch)
registerToolStyleRenderer('terminal', ToolCardTerminal)
registerToolStyleRenderer('web', ToolCardWeb)
