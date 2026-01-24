import uuid
from datetime import datetime
from sqlmodel import select, desc
try:
    from models import Config, ConversationLog, Memory
    from services.llm_service import LLMService
    from services.memory_service import MemoryService
    from core.config_manager import get_config_manager
except ImportError:
    from backend.models import Config, ConversationLog, Memory
    from backend.services.llm_service import LLMService
    from backend.services.memory_service import MemoryService
    from backend.core.config_manager import get_config_manager
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
        return "Error: 数据库会话不可用。"

    # [Check] Block Work Mode if incompatible modes are active
    try:
        active_blockers = []
        
        # 1. Check Config via ConfigManager (memory cache)
        from core.config_manager import get_config_manager
        from services.agent_manager import get_agent_manager
        
        config_mgr = get_config_manager()
        agent_manager = get_agent_manager()
        agent_id = agent_manager.active_agent_id
        
        # Log current state for debugging
        print(f"[SessionOps] 正在检查模式冲突。当前配置: lightweight_mode={config_mgr.get('lightweight_mode')}, aura_vision={config_mgr.get('aura_vision_enabled')}, agent={agent_id}")
        
        if config_mgr.get("lightweight_mode", False):
            active_blockers.append("lightweight_mode")
            
        if config_mgr.get("aura_vision_enabled", False):
            active_blockers.append("aura_vision_enabled")
            
        # 2. Check DB Config (Companion Mode)
        companion_config = (await session.exec(select(Config).where(Config.key == "companion_mode_enabled"))).first()
        if companion_config and str(companion_config.value).lower() == 'true':
            active_blockers.append("companion_mode")
                
        if active_blockers:
            # Map keys to Chinese names for better user experience
            name_map = {
                "lightweight_mode": "轻量模式",
                "companion_mode": "陪伴模式",
                "aura_vision_enabled": "主动视觉模式"
            }
            modes_str = "、".join([name_map.get(m, m) for m in active_blockers])
            return f"Error: 无法进入工作模式。检测到以下模式正在运行：{modes_str}。请先关闭它们。"
            
    except Exception as check_e:
        print(f"[SessionOps] Mode check warning: {check_e}")
        # Proceed with caution or return error? Let's log and proceed if check fails to avoid lockouts, 
        # or fail safe. Let's fail safe if we can't verify.
        # For now, just log.

    try:
        # 1. Generate new Session ID (Agent-Aware)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        work_session_id = f"work_{agent_id}_{timestamp}_{uuid.uuid4().hex[:4]}"
        
        # 2. Update Config
        # current_session_id: The actual session ID to use for logs
        # work_mode_task: The name of the task
        
        # Update current_session_id_{agent_id}
        session_key = f"current_session_id_{agent_id}"
        config_id = (await session.exec(select(Config).where(Config.key == session_key))).first()
        if not config_id:
            config_id = Config(key=session_key, value=work_session_id)
            session.add(config_id)
        else:
            config_id.value = work_session_id
            
        # Update work_mode_task_{agent_id}
        task_key = f"work_mode_task_{agent_id}"
        config_task = (await session.exec(select(Config).where(Config.key == task_key))).first()
        if not config_task:
            config_task = Config(key=task_key, value=task_name)
            session.add(config_task)
        else:
            config_task.value = task_name
            
        await session.commit()

        # [NIT] Activate Work Toolchain
        try:
            from core.nit_manager import get_nit_manager
            get_nit_manager().set_category_status("work", True)
        except Exception as nit_e:
            print(f"[SessionOps] Failed to activate NIT work category: {nit_e}")

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
        return "Error: 数据库会话不可用。"

    config_id = None
    try:
        from services.agent_manager import get_agent_manager
        agent_manager = get_agent_manager()
        agent_id = agent_manager.active_agent_id
        
        session_key = f"current_session_id_{agent_id}"
        task_key = f"work_mode_task_{agent_id}"

        # 1. Get current work info
        config_id = (await session.exec(select(Config).where(Config.key == session_key))).first()
        config_task = (await session.exec(select(Config).where(Config.key == task_key))).first()
        
        if not config_id or not config_id.value.startswith(f"work_{agent_id}_"):
            # Fallback for old sessions or just generic check
            if not config_id or not config_id.value.startswith("work_"):
                return "Error: 当前不在工作模式。"
            
        work_session_id = config_id.value
        task_name = config_task.value if config_task else "未命名任务"
        
        # 2. Fetch all logs for this session
        logs = (await session.exec(
            select(ConversationLog)
            .where(ConversationLog.session_id == work_session_id)
            .order_by(ConversationLog.timestamp)
        )).all()
        
        if not logs:
            return "已退出工作模式 (无日志需要总结)。"

        # 3. Summarize via LLM
        global_config = {c.key: c.value for c in (await session.exec(select(Config))).all()}
        api_key = global_config.get("global_llm_api_key")
        api_base = global_config.get("global_llm_api_base")
        bot_name = global_config.get("bot_name", "Pero")

        # Initialize MDPManager
        import os
        # Path logic: backend/services/session_service.py -> backend/services/mdp/prompts
        # __file__ -> session_service.py
        # dirname -> services
        # dirname -> backend
        # join -> backend/services/mdp/prompts
        mdp_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "services", "mdp", "prompts")
        
        if not os.path.exists(mdp_dir):
             # Fallback
             mdp_dir = os.path.join(os.getcwd(), "backend", "services", "mdp", "prompts")
        
        from services.mdp.manager import MDPManager
        mdp = MDPManager(mdp_dir)
        
        # [Unified Model Fix] Use current_model_id instead of hardcoded gpt-4o
        from models import AIModelConfig
        current_model_id = global_config.get("current_model_id")
        
        # Default fallback if config fails
        model_to_use = "gpt-4o" 
        
        if current_model_id:
             model_config = await session.get(AIModelConfig, int(current_model_id))
             if model_config:
                 model_to_use = model_config.model_id
                 # Also ensure we use the correct API key/base if it's a custom provider
                 if model_config.provider_type == 'custom':
                     api_key = model_config.api_key
                     api_base = model_config.api_base

        llm = LLMService(api_key, api_base, model_to_use)
        log_text = "\n".join([f"{log.role}: {log.content}" for log in logs])
        
        from services.mdp.manager import mdp
        prompt = mdp.render("core/abilities/work_log", {
            "agent_name": bot_name,
            "task_name": task_name,
            "log_text": log_text
        })
        
        summary = await llm.chat([{"role": "user", "content": prompt}])
        summary_content = summary["choices"][0]["message"]["content"]
        
        # 4. Save to File (MD)
        from utils.memory_file_manager import MemoryFileManager
        timestamp_str = datetime.now().strftime("%Y%m%d_%H%M%S")
        safe_task_name = "".join(c for c in task_name if c.isalnum() or c in (' ', '-', '_')).strip()[:30]
        # Use active agent ID for log isolation
        file_path = await MemoryFileManager.save_log("work_logs", f"{timestamp_str}_{safe_task_name}", summary_content, agent_id=agent_id)
        
        # 5. Save to Memory (DB)
        # [Modified] User requested NOT to store document types in DB.
        # db_content = f"{summary_content}\n\n> 📁 File Archived: {file_path}"
        
        # await MemoryService.save_memory(
        #     session=session,
        #     content=db_content,
        #     tags="work_log,summary,coding",
        #     clusters="[工作记录]",
        #     importance=8,
        #     memory_type="work_log",
        #     source="system"
        # )

        # [NIT] Deactivate Work Toolchain
        try:
            from core.nit_manager import get_nit_manager
            get_nit_manager().set_category_status("work", False)
        except Exception as nit_e:
            print(f"[SessionOps] 停用 NIT 工作分类失败: {nit_e}")
            
        # 6. Restore Main Session
        # Just revert the config pointer
        # We need to find the previous session ID. 
        # Actually, for now, we just set it to 'default' or generate a new daily session if needed.
        # But ideally we should go back to where we were.
        # Since we don't store "previous_session_id" explicitly, let's look for the latest non-work session?
        # Or just 'default' which usually maps to daily session in other logic.
        
        config_id.value = "default" 
        config_task.value = ""
        await session.commit()
        
        return f"已退出工作模式。日志已保存 ({file_path})。会话已恢复。"
        
    except Exception as e:
        await session.rollback()
        return f"退出工作模式错误: {e}"

