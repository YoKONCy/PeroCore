import { auditCommand } from '@infos/auditor-wasm'
import type { ToolPermission } from '../../capabilities/types'

export interface ToolPolicyContext {
  agentId: string
  channel: string
  sessionId: string
  threadId: string
  taskId?: string
  toolName: string
  args: Record<string, unknown>
  permission?: ToolPermission
}

export type PolicyDecision =
  | { action: 'allow' }
  | { action: 'deny'; code: string; reason: string }
  | { action: 'require_approval'; reason: string }

const CONTENT_FIELDS = new Set([
  'content',
  'data',
  'code',
  'command',
  'query',
  'old_text',
  'new_text',
])

/** 即使 capabilities.yaml 未显式配置，也必须审批的高风险终端命令。 */
const HIGH_RISK_COMMAND_PATTERNS = [
  /\brm\s+-[^\n]*r[^\n]*f\b/i,
  /\bRemove-Item\b[^\n]*(?:-Recurse[^\n]*-Force|-Force[^\n]*-Recurse)/i,
  /\b(?:format|shutdown|reboot)\b/i,
  /\bcurl\b[^\n|]*\|\s*(?:sh|bash|zsh|powershell|pwsh)\b/i,
  /\bgit\s+(?:reset\s+--hard|clean\s+-[^\n]*f)/i,
]

const TERMINAL_TOOLS = new Set(['terminal_execute', 'terminal_create'])

/**
 * 本地执行器目前只能约束终端 cwd，不能在操作系统层隔离 Shell 对全盘文件的访问。
 * 因此任意命令执行必须逐次审批，不能仅依赖命令文本审计或路径参数检查。
 */
export const ALWAYS_APPROVE_EACH_CALL_TOOLS = new Set([
  'terminal_execute',
  'terminal_create',
  'terminal_write',
  'open_application',
  'activate_window',
])

/** 工具参数与审批策略引擎。 */
export class PolicyEngine {
  evaluate(context: ToolPolicyContext): PolicyDecision {
    const policy = context.permission?.paramPolicy
    if (policy?.maxContentLength !== undefined) {
      for (const [key, value] of Object.entries(context.args)) {
        if (
          CONTENT_FIELDS.has(key) &&
          typeof value === 'string' &&
          value.length > policy.maxContentLength
        ) {
          return {
            action: 'deny',
            code: 'PARAM_TOO_LARGE',
            reason: `参数 ${key} 长度 ${value.length} 超过上限 ${policy.maxContentLength}`,
          }
        }
      }
    }

    const command =
      typeof context.args.command === 'string' ? context.args.command.trim() : undefined
    if (command && policy?.allowedCommands?.length) {
      const executable = this.firstCommandToken(command).toLowerCase()
      const allowed = policy.allowedCommands.some((item) => item.toLowerCase() === executable)
      if (!allowed) {
        return {
          action: 'deny',
          code: 'COMMAND_NOT_ALLOWED',
          reason: `命令 ${executable} 不在允许列表中`,
        }
      }
    }
    if (policy?.deniedPatterns?.length) {
      const serialized = JSON.stringify(context.args)
      for (const pattern of policy.deniedPatterns) {
        try {
          if (new RegExp(pattern, 'i').test(serialized)) {
            return {
              action: 'deny',
              code: 'PARAM_PATTERN_DENIED',
              reason: `参数命中禁止模式: ${pattern}`,
            }
          }
        } catch {
          return {
            action: 'deny',
            code: 'INVALID_POLICY',
            reason: `权限配置包含无效正则: ${pattern}`,
          }
        }
      }
    }

    if (command && TERMINAL_TOOLS.has(context.toolName)) {
      const audit = auditCommand(command, process.platform === 'win32' ? 'powershell' : 'sh')
      if (!audit.allowed) {
        return {
          action: 'require_approval',
          reason: `命令审计判定为 ${audit.risk} 风险：${audit.reason}`,
        }
      }
    }
    if (
      command &&
      TERMINAL_TOOLS.has(context.toolName) &&
      HIGH_RISK_COMMAND_PATTERNS.some((pattern) => pattern.test(command))
    ) {
      return { action: 'require_approval', reason: '终端命令包含高风险或破坏性操作，需要用户确认' }
    }
    if (ALWAYS_APPROVE_EACH_CALL_TOOLS.has(context.toolName)) {
      return {
        action: 'require_approval',
        reason: `工具 ${context.toolName} 可执行或注入任意系统命令，必须逐次由用户确认`,
      }
    }
    if (context.permission?.requiresApproval) {
      return {
        action: 'require_approval',
        reason: `工具 ${context.toolName} 的权限策略要求用户审批`,
      }
    }
    return { action: 'allow' }
  }

  private firstCommandToken(command: string): string {
    const trimmed = command.trim()
    const quoted = trimmed.match(/^["']([^"']+)["']/)
    if (quoted?.[1]) return quoted[1]
    return trimmed.split(/\s+/)[0] ?? ''
  }
}
