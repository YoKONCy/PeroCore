import os
import asyncio
from datetime import datetime
from services.agent_manager import get_agent_manager
from utils.workspace_utils import get_workspace_root

# 定义相对于此文件的工作区根目录
# 此文件位于 backend/utils/memory_file_manager.py
# 工作区位于 PeroCore/pero_workspace
BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKSPACE_ROOT = os.path.join(BASE_DIR, "pero_workspace")
# LOG_ROOT = os.path.join(WORKSPACE_ROOT, "log") # Deprecated global log root

class MemoryFileManager:
    @staticmethod
    def get_agent_log_root(agent_id: str = None) -> str:
        """
        Get the log root directory for a specific agent.
        Updated: Now points to the agent's workspace root directly, flattening the structure.
        e.g. pero_workspace/pero/
        """
        return get_workspace_root(agent_id)

    @staticmethod
    def ensure_log_dirs(agent_id: str = None):
        """确保所有日志目录存在。"""
        log_root = MemoryFileManager.get_agent_log_root(agent_id)
        categories = ["social_daily", "work_logs", "periodic_summaries"]
        for cat in categories:
            path = os.path.join(log_root, cat)
            os.makedirs(path, exist_ok=True)

    @staticmethod
    async def save_log(category: str, filename: str, content: str, agent_id: str = None) -> str:
        """
        将内容保存到 markdown 文件。
        返回已保存文件的绝对路径。
        """
        # 确保目录存在（延迟初始化）
        MemoryFileManager.ensure_log_dirs(agent_id)
        
        log_root = MemoryFileManager.get_agent_log_root(agent_id)
        target_dir = os.path.join(log_root, category)
        if not os.path.exists(target_dir):
             os.makedirs(target_dir, exist_ok=True)

        if not filename.endswith(".md"):
            filename += ".md"
            
        # 净化文件名
        filename = "".join(c for c in filename if c.isalnum() or c in (' ', '-', '_', '.')).strip()
        
        filepath = os.path.join(target_dir, filename)
        
        # 写入文件（在线程中以避免阻塞循环）
        await asyncio.to_thread(MemoryFileManager._write_file, filepath, content)
        return filepath

    @staticmethod
    def _write_file(filepath, content):
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
