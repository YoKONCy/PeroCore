import re
import numpy as np
from typing import Dict, Any, List
import datetime
from sqlmodel import select
from models import Config, PetState, ConversationLog
from .base import BasePreprocessor
from services.embedding_service import embedding_service
from sqlmodel import select, desc

class UserInputPreprocessor(BasePreprocessor):
    """
    从输入消息列表中提取用户的文本消息。
    处理多模态内容。
    """
    @property
    def name(self) -> str:
        return "UserInputExtractor"

    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        messages = context.get("messages", [])
        user_text_override = context.get("user_text_override")
        
        user_message = user_text_override if user_text_override else ""
        is_multimodal = False
        
        if not user_message:
            for m in reversed(messages):
                if m["role"] == "user":
                    content = m.get("content", "")
                    if isinstance(content, str):
                        user_message = content
                    elif isinstance(content, list):
                        is_multimodal = True
                        # 尝试从多模态内容中提取文本
                        texts = [item["text"] for item in content if item.get("type") == "text"]
                        user_message = " ".join(texts)
                    break
        
        print(f"[UserInputPreprocessor] Extracted user_message: {user_message[:50]}...")
        context["user_message"] = user_message
        context["is_multimodal"] = is_multimodal
        return context

class HistoryPreprocessor(BasePreprocessor):
    """
    从数据库获取并清理对话历史。
    """
    @property
    def name(self) -> str:
        return "HistoryFetcher"

    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        session = context["session"]
        memory_service = context["memory_service"]
        source = context.get("source", "desktop")
        session_id = context.get("session_id", "default")
        current_messages = context.get("messages", [])

        # Fetch recent logs
        try:
            # [Context Window Adjustment]
            # Work Mode needs longer context for coding tasks.
            is_work_context = session_id.startswith("work_") or source == "ide"
            
            # 策略调整：先拉取足够多的日志 (例如 200 条)，然后基于 Token 进行截断
            limit = 200 if is_work_context else 40
            
            history_logs = await memory_service.get_recent_logs(session, source, session_id, limit=limit)
        except Exception as e:
            print(f"[HistoryPreprocessor] 获取历史日志失败: {e}")
            history_logs = []

        history_messages = []
        earliest_timestamp = None

        if history_logs:
            earliest_timestamp = history_logs[0].timestamp
            # print(f"[History] Context Window Start: {earliest_timestamp}")
            for log in history_logs:
                # Clean tags
                content = log.content
                
                content = re.sub(r'<!-- PERO_RAG_BLOCK_START.*?-->', '', content, flags=re.S)
                content = re.sub(r'<!-- PERO_RAG_BLOCK_END -->', '', content, flags=re.S)

                content = re.sub(r'<([A-Z_]+)>.*?</\1>', '', content, flags=re.S)
                content = re.sub(r'<[^>]+>', '', content)
                content = content.strip()
                if content:
                    history_messages.append({"role": log.role, "content": content})

        # [Token Based Truncation]
        # 如果处于工作模式，我们使用 100K Token 的滑动窗口策略
        if is_work_context and history_messages:
            try:
                import tiktoken
                enc = tiktoken.get_encoding("cl100k_base") # 适用于 GPT-4/GPT-3.5
                
                MAX_TOKENS = 100000 # 100K Limit
                current_tokens = 0
                truncated_history = []
                
                # 从最新的消息开始累加 (history_messages 是按时间顺序排列的，所以我们要倒序遍历)
                for msg in reversed(history_messages):
                    content = msg.get("content", "")
                    tokens = len(enc.encode(content))
                    
                    if current_tokens + tokens > MAX_TOKENS:
                        print(f"[History] Token limit reached ({current_tokens} + {tokens} > {MAX_TOKENS}). Truncating older messages.")
                        break
                    
                    current_tokens += tokens
                    truncated_history.insert(0, msg) # 保持原有顺序插入头部
                
                history_messages = truncated_history
                
            except ImportError:
                print("[History] tiktoken not found. Fallback to message count limit.")
                # Fallback: Keep last 100 messages if tiktoken fails
                if len(history_messages) > 100:
                    history_messages = history_messages[-100:]
            except Exception as e:
                print(f"[History] Token truncation failed: {e}")

        # Deduplication logic
        if current_messages and history_messages:
            def _safe_get_text(msg):
                c = msg.get("content", "")
                if isinstance(c, str):
                    return c.strip()
                elif isinstance(c, list):
                    return " ".join([item["text"] for item in c if item.get("type") == "text"]).strip()
                return ""

            first_msg_content = _safe_get_text(current_messages[0])
            match_index = -1
            for i in range(len(history_messages) - 1, -1, -1):
                if history_messages[i]["content"] == first_msg_content:
                    is_match = True
                    for j in range(1, min(len(current_messages), len(history_messages) - i)):
                        if history_messages[i+j]["content"] != _safe_get_text(current_messages[j]):
                            is_match = False
                            break
                    if is_match:
                        match_index = i
                        break
            
            if match_index != -1:
                history_messages = history_messages[:match_index]

        context["history_messages"] = history_messages
        context["earliest_timestamp"] = earliest_timestamp
        
        # 我们暂时不将它们合并到 "messages" 中，而是保持分离以提供灵活性
        # 但通常我们可能希望有一个 "full_context_messages" 列表
        context["full_context_messages"] = history_messages + current_messages
        
        return context

