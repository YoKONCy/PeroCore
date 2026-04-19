export interface AuditResult {
  allowed: boolean
  risk: 'safe' | 'low' | 'medium' | 'high' | 'critical'
  reason: string
  matchedPattern?: string
}

export declare function auditCommand(command: string, shell?: string): AuditResult

export declare function auditCommands(commands: string[]): AuditResult[]
