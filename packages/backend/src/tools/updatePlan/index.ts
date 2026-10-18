import type { BuiltinTool } from '../index'
import type { TaskPlanService } from '../../services/task/taskPlanService'
import { updatePlanSchema } from '../../services/task/taskPlanService'
import { toolFailure, toolSuccess } from '../../services/execution/toolResult'

let service: TaskPlanService | undefined
export function setTaskPlanService(value?: TaskPlanService) {
  service = value
}

export const updatePlanTool: BuiltinTool = {
  name: 'update_plan',
  allowedSources: ['desktop'],
  async execute(args, ctx) {
    if (!service) return toolFailure('PLAN_UNAVAILABLE', '计划服务尚未初始化')
    const parsed = updatePlanSchema.safeParse(args)
    if (!parsed.success)
      return toolFailure('INVALID_PLAN', '计划参数无效，请提供有效的标题、步骤和状态')
    const plan = await service.update(ctx, parsed.data)
    return toolSuccess(parsed.data.action === 'clear' ? '计划已清除' : '计划已同步', { plan })
  },
}
