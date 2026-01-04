import os
import json
import datetime
import logging
from typing import Optional, List
from sqlmodel import select, desc, and_

# Try imports for Database access
try:
    from backend.models import Memory, MaintenanceRecord, ScheduledTask
    from backend.services.memory_service import MemoryService
    # Try to import session context from SessionOps
    try:
        from backend.nit_core.tools.core.SessionOps.session_ops import _CURRENT_SESSION_CONTEXT
    except ImportError:
        try:
            from nit_core.tools.core.SessionOps.session_ops import _CURRENT_SESSION_CONTEXT
        except ImportError:
            from tools.core.SessionOps.session_ops import _CURRENT_SESSION_CONTEXT
except ImportError:
    try:
        from models import Memory, MaintenanceRecord, ScheduledTask
        from services.memory_service import MemoryService
        try:
            from backend.nit_core.tools.core.SessionOps.session_ops import _CURRENT_SESSION_CONTEXT
        except ImportError:
            try:
                from nit_core.tools.core.SessionOps.session_ops import _CURRENT_SESSION_CONTEXT
            except ImportError:
                from tools.core.SessionOps.session_ops import _CURRENT_SESSION_CONTEXT
    except ImportError:
        # Fallback for dev/testing without full backend context
        # This might fail in production if paths are wrong, but we'll handle it gracefully
        logging.warning("MemoryOps: Failed to import backend modules. Database features may not work.")
        _CURRENT_SESSION_CONTEXT = {}
        Memory = None
        MaintenanceRecord = None
        ScheduledTask = None
        MemoryService = None

# 配置日志存储路径 (作为备份/兼容)
# Assuming file is in backend/nit_core/tools/core/MemoryOps/memory_ops.py
# Root is backend (4 levels up)
MEMORY_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))), "memory")
REFLECTION_FILE = os.path.join(MEMORY_DIR, "reflection_log.json")

logger = logging.getLogger(__name__)

def _ensure_memory_dir():
    if not os.path.exists(MEMORY_DIR):
        try:
            os.makedirs(MEMORY_DIR)
        except Exception as e:
            logger.error(f"Failed to create memory directory: {e}")

