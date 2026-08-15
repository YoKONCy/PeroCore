/**
 * terminal_execute — 受管短命令执行工具
 *
 * 复用 ExecutionSession + TerminalManager；命令超时、任务取消或会话回收时会终止受管进程树。
 * 长时服务器应使用 terminal_create，避免阻塞单次 ReAct 工具调用。
 */

import type { BuiltinTool } from '../index'
import { getProductivityRuntime, resolveExecutionSession } from '../productivityRuntimeHolder'
import { toolSuccess } from '../../services/execution/toolResult'

const DEFAULT_TIMEOUT_MS = 30_000

export const terminalExecutorTool: BuiltinTool = {
  name: 'terminal_execute',

  async execute(args, ctx) {
    if (!ctx.approvedSensitiveAction) throw new Error('终端命令缺少本次用户审批凭证')
    const command = String(args.command ?? '').trim()
    if (!command) throw new Error('command 不能为空')
    const timeout = Math.max(100, Math.min(Number(args.timeout ?? DEFAULT_TIMEOUT_MS), 10 * 60_000))
    const session = await resolveExecutionSession(ctx)
    const result = await getProductivityRuntime().terminals.run({
      executionSessionId: session.id,
      command,
      cwd: args.cwd ? String(args.cwd) : undefined,
      title: command.slice(0, 80),
      timeoutMs: timeout,
      signal: ctx.signal,
    })
    return toolSuccess(result.output, {
      exitCode: result.terminal.exitCode,
      truncated: result.truncated,
      executionSessionId: session.id,
    })
  },
}
