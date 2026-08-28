import type { BuiltinTool } from '../index'
import { toolSuccess } from '../../services/execution/toolResult'

/** 展开动作由ReAct循环识别；工具处理器只返回协议确认。 */
export const expandAdvancedToolsTool: BuiltinTool = {
  name: 'expand_advanced_tools',
  async execute() {
    return toolSuccess('高级工具列表已展开', { expanded: true })
  },
}
