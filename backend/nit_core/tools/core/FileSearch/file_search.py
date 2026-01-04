import os
import subprocess
import json
import shutil
import concurrent.futures
import threading
import mimetypes
from datetime import datetime
from typing import List, Optional, Dict, Union

# Document handling imports
try:
    import docx
except ImportError:
    docx = None

try:
    from pptx import Presentation
except ImportError:
    Presentation = None

try:
    import fitz # PyMuPDF
except ImportError:
    fitz = None

def find_es_executable() -> Optional[str]:
    """Find the 'es.exe' executable in common paths."""
    # 1. Check PATH
    path_in_env = shutil.which("es")
    if path_in_env:
        return path_in_env
    
    # 2. Check common installation directories and local tools
    current_dir = os.path.dirname(os.path.abspath(__file__))
    # Assuming file_search.py is in backend/tools/, we look in backend/tools/ and backend/bin/
    # And also check standard program files
    possible_paths = [
        os.path.join(current_dir, "es.exe"),
        os.path.join(os.path.dirname(current_dir), "bin", "es.exe"), # backend/bin/es.exe
        "C:\\Program Files\\Everything\\es.exe",
        "C:\\Program Files (x86)\\Everything\\es.exe"
    ]
    
    for path in possible_paths:
        if os.path.exists(path):
            return path
            
    return None

def fast_search_fallback(query: str, root_dir: str, limit: int = 50, timeout: float = 10.0) -> List[str]:
    """
    Multithreaded recursive file search with timeout.
    Scans top-level directories of root_dir in parallel.
    """
    results = []
    dirs_to_scan = []
    stop_event = threading.Event()
    
    try:
        # Get top level entries
        with os.scandir(root_dir) as it:
            for entry in it:
                if entry.name.startswith('.') or entry.name.startswith('$'):
                    continue
                    
                if entry.is_dir():
                    dirs_to_scan.append(entry.path)
                elif entry.is_file():
                    if query.lower() in entry.name.lower():
                        results.append(entry.path)
    except (PermissionError, OSError):
        pass

    if len(results) >= limit:
        return results

    # Helper function for threads
    def scan_tree(path):
        local_res = []
        try:
            for root, dirs, files in os.walk(path):
                # Check if we should stop
                if stop_event.is_set():
                    return local_res

                # Optimization: Modify dirs in-place to skip hidden ones
                dirs[:] = [d for d in dirs if not d.startswith('.') and not d.startswith('$')]
                
                for file in files:
                    if query.lower() in file.lower():
                        local_res.append(os.path.join(root, file))
                        if len(local_res) >= limit: 
                            return local_res
        except Exception:
            pass
        return local_res

    # Use ThreadPoolExecutor for parallel scanning
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        future_to_path = {executor.submit(scan_tree, d): d for d in dirs_to_scan}
        
        try:
            # Wait for results with a global timeout
            for future in concurrent.futures.as_completed(future_to_path, timeout=timeout):
                try:
                    data = future.result()
                    results.extend(data)
                    if len(results) >= limit:
                        stop_event.set() # Signal other threads to stop
                        break
                except Exception:
                    pass
        except concurrent.futures.TimeoutError:
            print(f"[FileSearch] Parallel search timed out after {timeout}s")
            stop_event.set() # Stop any ongoing work

    return results[:limit]

