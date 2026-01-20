import asyncio
import subprocess
import os
import json
import logging
from wasmtime import Store, Module, Instance, Engine, Linker, WasmtimeError
from services.realtime_session_manager import realtime_session_manager

logger = logging.getLogger(__name__)

# Wasm Auditor Path
WASM_PATH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "auditor.wasm"
)

# Wasm Engine (Singleton to avoid overhead)
_wasm_engine = None
_wasm_module = None

def _get_wasm_module():
    global _wasm_engine, _wasm_module
    if _wasm_module is None:
        try:
            logger.info(f"Loading Wasm Auditor from: {WASM_PATH}")
            _wasm_engine = Engine()
            _wasm_module = Module.from_file(_wasm_engine, WASM_PATH)
        except Exception as e:
            logger.error(f"Failed to load Wasm module: {e}")
            return None
    return _wasm_module

def audit_command_via_wasm(command: str) -> dict:
    """
    Call Rust Wasm to audit the command.
    Returns: {"level": int, "reason": str, "highlight": str|None}
    """
    module = _get_wasm_module()
    if not module:
        return {"level": 1, "reason": "Wasm加载失败，降级为常规操作", "highlight": None}

    try:
        store = Store(_wasm_engine)
        linker = Linker(_wasm_engine)
        instance = linker.instantiate(store, module)
        exports = instance.exports(store)
        
        memory = exports["memory"]
        alloc = exports["alloc"]
        # dealloc = exports["dealloc"] # Optional cleanup
        audit_abi = exports["audit_command_abi"]
        
        # 1. Encode command
        cmd_bytes = command.encode('utf-8')
        cmd_len = len(cmd_bytes)
        
        # 2. Allocate memory in Wasm
        ptr = alloc(store, cmd_len)
        
        # 3. Write to memory
        # Note: wasmtime memory.write signature might vary by version. 
        # Attempting standard (store, data, offset) order for recent versions.
        try:
            memory.write(store, cmd_bytes, ptr)
        except Exception:
            # Fallback for other versions or if signature is (store, offset, data)
            memory.write(store, ptr, cmd_bytes)
        
        # 4. Call Audit (returns packed len|ptr)
        packed_res = audit_abi(store, ptr, cmd_len)
        
        res_ptr = packed_res & 0xFFFFFFFF
        res_len = (packed_res >> 32) & 0xFFFFFFFF
        
        # 5. Read result
        json_bytes = memory.read(store, res_ptr, res_ptr + res_len)
        json_str = bytes(json_bytes).decode('utf-8')
        
        result = json.loads(json_str)
        
        # Convert level string to int if necessary (Wasm returns enum as string by default)
        if isinstance(result.get("level"), str):
            level_map = {
                "Safe": 0,
                "Notice": 1,
                "Warn": 2,
                "Block": 3
            }
            result["level"] = level_map.get(result["level"], 1) # Default to Notice (1) if unknown

        return result
        
    except Exception as e:
        logger.error(f"Wasm execution error: {e}")
        return {"level": 2, "reason": f"Wasm执行异常: {e}", "highlight": None}


