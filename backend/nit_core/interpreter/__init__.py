from .lexer import Lexer
from .parser import Parser
from .runtime import NITRuntime

async def execute_nit_script(script: str, tool_executor):
    lexer = Lexer(script)
    tokens = lexer.tokenize()
    parser = Parser(tokens)
    pipeline = parser.parse()
    runtime = NITRuntime(tool_executor)
    return await runtime.execute(pipeline)
