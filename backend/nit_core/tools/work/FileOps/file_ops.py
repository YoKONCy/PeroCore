import os
import fitz  # PyMuPDF
import docx
import json

async def read_file_content(file_path: str, **kwargs) -> str:
    """
    Read content from a file, supporting TXT, MD, PDF, DOCX.
    """
    if not os.path.exists(file_path):
        return f"Error: File not found at {file_path}"
        
    _, ext = os.path.splitext(file_path)
    ext = ext.lower()
    
    try:
        if ext == '.pdf':
            doc = fitz.open(file_path)
            text = ""
            for page in doc:
                text += page.get_text() + "\n"
            return text
            
        elif ext in ['.docx', '.doc']:
            doc = docx.Document(file_path)
            text = "\n".join([para.text for para in doc.paragraphs])
            return text
            
        else:
            # Assume text file
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                return f.read()
                
    except Exception as e:
        return f"Error reading file: {str(e)}"

async def list_directory(path: str, **kwargs) -> str:
    """
    List files in a directory.
    """
    if not os.path.exists(path):
        return "Error: Directory not found."
    if not os.path.isdir(path):
        return "Error: Path is not a directory."
        
    try:
        items = os.listdir(path)
        return json.dumps(items, indent=2)
    except Exception as e:
        return f"Error listing directory: {str(e)}"
