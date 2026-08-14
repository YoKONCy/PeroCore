/** 官方工具面向用户的正式名称；Manifest display.label 优先，本表保证兜底不暴露函数名。 */
export const TOOL_USER_LABELS: Record<string, string> = {
  read_file: '读取文件',
  write_file: '写入文件',
  get_file_info: '查看文件信息',
  list_directory: '浏览目录',
  read_file_range: '范围读取',
  edit_file: '编辑文件',
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

/** 扩展工具缺少正式名时生成可读标题，永远不直接显示 snake_case。 */
export function resolveToolUserLabel(name: string, declared?: string): string {
  if (declared?.trim()) return declared.trim()
  if (TOOL_USER_LABELS[name]) return TOOL_USER_LABELS[name]
  return name
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