def _load_reflections_local():
    """Load reflections from local JSON file (Legacy/Backup)"""
    _ensure_memory_dir()
    if not os.path.exists(REFLECTION_FILE):
        return []
    try:
        with open(REFLECTION_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load reflection log: {e}")
        return []

def _save_reflections_local(logs):
    """Save reflections to local JSON file (Legacy/Backup)"""
    _ensure_memory_dir()
    try:
        with open(REFLECTION_FILE, "w", encoding="utf-8") as f:
            json.dump(logs, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Failed to save reflection log: {e}")

# --- Reflection Operations ---

async def log_reflection(category: str, content: str, level: str = "info") -> str:
    """
    记录一条自我反思日志。
    优先写入数据库 (Memory Table, type='reflection', cluster='[反思簇]')。
    同时备份到本地 JSON 文件。
    """
    # 1. Save to Database (Primary)
    db_status = ""
    session = _CURRENT_SESSION_CONTEXT.get("db_session")
    
    if session and MemoryService:
        try:
            importance_map = {"info": 3, "warning": 6, "critical": 9}
            imp = importance_map.get(level, 3)
            
            await MemoryService.save_memory(
                session=session,
                content=f"[{category}] {content}",
                tags=f"reflection,{category},{level}",
                clusters="[反思簇]",
                importance=imp,
                base_importance=float(imp),
                memory_type="reflection",
                source="MemoryOps",
                sentiment="neutral" # Reflection is usually neutral/objective
            )
            db_status = "(已同步至记忆数据库)"
        except Exception as e:
            db_status = f"(数据库写入失败: {e})"
            logger.error(f"MemoryOps DB Error: {e}")
    else:
        db_status = "(未连接数据库，仅本地存储)"

    # 2. Save to Local File (Backup)
    try:
        logs = _load_reflections_local()
        entry = {
            "timestamp": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "category": category,
            "content": content,
            "level": level
        }
        logs.insert(0, entry)
        if len(logs) > 50:
            logs = logs[:50]
        _save_reflections_local(logs)
    except Exception as e:
        logger.error(f"MemoryOps Local File Error: {e}")
    
    return f"已记录反思日志 [{level.upper()}] {category}: {content} {db_status}"

async def read_reflections(limit: int = 5) -> str:
    """
    查阅最近的自我反思记录。
    优先从数据库读取。
    """
    try:
        limit = int(limit)
    except:
        limit = 5

    logs_text = ""
    session = _CURRENT_SESSION_CONTEXT.get("db_session")
    
    # Try DB first
    if session and Memory:
        try:
            statement = select(Memory).where(Memory.type == "reflection").order_by(desc(Memory.timestamp)).limit(limit)
            memories = (await session.exec(statement)).all()
            
            if memories:
                logs_text = "【我的错题本 (来自记忆数据库)】\n"
                for m in memories:
                    # Parse tags to find level/category if possible, or just use content
                    # tags format: reflection,category,level
                    level_tag = "INFO"
                    if m.tags:
                        if "critical" in m.tags: level_tag = "CRITICAL"
                        elif "warning" in m.tags: level_tag = "WARNING"
                    
                    logs_text += f"- [{m.realTime}] ({level_tag}) {m.content}\n"
                return logs_text.strip()
        except Exception as e:
            logger.error(f"MemoryOps Read DB Error: {e}")

    # Fallback to local file
    logs = _load_reflections_local()
    recent_logs = logs[:limit]
    
    if not recent_logs:
        return "目前还没有反思记录哦，表现很棒！"
        
    result = "【我的错题本 (来自本地备份)】\n"
    for log in recent_logs:
        result += f"- [{log['timestamp']}] ({log['level'].upper()}) {log['category']}: {log['content']}\n"
        
    return result.strip()

async def read_diary(limit: int = 5) -> str:
    """
    阅读“熔炼后的日记” (Consolidated Memories)。
    这些是记忆秘书整理过的、优美的日记体记忆。
    """
    session = _CURRENT_SESSION_CONTEXT.get("db_session")
    if not session or not Memory:
        return "无法连接数据库，无法读取日记。"

    try:
        limit = int(limit)
    except:
        limit = 5

    try:
        # source='secretary_merge' 是我们在 memory_secretary_service.py 中看到的
        statement = select(Memory).where(Memory.source == "secretary_merge").order_by(desc(Memory.timestamp)).limit(limit)
        memories = (await session.exec(statement)).all()
        
        if not memories:
            return "还没有生成过日记 (Consolidated Memories)。可能需要等待记忆秘书运行一次维护任务。"
            
        result = "【我的日记 (Consolidated Memories)】\n"
        for m in memories:
            result += f"### {m.realTime}\n{m.content}\n\n"
            
        return result.strip()
    except Exception as e:
        return f"读取日记失败: {e}"

async def read_maintenance_reports(limit: int = 5) -> str:
    """
    阅读“秘书周报” (Maintenance Records)。
    查看记忆秘书最近做了哪些整理工作。
    """
    session = _CURRENT_SESSION_CONTEXT.get("db_session")
    if not session or not MaintenanceRecord:
        return "无法连接数据库，无法读取周报。"

    try:
        limit = int(limit)
    except:
        limit = 5

    try:
        statement = select(MaintenanceRecord).order_by(desc(MaintenanceRecord.timestamp)).limit(limit)
        records = (await session.exec(statement)).all()
        
        if not records:
            return "还没有维护记录。"
            
        result = "【秘书工作周报 (Maintenance Records)】\n"
        for r in records:
            result += f"- [{r.timestamp.strftime('%Y-%m-%d %H:%M:%S')}] "
            result += f"提取偏好:{r.preferences_extracted}, "
            result += f"重要标记:{r.important_tagged}, "
            result += f"合并记忆:{r.consolidated}, "
            result += f"清理垃圾:{r.cleaned_count}\n"
            
        return result.strip()
    except Exception as e:
        return f"读取周报失败: {e}"

async def read_memory_by_cluster(cluster_name: str, limit: int = 10) -> str:
    """
    根据记忆簇 (Cluster) 读取记忆。
    例如读取 "[反思簇]" 或其他自定义簇的记忆。
    """
    session = _CURRENT_SESSION_CONTEXT.get("db_session")
    if not session or not Memory:
        return "无法连接数据库，无法读取记忆簇。"

    try:
        limit = int(limit)
    except:
        limit = 10

    try:
        # 使用 contains 来匹配，因为 clusters 可能是逗号分隔的字符串
        statement = select(Memory).where(Memory.clusters.contains(cluster_name)).order_by(desc(Memory.timestamp)).limit(limit)
        memories = (await session.exec(statement)).all()
        
        if not memories:
            return f"在簇 '{cluster_name}' 中没有找到记忆。"
            
        result = f"【记忆簇: {cluster_name}】\n"
        for m in memories:
            result += f"- [{m.realTime}] {m.content}\n"
            
        return result.strip()
    except Exception as e:
        return f"读取记忆簇失败: {e}"

# --- Task/Schedule Operations ---

async def add_schedule_task(time: str, content: str, type: str = "reminder") -> str:
    """
    Add a scheduled task (reminder or topic).
    """
    session = _CURRENT_SESSION_CONTEXT.get("db_session")
    if not session or not ScheduledTask:
        return "Error: Database session not available."
    
    try:
        # Validate time format
        datetime.datetime.strptime(time, "%Y-%m-%d %H:%M:%S")
        
        task = ScheduledTask(
            time=time,
            content=content,
            type=type,
            is_triggered=False
        )
        session.add(task)
        await session.commit()
        return f"Successfully added {type}: '{content}' at {time} (ID: {task.id})"
    except ValueError:
        return "Error: Invalid time format. Please use 'YYYY-MM-DD HH:mm:ss'."
    except Exception as e:
        return f"Error adding task: {str(e)}"

async def list_pending_tasks() -> str:
    """List all pending scheduled tasks."""
    session = _CURRENT_SESSION_CONTEXT.get("db_session")
    if not session or not ScheduledTask:
        return "Error: Database session not available."
    
    tasks = (await session.exec(select(ScheduledTask).where(ScheduledTask.is_triggered == False))).all()
    if not tasks:
        return "No pending tasks."
    
    result = "Pending Tasks:\n"
    for t in tasks:
        result += f"- [ID: {t.id}] {t.type.upper()} at {t.time}: {t.content}\n"
    return result

async def delete_schedule_task(task_id: int) -> str:
    """Delete a scheduled task by ID."""
    session = _CURRENT_SESSION_CONTEXT.get("db_session")
    if not session or not ScheduledTask:
        return "Error: Database session not available."
    
    task = await session.get(ScheduledTask, task_id)
    if not task:
        return f"Error: Task with ID {task_id} not found."
    
    await session.delete(task)
    await session.commit()
    return f"Successfully deleted task {task_id}."

async def add_pre_action(delay_seconds: int, content: str) -> str:
    """
    Add a pre-action (reaction) task.
    These tasks are triggered after a delay, but WILL BE CANCELLED if the user interacts before the timer expires.
    """
    session = _CURRENT_SESSION_CONTEXT.get("db_session")
    if not session or not ScheduledTask:
        return "Error: Database session not available."
    
    try:
        delay_seconds = int(delay_seconds)
        if delay_seconds <= 0:
            return "Error: delay_seconds must be positive."
            
        trigger_time = datetime.datetime.now() + datetime.timedelta(seconds=delay_seconds)
        time_str = trigger_time.strftime("%Y-%m-%d %H:%M:%S")
        
        task = ScheduledTask(
            time=time_str,
            content=content,
            type="reaction",  # Special type that gets cancelled on user input
            is_triggered=False
        )
        session.add(task)
        await session.commit()
        return f"Successfully added reaction: '{content}' in {delay_seconds} seconds (at {time_str}). Note: This will be cancelled if the user speaks."
    except Exception as e:
        return f"Error adding pre-action: {str(e)}"
