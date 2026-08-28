import { projectSocialSurface } from './socialSurfaceProjection'
import type { SocialStoragePort } from '@infos/shared'

export interface SocialDataServiceDeps {
  storage: SocialStoragePort
  resetMemory(agentId: string): void
  getAgentName(agentId: string): string | undefined
}

/** Social隐私数据清理用例层；统一处理Tombstone与跨存储删除。 */
export class SocialDataService {
  constructor(private readonly deps: SocialDataServiceDeps) {}

  listContacts(agentId: string) {
    return this.deps.storage.listContactImpressions(agentId)
  }

  project(agentId: string) {
    return projectSocialSurface(this.deps.storage, agentId)
  }

  async clear(input: Record<string, unknown>) {
    const agentId = String(input.agentId ?? '')
    const scope = String(input.scope ?? '')
    const agentName = this.deps.getAgentName(agentId)
    if (!agentName) return { error: '目标 Agent 不存在' as const }
    if (scope === 'channel') {
      const channelType = String(input.channelType ?? '')
      const channelId = String(input.channelId ?? '')
      if (!['private', 'group'].includes(channelType) || !channelId) {
        return { error: '缺少有效的会话类型或会话 ID' as const }
      }
      await this.deps.storage.upsertTombstone({
        agentId,
        platform: 'qq',
        channelType,
        channelId,
        deletedBefore: Math.floor(Date.now() / 1000),
      })
      return {
        message: '会话记录已清除',
        data: {
          deleted: await this.deps.storage.deleteChannelMessages(agentId, channelType, channelId),
        },
      }
    }
    if (scope === 'contact_impression') {
      const userId = String(input.userId ?? '')
      if (!userId) return { error: '缺少用户 ID' as const }
      await this.deps.storage.deleteContactImpression(agentId, 'qq', userId)
      return { message: '联系人印象已清除' }
    }
    if (String(input.confirmAgentName ?? '') !== agentName) {
      return { precondition: `请输入角色名“${agentName}”确认` }
    }
    if (scope === 'all_messages' || scope === 'all_social_data') {
      await this.deps.storage.upsertTombstone({
        agentId,
        platform: 'qq',
        deletedBefore: Math.floor(Date.now() / 1000),
      })
      const messages = await this.deps.storage.deleteAllMessages(agentId)
      if (scope === 'all_messages')
        return { message: '全部社交消息已清除', data: { deleted: messages } }
      const impressions = await this.deps.storage.deleteAllContactImpressions(agentId)
      this.deps.resetMemory(agentId)
      return { message: '全部社交数据已清除', data: { messages, impressions } }
    }
    if (scope === 'long_memory') {
      this.deps.resetMemory(agentId)
      return { message: '全部社交长记忆已清除' }
    }
    return { error: '未知清理范围' as const }
  }
}
