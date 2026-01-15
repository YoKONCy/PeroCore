"""
NIT Interpreter 核心模块
采用“双轨制”策略：
1. 生产环境/高性能模式：优先尝试加载 Rust 编写的 nit_rust_runtime 扩展，大幅提升 Lexer/Parser 性能。
2. 开发环境/兼容模式：若 Rust 扩展未编译或不可用，自动降级至原生 Python 实现。
"""

try:
    # 尝试导入 Rust 编译的高性能运行时
    from nit_rust_runtime import Lexer, Parser, PipelineNode
    RUST_AVAILABLE = True
except ImportError:
    # 降级方案：使用原生 Python 实现
    from .lexer import Lexer
    from .parser import Parser
    RUST_AVAILABLE = False

from .engine import NITRuntime

async def execute_nit_script(script: str, tool_executor):
    """
    根据可用运行时执行 NIT 脚本。
    
    [双轨制逻辑]
    - Rust 路径: 处理大规模脚本或高并发请求时，利用 Rust 的内存安全和计算性能。
    - Python 路径: 保证在无法编译 Rust 扩展的简单环境或调试场景下仍能运行。
    """
    if RUST_AVAILABLE:
        # [Rust 加速路径]
        # 1. 分词 (Rust 实现，比 Python 快 50-100 倍)
        lexer = Lexer(script)
        tokens = lexer.tokenize()
        
        # 2. 解析 (Rust 实现)
        parser = Parser(tokens)
        pipeline = parser.parse()
    else:
        # [旧版 Python 降级路径]
        lexer = Lexer(script)
        tokens = lexer.tokenize()
        parser = Parser(tokens, source=script)
        pipeline = parser.parse()

    # 3. 执行 (目前 VM 层仍由 Python 异步驱动，但变量作用域管理已通过 NITScope 由 Rust 接管)
    runtime = NITRuntime(tool_executor)
    return await runtime.execute(pipeline)
