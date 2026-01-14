import uuid
from datetime import datetime
from sqlmodel import select, desc
try:
    from models import Config, ConversationLog, Memory
    from services.llm_service import LLMService
    from services.memory_service import MemoryService
except ImportError:
    from backend.models import Config, ConversationLog, Memory
    from backend.services.llm_service import LLMService
    from backend.services.memory_service import MemoryService
import json

# Global variable to hold session reference (injected by AgentService)
# This is a bit hacky but works for tool-to-service communication
_CURRENT_SESSION_CONTEXT = {}

def set_current_session_context(session):
    _CURRENT_SESSION_CONTEXT["db_session"] = session

async def enter_work_mode(task_name: str = "Unknown Task") -> str:
    """
    Enter 'Work Mode' (Isolation Mode).
    Creates a temporary, isolated session for coding or complex tasks.
    History from this session will NOT pollute the main chat, but will be summarized later.
    """
    session = _CURRENT_SESSION_CONTEXT.get("db_session")
    if not session:
        return "Error: Database session not available."

    try:
        # 1. Generate new Session ID
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        work_session_id = f"work_{timestamp}_{uuid.uuid4().hex[:4]}"
        
        # 2. Update Config
        # current_session_id: The actual session ID to use for logs
        # work_mode_task: The name of the task
        
        # Update current_session_id
        config_id = (await session.exec(select(Config).where(Config.key == "current_session_id"))).first()
        if not config_id:
            config_id = Config(key="current_session_id", value=work_session_id)
            session.add(config_id)
        else:
            config_id.value = work_session_id
            
        # Update work_mode_task
        config_task = (await session.exec(select(Config).where(Config.key == "work_mode_task"))).first()
        if not config_task:
            config_task = Config(key="work_mode_task", value=task_name)
            session.add(config_task)
        else:
            config_task.value = task_name
            
        await session.commit()
        return f"Entered Work Mode. New isolated session: {work_session_id}. Task: {task_name}"
        
    except Exception as e:
        await session.rollback()
        return f"Error entering Work Mode: {e}"

async def exit_work_mode() -> str:
    """
    Exit 'Work Mode'.
    Summarizes the entire work session into a 'Handwritten Log' and saves it to long-term memory.
    Restores the main chat session.
    """
    session = _CURRENT_SESSION_CONTEXT.get("db_session")
    if not session:
        return "Error: Database session not available."

    config_id = None
    try:
        # 1. Get current work info
        config_id = (await session.exec(select(Config).where(Config.key == "current_session_id"))).first()
        config_task = (await session.exec(select(Config).where(Config.key == "work_mode_task"))).first()
        
        if not config_id or not config_id.value.startswith("work_"):
            return "Error: Not currently in Work Mode."
            
        work_session_id = config_id.value
        task_name = config_task.value if config_task else "Unnamed Task"
        
        # 2. Fetch all logs for this session
        logs = (await session.exec(
            select(ConversationLog)
            .where(ConversationLog.session_id == work_session_id)
            .order_by(ConversationLog.timestamp)
        )).all()
        
        if not logs:
            return "Exited Work Mode (No logs to summarize)."

        # 3. Summarize via LLM
        global_config = {c.key: c.value for c in (await session.exec(select(Config))).all()}
        api_key = global_config.get("global_llm_api_key")
        api_base = global_config.get("global_llm_api_base")
        
        llm = LLMService(api_key, api_base, "gpt-4o")
        log_text = "\n".join([f"{log.role}: {log.content}" for log in logs])
        
        prompt = f"""
        You are Pero. You have just finished a coding/work task: "{task_name}".
        Here is the raw conversation log of the session:
        
        {log_text}
        
        Please write a "Handwritten Work Log" (Markdown format).
        Requirements:
        1. Title: # 📝 Pero's Work Log - {task_name}
        2. Tone: Professional yet personal (Pero's style).
        3. Content Structure (Use Markdown Headers):
           - ## Goal
           - ## Process (Key steps, tools used)
           - ## Outcome
           - ## Reflection
        4. Keep it concise but information-dense.
        """
        
        summary = await llm.chat([{"role": "user", "content": prompt}])
        summary_content = summary["choices"][0]["message"]["content"]
        
        # 4. Save to File (MD)
        from backend.utils.memory_file_manager import MemoryFileManager
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_task_name = "".join(c for c in task_name if c.isalnum() or c in (' ', '-', '_')).strip()[:30]
        file_path = await MemoryFileManager.save_log("work_logs", f"{timestamp_str}_{safe_task_name}", summary_content)
        
        # 5. Save to Memory (DB)
        db_content = f"{summary_content}\n\n> 📁 File Archived: {file_path}"
        
        await MemoryService.save_memory(
            session=session,
            content=db_content,
            tags="work_log,summary,coding",
            clusters="[工作记录]",
            importance=8,
            memory_type="work_log",
            source="system"
        )
        return f"Exited Work Mode. \n\n[Summary Generated]:\n{summary_content}\n\n(Saved to Long-term Memory)"
        
    except Exception as e:
        await session.rollback()
        return f"Error during Work Mode exit: {e}"
    finally:
        # ALWAYS try to restore session state to 'default'
        if config_id and config_id.value.startswith("work_"):
            try:
                config_id.value = "default"
                await session.commit()

                # [Broadcast] Notify frontend to switch UI
                try:
                    from services.voice_manager import voice_manager
                    await voice_manager.broadcast({
                        "type": "mode_update",
                        "mode": "work",
                        "is_active": False
                    })
                except Exception as e:
                    print(f"[SessionOps] Failed to broadcast mode update: {e}")

            except Exception as final_e:
                print(f"[SessionOps] Critical Error restoring session: {final_e}")

# Tool Definitions
enter_work_mode_definition = {
    "type": "function",
    "function": {
        "name": "enter_work_mode",
        "description": "Activate 'Work Mode' (Isolation Mode). Use this when starting a complex coding task or project. It isolates the conversation history to prevent polluting the daily chat context.",
        "parameters": {
            "type": "object",
            "properties": {
                "task_name": {
                    "type": "string",
                    "description": "The name or description of the task (e.g., 'Refactoring Memory Service')."
                }
            },
            "required": ["task_name"]
        }
    }
}

exit_work_mode_definition = {
    "type": "function",
    "function": {
        "name": "exit_work_mode",
        "description": "Deactivate 'Work Mode'. Use this when the task is done. It will automatically summarize the session into a 'Work Log' and save it to memory.",
        "parameters": {
            "type": "object",
            "properties": {},
            "required": []
        }
    }
}
