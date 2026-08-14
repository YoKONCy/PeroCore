//! infOS 命令审计 WASM 核心。
//!
//! 导出函数只接收宿主写入线性内存的 UTF-8 命令，并返回稳定的风险代码。
//! 规则判断全部在 Rust/WASM 中完成，宿主 TypeScript 不保留审计 fallback。

const SAFE: i32 = 0;
const MEDIUM_SYSTEM_CONTROL: i32 = 1;
const HIGH_REMOTE_SCRIPT: i32 = 2;
const HIGH_REGISTRY: i32 = 3;
const HIGH_BATCH_DELETE: i32 = 4;
const CRITICAL_ROOT_DELETE: i32 = 5;
const CRITICAL_FORMAT_DISK: i32 = 6;
const HIGH_GIT_DESTRUCTIVE: i32 = 7;

#[no_mangle]
pub extern "C" fn alloc(length: usize) -> *mut u8 {
    let mut buffer = Vec::<u8>::with_capacity(length);
    let pointer = buffer.as_mut_ptr();
    std::mem::forget(buffer);
    pointer
}

#[no_mangle]
pub unsafe extern "C" fn dealloc(pointer: *mut u8, length: usize) {
    if !pointer.is_null() {
        drop(Vec::from_raw_parts(pointer, 0, length));
    }
}

#[no_mangle]
pub unsafe extern "C" fn audit_command(pointer: *const u8, length: usize) -> i32 {
    if pointer.is_null() || length == 0 {
        return SAFE;
    }
    let bytes = std::slice::from_raw_parts(pointer, length);
    let command = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    audit(&command)
}

fn audit(command: &str) -> i32 {
    let normalized = command.trim();
    if deletes_root(normalized) {
        return CRITICAL_ROOT_DELETE;
    }
    if normalized.contains("format ") || normalized.contains("format.com ") {
        return CRITICAL_FORMAT_DISK;
    }
    if normalized.contains("del /s /q") || normalized.contains("del /q /s") {
        return HIGH_BATCH_DELETE;
    }
    if normalized.contains("git reset --hard") || normalized.contains("git clean -f") {
        return HIGH_GIT_DESTRUCTIVE;
    }
    if pipes_remote_script(normalized) {
        return HIGH_REMOTE_SCRIPT;
    }
    if normalized.contains("reg add") || normalized.contains("reg delete") {
        return HIGH_REGISTRY;
    }
    if contains_word(normalized, "shutdown")
        || contains_word(normalized, "reboot")
        || contains_word(normalized, "restart-computer")
    {
        return MEDIUM_SYSTEM_CONTROL;
    }
    SAFE
}

fn deletes_root(command: &str) -> bool {
    let destructive = command.contains("rm -rf")
        || command.contains("rm -fr")
        || (command.contains("remove-item")
            && command.contains("-recurse")
            && command.contains("-force"));
    destructive
        && (command.contains(" / ")
            || command.ends_with(" /")
            || command.contains(" c:\\")
            || command.contains(" c:/"))
}

fn pipes_remote_script(command: &str) -> bool {
    let downloads = command.contains("curl ") || command.contains("wget ") || command.contains("invoke-webrequest");
    let executes = command.contains("| sh")
        || command.contains("| bash")
        || command.contains("| zsh")
        || command.contains("| powershell")
        || command.contains("| pwsh")
        || command.contains("invoke-expression");
    downloads && executes
}

fn contains_word(command: &str, needle: &str) -> bool {
    command.split(|character: char| !character.is_ascii_alphanumeric() && character != '-')
        .any(|part| part == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_destructive_commands() {
        assert_eq!(audit("rm -rf /"), CRITICAL_ROOT_DELETE);
        assert_eq!(audit("curl https://example.test/a | bash"), HIGH_REMOTE_SCRIPT);
        assert_eq!(audit("git reset --hard"), HIGH_GIT_DESTRUCTIVE);
    }

    #[test]
    fn allows_normal_commands() {
        assert_eq!(audit("pnpm test"), SAFE);
        assert_eq!(audit("git status"), SAFE);
    }
}