class RAGPreprocessor(BasePreprocessor):
    """
    检索相关记忆和 PetState。
    """
    @property
    def name(self) -> str:
        return "RAGInjector"

    async def _get_pet_state(self, session, agent_id="pero") -> PetState:
        from sqlmodel import desc
        state = (await session.exec(select(PetState).where(PetState.agent_id == agent_id).order_by(desc(PetState.updated_at)).limit(1))).first()
        if not state:
            state = PetState(agent_id=agent_id)
            session.add(state)
            await session.commit()
            await session.refresh(state)
        return state

    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        session = context["session"]
        memory_service = context["memory_service"]
        user_message = context.get("user_message", "")
        full_context_messages = context.get("full_context_messages", [])
        earliest_timestamp = context.get("earliest_timestamp")
        agent_id = context.get("agent_id", "pero")
        
        # 获取 PetState
        pet_state = await self._get_pet_state(session, agent_id)
        
        # 获取用户配置
        configs = {c.key: c.value for c in (await session.exec(select(Config))).all()}
        owner_name = configs.get("owner_name", "主人")
        user_persona = configs.get("user_persona", "未设定")

        # 获取相关记忆
        try:
            # [特性] 思考管道：自动链触发
            from services.chain_service import chain_service
            
            # 1. 尝试路由到思考链
            chain_name = chain_service.route_chain(user_message)
            memory_context = ""
            
            if chain_name:
                print(f"[RAGPreprocessor] 触发思考链: {chain_name}")
                chain_result = await chain_service.execute_chain(session, chain_name, user_message, agent_id=agent_id)
                formatted_chain = chain_service.format_chain_result(chain_result)
                
                if formatted_chain:
                    memory_context = formatted_chain
                    # 注意：如果链成功，我们跳过标准 RAG 以保持“惯性通道”的焦点。
                else:
                    print(f"[RAGPreprocessor] 链 {chain_name} 未返回结果，回退到标准 RAG。")
                    chain_name = None # 回退
            
            # 2. 标准 RAG（回退或默认）
            if not chain_name:
                # 加权向量：用户 (0.5)，助手 (0.35)，工具 (0.15)
                
                query_vec = None
                if full_context_messages:
                    # 内容清洗助手
                    def purify(text):
                        if not isinstance(text, str): return ""
                        # 使用 Rust Core 进行高性能清洗
                        try:
                            from pero_memory_core import clean_text
                            return clean_text(text)
                        except ImportError:
                            # 回退到 Python 实现
                            # 移除 base64 图片和大型技术标签
                            import re
                            text = re.sub(r'data:image/[^;]+;base64,[^"\'\s>]+', '[IMAGE_DATA]', text)
                            text = re.sub(r'<([A-Z_]+)>.*?</\1>', r'<\1>[OMITTED]</\1>', text, flags=re.S)
                            return text[:2000].strip()

                    # 查找候选
                    last_user = ""
                    last_assistant = ""
                    last_tool = ""
                    
                    for msg in reversed(full_context_messages):
                        role = msg.get("role")
                        content = msg.get("content", "")
                        if role == "user" and not last_user:
                            last_user = purify(content)
                        elif role == "assistant" and not last_assistant:
                            last_assistant = purify(content)
                        elif role == "tool" and not last_tool:
                            last_tool = purify(content)
                        
                        if last_user and last_assistant and last_tool:
                            break
                    
                    # 编码并合并
                    embeddings = []
                    weights = []
                    
                    if last_user:
                        embeddings.append(embedding_service.encode_one(last_user))
                        weights.append(0.5)
                    if last_assistant:
                        embeddings.append(embedding_service.encode_one(last_assistant))
                        weights.append(0.35)
                    if last_tool:
                        embeddings.append(embedding_service.encode_one(last_tool))
                        weights.append(0.15)
                    
                    if embeddings:
                        # Normalize weights to sum to 1.0 if not all roles are present
                        total_weight = sum(weights)
                        normalized_weights = [w / total_weight for w in weights]
                        
                        # Calculate weighted average
                        merged_vec = np.zeros_like(embeddings[0])
                        for emb, weight in zip(embeddings, normalized_weights):
                            merged_vec += np.array(emb) * weight
                        query_vec = merged_vec.tolist()

                # Perform Search
                print(f"[RAGPreprocessor] Searching relevant memories for: {user_message[:30]}...")
                memories = await memory_service.get_relevant_memories(
                    session, 
                    user_message, 
                    limit=10,
                    exclude_after_time=earliest_timestamp,
                    query_vec=query_vec,
                    agent_id=agent_id
                )
                print(f"[RAGPreprocessor] Found {len(memories) if memories else 0} memories.")
                
                # [特性] RAG 刷新块构建
                # 创建富含元数据的注释块以进行动态刷新
                if memories:
                    # 构建刷新元数据
                    # 我们存储查询向量（或其原始组件）和其他上下文
                    # 以允许前端或未来的处理器在需要时重新获取。
                    # 由于我们还没有 JS 前端来解析注释，
                    # 我们将其实现为服务器端“可刷新块”概念。
                    
                    refresh_metadata = {
                        "type": "rag_block",
                        "timestamp": datetime.datetime.now().isoformat(),
                        "query_context": {
                            "user_len": len(last_user) if 'last_user' in locals() else 0,
                            "assistant_len": len(last_assistant) if 'last_assistant' in locals() else 0
                        },
                        "memory_ids": [m.id for m in memories]
                    }
                    
                    # Format: <!-- PERO_RAG_BLOCK_START {json} --> ... content ... <!-- PERO_RAG_BLOCK_END -->
                    import json
                    meta_json = json.dumps(refresh_metadata)
                    
                    inner_content = "\n".join([f"- {m.content}" for m in memories])
                    memory_context = f"<!-- PERO_RAG_BLOCK_START {meta_json} -->\n{inner_content}\n<!-- PERO_RAG_BLOCK_END -->"
                else:
                    memory_context = "无相关记忆"
                
                # [Reinforcement] 
                # Note: mark_memories_accessed is now handled inside get_relevant_memories
                # to ensure consistency across all access paths (including fallback).

        except Exception as e:
            print(f"[RAGPreprocessor] Failed to retrieve memories: {e}")
            memory_context = "无相关记忆 (检索出错)"

        # Populate variables
        variables = context.get("variables", {})
        variables.update({
            "current_time": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "memory_context": memory_context,
            "mood": pet_state.mood,
            "vibe": pet_state.vibe,
            "mind": pet_state.mind,
            "owner_name": owner_name,
            "user_persona": user_persona,
        })
        context["variables"] = variables
        
        return context

