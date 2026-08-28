/**
 * toolSignatures — 前端领域模块
 *
 * 集中管理该领域的数据转换、状态边界与外部交互。
 * 调用方依赖这里的稳定契约，不直接耦合底层传输或运行时实现。
 */
export type ToolArchetype =
  | 'file-paper'
  | 'edit-splice'
  | 'search-radar'
  | 'terminal-tape'
  | 'browser-space'
  | 'vision-frame'
  | 'desktop-motion'
  | 'time-ticket'
  | 'stronghold-scene'
  | 'system-module'
  | 'web-sheet'
  | 'script-circuit'
  | 'social-signal'
  | 'generic'

export interface ToolVisualSignature {
  archetype: ToolArchetype
  variant: string
  chain: string
  motion: string
  silhouette: string
  summaryFields: string[]
  collapseDelayMs: number
}

const terminalTools = [
  'terminal_execute',
  'terminal_create',
  'terminal_list',
  'terminal_get',
  'terminal_read',
  'terminal_wait',
  'terminal_write',
  'terminal_resize',
  'terminal_interrupt',
  'terminal_kill',
  'terminal_close',
]
const browserTools = [
  'browser_open_url',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_back',
  'browser_get_content',
  'browser_search',
  'browser_wait',
  'browser_tabs',
  'browser_interact',
  'browser_query_dom',
  'browser_dialog',
  'browser_network',
  'browser_upload',
  'browser_download',
  'browser_storage',
  'browser_emulate',
  'browser_evaluate',
  'browser_status',
]
const socialTools = [
  'social_send_message',
  'social_get_contacts',
  'social_get_groups',
  'social_get_contact_info',
  'social_get_group_info',
  'social_get_group_members',
  'social_handle_request',
  'social_notify_owner',
]

const groups: Array<[ToolArchetype, string, string[]]> = [
  [
    'file-paper',
    'files',
    ['read_file', 'read_file_range', 'get_file_info', 'list_directory', 'glob_files'],
  ],
  ['edit-splice', 'files', ['write_file', 'edit_file']],
  ['search-radar', 'search', ['search_files', 'code_search']],
  ['terminal-tape', 'terminal', terminalTools],
  ['browser-space', 'browser', browserTools],
  ['vision-frame', 'vision', ['take_screenshot', 'browser_screenshot', 'browser_page_image']],
  [
    'desktop-motion',
    'desktop',
    [
      'automation_execute',
      'get_mouse_position',
      'get_system_info',
      'open_application',
      'get_active_windows',
      'activate_window',
    ],
  ],
  ['time-ticket', 'time', ['set_reminder', 'list_reminders', 'cancel_reminder']],
  [
    'stronghold-scene',
    'stronghold',
    [
      'stronghold_move_to_room',
      'stronghold_list_rooms',
      'stronghold_get_room_info',
      'stronghold_set_environment',
      'stronghold_summon_agents',
      'stronghold_call_butler',
    ],
  ],
  [
    'system-module',
    'system',
    [
      'finish_task',
      'load_skill',
      'skill_list_resources',
      'skill_read_resource',
      'expand_advanced_tools',
      'update_flow_state',
      'update_state',
      'interact_with_social',
      'communicate_with_host',
    ],
  ],
  ['web-sheet', 'web', ['web_fetch']],
  ['script-circuit', 'script', ['run_script']],
  ['social-signal', 'social', socialTools],
]

const signatureMap = new Map<string, ToolVisualSignature>()
for (const [archetype, chain, names] of groups) {
  names.forEach((name, index) => {
    signatureMap.set(name, {
      archetype,
      variant: name.replaceAll('_', '-'),
      chain,
      motion: `${archetype}-${index % 6}`,
      silhouette: `${archetype}-${index % 5}`,
      summaryFields: summaryFields(name),
      collapseDelayMs: 600,
    })
  })
}

function summaryFields(name: string): string[] {
  if (name.includes('file') || name.includes('directory')) return ['path', 'file_path', 'dir_path']
  if (name.startsWith('browser_')) return ['url', 'target', 'selector', 'text', 'query']
  if (name.startsWith('terminal_')) return ['command', 'terminal_id', 'title']
  if (name.startsWith('stronghold_')) return ['room_name', 'agent_ids', 'key', 'request']
  if (name.includes('reminder')) return ['content', 'time', 'reminder_id']
  if (name.startsWith('social_')) return ['content', 'user_id', 'group_id', 'request_id']
  return ['query', 'summary', 'action', 'skill_id', 'url']
}

export function resolveToolSignature(
  name: string,
  override?: Partial<ToolVisualSignature>,
): ToolVisualSignature {
  const base = signatureMap.get(name) ?? {
    archetype: 'generic' as const,
    variant: `generic-${name.replaceAll('_', '-')}`,
    chain: `generic:${name}`,
    motion: 'generic-pulse',
    silhouette: 'generic-node',
    summaryFields: ['path', 'query', 'url', 'command', 'action'],
    collapseDelayMs: 600,
  }
  return { ...base, ...override }
}

export function officialToolSignatures(): ReadonlyMap<string, ToolVisualSignature> {
  return signatureMap
}
