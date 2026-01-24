import os
import fitz  # PyMuPDF
import docx
import json
import ast
import logging
from pathlib import Path
from utils.workspace_utils import get_workspace_root

# 定义工作空间根目录，强制隔离所有文件操作
# backend/nit_core/tools/work/FileOps/file_ops.py -> PeroCore/pero_workspace
# [Refactor] Use dynamic workspace root
# BASE_DIR = ...
# WORKSPACE_ROOT = ...

logger = logging.getLogger(__name__)

def _get_safe_path(input_path: str) -> str:
    """
    校验路径是否逃逸出工作空间。
    如果 input_path 是绝对路径，则检查其是否在 WORKSPACE_ROOT 内。
    如果 input_path 是相对路径，则将其拼接到 WORKSPACE_ROOT 后并校验。
    """
    # 获取当前 Active Agent 的工作空间
    workspace_root = get_workspace_root()
    
    # 确保根目录存在
    if not os.path.exists(workspace_root):
        os.makedirs(workspace_root, exist_ok=True)
        
    # 处理可能的空输入或当前目录表示
    if not input_path or input_path.strip() in [".", "./"]:
        return workspace_root

    # 统一解析为绝对路径
    if os.path.isabs(input_path):
        target_path = os.path.abspath(input_path)
    else:
        target_path = os.path.abspath(os.path.join(workspace_root, input_path))
    
    # 路径逃逸校验：目标路径必须以工作空间根路径开头
    if not target_path.startswith(workspace_root):
        raise PermissionError(f"Access Denied: Path traversal detected. Target: {target_path} is outside of {workspace_root}")
    
    return target_path

def validate_code(file_path: str, content: str) -> list:
    """
    Simple Code Validator.
    Currently supports Python syntax checking via ast.
    Returns a list of error messages.
    """
    errors = []
    ext = os.path.splitext(file_path)[1].lower()
    
    if ext == '.py':
        try:
            ast.parse(content)
        except SyntaxError as e:
            errors.append(f"Line {e.lineno}, Col {e.offset}: {e.msg}")
        except Exception as e:
            errors.append(f"AST Parse Error: {str(e)}")
            
    # Future: Add checks for JS/TS/CSS if needed, potentially calling external tools if available.
    
    return errors

import re

def apply_diff_logic(original_content: str, diff_content: str) -> str:
    """
    Applies a diff block to the original content.
    Supports two formats:
    1. Standard (7 chars): <<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE
    2. Clean (4 chars):    <<<< SEARCH ... ==== ... >>>> REPLACE
    
    Features:
    - Wildcard '...' in SEARCH block matches any content (non-greedy).
    - Whitespace normalization (ignores \\r).
    """
    # 1. Normalize Newlines in Original
    # We work with \n internally for consistent matching
    original_normalized = original_content.replace('\r\n', '\n')
    
    # 2. Parse Diff Content
    start_marker_7 = '<<<<<<< SEARCH'
    start_marker_4 = '<<<< SEARCH'
    
    if start_marker_7 in diff_content:
        start_marker = start_marker_7
        mid_marker = '======='
        end_marker = '>>>>>>> REPLACE'
    elif start_marker_4 in diff_content:
        start_marker = start_marker_4
        mid_marker = '===='
        end_marker = '>>>> REPLACE'
    else:
        raise ValueError("Invalid diff format: No SEARCH blocks found (checked <<<<<<< SEARCH and <<<< SEARCH).")

    # Extract Block
    try:
        # split by start_marker, take the second part (first block)
        block = diff_content.split(start_marker, 1)[1]
        
        if mid_marker not in block:
            raise ValueError(f"Invalid diff format: Missing {mid_marker} separator.")
            
        parts = block.split(mid_marker)
        search_part = parts[0]
        
        if end_marker not in parts[1]:
             raise ValueError(f"Invalid diff format: Missing {end_marker} separator.")
             
        replace_part = parts[1].split(end_marker)[0]
    except IndexError:
        raise ValueError("Invalid diff format: Structure parsing failed.")

    # 3. Process Search Content
    # Support legacy '-------' separator
    if '-------' in search_part:
        search_content = search_part.split('-------', 1)[1]
    else:
        search_content = search_part

    # Trim empty lines from start/end of search content to avoid strict whitespace issues
    search_content = search_content.strip('\n') 
    replace_content = replace_part.strip('\n')
    
    # Normalize search content newlines
    search_content = search_content.replace('\r\n', '\n')
    
    # 4. Construct Regex for Matching
    # Escape special characters
    search_pattern = re.escape(search_content)
    
    # Replace escaped '...' with non-greedy wildcard
    # re.escape might produce '\.\.\.' or '...' depending on version
    search_pattern = search_pattern.replace(r'\.\.\.', r'[\s\S]*?')
    search_pattern = search_pattern.replace('...', r'[\s\S]*?')

    # 5. Find and Replace
    # Use re.search to find the span
    match = re.search(search_pattern, original_normalized)
    
    if match:
        start, end = match.span()
        # Use slicing to replace, safer than re.sub for literal replacement string
        modified_content = original_normalized[:start] + replace_content + original_normalized[end:]
        return modified_content
    else:
        # Fallback: if no wildcard was used, maybe try exact string match just in case regex failed? 
        # But regex should cover exact match.
        # Let's raise error with debug info.
        raise ValueError(f"Diff application failed: SEARCH content not found.\nSearch Pattern: {search_pattern[:200]}...")