class WeeklyReportPreprocessor(BasePreprocessor):
    """
    独立检索周报：每次对话最多只注入 1 条最相关的周报。
    """
    @property
    def name(self) -> str:
        return "WeeklyReportInjector"

    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        session = context["session"]
        memory_service = context["memory_service"]
        user_message = context.get("user_message", "")
        agent_id = context.get("agent_id", "pero")
        
        weekly_report_context = ""
        
        try:
            # 使用 get_relevant_memories 但限制类型为 weekly_report
            # 注意：我们需要确保 query_vec 是基于 user_message 的
            # 如果 user_message 为空，则取最新的
            
            reports = []
            
            if user_message:
                # 语义检索最相关的一条
                reports = await memory_service.get_relevant_memories(
                    session,
                    user_message,
                    limit=1,
                    filter_tags=["weekly_report"],
                    memory_type="weekly_report", # 确保只检索此类型
                    agent_id=agent_id
                )
            else:
                # 如果没有用户输入（可能是系统触发），则取最新的一条
                from models import Memory
                from sqlmodel import desc, col
                stmt = select(Memory).where(Memory.memory_type == "weekly_report").where(Memory.agent_id == agent_id).order_by(desc(Memory.timestamp)).limit(1)
                reports = (await session.exec(stmt)).all()
                
            if reports:
                report = reports[0]
                weekly_report_context = f"【相关周报】({report.realTime})\n{report.content}"
                print(f"[WeeklyReport] Injected report from {report.realTime}")
            
        except Exception as e:
            print(f"[WeeklyReport] Failed to retrieve report: {e}")
            
        variables = context.get("variables", {})
        variables["weekly_report_context"] = weekly_report_context
        context["variables"] = variables
        
        return context

