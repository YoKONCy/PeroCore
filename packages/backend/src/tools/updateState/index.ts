import type { BuiltinTool } from '../index'
import { toolFailure, toolSuccess } from '../../services/execution/toolResult'
import { applyCharacterStateUpdate } from '../finishTask'

/** 独立更新角色状态与动态台词，不结束ReAct，也不承担用户最终回复。 */
export const updateStateTool: BuiltinTool = {
  name: 'update_state',
  async execute(args, ctx) {
    try {
      const result = await applyCharacterStateUpdate(args, ctx.agentId)
      if (!result.updated) {
        return toolFailure('UPDATE_STATE_EMPTY', '至少提供一项情绪、动作、内心或动态台词更新。')
      }
      return toolSuccess(
        JSON.stringify({
          updated: true,
          agent_id: ctx.agentId,
          text_expires_at: result.textExpiresAt ?? null,
        }),
      )
    } catch (error) {
      return toolFailure(
        'UPDATE_STATE_FAILED',
        error instanceof Error ? error.message : String(error),
      )
    }
  },
}
