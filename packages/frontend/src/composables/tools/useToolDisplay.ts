/**
 * useToolDisplay — 工具显示元数据注册表
 *
 * 职责：
 * 1. 启动后经 /api/agents/tools 拉取后端工具 display 元数据（label/icon/color/style）
 *    —— 官方工具在 manifest.json 声明；社区扩展工具同样声明后自动透传，零前端代码定制。
 * 2. API 未就绪或工具无 display 时，使用内置兜底表（style 级默认图标/配色），保证轨迹区始终可渲染。
 *
 * 元数据来源优先级：后端 API display > 内置兜底表 > generic 兜底。
 *
 * @module packages/frontend/src/composables/tools/useToolDisplay
 */

import { agentApi } from '../../api/modules/agentApi'
import type { AgentToolDisplay } from '../../api/modules/agentApi'
import { logger } from '../../lib/logger'

/**
 * 工具主题色语义名 → UI 令牌（后端 display.color 使用语义名，前端在此映射）
 *
 * 每个语义色提供 solid（主色）+ soft（软底）两个令牌，
 * 均走 ui-tokens，浅色/深色主题自动切换。
 */
export const TOOL_COLOR_CSS: Record<string, { solid: string; soft: string }> = {
  pink: { solid: 'var(--ui-accent-primary)', soft: 'var(--ui-accent-primary-soft)' },
  purple: { solid: 'var(--ui-accent-purple)', soft: 'var(--ui-accent-purple-soft)' },
  sky: { solid: 'var(--ui-accent-sky)', soft: 'var(--ui-accent-sky-soft)' },
  green: { solid: 'var(--ui-success)', soft: 'var(--ui-success-soft)' },
  orange: { solid: 'var(--ui-warning)', soft: 'var(--ui-warning-soft)' },
  // 兼容别名
  yellow: { solid: 'var(--ui-warning)', soft: 'var(--ui-warning-soft)' },
}

/** 兜底色（pink） */
const FALLBACK_COLOR = TOOL_COLOR_CSS.pink!

/** 每个轨迹样式的默认图标与配色（兜底表） */
const STYLE_FALLBACK: Record<string, { icon: string; color: string }> = {
  edit: { icon: 'edit', color: 'pink' },
  read: { icon: 'file', color: 'sky' },
  search: { icon: 'search', color: 'purple' },
  terminal: { icon: 'terminal', color: 'green' },
  web: { icon: 'globe', color: 'sky' },
  browser: { icon: 'globe', color: 'sky' },
  script: { icon: 'code', color: 'purple' },
  screen: { icon: 'image', color: 'pink' },
  reminder: { icon: 'clock', color: 'orange' },
  task: { icon: 'check', color: 'green' },
  skill: { icon: 'puzzle', color: 'purple' },
  social: { icon: 'chat', color: 'green' },
  stronghold: { icon: 'door-open', color: 'purple' },
  system: { icon: 'cpu', color: 'purple' },
  desktop: { icon: 'activity', color: 'purple' },
  file: { icon: 'file', color: 'purple' },
  generic: { icon: 'tool', color: 'pink' },
}

/** 工具名 → 轨迹样式兜底映射（仅 API 不可用时生效） */
const FALLBACK_TOOL_STYLE: Record<string, string> = {
  edit_file: 'edit',
  write_file: 'edit',
  read_file: 'read',
  read_file_range: 'read',
  browser_get_content: 'read',
  code_search: 'search',
  glob_files: 'search',
  search_files: 'search',
  search_diary: 'search',
  terminal_execute: 'terminal',
  terminal_create: 'terminal',
  terminal_list: 'terminal',
  terminal_get: 'terminal',
  terminal_read: 'terminal',
  terminal_wait: 'terminal',
  terminal_write: 'terminal',
  terminal_resize: 'terminal',
  terminal_interrupt: 'terminal',
  terminal_kill: 'terminal',
  terminal_close: 'terminal',
  web_fetch: 'web',
  browser_open_url: 'browser',
  browser_click: 'browser',
  browser_type: 'browser',
  browser_scroll: 'browser',
  browser_back: 'browser',
  run_script: 'script',
  take_screenshot: 'screen',
  set_reminder: 'reminder',
  list_reminders: 'reminder',
  cancel_reminder: 'reminder',
  finish_task: 'task',
  load_skill: 'skill',
  social_notify_owner: 'social',
  stronghold_move_to_room: 'stronghold',
  stronghold_list_rooms: 'stronghold',
  stronghold_get_room_info: 'stronghold',
  stronghold_set_environment: 'stronghold',
  stronghold_call_butler: 'stronghold',
  get_system_info: 'system',
  open_application: 'system',
  get_active_windows: 'system',
  activate_window: 'system',
  automation_execute: 'desktop',
  get_mouse_position: 'desktop',
  get_file_info: 'file',
  list_directory: 'file',
}

