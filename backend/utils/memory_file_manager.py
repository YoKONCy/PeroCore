import os
import asyncio
from datetime import datetime

# Define workspace root relative to this file
# This file is in backend/utils/memory_file_manager.py
# Workspace is in PeroCore/pero_workspace
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKSPACE_ROOT = os.path.join(BASE_DIR, "pero_workspace")
LOG_ROOT = os.path.join(WORKSPACE_ROOT, "log")

class MemoryFileManager:
    @staticmethod
    def ensure_log_dirs():
        """Ensure all log directories exist."""
        categories = ["social_daily", "work_logs", "periodic_summaries"]
        for cat in categories:
            path = os.path.join(LOG_ROOT, cat)
            os.makedirs(path, exist_ok=True)

    @staticmethod
    async def save_log(category: str, filename: str, content: str) -> str:
        """
        Save content to a markdown file.
        Returns the absolute path of the saved file.
        """
        # Ensure directories exist (lazy init)
        MemoryFileManager.ensure_log_dirs()
        
        target_dir = os.path.join(LOG_ROOT, category)
        if not os.path.exists(target_dir):
             os.makedirs(target_dir, exist_ok=True)

        if not filename.endswith(".md"):
            filename += ".md"
            
        # Sanitize filename
        filename = "".join(c for c in filename if c.isalnum() or c in (' ', '-', '_', '.')).strip()
        
        filepath = os.path.join(target_dir, filename)
        
        # Write file (in thread to avoid blocking loop)
        await asyncio.to_thread(MemoryFileManager._write_file, filepath, content)
        return filepath

    @staticmethod
    def _write_file(filepath, content):
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
