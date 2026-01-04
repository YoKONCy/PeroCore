import asyncio
from typing import Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)

class TaskManager:
    """
    Manages active chat tasks, allowing for interruption, pausing, and instruction injection.
    Singleton pattern.
    """
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(TaskManager, cls).__new__(cls)
            cls._instance.tasks = {} # session_id -> TaskContext
        return cls._instance

    def register(self, session_id: str):
        """Register a new task context for a session."""
        if session_id in self.tasks:
            # Clean up old task context if exists (though usually it should be done)
            logger.info(f"[TaskManager] Overwriting existing context for {session_id}")
        
        self.tasks[session_id] = {
            "pause_event": asyncio.Event(),
            "injected_messages": asyncio.Queue(),
            "status": "running" # running, paused
        }
        self.tasks[session_id]["pause_event"].set() # Initially running
        logger.info(f"[TaskManager] Registered task for {session_id}")

    def unregister(self, session_id: str):
        """Unregister task context."""
        if session_id in self.tasks:
            del self.tasks[session_id]
            logger.info(f"[TaskManager] Unregistered task for {session_id}")

    async def check_pause(self, session_id: str):
        """Wait if the task is paused."""
        if session_id in self.tasks:
            event = self.tasks[session_id]["pause_event"]
            if not event.is_set():
                logger.info(f"[TaskManager] Task {session_id} is paused. Waiting...")
                await event.wait()
                logger.info(f"[TaskManager] Task {session_id} resumed.")

    def pause(self, session_id: str):
        """Pause the task."""
        if session_id in self.tasks:
            self.tasks[session_id]["pause_event"].clear()
            self.tasks[session_id]["status"] = "paused"
            logger.info(f"[TaskManager] Paused task {session_id}")
            return True
        return False

    def resume(self, session_id: str):
        """Resume the task."""
        if session_id in self.tasks:
            self.tasks[session_id]["pause_event"].set()
            self.tasks[session_id]["status"] = "running"
            logger.info(f"[TaskManager] Resumed task {session_id}")
            return True
        return False

    def inject_instruction(self, session_id: str, instruction: str):
        """Inject a user instruction into the running task."""
        if session_id in self.tasks:
            self.tasks[session_id]["injected_messages"].put_nowait(instruction)
            logger.info(f"[TaskManager] Injected instruction to {session_id}: {instruction}")
            return True
        return False

    def get_injected_instruction(self, session_id: str) -> Optional[str]:
        """Get one pending injected instruction if available."""
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
