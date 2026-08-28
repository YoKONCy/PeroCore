import type { BuiltinTool } from '../index'
import type { FlowStateService } from '../../services/flow/flowStateService'
import { toolFailure, toolSuccess } from '../../services/execution/toolResult'

let service: FlowStateService | null = null

export function setWorkContextService(value: FlowStateService): void {
  service = value
}

/** Agent 主动总结或清空当前 Thread 的工作上下文。 */
export const manageWorkContextTool: BuiltinTool = {
  name: 'manage_work_context',
  async execute(args, context) {
    if (!service) return toolFailure('WORK_CONTEXT_UNAVAILABLE', '工作上下文服务尚未初始化')
    if (!context.threadId || !context.agentId) {
      return toolFailure('WORK_CONTEXT_SCOPE_MISSING', '当前执行上下文缺少 Thread 或 Agent 身份')
    }
    const action = args.action
    if (action === 'clear') {
      const state = await service.clearWorkContext(
        context.threadId,
        context.agentId,
        context.pairId,
      )
      return toolSuccess('当前会话的工作上下文已清空', { revision: state.revision })
    }
    if (action !== 'update' || typeof args.content !== 'string' || !args.content.trim()) {
      return toolFailure(
        'WORK_CONTEXT_INVALID_ACTION',
        'update 操作必须提供非空 content，或使用 clear 操作',
      )
    }
    const state = await service.updateWorkContext({
      threadId: context.threadId,
      agentId: context.agentId,
      pairId: context.pairId,
      content: args.content,
    })
    return toolSuccess('当前会话的工作上下文已更新', {
      revision: state.revision,
      remainingPairs: state.workContextRemainingPairs,
    })
  },
}
