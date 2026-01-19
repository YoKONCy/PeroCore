import os
import fitz  # PyMuPDF
import docx
import json
from pathlib import Path

# 定义工作空间根目录，强制隔离所有文件操作
# backend/nit_core/tools/work/FileOps/file_ops.py -> PeroCore/pero_workspace
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
WORKSPACE_ROOT = os.path.join(BASE_DIR, "pero_workspace")

def _get_safe_path(input_path: str) -> str:
    """
    校验路径是否逃逸出工作空间。
    如果 input_path 是绝对路径，则检查其是否在 WORKSPACE_ROOT 内。
    如果 input_path 是相对路径，则将其拼接到 WORKSPACE_ROOT 后并校验。
    """
    # 确保根目录存在
    if not os.path.exists(WORKSPACE_ROOT):
        os.makedirs(WORKSPACE_ROOT, exist_ok=True)
        
    # 处理可能的空输入或当前目录表示
    if not input_path or input_path.strip() in [".", "./"]:
        return WORKSPACE_ROOT

    # 统一解析为绝对路径
    if os.path.isabs(input_path):
        target_path = os.path.abspath(input_path)
    else:
        target_path = os.path.abspath(os.path.join(WORKSPACE_ROOT, input_path))
    
    # 路径逃逸校验：目标路径必须以工作空间根路径开头
    if not target_path.startswith(WORKSPACE_ROOT):
        raise PermissionError(f"Access Denied: Path traversal detected. Target: {target_path} is outside of {WORKSPACE_ROOT}")
    
    return target_path

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
