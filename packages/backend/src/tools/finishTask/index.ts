/**
 * finish_task — 任务完成工具
 *
 * 始终允许调用的生命周期工具 (CapabilityGate 白名单豁免)。
 * Agent 通过此工具主动结束当前任务/对话回合。
 *
 * @module packages/backend/src/tools/finishTask
 */

import type { BuiltinTool } from '../index'

export const finishTaskTool: BuiltinTool = {
  definition: {
    name: 'finish_task',
    description: '结束当前任务。当你完成了用户的请求，或确认无需进一步操作时调用。',
    parameters: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: '任务完成总结 (简要说明做了什么)',
        },
        status: {
          type: 'string',
          description: '完成状态: "done" (已完成) | "partial" (部分完成) | "failed" (失败)',
          enum: ['done', 'partial', 'failed'],
        },
      },
      required: ['summary'],
    },
  },

  async execute(args) {
    const summary = (args.summary as string) ?? '任务已完成'
    const status = (args.status as string) ?? 'done'

    // finish_task 的实际效果由 ReAct Loop 层处理 (检测到此工具调用后停止循环)
    // 这里只返回格式化结果
    return JSON.stringify({ finished: true, status, summary })
  },
}
