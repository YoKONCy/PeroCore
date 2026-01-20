
// use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use regex::Regex;
use lazy_static::lazy_static;

// 定义风险等级
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
pub enum RiskLevel {
    Safe = 0,    // Level 0: 纯读取，无副作用
    Notice = 1,  // Level 1: 常规操作，轻微副作用
    Warn = 2,    // Level 2: 破坏性操作、网络、脚本
    Block = 3,   // Level 3: 恶意操作，直接拦截
}

// 审计结果结构体
#[derive(Serialize, Deserialize, Debug)]
pub struct AuditResult {
    pub level: RiskLevel,
    pub reason: String,
    pub highlight: Option<String>, // 需要高亮显示的危险部分
}

// 预编译正则规则
lazy_static! {
    // 危险动词 (Level 2/3)
    static ref DANGEROUS_VERBS: Regex = Regex::new(r"(?i)^(rm|del|format|rmdir|rd|curl|wget|python|node|powershell|cmd|sh|bash)$").unwrap();

    // 包管理器 (Level 2)
    static ref PACKAGE_MANAGERS: Regex = Regex::new(r"(?i)^(npm|pip|cargo|yarn|pnpm|gem|go)$").unwrap();
    
    // 敏感路径 (Level 3)
    static ref SENSITIVE_PATHS: Regex = Regex::new(r"(?i)(windows|system32|/etc/|/var/|/root/|\.\./)").unwrap();
    
    // 网络操作 (Level 2)
    static ref NET_VERBS: Regex = Regex::new(r"(?i)^(ping|net|ipconfig|ifconfig|ssh|scp|ftp)$").unwrap();
    
    // 纯读取操作 (Level 0)
    static ref SAFE_VERBS: Regex = Regex::new(r"(?i)^(ls|dir|echo|cat|type|git|pwd|whoami|date|time)$").unwrap();
}

// #[wasm_bindgen]
// pub fn audit_command(command: &str) -> String {
//     let result = internal_audit(command);
//     serde_json::to_string(&result).unwrap_or_else(|_| r#"{"level":3,"reason":"JSON Serialization Error","highlight":null}"#.to_string())
// }

// --- C ABI for Python Wasmtime ---

use std::mem;

#[no_mangle]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    mem::forget(buf);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    let _ = Vec::from_raw_parts(ptr, len, len);
}

// Global buffer to hold the result so the pointer remains valid until next call
static mut LAST_RESULT: Option<Vec<u8>> = None;