async def execute_terminal_command(command: str, cwd: str = None) -> str:
    """
    在终端中执行指令 (PowerShell)。
    此操作会阻塞，直到用户在前端确认或拒绝。
    """
    if not command:
        return "错误: 指令内容不能为空。"

    # 0. Wasm 安全审计
    audit_result = audit_command_via_wasm(command)
    
    risk_level = audit_result.get("level", 1)
    reason = audit_result.get("reason", "常规操作")
    highlight = audit_result.get("highlight", None)
    
    # Python Fallback for safety (Double Check)
    lower_cmd = command.lower()
    if risk_level < 3:
        FORBIDDEN = ["rm -rf /", "format c:", "rd /s /q c:\\"]
        for f in FORBIDDEN:
            if f in lower_cmd:
                risk_level = 3
                reason = "检测到极高风险操作 (Python Double-Check)"
                break

    # 1. 向前端请求确认
    risk_info = {
        "level": risk_level,
        "reason": reason,
        "highlight": highlight
    }
    
    logger.info(f"Requesting user confirmation for command: {command} (Risk Level: {risk_level})")
    
    approved = await realtime_session_manager.request_user_confirmation(command, risk_info=risk_info)
    
    if not approved:
        logger.info(f"User denied command execution: {command}")
        return "执行已取消: 用户拒绝了该指令的执行请求。"

    # 2. 用户同意，执行指令
    logger.info(f"User approved command. Executing: {command}")
    
    # 构造 PowerShell 命令，强制 UTF-8 编码
    # 使用 -Command 包装，并预置 OutputEncoding
    ps_command = f"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; {command}"
    
    try:
        # 使用 asyncio.create_subprocess_exec 调用 PowerShell
        # 注意: 不使用 shell=True，而是直接调用 powershell.exe
        process = await asyncio.create_subprocess_exec(
            "powershell.exe",
            "-NoProfile", 
            "-NonInteractive",
            "-Command",
            ps_command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=cwd,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
        )
        
        # 3. 通知前端：指令正在执行中，允许用户跳过
        await realtime_session_manager.broadcast({
            "type": "command_running",
            "command": command,
            "pid": process.pid
        })
        
        # [New] Broadcast Terminal Init for Terminal Manager
        await realtime_session_manager.broadcast({
            "type": "terminal_init",
            "pid": process.pid,
            "command": command
        })

        # Output Buffers
        stdout_buffer = []
        stderr_buffer = []

        async def read_stream(stream, buffer, stream_name):
            while True:
                line = await stream.readline()
                if not line:
                    break
                decoded_line = line.decode('utf-8', errors='replace')
                buffer.append(decoded_line)
                # Broadcast real-time output
                await realtime_session_manager.broadcast({
                    "type": "terminal_output",
                    "pid": process.pid,
                    "stream": stream_name,
                    "content": decoded_line
                })

        # Start stream readers
        stdout_reader = asyncio.create_task(read_stream(process.stdout, stdout_buffer, "stdout"))
        stderr_reader = asyncio.create_task(read_stream(process.stderr, stderr_buffer, "stderr"))

        # 4. 等待执行完成 (支持跳过)
        skip_event = asyncio.Event()
        realtime_session_manager.register_skippable_command(process.pid, skip_event)
        
        try:
            # Wait for process to exit
            wait_task = asyncio.create_task(process.wait())
            skip_task = asyncio.create_task(skip_event.wait())
            
            done, pending = await asyncio.wait(
                [wait_task, skip_task], 
                return_when=asyncio.FIRST_COMPLETED
            )
            
            if skip_task in done:
                logger.info(f"User skipped waiting for command {command} (PID {process.pid})")
                
                # Ensure readers and process wait continue in background
                async def background_monitor():
                    try:
                        await wait_task
                        await asyncio.gather(stdout_reader, stderr_reader)
                        logger.info(f"Background command {process.pid} finished. Exit code: {process.returncode}")
                        # Broadcast exit for Terminal Manager
                        await realtime_session_manager.broadcast({
                            "type": "terminal_exit",
                            "pid": process.pid,
                            "exit_code": process.returncode
                        })
                    except Exception as e:
                        logger.error(f"Background command {process.pid} error: {e}")

                # Fire and forget background monitor
                asyncio.create_task(background_monitor())
                
                return "指令正在后台运行 (用户已选择跳过等待，实时输出请查看终端管理器)。"
            
            else:
                skip_task.cancel()
                # Wait for readers to finish consuming remaining output
                await asyncio.gather(stdout_reader, stderr_reader)
                
                output = "".join(stdout_buffer).strip()
                error = "".join(stderr_buffer).strip()
                
                result_parts = []
                if output:
                    result_parts.append(f"[STDOUT]\n{output}")
                if error:
                    result_parts.append(f"[STDERR]\n{error}")
                    
                final_output = "\n\n".join(result_parts)
                
                # Broadcast exit for Terminal Manager
                await realtime_session_manager.broadcast({
                    "type": "terminal_exit",
                    "pid": process.pid,
                    "exit_code": process.returncode
                })

                if process.returncode != 0:
                    return f"执行失败 (Exit Code {process.returncode}):\n{final_output}"
                    
                return final_output if final_output else "指令执行成功 (无输出)。"

        finally:
            realtime_session_manager.unregister_skippable_command(process.pid)
            await realtime_session_manager.broadcast({
                "type": "command_finished",
                "command": command,
                "exit_code": process.returncode if process.returncode is not None else "skipped"
            })

    except Exception as e:
        logger.error(f"Command execution failed: {e}")
        return f"执行出错: {str(e)}"