async def read_file_content(file_path: str, **kwargs) -> str:
    """
    Read content from a file, supporting TXT, MD, PDF, DOCX. (Sandboxed)
    """
    try:
        safe_path = _get_safe_path(file_path)
        
        if not os.path.exists(safe_path):
            return f"Error: File not found at {file_path}"
        
        if os.path.isdir(safe_path):
            return f"Error: '{file_path}' is a directory, use list_directory instead."
            
        _, ext = os.path.splitext(safe_path)
        ext = ext.lower()
        
        if ext == '.pdf':
            doc = fitz.open(safe_path)
            text = ""
            for page in doc:
                text += page.get_text() + "\n"
            return text
            
        elif ext in ['.docx', '.doc']:
            doc = docx.Document(safe_path)
            text = "\n".join([para.text for para in doc.paragraphs])
            return text
            
        else:
            # Assume text file
            with open(safe_path, 'r', encoding='utf-8', errors='ignore') as f:
                return f.read()
                
    except PermissionError as pe:
        return str(pe)
    except Exception as e:
        return f"Error reading file: {str(e)}"

async def list_directory(path: str = ".", **kwargs) -> str:
    """
    List files in a directory. (Sandboxed)
    """
    try:
        safe_path = _get_safe_path(path)
        
        if not os.path.exists(safe_path):
            return "Error: Directory not found."
        if not os.path.isdir(safe_path):
            return "Error: Path is not a directory."
            
        items = os.listdir(safe_path)
        return json.dumps(items, indent=2)
    except PermissionError as pe:
        return str(pe)
    except Exception as e:
        return f"Error listing directory: {str(e)}"

async def write_file(file_path: str, content: str, **kwargs) -> str:
    """
    Write content to a file. (Sandboxed & Validated)
    """
    try:
        safe_path = _get_safe_path(file_path)
        
        # 1. Validate Code
        errors = validate_code(safe_path, content)
        validation_msg = ""
        if errors:
            validation_msg = "\n\n[Warning] Code Validation Issues:\n" + "\n".join(errors)
            # We don't block writing, but we warn the user.
        
        # 2. Write File
        with open(safe_path, 'w', encoding='utf-8') as f:
            f.write(content)
            
        return f"File written successfully to {file_path}.{validation_msg}"
        
    except PermissionError as pe:
        return str(pe)
    except Exception as e:
        return f"Error writing file: {str(e)}"

async def apply_diff(file_path: str, diff_content: str, **kwargs) -> str:
    """
    Apply a smart diff to a file.
    """
    try:
        safe_path = _get_safe_path(file_path)
        
        if not os.path.exists(safe_path):
            return f"Error: File not found at {file_path}"
            
        # 1. Read Original
        with open(safe_path, 'r', encoding='utf-8') as f:
            original_content = f.read()
            
        # 2. Apply Diff
        try:
            new_content = apply_diff_logic(original_content, diff_content)
        except ValueError as ve:
            return f"Diff Error: {str(ve)}"
            
        # 3. Validate New Code
        errors = validate_code(safe_path, new_content)
        validation_msg = ""
        if errors:
            validation_msg = "\n\n[Warning] Code Validation Issues:\n" + "\n".join(errors)
            
        # 4. Write Back
        with open(safe_path, 'w', encoding='utf-8') as f:
            f.write(new_content)
            
        return f"Diff applied successfully to {file_path}.{validation_msg}"
        
    except PermissionError as pe:
        return str(pe)
    except Exception as e:
        return f"Error applying diff: {str(e)}"
