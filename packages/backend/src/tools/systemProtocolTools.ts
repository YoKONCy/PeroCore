/** Agent 执行协议的固定工具；不属于用户可撤销能力。 */
export const SYSTEM_PROTOCOL_TOOLS = new Set([
  'finish_task',
  'load_skill',
  'update_flow_state',
  'interact_with_app',
  'communicate_with_host',
])

export function isSystemProtocolTool(name: string): boolean {
  return SYSTEM_PROTOCOL_TOOLS.has(name)
}
