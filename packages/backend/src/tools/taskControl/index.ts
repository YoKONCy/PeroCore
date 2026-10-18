import type { TaskControlInput } from '@infos/shared'
import type { BuiltinTool } from '../index'
import { getTaskToolRuntime } from './runtime'
export const manageTaskTool: BuiltinTool = {
  name: 'manage_task',
  allowedSources: ['desktop'],
  async execute(args, ctx) {
    if (ctx.taskId) throw new Error('后台执行不能通过任务管理工具控制自身或派生新任务')
    return JSON.stringify(
      await getTaskToolRuntime().control(
        ctx.agentId,
        args as unknown as TaskControlInput,
        ctx.threadId,
      ),
    )
  },
}
