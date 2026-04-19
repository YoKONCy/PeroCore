/**
 * @perocore/auditor-wasm — TS Mock 实现
 *
 * 终端命令安全审计，正式版使用 Rust + WASM。
 * 开发期使用此 TS fallback（基本规则匹配）。
 *
 * @module @perocore/auditor-wasm
 */

/** 审计结果 */
export interface AuditResult {
  /** 是否允许执行 */
  allowed: boolean
  /** 风险等级 */
  risk: 'safe' | 'low' | 'medium' | 'high' | 'critical'
  /** 审计原因 */
  reason: string
  /** 匹配的危险模式 (如有) */
  matchedPattern?: string
}

/** 危险命令模式 (TS fallback 基础规则) */
const DANGEROUS_PATTERNS = [
  { pattern: /rm\s+(-rf?|--recursive)\s+[\/\\]/, risk: 'critical' as const, reason: '递归删除根目录' },
  { pattern: /format\s+[a-zA-Z]:/, risk: 'critical' as const, reason: '格式化磁盘' },
  { pattern: /del\s+\/[sS]\s+\/[qQ]/, risk: 'high' as const, reason: '静默批量删除' },
  { pattern: /shutdown|reboot|restart/, risk: 'medium' as const, reason: '系统关机/重启' },
  { pattern: /curl.*\|\s*(bash|sh)/, risk: 'high' as const, reason: '远程脚本执行' },
  { pattern: /reg\s+(add|delete)/, risk: 'high' as const, reason: '注册表修改' },
]

/**
 * 审计终端命令
 *
 * @param command 待执行的命令
 * @param shell 使用的 shell (powershell/cmd/bash)
 * @returns 审计结果
 */
export function auditCommand(command: string, _shell: string = 'powershell'): AuditResult {
  const normalizedCmd = command.toLowerCase().trim()

  for (const rule of DANGEROUS_PATTERNS) {
    if (rule.pattern.test(normalizedCmd)) {
      return {
        allowed: false,
        risk: rule.risk,
        reason: rule.reason,
        matchedPattern: rule.pattern.source,
      }
    }
  }

  return {
    allowed: true,
    risk: 'safe',
    reason: '未匹配到危险模式',
  }
}

/**
 * 批量审计命令
 *
 * @param commands 命令列表
 * @returns 审计结果列表
 */
export function auditCommands(commands: string[]): AuditResult[] {
  return commands.map(cmd => auditCommand(cmd))
}