class GraphFlashbackPreprocessor(BasePreprocessor):
    """
    Performs logical flashback on the memory graph to find associated fragments.
    """
    @property
    def name(self) -> str:
        return "GraphFlashback"

    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        session = context["session"]
        memory_service = context["memory_service"]
        user_message = context.get("user_message", "")
        agent_id = context.get("agent_id", "pero")
        
        if not user_message:
            print("[GraphFlashback] Skipping: No user_message")
            return context

        # Perform logical flashback
        try:
            print(f"[GraphFlashback] Starting logical_flashback for: {user_message[:30]}...")
            flashback = await memory_service.logical_flashback(session, user_message, limit=5, agent_id=agent_id)
            
            graph_context = ""
            if flashback:
                # Format the flashback fragments
                fragments = [item["name"] for item in flashback]
                graph_context = "关联思绪: " + ", ".join(fragments)
                print(f"[GraphFlashback] Found {len(fragments)} fragments: {fragments}")
            else:
                print("[GraphFlashback] No fragments found.")
            
            # Populate variables
            variables = context.get("variables", {})
            variables["graph_context"] = graph_context
            context["variables"] = variables
            
        except Exception as e:
            print(f"[GraphFlashback] Failed: {e}")
            
        return context

class ConfigPreprocessor(BasePreprocessor):
    """
    Loads LLM configuration and determines capabilities (Vision, Voice).
    """
    @property
    def name(self) -> str:
        return "ConfigLoader"
        
    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        
        agent_service = context.get("agent_service")
        if agent_service:
            config = await agent_service._get_llm_config()
        else:
            # Fallback or simplified logic
            config = {} 
        
        context["llm_config"] = config
        
        variables = context.get("variables", {})
        variables.update({
            "enable_vision": config.get("enable_vision", False),
            "enable_voice": config.get("enable_voice", False),
            "enable_video": config.get("enable_video", False),
            "vision_status": ""
        })
        context["variables"] = variables
        return context

class SystemPromptPreprocessor(BasePreprocessor):
    """
    使用 PromptManager 构建最终的系统提示词。
    """
    @property
    def name(self) -> str:
        return "SystemPromptBuilder"

    async def process(self, context: Dict[str, Any]) -> Dict[str, Any]:
        prompt_manager = context["prompt_manager"]
        variables = context.get("variables", {})
        full_context_messages = context.get("full_context_messages", [])
        is_voice_mode = context.get("is_voice_mode", False)
        nit_id = context.get("nit_id")
        
        # [Work Mode Detection]
        session_id = context.get("session_id", "default")
        source = context.get("source", "desktop")
        is_work_mode = session_id.startswith("work_") or source == "ide"

        # [Work Mode Context Injection]
        if is_work_mode:
            try:
                # 获取最近的非工作模式对话 (default session) 作为前情提要
                # 排除所有 work_ 开头的 session，只取日常对话
                stmt = select(ConversationLog).where(
                    ~ConversationLog.session_id.startswith("work_")
                ).order_by(desc(ConversationLog.timestamp)).limit(4)
                
                recent_logs = (await context["session"].exec(stmt)).all()
                # 结果是倒序的 (最新的在前)，我们需要反转回来按时间顺序显示
                recent_logs = sorted(recent_logs, key=lambda x: x.timestamp)
                
                # 获取当前 Bot Name
                from core.config_manager import get_config_manager
                config_mgr = get_config_manager()
                bot_name = config_mgr.get("bot_name", "Pero")

                context_str = ""
                if recent_logs:
                    context_str = "[近期日常对话回顾]\n"
                    for log in recent_logs:
                         role = "主人" if log.role == "user" else bot_name
                         # 简单的清理
                         content = re.sub(r'<[^>]+>', '', log.content).strip()
                         if len(content) > 100: content = content[:100] + "..."
                         context_str += f"- {role}: {content}\n"
                
                variables["recent_history_context"] = context_str
                
            except Exception as e:
                print(f"[SystemPromptBuilder] Failed to inject work mode context: {e}")
                variables["recent_history_context"] = ""

        final_messages = prompt_manager.compose_messages(
            full_context_messages, 
            variables, 
            is_voice_mode=is_voice_mode,
            is_work_mode=is_work_mode
        )
        
        # [NIT Security] 将动态握手 ID 注入系统提示词
        if nit_id and final_messages and final_messages[0]["role"] == "system":
            from nit_core.security import NITSecurityManager
            security_prompt = NITSecurityManager.get_injection_prompt(nit_id)
            final_messages[0]["content"] += "\n" + security_prompt
        
        context["final_messages"] = final_messages
        return context
