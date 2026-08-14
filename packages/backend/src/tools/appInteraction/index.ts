import type { BuiltinTool } from '../index'
import type { AppManager } from '../../applications/appManager'

let appManager: AppManager | null = null

export function setAppInteractionManager(manager: AppManager): void {
  appManager = manager
}

export const interactWithAppTool: BuiltinTool = {
  name: 'interact_with_app',
  async execute(args, context) {
    if (!appManager) return JSON.stringify({ success: false, error: '应用通信内核尚未初始化' })
    const appId = String(args.app_id ?? '').trim()
    const mode = String(args.mode ?? '')
    if (!appId) return JSON.stringify({ success: false, error: 'app_id 不能为空' })

    if (mode === 'discover') {
      const manifest = await appManager.getManifest(appId)
      if (!manifest) return JSON.stringify({ success: false, error: `应用未安装: ${appId}` })
      return JSON.stringify({
        success: true,
        app: { id: manifest.id, name: manifest.name, description: manifest.description },
        actions: manifest.actions ?? [],
      })
    }
    if (mode !== 'command') {
      return JSON.stringify({ success: false, error: `首版暂不支持应用通信模式: ${mode}` })
    }
    const action = String(args.action ?? '').trim()
    if (!action) return JSON.stringify({ success: false, error: 'command 模式必须提供 action' })
    try {
      const result = await appManager.executeCommand({
        appId,
        hostAgentId: context.agentId,
        action,
        input:
          args.input && typeof args.input === 'object' && !Array.isArray(args.input)
            ? (args.input as Record<string, unknown>)
            : {},
        taskContext:
          typeof args.task_description === 'string'
            ? {
                description: args.task_description,
                inputs: [],
                successCriteria:
                  typeof args.success_criteria === 'string'
                    ? args.success_criteria
                    : '完成指定动作',
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
