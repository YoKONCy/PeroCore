import { t as __t } from '../../i18n/index'
import type { ConversationMessageProjection } from '@infos/shared'
import { logger } from '../../lib/logger'

/** 普通流与队列流在持久提交后使用相同的工作区刷新通知。 */
export function publishWorkspaceChanges(
  message: ConversationMessageProjection,
  agentId: string,
  threadId: string,
): void {
  for (const call of message.toolCalls) {
    if (call.isError || !call.result || !['write_file', 'edit_file'].includes(call.name)) continue
    try {
      const args = JSON.parse(call.args) as Record<string, unknown>
      const result = JSON.parse(call.result) as Record<string, unknown>
      const path = String(result.path ?? args.path ?? args.file_path ?? '')
      if (!path || result.error) continue
      window.dispatchEvent(
        new CustomEvent('infos:workspace-file-changed', {
          detail: {
            agentId,
            threadId,
            path,
            operation: result.operation ?? (call.name === 'write_file' ? 'write' : 'edit'),
          },
        }),
      )
    } catch (error) {
      logger.warn(
        'ChatWorkspace',
        __t('logs.frontend.chat', '无法解析文件工具结果，跳过工作区自动刷新'),
        error,
      )
    }
  }
}
