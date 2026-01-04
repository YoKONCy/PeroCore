import os
import json
import subprocess
import asyncio
from typing import Optional, List, Dict, Any

# Get the directory where this script is located
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
CODE_SEARCHER_EXE = os.path.join(TOOLS_DIR, "CodeSearcher.exe")

async def code_search(
    query: str,
    search_path: Optional[str] = None,
    case_sensitive: bool = False,
    whole_word: bool = False,
    context_lines: int = 2
) -> str:
    """
    Search for code snippets or keywords in the project using the high-performance CodeSearcher tool.
    
    Args:
        query (str): The keyword, code snippet, or regex pattern to search for.
        search_path (Optional[str]): Relative path to search within. Defaults to the entire project workspace if omitted.
        case_sensitive (bool): Whether the search should be case-sensitive. Defaults to False.
        whole_word (bool): Whether to match whole words only. Defaults to False.
        context_lines (int): Number of context lines to show before and after the match. Defaults to 2.
        
    Returns:
        str: A JSON-formatted string containing the search results, or an error message.
    """
    
    # Check if the executable exists
    if not os.path.exists(CODE_SEARCHER_EXE):
        return json.dumps({
            "status": "error",
            "error": "CodeSearcher.exe not found in tools directory."
        })

    # Prepare input arguments for CodeSearcher
    input_args = {
        "query": query,
        "search_path": search_path,
        "case_sensitive": str(case_sensitive).lower(), # CodeSearcher expects string "true"/"false"
        "whole_word": str(whole_word).lower(),
        "context_lines": str(context_lines)
    }

    try:
        # Run CodeSearcher as a subprocess
        # We use asyncio.create_subprocess_exec to run it asynchronously
        process = await asyncio.create_subprocess_exec(
            CODE_SEARCHER_EXE,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )

        # Send input arguments as JSON to stdin
        input_json = json.dumps(input_args)
        
        try:
            # [Fix] Add timeout to prevent hanging processes
            stdout, stderr = await asyncio.wait_for(
                process.communicate(input=input_json.encode()), 
                timeout=30.0
            )
        except asyncio.TimeoutError:
            try:
                process.kill()
            except:
                pass
            return json.dumps({
                "status": "error",
                "error": "CodeSearcher execution timed out after 30s."
            })

        if process.returncode != 0:
            return json.dumps({
                "status": "error",
                "error": f"CodeSearcher process failed with code {process.returncode}: {stderr.decode()}"
            })

        # Return the stdout directly (it should be already JSON formatted by CodeSearcher)
        output = stdout.decode().strip()
        if not output:
             return json.dumps({
                "status": "error",
                "error": "CodeSearcher returned empty output."
            })
            
        return output

    except Exception as e:
        return json.dumps({
            "status": "error",
            "error": f"Failed to execute CodeSearcher: {str(e)}"
        })

if __name__ == "__main__":
    # Test block
    async def test():
        print("Testing CodeSearcher...")
        # Search for "code_search" in the current directory (tools)
        result = await code_search(query="code_search", search_path=".", context_lines=1)
        print(f"Result: {result}")

    asyncio.run(test())
