import type { BuiltinTool } from '../index'
import type { AppManager } from '../../applications/appManager'

let appManager: AppManager | null = null

export function setSocialInteractionManager(manager: AppManager): void {
  appManager = manager
}

export const interactWithSocialTool: BuiltinTool = {
  name: 'interact_with_social',
  async execute(args, context) {
    if (!appManager) return JSON.stringify({ success: false, error: '社交通信内核尚未初始化' })
    const groupId = String(args.group_id ?? '').trim()
    if (!groupId) return JSON.stringify({ success: false, error: 'group_id 不能为空' })

    try {
      const result = await appManager.executeCommand({
        appId: 'social',
        hostAgentId: context.agentId,
        action: 'chat_in_group',
        input: {
          group_id: groupId,
          ...(typeof args.intent === 'string' && args.intent.trim()
            ? { intent: args.intent.trim() }
            : {}),
        },
        taskContext:
          typeof args.intent === 'string' && args.intent.trim()
            ? {
                description: args.intent.trim(),
                inputs: [groupId],
                successCriteria: '社交Agent已读取目标群聊并完成本次参与判断',
              }
            : undefined,
      })
      return JSON.stringify({ success: result.status === 'completed', ...result })
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },
}
