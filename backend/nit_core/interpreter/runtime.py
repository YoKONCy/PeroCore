import uuid
import json
from datetime import datetime
from typing import Dict, Any, List
from .ast_nodes import PipelineNode, AssignmentNode, CallNode, LiteralNode, VariableRefNode, ListNode

from .engine import NITRuntime

# --- Original content of runtime.py (misplaced functions kept for compatibility) ---
from sqlmodel import select, desc
try:
    from backend.models import Config, ConversationLog, Memory
    from backend.services.llm_service import LLMService
    from backend.services.memory_service import MemoryService
except ImportError:
    from models import Config, ConversationLog, Memory
    from services.llm_service import LLMService
    from services.memory_service import MemoryService
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
        你是 Pero。你刚刚完成了一项编码/工作任务："{task_name}"。
        以下是本次会话的原始对话日志：
        
        {log_text}
        
        请撰写一份“手写工作日志”（Markdown 格式）。
        要求：
        1. 标题: 📝 Pero 的工作日志 - {task_name}
        2. 语气: 专业又不失个性（Pero 的风格）。
        3. 内容:
           - 目标: 任务是什么？
           - 过程: 采取的关键步骤、使用的工具、遇到的错误及修复方法。
           - 结果: 最终成果。
           - 反思: 你学到了什么？
        4. 保持简洁但信息量大。
        """
        
        summary = await llm.chat([{"role": "user", "content": prompt}])
        summary_content = summary["choices"][0]["message"]["content"]
        
        # 4. Save to Memory (Long-term)
        await MemoryService.save_memory(
            session=session,
            content=summary_content,
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
            except Exception as final_e:
                print(f"[Runtime] Critical Error restoring session: {final_e}")

class NITRuntime:
    def __init__(self, tool_executor):
        self.tool_executor = tool_executor
        self.variables = {}

    async def execute(self, pipeline):
        last_result = None
        for statement in pipeline.statements:
            last_result = await self.execute_statement(statement)
        return last_result

    async def execute_statement(self, statement):
        from .ast_nodes import AssignmentNode, CallNode
        if isinstance(statement, AssignmentNode):
            value = await self.execute_call(statement.expression)
            self.variables[statement.target_var] = value
            return value
        elif isinstance(statement, CallNode):
            return await self.execute_call(statement)

    def evaluate_value(self, node):
        from .ast_nodes import LiteralNode, VariableRefNode, ListNode
        if isinstance(node, LiteralNode):
            return node.value
        elif isinstance(node, VariableRefNode):
            return self.variables.get(node.name)
        elif isinstance(node, ListNode):
            return [self.evaluate_value(elem) for elem in node.elements]
        return None

    async def execute_call(self, call_node):
        args = {}
        for name, node in call_node.args.items():
            args[name] = self.evaluate_value(node)
        
        # Tool execution logic
        result = await self.tool_executor(call_node.tool_name, args)
        return result

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