/** 后端 API 提供的 display 元数据（name → display） */
const metaByTool = new Map<string, AgentToolDisplay>()

/** 已解析结果缓存（避免每个轨迹卡片重复 await） */
const resolvedCache = new Map<string, AgentToolDisplay>()

let loaded = false
let loadingPromise: Promise<void> | null = null

/** 拉取一次后端工具元数据（幂等） */
async function ensureLoaded(): Promise<void> {
  if (loaded) return
  if (!loadingPromise) {
    loadingPromise = (async () => {
      try {
        const tools = (await agentApi.listTools()).data ?? []
        for (const tool of tools) {
          if (tool?.name && tool.display) metaByTool.set(tool.name, tool.display)
        }
      } catch (error) {
        // API 不可用：使用内置兜底表，不影响轨迹渲染
        logger.warn('useToolDisplay', '拉取工具显示元数据失败，使用内置兜底表', error)
      } finally {
        loaded = true
      }
    })()
  }
  return loadingPromise
}

/** 解析某个工具轨迹的显示元数据（API display 优先，兜底表其次） */
export async function resolveToolDisplay(name: string): Promise<AgentToolDisplay> {
  const cached = resolvedCache.get(name)
  if (cached) return cached

  await ensureLoaded()

  let meta: AgentToolDisplay
  const fromApi = metaByTool.get(name)
  if (fromApi) {
    meta = fromApi
  } else {
    const style = FALLBACK_TOOL_STYLE[name]
    const fallback = style ? STYLE_FALLBACK[style] : STYLE_FALLBACK.generic
    meta = fallback ? { icon: fallback.icon, color: fallback.color, style } : {}
  }
  resolvedCache.set(name, meta)
  return meta
}

const FALLBACK_TOOL_LABEL: Record<string, string> = {
  edit_file: '编辑文件',
  write_file: '写入文件',
  read_file: '读取文件',
  read_file_range: '范围读取',
  get_file_info: '查看文件信息',
  list_directory: '浏览目录',
  glob_files: '查找文件',
  code_search: '搜索代码',
  search_files: '搜索文件',
  terminal_execute: '终端执行',
  terminal_create: '创建终端',
  terminal_list: '终端列表',
  terminal_get: '查看终端',
  terminal_read: '读取终端',
  terminal_wait: '等待终端',
  terminal_write: '输入终端',
  terminal_resize: '调整终端',
  terminal_interrupt: '中断终端',
  terminal_kill: '终止终端',
  terminal_close: '关闭终端',
  web_fetch: '获取网页',
  browser_open_url: '打开网页',
  browser_click: '点击网页',
  browser_type: '网页输入',
  browser_scroll: '滚动网页',
  browser_back: '网页后退',
  browser_get_content: '读取网页内容',
  run_script: '运行脚本',
  take_screenshot: '屏幕截图',
  get_system_info: '系统信息',
  open_application: '打开应用',
  get_active_windows: '活动窗口',
  activate_window: '切换窗口',
  automation_execute: '桌面自动化',
  get_mouse_position: '鼠标位置',
  set_reminder: '创建提醒',
  list_reminders: '查看提醒',
  cancel_reminder: '取消提醒',
  finish_task: '完成任务',
  load_skill: '加载技能',
  search_diary: '搜索日记',
  social_notify_owner: '通知主人',
  stronghold_move_to_room: '移动到房间',
  stronghold_list_rooms: '查看房间',
  stronghold_get_room_info: '房间信息',
  stronghold_set_environment: '设置环境',
  stronghold_call_butler: '呼叫管家',
}

/** 工具名 → 显示名；任何情况下都不向用户暴露 snake_case 函数标识。 */
export function toolDisplayLabel(name: string, display?: AgentToolDisplay): string {
  if (display?.label) return display.label
  if (FALLBACK_TOOL_LABEL[name]) return FALLBACK_TOOL_LABEL[name]
  return name
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/** 工具名 → 图标（display.icon 优先，缺省回退 tool） */
export function toolDisplayIcon(display?: AgentToolDisplay): string {
  return display?.icon || 'tool'
}

/** 工具名 → 主题色（主色）CSS 变量 */
export function toolDisplayColor(display?: AgentToolDisplay): string {
  const semantic = display?.color || 'pink'
  return TOOL_COLOR_CSS[semantic]?.solid ?? FALLBACK_COLOR.solid
}

/** 工具名 → 主题色（软底）CSS 变量 */
export function toolDisplayColorSoft(display?: AgentToolDisplay): string {
  const semantic = display?.color || 'pink'
  return TOOL_COLOR_CSS[semantic]?.soft ?? FALLBACK_COLOR.soft
}
