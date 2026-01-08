import re
import numpy as np
from typing import Dict, Any, List
import datetime
from sqlmodel import select
from models import Config, PetState
from .base import BasePreprocessor
from services.embedding_service import embedding_service

class UserInputPreprocessor(BasePreprocessor):
    """
    Extracts the user's text message from the input messages list.
    Handles multimodal content.
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
                        # Attempt to extract text from multimodal content
                        texts = [item["text"] for item in content if item.get("type") == "text"]
                        user_message = " ".join(texts)
                    break
        
        context["user_message"] = user_message
        context["is_multimodal"] = is_multimodal
        return context

class HistoryPreprocessor(BasePreprocessor):
    """
    Fetches and cleans conversation history from the database.
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
            history_logs = await memory_service.get_recent_logs(session, source, session_id, limit=80)
        except Exception as e:
            print(f"[HistoryPreprocessor] Failed to fetch history logs: {e}")
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
        
        # We don't merge them into "messages" yet, we keep them separate to allow flexibility
        # But commonly we might want to have a "full_context_messages" list
        context["full_context_messages"] = history_messages + current_messages
        
        return context

class RAGPreprocessor(BasePreprocessor):
    """
    Retrieves relevant memories and PetState.
    """
    @property
    def name(self) -> str:
        return "RAGInjector"

    async def _get_pet_state(self, session) -> PetState:
        from sqlmodel import desc
        state = (await session.exec(select(PetState).order_by(desc(PetState.updated_at)).limit(1))).first()
        if not state:
            state = PetState()
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
        
        # Get PetState
        pet_state = await self._get_pet_state(session)
        
        # Get User Configs
        configs = {c.key: c.value for c in (await session.exec(select(Config))).all()}
        owner_name = configs.get("owner_name", "主人")
        user_persona = configs.get("user_persona", "未设定")

        # Get Relevant Memories
        try:
            # [Feature] Thinking Pipeline: Automatic Chain Triggering
            from services.chain_service import chain_service
            
            # 1. Attempt to route to a thinking chain
            chain_name = chain_service.route_chain(user_message)
            memory_context = ""
            
            if chain_name:
                print(f"[RAGPreprocessor] Triggering Thinking Chain: {chain_name}")
                chain_result = await chain_service.execute_chain(session, chain_name, user_message)
                formatted_chain = chain_service.format_chain_result(chain_result)
                
                if formatted_chain:
                    memory_context = formatted_chain
                    # Note: We skip standard RAG if chain is successful to maintain "Inertia Channel" focus.
                else:
                    print(f"[RAGPreprocessor] Chain {chain_name} returned no results, falling back to standard RAG.")
                    chain_name = None # Fallback
            
            # 2. Standard RAG (Fallback or Default)
            if not chain_name:
                # Weighted Vector: User (0.5), Assistant (0.35), Tool (0.15)
                
                query_vec = None
                if full_context_messages:
                    # Helper for content purification
                    def purify(text):
                        if not isinstance(text, str): return ""
                        # 使用 Rust Core 进行高性能清洗
                        try:
                            from pero_memory_core import clean_text
                            return clean_text(text)
                        except ImportError:
                            # Fallback to Python implementation
                            # Remove base64 images and large tech tags
                            import re
                            text = re.sub(r'data:image/[^;]+;base64,[^"\'\s>]+', '[IMAGE_DATA]', text)
                            text = re.sub(r'<([A-Z_]+)>.*?</\1>', r'<\1>[OMITTED]</\1>', text, flags=re.S)
                            return text[:2000].strip()

                    # Find candidates
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
                    
                    # Encode and Merge
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
                memories = await memory_service.get_relevant_memories(
                    session, 
                    user_message, 
                    exclude_after_time=earliest_timestamp,
                    query_vec=query_vec
                )
                
                # [Feature] RAG Refresh Block Construction
                # Create a metadata-rich comment block for dynamic refreshing
                if memories:
                    # Construct metadata for refresh
                    # We store the query vector (or its origin components) and other context
                    # to allow the frontend or future processors to re-fetch if needed.
                    # Since we don't have a JS frontend to parse comments yet, 
                    # we implement this as a server-side "Refreshable Block" concept.
                    
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
        
        if not user_message:
            return context

        # Perform logical flashback
        try:
            flashback = await memory_service.logical_flashback(session, user_message, limit=5)
            
            graph_context = ""
            if flashback:
                # Format the flashback fragments
                fragments = [item["name"] for item in flashback]
                graph_context = "关联思绪: " + ", ".join(fragments)
                print(f"[GraphFlashback] Found {len(fragments)} fragments: {fragments}")
            
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
    Constructs the final system prompt using PromptManager.
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

        final_messages = prompt_manager.compose_messages(
            full_context_messages, 
            variables, 
            is_voice_mode=is_voice_mode
        )
        
        # [NIT Security] Inject Dynamic Handshake ID into System Prompt
        if nit_id and final_messages and final_messages[0]["role"] == "system":
            from nit_core.security import NITSecurityManager
            security_prompt = NITSecurityManager.get_injection_prompt(nit_id)
            final_messages[0]["content"] += "\n" + security_prompt
        
        context["final_messages"] = final_messages
        return context
