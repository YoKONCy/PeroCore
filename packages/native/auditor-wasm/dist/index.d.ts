/** 审计结果。 */
export interface AuditResult {
    allowed: boolean;
    risk: 'safe' | 'low' | 'medium' | 'high' | 'critical';
    reason: string;
    matchedPattern?: string;
    engine: 'rust-wasm' | 'unavailable';
}
/** 审计终端命令。WASM 不可用时 fail-closed，绝不静默回退到较弱的 TS 规则。 */
export declare function auditCommand(command: string, _shell?: string): AuditResult;
export declare function auditCommands(commands: string[]): AuditResult[];
export declare function getAuditorEngine(): 'rust-wasm' | 'unavailable';
//# sourceMappingURL=index.d.ts.map