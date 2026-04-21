/**
 * History Enricher — 对话历史注入
 *
 * 从 ConversationLogService 拉取最近对话，
 * 压扁为 XML 格式注入 EnrichedContext。
 *
 * 历史记录增强器。
 *
 * @module packages/backend/src/services/pipeline/enrichers/historyEnricher
 */

import type { Enricher, EnrichmentInput, EnrichedContext } from '../types'
import type { ConversationLogService } from '../../memory/conversationLog'

/** 历史记录条目 */
interface HistoryEntry {
  role: string
  content: string
}

export class HistoryEnricher implements Enricher {
  readonly name = 'HistoryEnricher'

  constructor(
    private logService: ConversationLogService,
    private windowSize = 20,
  ) {}

  async enrich(input: EnrichmentInput): Promise<Partial<EnrichedContext>> {
    const { agentId, sessionId, source } = input

    const history = await this.logService.getContextWindow(agentId, sessionId, this.windowSize)

    const flattened = this.flatten(history, agentId)

    // 根据来源决定放入哪个字段
    if (source === 'social' || source === 'group_chat') {
      return { flattenedGroupHistory: flattened }
    }
    return { flattenedDesktopHistory: flattened }
  }

  /**
   * 将消息列表压扁为 XML 格式
   *
   * 格式：<message role="user" name="User">内容</message>
   * 将嵌套历史记录扁平化。
   */
  private flatten(messages: HistoryEntry[], agentName: string): string {
    if (messages.length === 0) {
      return '<!-- 暂无历史记录 -->'
    }

    const lines: string[] = []
    for (const msg of messages) {
      const displayName =
        msg.role === 'assistant' ? agentName : msg.role === 'system' ? 'System' : 'User'

      // XML 转义
      const content = msg.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

      lines.push(`<message role="${msg.role}" name="${displayName}">${content}</message>`)
    }

    return lines.join('\n')
  }
}