async def abort_work_mode() -> str:
    """
    Abort 'Work Mode' WITHOUT saving summary.
    Useful for accidental entry or if the user just wants to quit.
    """
    session = _CURRENT_SESSION_CONTEXT.get("db_session")
    if not session:
        return "Error: 数据库会话不可用。"

    try:
        from services.agent_manager import get_agent_manager
        agent_manager = get_agent_manager()
        agent_id = agent_manager.active_agent_id
        
        session_key = f"current_session_id_{agent_id}"
        task_key = f"work_mode_task_{agent_id}"

        # 1. Revert Config
        config_id = (await session.exec(select(Config).where(Config.key == session_key))).first()
        config_task = (await session.exec(select(Config).where(Config.key == task_key))).first()
        
        if config_id and config_id.value.startswith("work_"):
             # Revert to default
             config_id.value = "default"
             if config_task:
                 config_task.value = ""
             await session.commit()
             
             # [NIT] Deactivate Work Toolchain
             try:
                from core.nit_manager import get_nit_manager
                get_nit_manager().set_category_status("work", False)
             except: pass

             original_session_id = "default" # Simplified
             print(f"[SessionOps] 工作模式已中止。恢复至 {original_session_id}。")
             return f"工作模式已中止。恢复至会话: {original_session_id}"
        else:
             return "当前不在工作模式。"
             
    except Exception as e:
        await session.rollback()
        return f"中止工作模式错误: {e}"
