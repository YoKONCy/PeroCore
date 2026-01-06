from typing import Optional

class NITError(Exception):
    """Base class for NIT interpreter errors."""
    def __init__(self, message: str, line: int, column: int, source: Optional[str] = None):
        self.message = message
        self.line = line
        self.column = column
        self.source = source
        super().__init__(self.format_error())

    def format_error(self) -> str:
        error_msg = f"NIT Error at line {self.line}, col {self.column}: {self.message}\n"
        if self.source:
            lines = self.source.split('\n')
            if 0 < self.line <= len(lines):
                target_line = lines[self.line - 1]
                error_msg += f"  {self.line} | {target_line}\n"
                error_msg += " " * (len(str(self.line)) + 3 + self.column) + "^--- 这里可能有错"
        return error_msg

class NITLexerError(NITError):
    """Errors during lexical analysis."""
    pass

class NITParserError(NITError):
    """Errors during parsing."""
    pass

class NITRuntimeError(NITError):
    """Errors during execution."""
    pass
