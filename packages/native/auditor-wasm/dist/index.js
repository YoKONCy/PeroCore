import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const RESULT_MAP = {
    0: { allowed: true, risk: 'safe', reason: 'Rust/WASM 审计未发现危险模式' },
    1: {
        allowed: false,
        risk: 'medium',
        reason: '检测到系统关机或重启操作',
        matchedPattern: 'system-control',
    },
    2: {
        allowed: false,
        risk: 'high',
        reason: '检测到远程脚本下载后直接执行',
        matchedPattern: 'remote-script-pipe',
    },
    3: { allowed: false, risk: 'high', reason: '检测到注册表修改', matchedPattern: 'registry-write' },
    4: { allowed: false, risk: 'high', reason: '检测到静默批量删除', matchedPattern: 'batch-delete' },
    5: {
        allowed: false,
        risk: 'critical',
        reason: '检测到递归删除根目录',
        matchedPattern: 'root-delete',
    },
    6: {
        allowed: false,
        risk: 'critical',
        reason: '检测到磁盘格式化',
        matchedPattern: 'format-disk',
    },
    7: {
        allowed: false,
        risk: 'high',
        reason: '检测到破坏性 Git 操作',
        matchedPattern: 'git-destructive',
    },
};
let exportsCache;
/** 审计终端命令。WASM 不可用时 fail-closed，绝不静默回退到较弱的 TS 规则。 */
export function auditCommand(command, _shell = 'powershell') {
    const exports = loadAuditor();
    if (!exports) {
        return {
            allowed: false,
            risk: 'critical',
            reason: 'Rust/WASM 审计模块不可用，为安全起见必须人工审批',
            matchedPattern: 'auditor-unavailable',
            engine: 'unavailable',
        };
    }
    const bytes = new TextEncoder().encode(command);
    const pointer = exports.alloc(bytes.length);
    try {
        new Uint8Array(exports.memory.buffer, pointer, bytes.length).set(bytes);
        const code = exports.audit_command(pointer, bytes.length);
        const result = RESULT_MAP[code] ?? {
            allowed: false,
            risk: 'critical',
            reason: `Rust/WASM 审计返回未知结果代码 ${code}`,
            matchedPattern: 'unknown-result',
        };
        return { ...result, engine: 'rust-wasm' };
    }
    finally {
        exports.dealloc(pointer, bytes.length);
    }
}
export function auditCommands(commands) {
    return commands.map((command) => auditCommand(command));
}
export function getAuditorEngine() {
    return loadAuditor() ? 'rust-wasm' : 'unavailable';
}
function loadAuditor() {
    if (exportsCache !== undefined)
        return exportsCache;
    const packageDir = dirname(fileURLToPath(import.meta.url));
    const wasmPath = join(packageDir, 'dist', 'auditor.wasm');
    if (!existsSync(wasmPath)) {
        exportsCache = null;
        return null;
    }
    try {
        const module = new WebAssembly.Module(readFileSync(wasmPath));
        const instance = new WebAssembly.Instance(module, {});
        exportsCache = instance.exports;
        return exportsCache;
    }
    catch {
        exportsCache = null;
        return null;
    }
}
//# sourceMappingURL=index.js.map