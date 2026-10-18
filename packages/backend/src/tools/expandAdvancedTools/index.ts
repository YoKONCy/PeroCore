import type { BuiltinTool } from '../index'
import { toolFailure, toolSuccess } from '../../services/execution/toolResult'
import { describeAdvancedToolPackages } from '../advancedTools'

/** 只展开本次执行实际获准的工具定义，不执行网页、桌面或终端操作。 */
export const expandAdvancedToolsTool: BuiltinTool = {
  name: 'expand_advanced_tools',
  async execute(_args, ctx) {
    const access = ctx.advancedToolAccess
    if (!access)
      return toolFailure(
        'ADVANCED_CONTEXT_REQUIRED',
        '请在当前 ReAct 中直接调用展开入口，不能通过脚本展开。',
      )
    const packages = describeAdvancedToolPackages(access.names)
    if (!packages.length)
      return toolFailure(
        'NO_ADVANCED_TOOLS',
        '当前执行没有获准的高级工具，请检查会话工具开关、角色权限和节点连接状态。',
      )
    const summary = packages
      .map((item) => `${item.label}（${item.count} 项）：${item.description}`)
      .join('\n')
    return toolSuccess(
      `高级工具列表已展开：\n${summary}\n下一轮将提供具体工具定义，请按定义调用。工作上下文续接时可恢复展开状态，工具名单仍按当前权限重新过滤，原有审批保持生效。`,
      {
        expanded: true,
        packages,
      },
    )
  },
}
