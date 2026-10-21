import type { AgentManager } from '../agent/agentManager'
import type { ConfigRepository } from '../../repositories/config.repo'
import { readPromptPersona } from '../prompt/promptWorkspace'

export type MemoryPersonaResolver = (
  agentId: string,
  channel?: string,
) => Promise<Record<string, unknown>>

/** 复用角色的人设文件与专属称呼，不加载桌面工具协议或其他 Thread 的临时状态。 */
export function memoryPersonaResolver(
  agents: AgentManager,
  config: ConfigRepository,
): MemoryPersonaResolver {
  return async (agentId, channel) => {
    const profile = agents.getAgent(agentId)
    if (!profile) throw new Error(`补记角色不存在：${agentId}`)
    const persona = await readPromptPersona(profile.promptPath)
    if (!persona.trim()) throw new Error(`补记角色的人格设定不可用：${agentId}`)
    return {
      agent_id: agentId,
      agent_name: profile.name,
      persona_definition: persona,
      owner_name: (await config.get('owner.name')) ?? '用户',
      owner_appellation: agents.getOwnerAppellation(agentId),
      channel_patch: channel ? (profile.channelPatches[channel] ?? '') : '',
    }
  }
}