def search_files(query: str, limit: int = 50) -> str:
    """
    Search for files on the computer. 
    First tries to use 'Everything' command line tool (es.exe) if available for instant global search.
    If not available, falls back to searching the User's Home directory using parallel search with timeout.
    
    Args:
        query: The filename or pattern to search for.
        limit: Max number of results to return.
        
    Returns:
        JSON string containing list of file paths.
    """
    results = []
    
    es_path = find_es_executable()
    
    # 1. Try 'Everything' (es.exe)
    if es_path:
        try:
            # -n <limit> to limit results
            # -utf8 to force UTF-8 output
            cmd = [es_path, query, "-n", str(limit), "-utf8"]
            
            # Using STARTUPINFO to hide console window properly on Windows
            startupinfo = None
            if os.name == 'nt':
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = subprocess.SW_HIDE # Explicitly hide
            
            raw_output = subprocess.check_output(
                cmd, 
                startupinfo=startupinfo, 
                stderr=subprocess.STDOUT, # Capture stderr for better debugging
                stdin=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0,
                timeout=10 # [Fix] Prevent hanging indefinitely
            )
            
            # Try UTF-8 first (since we passed -utf8), then fallback to system encoding
            try:
                output = raw_output.decode('utf-8')
            except UnicodeDecodeError:
                import locale
                system_enc = locale.getpreferredencoding()
                print(f"[FileSearch] UTF-8 decode failed, falling back to {system_enc}")
                output = raw_output.decode(system_enc, errors='ignore')
            
            lines = output.strip().split('\n')
            results = [line.strip() for line in lines if line.strip()]
            if results:
                final_results = results[:limit]
                return json.dumps(final_results, ensure_ascii=False)
        except (subprocess.CalledProcessError, FileNotFoundError, OSError) as e:
            print(f"[FileSearch] Error running es: {e}")
            if hasattr(e, 'output') and e.output:
                print(f"[FileSearch] Subprocess output: {e.output.decode('utf-8', errors='ignore')}")
            pass # Fallback

    # 2. Fallback: Search User Home Directory with Parallel Search
    user_home = os.path.expanduser("~")
    # Using 10s timeout for fallback to keep Pero responsive
    print(f"[FileSearch] 'es' not found. Falling back to parallel search in {user_home} (10s timeout)")
    
    results = fast_search_fallback(query, user_home, limit, timeout=10.0)
            
    # Return pure JSON for backend processing
    return json.dumps(results, ensure_ascii=False)

def read_file_content(file_path: str, max_length: int = 10000) -> str:
    """
    Read the content of a file. Supports text files, PDF, DOCX, and PPTX.
    
    Args:
        file_path: Absolute path to the file.
        max_length: Maximum number of characters to read (default 10000).
        
    Returns:
        String content of the file or error message.
    """
    try:
        # Check if file exists
        if not os.path.exists(file_path):
            return f"Error: File not found: {file_path}"
        
        # Check if it's a file
        if not os.path.isfile(file_path):
            return f"Error: Path is not a file: {file_path}"
            
        # Check size to avoid reading massive files
        file_size = os.path.getsize(file_path)
        if file_size > 10 * 1024 * 1024: # 10MB hard limit for safety
             return f"Error: File is too large ({file_size} bytes). Max allowed size is 10MB."

        ext = os.path.splitext(file_path)[1].lower()

        # 1. Handle PDF
        if ext == '.pdf':
            if not fitz:
                return "Error: PyMuPDF (fitz) is not installed. Cannot read PDF files."
            try:
                doc = fitz.open(file_path)
                text = ""
                for page in doc:
                    text += page.get_text()
                    if len(text) > max_length:
                        break
                doc.close()
                return text[:max_length] + ("\n...[Content Truncated]..." if len(text) > max_length else "")
            except Exception as e:
                return f"Error reading PDF: {str(e)}"

        # 2. Handle DOCX
        elif ext == '.docx':
            if not docx:
                return "Error: python-docx is not installed. Cannot read DOCX files."
            try:
                doc = docx.Document(file_path)
                full_text = []
                for para in doc.paragraphs:
                    full_text.append(para.text)
                text = '\n'.join(full_text)
                return text[:max_length] + ("\n...[Content Truncated]..." if len(text) > max_length else "")
            except Exception as e:
                return f"Error reading DOCX: {str(e)}"

        # 3. Handle PPTX
        elif ext == '.pptx':
            if not Presentation:
                return "Error: python-pptx is not installed. Cannot read PPTX files."
            try:
                prs = Presentation(file_path)
                text_runs = []
                for slide in prs.slides:
                    for shape in slide.shapes:
                        if hasattr(shape, "text"):
                            text_runs.append(shape.text)
                text = '\n'.join(text_runs)
                return text[:max_length] + ("\n...[Content Truncated]..." if len(text) > max_length else "")
            except Exception as e:
                return f"Error reading PPTX: {str(e)}"

        # 4. Handle Plain Text (Default)
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read(max_length)
                if len(content) == max_length:
                    content += "\n...[Content Truncated]..."
                return content
        except UnicodeDecodeError:
            # Try a few common encodings
            for enc in ['gbk', 'latin1']:
                try:
                    with open(file_path, 'r', encoding=enc) as f:
                        content = f.read(max_length)
                        if len(content) == max_length:
                            content += "\n...[Content Truncated]..."
                        return content
                except:
                    continue
            return f"Error: Unable to decode file content. The file extension is {ext}, but it doesn't appear to be a standard text file or supported document format."
            
    except Exception as e:
        return f"Error reading file: {str(e)}"

