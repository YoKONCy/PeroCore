import { ADVANCED_TOOL_NAMES, isAdvancedTool } from './advancedTools'

/** Agent执行协议的固定工具；不属于用户可撤销能力。 */
export const SYSTEM_PROTOCOL_TOOLS = new Set([
  'finish_task',
  'expand_advanced_tools',
  'load_skill',
  'update_flow_state',
  'manage_work_context',
  'ask_user',
  'update_state',
  'skill_list_resources',
  'skill_read_resource',
  'interact_with_social',
  'communicate_with_host',
  'expand_advanced_tools',
])

/** 据点group通道除固定执行协议外，仅开放据点空间状态机工具。 */
export const STRONGHOLD_CHANNEL_TOOLS = new Set([
  'stronghold_move_to_room',
  'stronghold_list_rooms',
  'stronghold_get_room_info',
  'stronghold_set_environment',
  'stronghold_summon_agents',
  'stronghold_call_butler',
])

/** 判断工具是否属于据点通道的上游白名单。 */
export function isStrongholdChannelTool(name: string): boolean {
  return SYSTEM_PROTOCOL_TOOLS.has(name) || STRONGHOLD_CHANNEL_TOOLS.has(name)
}

/** 高级工具清单由统一工具包定义维护。 */
export { ADVANCED_TOOL_NAMES, isAdvancedTool }

export function isSystemProtocolTool(name: string): boolean {
  return SYSTEM_PROTOCOL_TOOLS.has(name)
}
