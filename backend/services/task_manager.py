import asyncio
from typing import Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)

class TaskManager:
    """
    管理活动的聊天任务，允许中断、暂停和指令注入。
    单例模式。
    """
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(TaskManager, cls).__new__(cls)
            cls._instance.tasks = {} # session_id -> 任务上下文
        return cls._instance

    def register(self, session_id: str):
        """为会话注册一个新的任务上下文。"""
        if session_id in self.tasks:
            # 如果存在旧的任务上下文，则进行清理（尽管通常应该已经完成）
            logger.info(f"[TaskManager] Overwriting existing context for {session_id}")
        
        self.tasks[session_id] = {
            "pause_event": asyncio.Event(),
            "injected_messages": asyncio.Queue(),
            "status": "running" # running (运行中), paused (已暂停)
        }
        self.tasks[session_id]["pause_event"].set() # 初始状态为运行中
        logger.info(f"[TaskManager] Registered task for {session_id}")

    def unregister(self, session_id: str):
        """注销任务上下文。"""
        if session_id in self.tasks:
            del self.tasks[session_id]
            logger.info(f"[TaskManager] Unregistered task for {session_id}")

    async def check_pause(self, session_id: str):
        """如果任务已暂停，则等待。"""
        if session_id in self.tasks:
            event = self.tasks[session_id]["pause_event"]
            if not event.is_set():
                logger.info(f"[TaskManager] Task {session_id} is paused. Waiting...")
                await event.wait()
                logger.info(f"[TaskManager] Task {session_id} resumed.")

    def pause(self, session_id: str):
        """暂停任务。"""
        if session_id in self.tasks:
            self.tasks[session_id]["pause_event"].clear()
            self.tasks[session_id]["status"] = "paused"
            logger.info(f"[TaskManager] Paused task {session_id}")
            return True
        return False

    def resume(self, session_id: str):
        """恢复任务。"""
        if session_id in self.tasks:
            self.tasks[session_id]["pause_event"].set()
            self.tasks[session_id]["status"] = "running"
            logger.info(f"[TaskManager] Resumed task {session_id}")
            return True
        return False

    def inject_instruction(self, session_id: str, instruction: str):
        """向运行中的任务注入用户指令。"""
        if session_id in self.tasks:
            self.tasks[session_id]["injected_messages"].put_nowait(instruction)
            logger.info(f"[TaskManager] Injected instruction to {session_id}: {instruction}")
            return True
        return False

    def get_injected_instruction(self, session_id: str) -> Optional[str]:
        """如果可用，获取一个待处理的注入指令。"""
        if session_id in self.tasks:
            queue = self.tasks[session_id]["injected_messages"]
            if not queue.empty():
                return queue.get_nowait()
        return None

    def get_status(self, session_id: str) -> Optional[str]:
        if session_id in self.tasks:
            return self.tasks[session_id]["status"]
        return None

task_manager = TaskManager()
