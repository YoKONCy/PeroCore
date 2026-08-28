import type { AgentInputService } from '../../services/execution/agentInputService'
import type { BuiltinTool } from '..'

let service: AgentInputService | null = null

export function setAgentInputService(value: AgentInputService): void {
  service = value
}

export const askUserTool: BuiltinTool = {
  name: 'ask_user',
  async execute(args, ctx) {
    if (!service) throw new Error('Agent求助服务尚未初始化')
    const options = Array.isArray(args.options)
      ? args.options.map((value) => {
          const option = value as Record<string, unknown>
          return {
            id: String(option.id ?? ''),
            label: String(option.label ?? ''),
            description: typeof option.description === 'string' ? option.description : undefined,
          }
        })
      : []
    const request = service.create({
      agentId: ctx.agentId,
      channel: ctx.channel,
      sessionId: ctx.sessionId,
      threadId: ctx.threadId,
      taskId: ctx.taskId,
      question: String(args.question ?? ''),
      context: typeof args.context === 'string' ? args.context : undefined,
      options,
      allowFreeText: args.allow_free_text !== false,
      required: args.required === true,
    })
    const resolved = await service.waitForResolution(request.id, ctx.signal)
    if (resolved.status === 'answered') {
      return JSON.stringify({
        answered: true,
        selectedOptionIds: resolved.selectedOptionIds,
        ...(resolved.responseMessage ? { message: resolved.responseMessage } : {}),
      })
    }
    if (resolved.status === 'skipped') {
      return JSON.stringify({ answered: false, skipped: true })
    }
    return JSON.stringify({
      answered: false,
      cancelled: true,
      message: resolved.responseMessage ?? '用户回答请求已取消。',
    })
  },
}
