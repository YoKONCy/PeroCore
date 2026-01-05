import os
import json
import asyncio
from typing import Optional

# 定位二进制执行文件路径
CURRENT_SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SEARCH_ENGINE_BINARY = os.path.join(CURRENT_SCRIPT_DIR, "CodeSearcher.exe")

async def code_search(
    query_pattern: str,
    target_rel_path: Optional[str] = None,
    is_case_sensitive: bool = False,
    is_whole_word: bool = False,
    context_lines_count: int = 2
) -> str:
    """
    使用高性能 Rust 搜索引擎在项目中检索代码片段或关键字。
    
    参数:
        query_pattern (str): 搜索关键词、代码片段或正则表达式。
        target_rel_path (Optional[str]): 搜索的相对路径。默认为整个项目工作区。
        is_case_sensitive (bool): 是否大小写敏感。
        is_whole_word (bool): 是否仅匹配完整单词。
        context_lines_count (int): 匹配行前后的上下文行数。
        
    返回:
        str: 包含搜索结果或错误信息的 JSON 格式字符串。
    """
    
    # 检查核心引擎是否存在
    if not os.path.exists(SEARCH_ENGINE_BINARY):
        return json.dumps({
            "status": "error",
            "error": f"找不到搜索引擎核心组件: {SEARCH_ENGINE_BINARY}"
        })

    # 构造传递给 Rust 引擎的 JSON 参数
    engine_input_params = {
        "query": query_pattern,
        "search_path": target_rel_path,
        "case_sensitive": str(is_case_sensitive).lower(),
        "whole_word": str(is_whole_word).lower(),
        "context_lines": str(context_lines_count)
    }

    try:
        # 异步启动 Rust 引擎子进程
        search_process = await asyncio.create_subprocess_exec(
            SEARCH_ENGINE_BINARY,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        # 将参数编码为 JSON 并发送到 stdin
        encoded_input_json = json.dumps(engine_input_params).encode()
        
        try:
            # 运行引擎并设置超时，防止进程挂死
            stdout_data, stderr_data = await asyncio.wait_for(
                search_process.communicate(input=encoded_input_json), 
                timeout=30.0
            )
        except asyncio.TimeoutError:
            try:
                search_process.kill()
            except Exception:
                pass
            return json.dumps({
                "status": "error",
                "error": "代码搜索任务执行超时（超过 30 秒）。"
            })

        if search_process.returncode != 0:
            error_details = stderr_data.decode().strip()
            return json.dumps({
                "status": "error",
                "error": f"搜索引擎内部错误 (代码 {search_process.returncode}): {error_details}"
            })

        # 直接返回引擎输出的 JSON 结果
        engine_output_str = stdout_data.decode().strip()
        if not engine_output_str:
             return json.dumps({
                "status": "error",
                "error": "搜索引擎返回了空结果。"
            })
            
        return engine_output_str

    except Exception as exc:
        return json.dumps({
            "status": "error",
            "error": f"执行代码搜索时发生意外异常: {str(exc)}"
        })

if __name__ == "__main__":
    # 调试测试块
    async def run_debug_test():
        print("正在初始化代码搜索测试...")
        # 在当前目录下搜索 "code_search"
        test_result = await code_search(query_pattern="code_search", target_rel_path=".", context_lines_count=1)
        print(f"搜索测试完成。结果:\n{test_result}")

    asyncio.run(run_debug_test())
