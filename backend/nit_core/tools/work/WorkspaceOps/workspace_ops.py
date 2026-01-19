import os
import json

# Define the workspace root relative to this file
# backend/nit_core/tools/work/WorkspaceOps/workspace_ops.py -> PeroCore/pero_workspace
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))))
WORKSPACE_ROOT = os.path.join(BASE_DIR, "pero_workspace")

def _ensure_workspace():
    if not os.path.exists(WORKSPACE_ROOT):
        os.makedirs(WORKSPACE_ROOT)

def _is_safe_path(file_path):
    # Ensure the path is within the workspace
    # Resolve relative paths
    try:
        # Join workspace root with the provided path
        # Note: os.path.join handles absolute paths in the second argument by discarding the first, 
        # so we must strip leading slashes or drive letters if present (though unlikely from LLM)
        # But for safety, we treat it as relative.
        file_path = file_path.lstrip("/\\")
        abs_path = os.path.abspath(os.path.join(WORKSPACE_ROOT, file_path))
        return abs_path.startswith(WORKSPACE_ROOT)
    except Exception:
        return False

def write_workspace_file(filename: str, content: str) -> str:
    """
    Write content to a file in the workspace.
    """
    _ensure_workspace()
    if not _is_safe_path(filename):
        return "Error: Access denied. You can only write to files within your workspace."
    
    try:
        filename = filename.lstrip("/\\")
        full_path = os.path.join(WORKSPACE_ROOT, filename)
        # Create directories if they don't exist
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"Successfully wrote to {filename}"
    except Exception as e:
        return f"Error writing file: {str(e)}"

def read_workspace_file(filename: str) -> str:
    """
    Read content from a file in the workspace.
    """
    _ensure_workspace()
    if not _is_safe_path(filename):
        return "Error: Access denied. You can only read files within your workspace."
    
    try:
        filename = filename.lstrip("/\\")
        full_path = os.path.join(WORKSPACE_ROOT, filename)
        if not os.path.exists(full_path):
            return "Error: File not found."
            
        with open(full_path, "r", encoding="utf-8") as f:
            return f.read()
    except Exception as e:
        return f"Error reading file: {str(e)}"

def list_workspace_files(subdir: str = "") -> str:
    """
    List files in the workspace.
    """
    _ensure_workspace()
    
    if subdir:
        if not _is_safe_path(subdir):
             return "Error: Access denied."
        target_dir = os.path.join(WORKSPACE_ROOT, subdir.lstrip("/\\"))
    else:
        target_dir = WORKSPACE_ROOT
        
    if not os.path.exists(target_dir):
        return "Error: Directory not found."

    try:
        file_list = []
        for root, _, filenames in os.walk(target_dir):
            for filename in filenames:
                # Get relative path from WORKSPACE_ROOT
                abs_file = os.path.join(root, filename)
                rel_path = os.path.relpath(abs_file, WORKSPACE_ROOT)
                file_list.append(rel_path)
        
        if not file_list:
            return "Workspace is empty."
            
        return json.dumps(file_list, indent=2)
    except Exception as e:
        return f"Error listing files: {str(e)}"

# Definitions
write_workspace_file_definition = {
    "type": "function",
    "function": {
        "name": "write_workspace_file",
        "description": "Create or overwrite a text file in your personal workspace. Use this to save notes, code, or any text content.",
        "parameters": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "Relative path to the file (e.g., 'notes.txt' or 'code/script.py')."
                },
                "content": {
                    "type": "string",
                    "description": "The text content to write."
                }
            },
            "required": ["filename", "content"]
        }
    }
}

read_workspace_file_definition = {
    "type": "function",
    "function": {
        "name": "read_workspace_file",
        "description": "Read the content of a file from your personal workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "filename": {
                    "type": "string",
                    "description": "Relative path to the file."
                }
            },
            "required": ["filename"]
        }
    }
}

list_workspace_files_definition = {
    "type": "function",
    "function": {
        "name": "list_workspace_files",
        "description": "List all files currently stored in your personal workspace.",
        "parameters": {
            "type": "object",
            "properties": {
                "subdir": {
                    "type": "string",
                    "description": "Optional subdirectory to list (default is root).",
                    "default": ""
                }
            }
        }
    }
}
