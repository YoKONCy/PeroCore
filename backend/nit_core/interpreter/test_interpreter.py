import unittest
import asyncio
from .lexer import Lexer
from .parser import Parser
from .engine import NITRuntime
from .errors import NITLexerError, NITParserError

class TestNITInterpreter(unittest.TestCase):
    def test_lexer_error_position(self):
        source = "$var = 123 @ invalid"
        lexer = Lexer(source)
        with self.assertRaises(NITLexerError) as cm:
            lexer.tokenize()
        
        err = cm.exception
        self.assertEqual(err.line, 1)
        self.assertEqual(err.column, 12)
        self.assertIn("^--- 这里可能有错", str(err))

    def test_parser_error_position(self):
        source = "$var = tool_call(arg1='val'" # Missing RPAREN
        lexer = Lexer(source)
        tokens = lexer.tokenize()
        parser = Parser(tokens, source)
        
        with self.assertRaises(NITParserError) as cm:
            parser.parse()
            
        err = cm.exception
        # The error should be at the end of tokens (EOF)
        self.assertIn("Expected TokenType.RPAREN", str(err))
        self.assertIn("^--- 这里可能有错", str(err))

    def test_runtime_simple_execution(self):
        source = "$result = add(a=1, b=2)"
        
        async def mock_executor(name, args):
            if name == "add":
                return args['a'] + args['b']
            return None

        lexer = Lexer(source)
        tokens = lexer.tokenize()
        parser = Parser(tokens, source)
        pipeline = parser.parse()
        
        runtime = NITRuntime(mock_executor)
        
        loop = asyncio.get_event_loop()
        result = loop.run_until_complete(runtime.execute(pipeline))
        
        self.assertEqual(result, 3)
        self.assertEqual(runtime.variables['result'], 3)

if __name__ == '__main__':
    unittest.main()