#[no_mangle]
pub extern "C" fn audit_command_abi(ptr: *const u8, len: usize) -> u64 {
    let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
    let command = String::from_utf8_lossy(slice);
    
    let result = internal_audit(&command);
    let json = serde_json::to_string(&result).unwrap_or_else(|_| r#"{"level":3,"reason":"JSON Serialization Error","highlight":null}"#.to_string());
    
    let mut json_bytes = json.into_bytes();
    let res_ptr = json_bytes.as_mut_ptr();
    let res_len = json_bytes.len();
    
    unsafe {
        LAST_RESULT = Some(json_bytes);
    }
    
    // Return packed: [Len (32) | Ptr (32)]
    // Note: wasm32 pointers are u32.
    ((res_len as u64) << 32) | (res_ptr as u64)
}

fn internal_audit(command: &str) -> AuditResult {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return AuditResult {
            level: RiskLevel::Safe,
            reason: "空指令".to_string(),
            highlight: None,
        };
    }

    // 1. 尝试使用 shlex 解析指令结构
    // 注意：Windows cmd 和 PowerShell 的解析规则与 POSIX sh 不同，
    // 但 shlex 至少能帮我们分理出第一个 "动词" 和后续参数。
    let parts = match shlex::split(trimmed) {
        Some(p) => p,
        None => {
            // 解析失败，可能是复杂的引号不匹配，直接标记为 Warn
            return AuditResult {
                level: RiskLevel::Warn,
                reason: "指令语法解析失败，可能包含复杂的引号或特殊字符".to_string(),
                highlight: Some(trimmed.to_string()),
            };
        }
    };

    if parts.is_empty() {
        return AuditResult {
            level: RiskLevel::Safe,
            reason: "空指令".to_string(),
            highlight: None,
        };
    }

    let verb = &parts[0];
    let args = &parts[1..];
    let full_args = args.join(" ");

    // 2. 检查 Level 3: 绝对黑名单与敏感路径
    if SENSITIVE_PATHS.is_match(&full_args) {
        return AuditResult {
            level: RiskLevel::Block,
            reason: "检测到对系统敏感目录或越权路径的访问".to_string(),
            highlight: Some(full_args), // 高亮参数部分
        };
    }

    // 格式化操作 (Level 3)
    if verb == "format" {
        return AuditResult {
            level: RiskLevel::Block,
            reason: "检测到高危格式化操作，已被拦截".to_string(),
            highlight: Some(command.to_string()),
        };
    }

    // 特殊检查: rm -rf / 或 rm -rf . (当前目录递归删除也很危险)
    if (verb == "rm" || verb == "del") && 
       ((full_args.contains("-rf") || full_args.contains("-fr") || full_args.contains("/s")) && 
       (full_args.contains("/") || full_args.contains("*") || full_args.contains("."))) {
         return AuditResult {
            level: RiskLevel::Block,
            reason: "检测到极高风险的递归删除操作".to_string(),
            highlight: Some(command.to_string()),
        };
    }

    // 3. 检查 Level 2: 危险动词与元执行器
    if DANGEROUS_VERBS.is_match(verb) {
        // 如果是 rm/del，但在项目目录下，属于 Level 2
        // 如果是 python/node，属于 Level 2
        return AuditResult {
            level: RiskLevel::Warn,
            reason: format!("检测到高风险操作命令: {}", verb),
            highlight: Some(verb.to_string()),
        };
    }
    
    if NET_VERBS.is_match(verb) {
         return AuditResult {
            level: RiskLevel::Warn,
            reason: format!("检测到网络相关操作: {}", verb),
            highlight: Some(verb.to_string()),
        };
    }

    if PACKAGE_MANAGERS.is_match(verb) {
        return AuditResult {
           level: RiskLevel::Warn,
           reason: format!("检测到包管理操作: {}", verb),
           highlight: Some(verb.to_string()),
       };
   }

    // 4. 检查 Level 0: 白名单
    if SAFE_VERBS.is_match(verb) {
        // git commit 虽然是写操作，但在开发场景下通常视为 Safe 或 Notice
        // 这里我们可以稍微放宽，或者进一步细分
        return AuditResult {
            level: RiskLevel::Safe,
            reason: "安全的基础指令".to_string(),
            highlight: None,
        };
    }

    // 5. 默认 Level 1: 未知指令 (通常是项目特定的工具或脚本)
    AuditResult {
        level: RiskLevel::Notice,
        reason: "常规操作指令".to_string(),
        highlight: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_safe_commands() {
        let res = internal_audit("ls -la");
        assert_eq!(res.level, RiskLevel::Safe);
        
        let res = internal_audit("echo 'hello world'");
        assert_eq!(res.level, RiskLevel::Safe);
    }

    #[test]
    fn test_warn_commands() {
        let res = internal_audit("python script.py");
        assert_eq!(res.level, RiskLevel::Warn);
        assert_eq!(res.reason, "检测到高风险操作命令: python");
        
        let res = internal_audit("rm temp.txt");
        assert_eq!(res.level, RiskLevel::Warn);
    }

    #[test]
    fn test_block_commands() {
        let res = internal_audit("cat /etc/passwd"); // 包含敏感路径
        assert_eq!(res.level, RiskLevel::Block);
        
        let res = internal_audit("rm -rf /"); // 递归删除根
        assert_eq!(res.level, RiskLevel::Block);
    }
    
    #[test]
    fn test_path_traversal() {
        let res = internal_audit("cat ../../secret.txt");
        assert_eq!(res.level, RiskLevel::Block);
    }
}