def list_directory(path: str = None, dir_path: str = None) -> str:
    """
    List files and subdirectories in a given directory.
    Supports both 'path' and 'dir_path' arguments for flexibility.
    
    Args:
        path: Absolute path to the directory (alias for dir_path).
        dir_path: Absolute path to the directory.
        
    Returns:
        JSON string of directory contents.
    """
    target_path = dir_path if dir_path else path
    if not target_path:
         target_path = "." # Default to current directory if nothing provided

    try:
        if not os.path.exists(target_path):
            return json.dumps({"error": f"Directory not found: {target_path}"})
            
        if not os.path.isdir(target_path):
            return json.dumps({"error": f"Path is not a directory: {target_path}"})
            
        items = []
        with os.scandir(target_path) as it:
            for entry in it:
                try:
                    item_type = "directory" if entry.is_dir() else "file"
                    items.append({
                        "name": entry.name,
                        "path": entry.path,
                        "type": item_type
                    })
                except OSError:
                    continue
                    
        return json.dumps(items, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": f"Failed to list directory: {str(e)}"})

def get_file_info(file_path: str) -> str:
    """
    Get metadata information about a file.
    
    Args:
        file_path: Absolute path to the file.
        
    Returns:
        JSON string containing file metadata.
    """
    try:
        if not os.path.exists(file_path):
            return json.dumps({"error": f"File not found: {file_path}"})
            
        stat = os.stat(file_path)
        mime_type, _ = mimetypes.guess_type(file_path)
        
        info = {
            "name": os.path.basename(file_path),
            "path": file_path,
            "size": stat.st_size,
            "created": datetime.fromtimestamp(stat.st_ctime).isoformat(),
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "is_dir": os.path.isdir(file_path),
            "mime_type": mime_type or "unknown"
        }
        
        return json.dumps(info, ensure_ascii=False)
    except Exception as e:
        return json.dumps({"error": f"Failed to get info: {str(e)}"})

def show_file_results(files: List[str]) -> str:
    """
    Display a UI to the user with the list of found files.
    Use this when you have found files and want to present them to the user for selection.
    
    Args:
        files: List of absolute file paths to show.
    """
    # We return instructions to the LLM to output the tag.
    # The frontend only parses tags in the Assistant's message.
    return f"UI Data prepared. To display the file list UI to the user, you MUST include this exact tag in your final response:\n<FILE_RESULTS>{json.dumps(files, ensure_ascii=False)}</FILE_RESULTS>"

# Tool Definitions
search_files_definition = {
    "type": "function",
    "function": {
        "name": "search_files",
        "description": "Search for files by FILENAME on the entire computer. Use this when you need to find WHERE a file is located based on its name. (For searching INSIDE code files, use 'code_search' instead).",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The filename or keyword to search for."
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of results to return (default 50).",
                    "default": 50
                }
            },
            "required": ["query"]
        }
    }
}

read_file_definition = {
    "type": "function",
    "function": {
        "name": "read_file_content",
        "description": "Read the FULL content of a document or text file. Best for reading .pdf, .docx, .pptx, or general text files. (For searching patterns across multiple code files, use 'code_search').",
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "The absolute path of the file to read."
                },
                "max_length": {
                    "type": "integer",
                    "description": "Max characters to read (default 10000).",
                    "default": 10000
                }
            },
            "required": ["file_path"]
        }
    }
}

list_directory_definition = {
    "type": "function",
    "function": {
        "name": "list_directory",
        "description": "List all files and subdirectories in a specific folder. Useful for exploring file structure.",
        "parameters": {
            "type": "object",
            "properties": {
                "dir_path": {
                    "type": "string",
                    "description": "The absolute path of the directory to list."
                }
            },
            "required": ["dir_path"]
        }
    }
}

get_file_info_definition = {
    "type": "function",
    "function": {
        "name": "get_file_info",
        "description": "Get metadata (size, dates, type) about a file or directory.",
        "parameters": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "The absolute path of the file or directory."
                }
            },
            "required": ["file_path"]
        }
    }
}

show_file_results_definition = {
    "type": "function",
    "function": {
        "name": "show_file_results",
        "description": "Show a list of files to the user in a UI overlay. Call this after finding files with search_files.",
        "parameters": {
            "type": "object",
            "properties": {
                "files": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of file paths to display."
                }
            },
            "required": ["files"]
        }
    }
}
