# Copyright (c) 2026 YoKONCy. All rights reserved.
# This software is licensed under the GNU General Public License v3.0.
# Any unauthorized commercial use or closed-source redistribution is a direct violation of the GPL-3.0 license.
# Original Repository: https://github.com/YoKONCy/PeroCore

import json
import re
import os
import tempfile
import asyncio
import uuid
from datetime import datetime
from typing import List, Dict, AsyncIterable, Any, Optional
from sqlmodel.ext.asyncio.session import AsyncSession
from services.memory_service import MemoryService
from services.llm_service import LLMService
from services.prompt_service import PromptManager
from services.scorer_service import ScorerService
from services.mcp_service import McpClient
from services.mdp.manager import MDPManager
from services.preprocessor.manager import PreprocessorManager
from services.preprocessor.implementations import (
    UserInputPreprocessor,
    HistoryPreprocessor,
    RAGPreprocessor,
    GraphFlashbackPreprocessor,
    ConfigPreprocessor,
    SystemPromptPreprocessor
)
from services.postprocessor.manager import PostprocessorManager
from services.postprocessor.implementations import NITFilterPostprocessor, ThinkingFilterPostprocessor
from core.nit_manager import get_nit_manager
from models import Config, Memory, PetState, ScheduledTask, AIModelConfig, MCPConfig
from sqlmodel import select, desc
from nit_core.tools import TOOLS_MAPPING, TOOLS_DEFINITIONS, plugin_manager
from nit_core.tools.core.ScreenVision.screen_ocr import get_screenshot_base64, save_screenshot
from nit_core.tools.core.SessionOps.session_ops import set_current_session_context
from nit_core.tools.core.WindowsOps.windows_ops import get_active_windows
from nit_core.security import NITSecurityManager

from services.task_manager import task_manager

class AgentService:
    def __init__(self, session: AsyncSession):
        self.session = session
        set_current_session_context(session) # Inject session for tool ops
        self.memory_service = MemoryService()
        self.scorer_service = ScorerService(session)
        self.prompt_manager = PromptManager()
        
        # Initialize Reflection MDP
        reflection_mdp_dir = os.path.join(os.path.dirname(__file__), "mdp", "reflection")
        self.reflection_mdp = MDPManager(reflection_mdp_dir)
        
        # Initialize Helper MDP
        helper_mdp_dir = os.path.join(os.path.dirname(__file__), "mdp", "helper")
        self.helper_mdp = MDPManager(helper_mdp_dir)
        
        # Initialize Preprocessor Pipeline
        self.preprocessor_manager = PreprocessorManager()
        self.preprocessor_manager.register(UserInputPreprocessor())
        self.preprocessor_manager.register(HistoryPreprocessor())
        self.preprocessor_manager.register(RAGPreprocessor())
        self.preprocessor_manager.register(GraphFlashbackPreprocessor())
        self.preprocessor_manager.register(ConfigPreprocessor())
        self.preprocessor_manager.register(SystemPromptPreprocessor())

        # Initialize Postprocessor Pipeline
        self.postprocessor_manager = PostprocessorManager()
        self.postprocessor_manager.register(NITFilterPostprocessor())
        self.postprocessor_manager.register(ThinkingFilterPostprocessor())

    def _log_to_file(self, msg: str):
        try:
            # Use absolute path to ensure log file is created in backend directory
            data_dir = os.environ.get("PERO_DATA_DIR", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
            log_path = os.path.join(data_dir, "debug_vision.log")
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(f"{datetime.now()} {msg}\n")
        except Exception as e:
            print(f"Failed to write to log file: {e}")

    async def _get_reflection_config(self) -> Dict[str, Any]:
        """获取反思模型配置"""
        configs = {c.key: c.value for c in (await self.session.exec(select(Config))).all()}
        
        if configs.get("reflection_enabled") != "true":
            return None

        reflection_model_id = configs.get("reflection_model_id")
        if not reflection_model_id:
            return None

        try:
            model_config = await self.session.get(AIModelConfig, int(reflection_model_id))
            if not model_config:
                return None
            
            global_api_key = configs.get("global_llm_api_key", "")
            global_api_base = configs.get("global_llm_api_base", "https://api.openai.com")

            final_api_key = model_config.api_key if model_config.provider_type == 'custom' else global_api_key
            final_api_base = model_config.api_base if model_config.provider_type == 'custom' else global_api_base

            return {
                "api_key": final_api_key,
                "api_base": final_api_base,
                "model": model_config.model_id,
                "temperature": 0.1, # 反思需要理性，低温
                "enable_vision": model_config.enable_vision
            }
        except Exception as e:
            print(f"Error getting reflection config: {e}")
            return None

    async def _analyze_file_results_with_aux(self, user_query: str, file_results: List[str]) -> Optional[str]:
        """
        使用辅助模型分析文件搜索结果
        """
        try:
            # 1. 检查是否启用了辅助模型
            aux_model_config = (await self.session.exec(
                select(AIModelConfig).where(AIModelConfig.name == "辅助模型")
            )).first()
            
            if not aux_model_config:
                print("[Agent] No auxiliary model configured, skipping analysis.")
                return None

            print(f"[Agent] Using auxiliary model ({aux_model_config.model_id}) to analyze search results...")
            
            # 2. 准备 Prompt
            # 限制文件数量以避免 Context Window 爆炸
            preview_files = file_results[:50] 
            files_text = "\n".join(preview_files)
            
            system_prompt = self.helper_mdp.render("file_analysis")
            
            user_prompt = (
                f"用户请求: {user_query}\n\n"
                f"搜索到的文件列表 (前 {len(preview_files)} 个):\n{files_text}\n\n"
                "请分析哪些文件最可能是用户想要的？"
            )
            
            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
            
            # 3. 调用辅助模型
            # 构造辅助 LLMService 实例
            # 注意：需要从 Config 中获取全局 API Key/Base 如果辅助模型配置为使用全局
            configs = {c.key: c.value for c in (await self.session.exec(select(Config))).all()}
            global_api_key = configs.get("global_llm_api_key", "")
            global_api_base = configs.get("global_llm_api_base", "https://api.openai.com")

            aux_api_key = aux_model_config.api_key if aux_model_config.provider_type == 'custom' else global_api_key
            aux_api_base = aux_model_config.api_base if aux_model_config.provider_type == 'custom' else global_api_base

            aux_llm = LLMService(
                api_key=aux_api_key,
                api_base=aux_api_base,
                model=aux_model_config.model_id
            )

            # 调用 chat 方法
            response = await aux_llm.chat(messages, temperature=0.3)
            return response["choices"][0]["message"]["content"]
                
        except Exception as e:
            print(f"[Agent] Error in aux analysis: {e}")
            return None
                
            return response_text

        except Exception as e:
            print(f"[Agent] Auxiliary analysis failed: {e}")
            return None

    async def _analyze_screen_with_mcp(self, mcp_client: Optional[McpClient] = None) -> Optional[str]:
        """通过 MCP 调用视觉模型分析当前屏幕"""
        print("\n[Vision] Starting screen analysis...", flush=True)
        
        self._log_to_file("Starting screen analysis")
        
        # 如果外部没有传入 mcp_client，则尝试从已启用的客户端中寻找具备视觉能力的
        if not mcp_client:
            try:
                clients = await self._get_mcp_clients()
                for client in clients:
                    # 简单检查客户端是否包含视觉工具关键词
                    try:
                        tools = await client.list_tools()
                        vision_keywords = ["vision", "analyze_image", "screen_analysis", "describe_image", "see_screen", "screenshot_analysis", "ocr"]
                        if any(any(k in t["name"].lower() for k in vision_keywords) for t in tools):
                            mcp_client = client
                            print(f"[Vision] Found vision-capable client: {client.name}")
                            break
                    except:
                        continue
                
                # 如果没找到，退而求其次用第一个
                if not mcp_client and clients:
                    mcp_client = clients[0]
                    print(f"[Vision] No specific vision client found, using first available: {mcp_client.name}")
            except Exception as e:
                msg = f"[Vision] Failed to get MCP clients: {e}"
                print(msg, flush=True)
                self._log_to_file(msg)
                return f"❌ 视觉功能不可用：获取 MCP 客户端失败 ({e})"
            
        if not mcp_client:
            msg = "[Vision] No MCP client configured."
            print(msg, flush=True)
            self._log_to_file(msg)
            # 调试：打印当前库中所有的配置键
            try:
                keys = (await self.session.exec(select(Config.key))).all()
                print(f"[Vision] Available config keys: {keys}", flush=True)
            except Exception as e:
                print(f"[Vision] Failed to list config keys: {e}", flush=True)
            return "❌ 视觉功能不可用：未配置 MCP 服务器。请在设置中添加支持视觉能力的 MCP 服务器配置（如 GLM-4V）。"

    async def _analyze_screen_with_mcp(self) -> str:
        """
        [已弃用] 旧版 MCP 视觉分析方法
        现已迁移至 NIT 架构，此方法保留仅为防止运行时 AttributeError，实际不应被调用。
        """
        return "⚠️ 此功能已迁移至 NIT 插件系统。"

    async def _run_reflection(self, task: str, history: str, screenshot_base64: str = None) -> str:
        """运行反思逻辑"""
        config = await self._get_reflection_config()
        if not config:
            return None
            
        print("[Reflection] Triggering reflection...")
        
        # 视觉分析已迁移至 NIT，反思逻辑暂不强依赖视觉预分析
        vision_analysis = None
        is_blind = not config.get("enable_vision")

        llm = LLMService(
            api_key=config.get("api_key"),
            api_base=config.get("api_base"),
            model=config.get("model")
        )
        
        # 根据视觉能力状态动态调整 Prompt
        vision_prompt_name = "vision_enabled" if not is_blind else "vision_disabled"
        vision_instruction_block = "{{" + vision_prompt_name + "}}"

        # 生成工具列表字符串
        tools_list_str = ""
        # 动态获取最新工具定义
        # current_tools_defs = plugin_manager.get_all_definitions() 
        
        # 改用符合 NIT 协议的筛选逻辑：必须经过 NIT Manager 的启用检查
        nit_manager = get_nit_manager()
        current_tools_defs = []
        
        for plugin_name, manifest in plugin_manager.plugins.items():
            # 1. 检查分类开关 (Level 1)
            category = manifest.get("_category", "plugins") # 默认为 plugins
            if not nit_manager.is_category_enabled(category):
                continue
                
            # 2. 检查插件开关 (Level 2)
            if not nit_manager.is_plugin_enabled(plugin_name):
                continue
            
            # 3. 提取工具定义
            if "capabilities" in manifest and "invocationCommands" in manifest["capabilities"]:
                current_tools_defs.extend(manifest["capabilities"]["invocationCommands"])
            elif "capabilities" in manifest and "toolDefinitions" in manifest["capabilities"]:
                current_tools_defs.extend(manifest["capabilities"]["toolDefinitions"])
        
        for tool_def in current_tools_defs:
            if "function" in tool_def:
                func = tool_def["function"]
                name = func.get("name", "unknown")
                desc = func.get("description", "No description")
                tools_list_str += f"- {name}: {desc}\n"
            elif "name" in tool_def: # 支持 NIT 风格的定义
                name = tool_def.get("name", "unknown")
                desc = tool_def.get("description", "No description")
                tools_list_str += f"- {name}: {desc}\n"
            elif "commandIdentifier" in tool_def: # 支持 NIT 2.0 风格定义
                name = tool_def.get("commandIdentifier", "unknown")
                desc = tool_def.get("description", "No description")
                tools_list_str += f"- {name}: {desc}\n"

        system_prompt = f"""你是一个专业的 UI 自动化操作反思助手。你的任务是分析当前的操作结果是否符合预期，以及是否陷入了死循环。

**可用工具列表**:
{tools_list_str}

**Prompt Debug Info**:
Tool List Length: {len(tools_list_str)}

请仔细对比用户的任务目标和当前的近期操作历史。
1. **工具参数校验**: 检查上一步工具调用是否因为参数错误（如 browser_click 误传了 url 参数）而失败。请务必根据【可用工具列表】检查工具名称是否存在。
{vision_instruction}
3. **决策建议**: 如果发现问题，请明确指出原因并给出修正建议。
   - **严禁臆造不存在的工具**（如 `browser_search`），只能从【可用工具列表】中选择。
   - 如果用户想搜索，应建议使用 `browser_open_url` 打开搜索引擎，然后使用 `browser_input` 和 `browser_click`。
   - 如果一切正常，只需回答"NORMAL"。
"""
        user_content = f"任务目标: {task}\n\n近期操作历史:\n{history}"
        
        if vision_analysis:
            user_content += f"\n\n[当前屏幕视觉分析]:\n{vision_analysis}"
            print(f"[Reflection] Added vision analysis to context.")
        
        messages = [
            {"role": "system", "content": system_prompt}
        ]
        
        # 组装用户消息内容
        content = [{"type": "text", "text": user_content}]
        
        # 如果提供了截图且模型支持多模态，则注入图片
        if screenshot_base64 and config.get("enable_vision"):
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/png;base64,{screenshot_base64}"}
            })
            print(f"[Reflection] Injected screenshot into reflection context.")
        
        messages.append({"role": "user", "content": content})

        try:
            response = await llm.chat(messages, temperature=config.get("temperature", 0.7))
            content = response["choices"][0]["message"]["content"]
            print(f"[Reflection] Result: {content}")
            return content
        except Exception as e:
            print(f"[Reflection] Error: {e}")
            return None

    async def _get_llm_config(self) -> Dict[str, Any]:
        # 1. 获取全局配置
        configs = {c.key: c.value for c in (await self.session.exec(select(Config))).all()}
        
        global_api_key = configs.get("global_llm_api_key", "")
        global_api_base = configs.get("global_llm_api_base", "https://api.openai.com")
        current_model_id = configs.get("current_model_id")

        # 默认回退配置
        fallback_config = {
            "api_key": global_api_key or configs.get("ppc.apiKey", ""), # 兼容旧key
            "api_base": global_api_base or configs.get("ppc.apiBase", "https://api.openai.com"),
            "model": configs.get("ppc.modelName", "gpt-3.5-turbo"),
            "temperature": 0.7,
            "enable_vision": False
        }

        # 2. 如果没有选中模型，使用默认/回退配置
        if not current_model_id:
            return fallback_config

        # 3. 获取选中模型卡片
        try:
            model_config = await self.session.get(AIModelConfig, int(current_model_id))
            if not model_config:
                return fallback_config
        except ValueError:
            return fallback_config

        # 4. 组装配置
        final_api_key = model_config.api_key if model_config.provider_type == 'custom' else global_api_key
        final_api_base = model_config.api_base if model_config.provider_type == 'custom' else global_api_base
        
        return {
            "api_key": final_api_key,
            "api_base": final_api_base,
            "model": model_config.model_id,
            "temperature": model_config.temperature,
            "enable_vision": model_config.enable_vision
        }

    async def _get_pet_state(self) -> PetState:
        state = (await self.session.exec(select(PetState).order_by(desc(PetState.updated_at)).limit(1))).first()
        if not state:
            state = PetState()
            self.session.add(state)
            await self.session.commit()
            await self.session.refresh(state)
        return state

    async def handle_proactive_observation(self, intent_description: str, score: float):
        """
        Handle a proactive visual observation from AuraVision.
        """
        # 1. Check if we should talk now
        # TODO: Implement more complex gating (e.g. check last talk time)
        print(f"[Agent] Proactive observation received: {intent_description} (Score: {score:.4f})")
        
        # 2. Construct an internal sensing prompt
        internal_prompt = f"""
[PERO_INTERNAL_SENSE]
视觉意图: "{intent_description}"
置信度: {score:.4f}

请观察当前环境和你的记忆。如果你觉得现在是与主人说话的好时机，请立即行动。
如果主人正忙或你没有什么有意义的话要说，请保持安静（输出 <NOTHING>）。
"""
        # 3. Trigger a special session
        # This would involve calling self.process_request with a pseudo-user message
        # but marked as an internal trigger.
        pass

    async def _get_mcp_clients(self) -> List[McpClient]:
        """获取所有已启用的 MCP 客户端"""
        clients = []
        # 1. 尝试从新版通用 MCP 配置表中获取
        try:
            # 获取所有配置，无论是否启用，以此判断新表是否有数据
            all_mcp_configs = (await self.session.exec(select(MCPConfig))).all()
            
            if all_mcp_configs:
                print(f"[AgentService] Found {len(all_mcp_configs)} configs in MCPConfig table. Using as source of truth.")
                for mcp_config_obj in all_mcp_configs:
                    if not mcp_config_obj.enabled:
                        continue
                        
                    print(f"[AgentService] Loading enabled MCP config: {mcp_config_obj.name}")
                    client_config = {
                        "type": mcp_config_obj.type,
                        "name": mcp_config_obj.name
                    }
                    
                    if mcp_config_obj.type == "stdio":
                        client_config.update({
                            "command": mcp_config_obj.command,
                            "args": json.loads(mcp_config_obj.args or "[]"),
                            "env": json.loads(mcp_config_obj.env or "{}")
                        })
                    elif mcp_config_obj.type == "sse":
                        client_config.update({
                            "url": mcp_config_obj.url
                        })
                    
                    clients.append(McpClient(config=client_config))
                # 只要新表有数据（即使全部被禁用），就以此为准，不再向下回退
                return clients
        except Exception as e:
            print(f"[AgentService] Error querying MCPConfig table: {e}")

        # 只有当新表完全没数据时，才尝试获取旧版配置作为回退
        # 2. 尝试获取完整 JSON 配置
            try:
                json_config = (await self.session.exec(select(Config).where(Config.key == "mcp_config_json"))).first()
                
                if json_config and json_config.value:
                    try:
                        config_data = json.loads(json_config.value)
                        if "mcpServers" in config_data:
                            for name, server_config in config_data["mcpServers"].items():
                                # 检查是否启用 (默认为 True)
                                if not server_config.get("enabled", True):
                                    print(f"[AgentService] Skipping disabled MCP JSON config for server: {name}")
                                    continue
                                    
                                print(f"[AgentService] Found MCP JSON config for server: {name}")
                                # 确保配置中有名字
                                if "name" not in server_config:
                                    server_config["name"] = name
                                clients.append(McpClient(config=server_config))
                        else:
                            print(f"[AgentService] Found direct MCP JSON config")
                            clients.append(McpClient(config=config_data))
                    except Exception as e:
                        print(f"[AgentService] Failed to load MCP JSON config: {e}")
            except Exception as e:
                print(f"[AgentService] Error querying mcp_config_json: {e}")

            # 3. 回退到旧的 URL/Key 配置 (仅当仍没有客户端时)
            if not clients:
                try:
                    url_config = (await self.session.exec(select(Config).where(Config.key == "mcp_server_url"))).first()
                    
                    if url_config and url_config.value:
                        key_config = (await self.session.exec(select(Config).where(Config.key == "mcp_api_key"))).first()
                        api_key = key_config.value if key_config else None
                        
                        print(f"[AgentService] Falling back to old MCP URL config: {url_config.value}")
                        clients.append(McpClient(config={
                            "type": "sse",
                            "url": url_config.value,
                            "api_key": api_key,
                            "name": "Legacy-MCP"
                        }))
                except Exception as e:
                    print(f"[AgentService] Error querying mcp_server_url: {e}")

        return clients

    async def _save_parsed_metadata(self, text: str, source: str = "desktop", mcp_clients: List[McpClient] = None, execute_nit: bool = True, expected_nit_id: str = None) -> List[Dict[str, Any]]:
        """解析并保存 LLM 返回的元数据。现在主要负责 NIT 工具调用。"""
        try:
            # 1. 处理 NIT 工具调用 (核心逻辑)
            nit_results = []
            if execute_nit:
                # --- [Security Gate] 针对手机端的 NIT 脚本硬隔离 ---
                if source == "mobile":
                    sensitive_tool_keywords = ["screenshot", "screen", "windows", "shell", "cmd", "file", "app", "browser", "exec", "write"]
                    # 检查 text 中是否包含 <nit> 且内容涉及敏感词
                    if "<nit" in text and any(kw in text.lower() for kw in sensitive_tool_keywords):
                        print(f"[🛡️ Hard Security] Blocked NIT script execution from mobile: {text[:50]}...")
                        return [{"status": "error", "message": "Permission Denied: NIT script contains restricted tools for mobile source."}]

                from nit_core.dispatcher import get_dispatcher
                nit_dispatcher = get_dispatcher()
                
                # 准备 MCP 插件 (如果存在)
                extra_plugins = None
                if mcp_clients:
                    try:
                        from nit_core.bridge import NITBridge
                        bridge = NITBridge(nit_dispatcher)
                        extra_plugins = await bridge.get_mcp_plugins(mcp_clients)
                    except Exception as e:
                        print(f"[Agent] Failed to bridge MCP tools to NIT: {e}")

                nit_results = await nit_dispatcher.dispatch(text, extra_plugins=extra_plugins, expected_nit_id=expected_nit_id)
                
                if nit_results:
                    print(f"[Agent] Executed {len(nit_results)} NIT tool calls")

            # 2. 传统 XML 标签解析 (已弃用，仅保留框架以防未来扩展)
            # 注意：状态更新 (PEROCUE, CLICK_MESSAGES 等) 已迁移至 UpdateStatusPlugin (NIT)
            # 长记忆 (MEMORY) 已由 ScorerService 独立处理
            
            await self.session.commit()
            return nit_results
        except Exception as e:
            await self.session.rollback()
            print(f"Error in _save_parsed_metadata: {e}")
            return []

    async def social_chat(self, messages: List[Dict[str, Any]], session_id: str) -> str:
        """
        Specialized chat mode for Social Interactions (QQ/OneBot).
        - Uses isolated session history.
        - Restricted toolset (Safe tools only).
        - Returns the final response text directly.
        """
        print(f"[SocialAgent] Processing social chat for session: {session_id}")
        
        # 1. Get Config (Use global config or specific social model)
        config = await self._get_llm_config()
        
        # 2. Prepare Tools (Whitelist Strategy)
        social_tools = []
        try:
            # We want to filter tools that are specifically for social mode.
            # Assuming PluginManager has loaded them and they are available in plugin_manager.
            all_tools = plugin_manager.get_all_definitions()
            
            # Whitelist of safe prefixes/names
            safe_prefixes = ["qq_"]
            safe_names = ["read_social_memory", "read_agent_memory", "notify_master"]
            
            for tool_def in all_tools:
                t_name = ""
                if "function" in tool_def:
                    t_name = tool_def["function"].get("name", "")
                elif "name" in tool_def:
                    t_name = tool_def.get("name", "")
                
                if any(t_name.startswith(p) for p in safe_prefixes) or t_name in safe_names:
                    social_tools.append(tool_def)
                    
            print(f"[SocialAgent] Loaded {len(social_tools)} social tools.")
        except Exception as e:
            print(f"[SocialAgent] Error loading tools: {e}")
            social_tools = []

        # 3. Call LLM
        llm = LLMService(
            api_key=config.get("api_key"),
            api_base=config.get("api_base"),
            model=config.get("model")
        )
        
        # We use a simplified loop for social mode (no complex reflection/vision for now)
        try:
            # Non-streaming call for simplicity in Phase 2 MVP
            response = await llm.chat(messages, temperature=0.7, tools=social_tools if social_tools else None)
            
            response_msg = response["choices"][0]["message"]
            content = response_msg.get("content", "")
            tool_calls = response_msg.get("tool_calls", [])
            
            # 4. Handle Tool Calls (Simple Loop)
            # If tool calls exist, execute them and recurse (limit 3 turns)
            # For MVP Phase 2, let's just execute and return the result or confirmation.
            
            if tool_calls:
                print(f"[SocialAgent] LLM requested {len(tool_calls)} tool calls.")
                # Append assistant message with tool calls
                messages.append(response_msg)
                
                for tc in tool_calls:
                    func_name = tc["function"]["name"]
                    args_str = tc["function"]["arguments"]
                    call_id = tc["id"]
                    
                    print(f"[SocialAgent] Executing tool: {func_name}")
                    
                    # Execute via NIT Dispatcher
                    from nit_core.dispatcher import get_dispatcher
                    dispatcher = get_dispatcher()
                    
                    # We need to construct the command string for dispatcher or call function directly
                    # Since dispatcher parses text, we might need to find the function in plugin_manager map
                    # Let's try to use plugin_manager directly or execute the python function if we can find it.
                    # Actually, AgentService._save_parsed_metadata uses dispatcher.dispatch(text).
                    # But here we have structured tool calls.
                    
                    # Quick fix: Use the tools_map in plugin_manager if available, or just use dispatcher's execute_tool if exposed.
                    # Looking at AgentService, it seems standard tool execution is manual in the loop.
                    
                    # Let's verify if we can just invoke the function from the tools definitions?
                    # No, definitions are JSON.
                    
                    # Let's use the PluginManager's tools_map which maps name -> callable
                    func = plugin_manager.tools_map.get(func_name)
                    tool_result = ""
                    
                    if func:
                        try:
                            import inspect
                            args = json.loads(args_str)
                            if inspect.iscoroutinefunction(func):
                                tool_result = await func(**args)
                            else:
                                tool_result = func(**args)
                        except Exception as e:
                            tool_result = f"Error executing {func_name}: {e}"
                    else:
                        tool_result = f"Tool {func_name} not found."
                        
                    # Append Tool Result
                    messages.append({
                        "tool_call_id": call_id,
                        "role": "tool",
                        "name": func_name,
                        "content": str(tool_result)
                    })
                    
                # Recursive call (Second turn)
                # For safety, just one recursion depth for now
                print("[SocialAgent] Sending tool results back to LLM...")
                response_2 = await llm.chat(messages, temperature=0.7, tools=social_tools)
                content = response_2["choices"][0]["message"].get("content", "")
                
            return content

        except Exception as e:
            print(f"[SocialAgent] Error: {e}")
            return f"[System Error] {str(e)}"

    async def _run_scorer_background(self, user_msg: str, assistant_msg: str, source: str, pair_id: str = None):
        """后台运行 Scorer 服务，使用独立 Session"""
        from database import engine
        from sqlmodel.ext.asyncio.session import AsyncSession
        from sqlalchemy.orm import sessionmaker
        
        try:
            async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            async with async_session() as session:
                scorer = ScorerService(session)
                await scorer.process_interaction(user_msg, assistant_msg, source, pair_id=pair_id)
        except Exception as e:
            print(f"[Agent] 后台秘书服务失败: {e}")

    async def _trigger_dream(self):
        """后台触发梦境机制"""
        try:
            from services.reflection_service import ReflectionService
            from database import engine
            from sqlmodel.ext.asyncio.session import AsyncSession
            from sqlalchemy.orm import sessionmaker
            import random
            
            print("[Agent] Spawning background dream task...", flush=True)
            async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
            async with async_session() as session:
                # Update last trigger time in Config
                now_str = datetime.now().isoformat()
                config_last_dream = await session.get(Config, "last_dream_trigger_time")
                if not config_last_dream:
                    config_last_dream = Config(key="last_dream_trigger_time", value=now_str)
                    session.add(config_last_dream)
                else:
                    config_last_dream.value = now_str
                    config_last_dream.updated_at = datetime.now()
                await session.commit()

                service = ReflectionService(session)

                # 1. 补录记忆 (Priority: Fix failures first)
                await service.backfill_failed_scorer_tasks()
        
                # 2. 孤独记忆扫描 (New Feature: Fix isolated memories)
                # 每次梦境周期扫描 3 个孤独记忆
                await service.scan_lonely_memories(limit=3)

                # 3. 关联挖掘 (High Priority)
                await service.dream_and_associate(limit=10)
                
                # 3. 记忆压缩 (Low Priority, 10% chance)
                if random.random() < 0.1:
                    # 默认配置: 压缩3天前的低价值记忆
                    await service.consolidate_memories(lookback_days=3, importance_threshold=4)

        except Exception as e:
            print(f"[Agent] Background dream failed: {e}")

    async def chat(self, messages: List[Dict[str, Any]], source: str = "desktop", session_id: str = "default", on_status: Optional[Any] = None, is_voice_mode: bool = False, user_text_override: str = None, skip_save: bool = False, system_trigger_instruction: str = None) -> AsyncIterable[str]:
        # [NIT Security] Generate ID for this request context
        current_nit_id = NITSecurityManager.generate_random_id()
        
        # Notify CompanionService of user activity to prevent interruption
        try:
            from services.companion_service import companion_service
            companion_service.update_activity()
        except ImportError:
            pass
        except Exception as e:
            print(f"[Agent] Failed to update companion activity: {e}")
            
        # Cancel any pending 'reaction' tasks because user is interacting
        if not system_trigger_instruction:
            try:
                # Assuming 'reaction' type tasks are those that should be cancelled on interaction
                statement = select(ScheduledTask).where(ScheduledTask.type == "reaction").where(ScheduledTask.is_triggered == False)
                tasks_to_cancel = (await self.session.exec(statement)).all()
                if tasks_to_cancel:
                    print(f"[Agent] User interaction detected. Cancelling {len(tasks_to_cancel)} pending reaction tasks.")
                    for t in tasks_to_cancel:
                        await self.session.delete(t)
                    await self.session.commit()
            except Exception as e:
                print(f"[Agent] Failed to cancel reaction tasks: {e}")

        # [Work Mode] Session Override
        # Check if we are in an active work session. If so, override the session_id to isolate history.
        # [Fix] Disabled global override to prevent hijacking of 'default' (Pet) session. 
        # IdeChat handles session resolution via ide_router.
        # try:
        #     config_session = (await self.session.exec(select(Config).where(Config.key == "current_session_id"))).first()
        #     if config_session and config_session.value and config_session.value != "default":
        #         original_session_id = session_id
        #         session_id = config_session.value
        #         print(f"[Agent] Work Mode Active: Overriding session_id '{original_session_id}' -> '{session_id}'")
        # except Exception as e:
        #     print(f"[Agent] Failed to check session override: {e}")

        print(f"[Agent] Chat request received. Source: {source}, Msg count: {len(messages)}, Voice: {is_voice_mode}")
        
        # 1. Initialize Context
        context = {
            "messages": messages,
            "source": source,
            "session_id": session_id,
            "session": self.session,
            "memory_service": self.memory_service,
            "prompt_manager": self.prompt_manager,
            "user_text_override": user_text_override,
            "is_voice_mode": is_voice_mode,
            "agent_service": self,
            "variables": {},
            "nit_id": current_nit_id,
        }
        
        # 2. Run Preprocessor Pipeline
        if on_status: await on_status("thinking", "正在整理记忆和思绪...")
        context = await self.preprocessor_manager.process(context)
        
        # 3. Extract Results
        user_message = context.get("user_message", "")
        final_messages = context.get("final_messages", [])
        config = context.get("llm_config", {})
        
        # [Feature] System Trigger Instruction
        if system_trigger_instruction:
            print(f"[Agent] Appending System Trigger Instruction: {system_trigger_instruction}")
            final_messages.append({
                "role": "system",
                "content": system_trigger_instruction
            })
            if not user_message:
                user_message = f"【系统触发】{system_trigger_instruction}"

        # [Feature] Mobile Source Awareness
        if source == "mobile":
            mobile_instruction = """
[SYSTEM_NOTE: MOBILE_MODE]
The user is currently communicating with you via a MOBILE device (Peroperochat).
- Desktop-only tools (e.g., open_app, windows_operation, screenshot) will execute on the OWNER'S PC, NOT the mobile device.
- Please AVOID using these tools unless explicitly asked to do something on the PC.
- Focus on natural conversation and emotional interaction.
"""
            final_messages.append({
                "role": "system",
                "content": mobile_instruction
            })
            print("[Agent] Mobile Source Awareness injected.")

        # [Feature] Active Window Injection
        # 注入当前活跃窗口列表，防止 AI 幻觉（以为应用已打开）
        try:
            active_windows = get_active_windows()
            if isinstance(active_windows, list) and active_windows:
                # Limit to avoid token explosion
                window_list_str = "\n".join(active_windows[:20]) 
                if len(active_windows) > 20:
                    window_list_str += f"\n... ({len(active_windows) - 20} more)"
                
                state_msg = f"""<system_state>
Current Active Windows (Taskbar):
{window_list_str}
</system_state>
Instruction: When opening an app, check this list first. If it's already running, use `windows_operation(action="activate", target="Name")` or just interact with it directly."""
                
                # Append to messages (System role)
                final_messages.append({
                    "role": "system",
                    "content": state_msg
                })
        except Exception as e:
            print(f"[Agent] Failed to inject active windows: {e}")
        
        # Fallback if config is missing (should not happen if ConfigPreprocessor runs)
        if not config:
            config = await self._get_llm_config()

        print(f"[Agent] Prompt composed via Preprocessors. Messages count: {len(final_messages)}")

        llm = LLMService(
            api_key=config.get("api_key"),
            api_base=config.get("api_base"),
            model=config.get("model")
        )
        temperature = config.get("temperature", 0.7)
        
        # 5. 合并动态 MCP 工具
        if on_status: await on_status("thinking", "正在加载工具...")
        print("[Agent] Loading MCP tools...")
        
        # --- 工具列表优化 ---
        # 根据主模型是否支持多模态，动态调整工具定义
        enable_vision = config.get("enable_vision", False)
        dynamic_tools = []
        for tool_def in TOOLS_DEFINITIONS:
            # 检查工具定义是否符合 OpenAI Function Calling 格式
            if "function" not in tool_def or "name" not in tool_def.get("function", {}):
                # 如果不是标准 Function 格式（例如纯 NIT 指令），则跳过 Native Tool 注册
                # 但它们依然会在 System Prompt 中可见（前面已处理）
                continue

            # 复制一份以防修改全局变量
            new_tool_def = json.loads(json.dumps(tool_def))
            tool_name = new_tool_def["function"]["name"]
            
            # 安全校验：如果是手机端且包含敏感词，则直接剔除
            sensitive_tool_keywords = ["screenshot", "screen", "windows", "shell", "cmd", "file", "app", "browser", "exec", "write"]
            if source == "mobile" and any(kw in tool_name.lower() for kw in sensitive_tool_keywords):
                print(f"[Security] Filtering sensitive tool for mobile: {tool_name}")
                continue
            
            # 如果是多模态模型，且工具是 screen_ocr，则跳过不注入
            if enable_vision and tool_name == "screen_ocr":
                continue
            
            if tool_name == "take_screenshot" or tool_name == "see_screen":
                if not enable_vision:
                    new_tool_def["function"]["description"] = "获取当前屏幕的视觉分析报告。系统将调用视觉 MCP 服务器分析屏幕内容并返回详细的文字描述。当你需要了解屏幕上的视觉信息、或出于好奇想看看主人在做什么但无法直接看到图片时，请使用此工具。"
                    # 非多模态模式下，count 参数可能没意义，或者我们只支持 1
                    new_tool_def["function"]["parameters"]["properties"]["count"]["description"] = "获取截图并分析的数量。在非多模态模式下，建议设为 1。"
            dynamic_tools.append(new_tool_def)
        
        # Log prepared tools for debugging
        print(f"[AgentService] Prepared {len(dynamic_tools)} tools: {[t['function']['name'] for t in dynamic_tools]}")
        # --- End 工具列表优化 ---
        
        mcp_clients = []
        try:
            mcp_clients = await self._get_mcp_clients()
            print(f"[Agent] Loaded {len(mcp_clients)} MCP Clients")
        except Exception as e:
            print(f"[Agent] Failed to get MCP clients: {e}")

        mcp_tool_map = {} # tool_name -> client
        for client in mcp_clients:
            try:
                mcp_tools = await client.list_tools()
                for tool in mcp_tools:
                    tool_name = f"mcp_{tool['name']}"
                    
                    # 同样对 MCP 工具实施安全校验
                    sensitive_tool_keywords = ["screenshot", "screen", "windows", "shell", "cmd", "file", "app", "browser", "exec", "write"]
                    if source == "mobile" and any(kw in tool_name.lower() for kw in sensitive_tool_keywords):
                        print(f"[Security] Filtering sensitive MCP tool for mobile: {tool_name}")
                        continue

                    # 如果有重名，后面的会覆盖前面的，或者我们可以加后缀
                    dynamic_tools.append({
                        "type": "function",
                        "function": {
                            "name": tool_name,
                            "description": tool.get("description", ""),
                            "parameters": tool.get("inputSchema", {})
                        }
                    })
                    mcp_tool_map[tool_name] = client
                    print(f"[Agent] Registered MCP tool: {tool_name} from {client.name}")
            except Exception as e:
                print(f"[AgentService] Warning: Failed to list tools for client {client.name}: {e}")

        # --- Native Tools Config ---
        disable_native_tools_config = (await self.session.exec(select(Config).where(Config.key == "disable_native_tools"))).first()
        disable_native_tools = disable_native_tools_config.value.lower() == "true" if disable_native_tools_config else False
        tools_to_pass = None if disable_native_tools else dynamic_tools
        if disable_native_tools:
            print("[Agent] Native Tools (Function Calling) are DISABLED via config.")

        full_response_text = ""
        accumulated_full_response = "" # 用于保存完整的对话记录（包含所有 ReAct 轮次的思考过程）
        pair_id = str(uuid.uuid4()) # 生成原子性绑定ID
        
        # --- ReAct Loop Configuration ---
        turn_count = 0
        MAX_TURNS = 30 # [Safety] Limit max turns to prevent infinite loops (was 9999)
        consecutive_error_count = 0 # 连续错误计数器

        # 注册任务管理器 (如果 session_id 存在)
        if session_id:
            task_manager.register(session_id)
        
        try:
            while turn_count < MAX_TURNS:
                # 1. 检查暂停状态
                if session_id:
                    # 如果暂停，这里会阻塞等待
                    await task_manager.check_pause(session_id)
                    
                    # 2. 检查是否有用户注入的指令
                    injected = task_manager.get_injected_instruction(session_id)
                    if injected:
                        print(f"[Agent] Detected injected instruction: {injected}")
                        final_messages.append({
                            "role": "user", 
                            "content": f"【主人即时指令】: {injected}"
                        })
                        # 注入指令后，直接进入下一轮思考，带上新的上下文

                turn_count += 1
                current_turn_text = ""
                has_tool_calls_in_this_turn = False
                collected_tool_calls = [] # 用于收集本轮流式返回的工具调用片段
                
                if on_status: await on_status("thinking", f"正在思考 (第 {turn_count} 轮)...")
                print(f"[Agent] Starting LLM stream (Turn {turn_count})...")
                
                # Define Raw Stream Generator
                async def raw_stream_source():
                    nonlocal current_turn_text, full_response_text, has_tool_calls_in_this_turn, collected_tool_calls
                    
                    async for delta in llm.chat_stream_deltas(final_messages, temperature=temperature, tools=tools_to_pass):
                        # Debug Log: Print delta content
                        # print(f"[Agent] Stream Delta: {delta}") 
                        
                        # 1. 处理文本内容 (Content)
                        content = delta.get("content", "")
                        if content:
                            current_turn_text += content
                            full_response_text += content
                            yield content
                        
                        # 2. 处理工具调用片段 (Tool Calls Delta)
                        if "tool_calls" in delta:
                            has_tool_calls_in_this_turn = True
                            for tc_delta in delta["tool_calls"]:
                                idx = tc_delta.get("index", 0)
                                while len(collected_tool_calls) <= idx:
                                    collected_tool_calls.append({
                                        "id": "", 
                                        "type": "function", 
                                        "function": {"name": "", "arguments": ""}
                                    })
                                
                                target = collected_tool_calls[idx]
                                if "id" in tc_delta: target["id"] = tc_delta["id"]
                                if "function" in tc_delta:
                                    fn_delta = tc_delta["function"]
                                    if "name" in fn_delta: target["function"]["name"] = fn_delta["name"]
                                    if "arguments" in fn_delta: target["function"]["arguments"] += fn_delta["arguments"]
                
                # Debug Log: After stream
                if has_tool_calls_in_this_turn:
                    print(f"[Agent] Collected Tool Calls: {json.dumps(collected_tool_calls, ensure_ascii=False)}")
                else:
                    print(f"[Agent] No tool calls detected in Turn {turn_count}")

                # Apply Postprocessor Pipeline
                processed_stream = self.postprocessor_manager.process_stream(
                    raw_stream_source(),
                    context={"source": source, "session_id": session_id}
                )

                async for content in processed_stream:
                    yield content

                # Check if turn is finished
                if not has_tool_calls_in_this_turn:
                    # No tools called, this is the final answer
                    
                    # === NIT Dispatcher Integration (Unified Flow) ===
                    # 检查是否有 NIT 调用指令，如果有则执行并进入下一轮
                    if full_response_text and full_response_text.strip():
                        # 注意：这里我们尝试执行 NIT，如果有结果，说明模型试图调用工具
                        nit_results = await self._save_parsed_metadata(full_response_text, source, mcp_clients, execute_nit=True, expected_nit_id=current_nit_id)
                        
                        if nit_results:
                            print(f"[Agent] Detected {len(nit_results)} NIT calls. Continuing conversation loop.")
                            
                            # 1. 将当前回复（包含 NIT 指令）追加到历史
                            # [Safety] Truncate extremely long responses to prevent context window explosion
                            safe_response_text = full_response_text
                            if len(safe_response_text) > 50000:
                                safe_response_text = safe_response_text[:50000] + "\n...(truncated by system for safety)"
                                print(f"⚠️ [Agent] Response truncated from {len(full_response_text)} to 50000 chars.")

                            final_messages.append({
                                "role": "assistant",
                                "content": safe_response_text
                            })
                            
                            # 2. 构造 Observation 消息
                            obs_text = "【系统通知：NIT工具执行反馈】\n"
                            has_screenshot_request = False
                            should_terminate_nit_loop = False
                            
                            for res in nit_results:
                                icon = "✅" if res['status'] == 'success' else "❌"
                                out_str = str(res['output'])
                                if len(out_str) > 2000: out_str = out_str[:2000] + "...(truncated)"
                                obs_text += f"{icon} 工具 [{res['plugin']}] 执行完成。\n结果:\n{out_str}\n\n"
                                
                                if res['plugin'] == 'finish_task':
                                    should_terminate_nit_loop = True

                                # 宽松匹配截图请求 (处理大小写和别名)
                                plugin_name_lower = res['plugin'].lower()
                                # 支持 'screenshot', 'see_screen' 等关键词
                                if ('screenshot' in plugin_name_lower or 'see_screen' in plugin_name_lower) and res['status'] == 'success':
                                    has_screenshot_request = True
                                    print(f"[Agent] Detected screenshot request in NIT: {res['plugin']}")
                            
                            # 3. 根据是否有多模态需求构造消息内容
                            enable_vision = config.get("enable_vision", False)
                            message_content = [{"type": "text", "text": obs_text}]
                            
                            if has_screenshot_request and enable_vision:
                                try:
                                    print("[Agent] Injecting screenshot for NIT call...")
                                    from services.screenshot_service import screenshot_manager
                                    # 强制捕获最新截图
                                    screenshot_data = screenshot_manager.capture()
                                    if screenshot_data:
                                        # 注入图片
                                        message_content.append({
                                            "type": "image_url",
                                            "image_url": {
                                                "url": f"data:image/png;base64,{screenshot_data['base64']}"
                                            }
                                        })
                                        # 更新文本提示，带上时间戳以区分旧图
                                        capture_time = screenshot_data.get('time_str', datetime.now().strftime("%H:%M:%S"))
                                        obs_text += f"\n[系统] 已附带最新屏幕截图 (Time: {capture_time})。"
                                        message_content[0]["text"] = obs_text
                                        print(f"[Agent] Screenshot injected successfully. Time: {capture_time}")
                                    else:
                                        print("[Agent] Screenshot capture returned None.")
                                        obs_text += "\n[系统] 尝试截图失败：无法获取图像数据。"
                                        message_content[0]["text"] = obs_text
                                except Exception as e:
                                    print(f"[Agent] Failed to inject screenshot for NIT: {e}")
                                    import traceback
                                    traceback.print_exc()
                                    obs_text += f"\n[系统] 尝试截图失败: {e}"
                                    message_content[0]["text"] = obs_text

                            final_messages.append({
                                "role": "user",
                                "content": message_content
                            })
                            
                            # 4. 检查连续错误熔断
                            has_error = any(res['status'] == 'error' for res in nit_results)
                            if has_error:
                                consecutive_error_count += 1
                                print(f"[Agent] NIT Tool error detected. Consecutive count: {consecutive_error_count}")
                            else:
                                consecutive_error_count = 0

                            if consecutive_error_count >= 3:
                                print(f"⚠️ [Agent] Consecutive errors ({consecutive_error_count}) reached limit via NIT. Forcing stop.")
                                final_messages.append({
                                    "role": "system",
                                    "content": "【系统紧急干预】监测到你已经连续操作失败 3 次。请立即停止任何后续的思考与工具调用，放弃当前任务，并主动向主人汇报失败原因。"
                                })
                                # 禁用后续工具调用
                                tools_to_pass = None

                            # 4.1 触发反思 (如果出错)
                            if has_error:
                                print(f"⚠️ [Agent] NIT Tool execution error detected, triggering reflection...")
                                history_context = "\n".join([f"{m['role']}: {str(m.get('content',''))[:200]}" for m in final_messages[-5:]])
                                # 尝试获取最新截图供反思使用
                                latest_screenshot = None
                                try:
                                    from services.screenshot_service import screenshot_manager
                                    shot = screenshot_manager.capture()
                                    if shot: latest_screenshot = shot["base64"]
                                except: pass
                                
                                reflection_advice = await self._run_reflection(user_message, history_context, latest_screenshot)
                                
                                if reflection_advice and "NORMAL" not in reflection_advice:
                                    final_messages.append({
                                        "role": "system",
                                        "content": f"[反思助手提示]: 检测到上一步操作可能存在问题。建议参考：{reflection_advice}"
                                    })

                            # 5. 重置状态，准备下一轮
                            accumulated_full_response += full_response_text + "\n"
                            full_response_text = ""
                            current_turn_text = "" 
                            collected_tool_calls = []
                            has_tool_calls_in_this_turn = False
                            
                            if should_terminate_nit_loop:
                                print("[Agent] NIT loop terminated by finish_task.")
                                break

                            # 4. 继续循环
                            continue

                    if turn_count == 1 and not full_response_text.strip():
                         print("[Agent] Stream finished without any deltas.")
                         self._log_to_file("Stream finished without any deltas.")
                         err_msg = "⚠️ AI 没有返回有效内容。请检查网络连接或 API Key 配置。"
                         full_response_text = err_msg
                         yield err_msg
                    break
                
                # --- Tool Execution Phase ---
                # 1. Append Assistant Message (Thought + Tool Calls) to history
                # [Safety] Truncate extremely long thought process
                safe_turn_text = current_turn_text if current_turn_text else None
                if safe_turn_text and len(safe_turn_text) > 50000:
                    safe_turn_text = safe_turn_text[:50000] + "\n...(truncated by system for safety)"

                assistant_msg = {
                    "role": "assistant",
                    "content": safe_turn_text,
                    "tool_calls": collected_tool_calls
                }
                final_messages.append(assistant_msg)
                
                # 2. Execute Tools
                intercepted_ui_data = {} # 存储 tool_name -> raw_data
                should_terminate_loop = False

                for tool_call in collected_tool_calls:
                    function_name = tool_call["function"]["name"]
                    args_str = tool_call["function"]["arguments"] or "{}"
                    arg_parsing_error = None
                    try:
                        function_args = json.loads(args_str)
                    except json.JSONDecodeError as e:
                        # 尝试处理 "Extra data" (例如模型输出了多个 JSON 对象)
                        try:
                            function_args, _ = json.JSONDecoder().raw_decode(args_str)
                            print(f"[Agent] Recovered from Extra data error. Parsed: {function_args}")
                        except Exception:
                            print(f"[Agent] Failed to parse tool arguments: {args_str}, error: {e}")
                            arg_parsing_error = f"Failed to parse arguments: {str(e)}"
                            function_args = {}
                    except Exception as e:
                        print(f"[Agent] Failed to parse tool arguments: {args_str}, error: {e}")
                        arg_parsing_error = f"Failed to parse arguments: {str(e)}"
                        function_args = {}
                    
                    # 如果参数解析失败，直接生成错误响应，不执行函数
                    if arg_parsing_error:
                         final_messages.append({
                            "tool_call_id": tool_call["id"],
                            "role": "tool",
                            "name": function_name,
                            "content": f"Error: {arg_parsing_error}. Please ensure arguments are valid JSON.",
                        })
                         continue
                    
                    # --- Tool Execution Strategy ---
                    # 1. Security Gate: 硬拦截机制 (Hard Isolation)
                    # 即使模型“猜”到了工具名，或者通过恶意脚本注入，只要来源是手机，就禁止执行敏感工具
                    sensitive_tool_keywords = ["screenshot", "screen", "windows", "shell", "cmd", "file", "app", "browser", "exec", "write"]
                    if source == "mobile" and any(kw in function_name.lower() for kw in sensitive_tool_keywords):
                        print(f"[🛡️ Hard Security] Blocked execution of sensitive tool '{function_name}' from mobile source.")
                        final_messages.append({
                            "tool_call_id": tool_call["id"],
                            "role": "tool",
                            "name": function_name,
                            "content": f"Error: Permission Denied. Tool '{function_name}' is restricted for remote/mobile connections for security reasons.",
                        })
                        continue

                    # 2. Interceptors: Handle tools with special UI/Context requirements first
                    # 3. NIT Dispatcher: Unified execution for all other plugins
                    
                    if function_name == "finish_task":
                        print(f"[Agent] finish_task called. Status: {function_args.get('status', 'success')}")
                        summary = function_args.get("summary", "")
                        if summary:
                            full_response_text += summary
                            yield summary
                        
                        final_messages.append({
                            "tool_call_id": tool_call["id"],
                            "role": "tool",
                            "name": function_name,
                            "content": "Task finished. Terminating loop.",
                        })
                        should_terminate_loop = True
                        break

                    if function_name == "search_files":
                        print(f"[Agent] Intercepting {function_name} call for UI injection...")
                        if on_status: await on_status("thinking", "正在处理大数据量任务...")
                        
                        try:
                            # Use legacy mapping or NIT dispatcher to get raw data
                            # Here we use legacy mapping for safety as it returns raw list/dict
                            func = TOOLS_MAPPING[function_name]
                            if asyncio.iscoroutinefunction(func):
                                raw_data = await func(**function_args)
                            else:
                                raw_data = func(**function_args)
                            
                            tag_name = "FILE_RESULTS" 
                            intercepted_ui_data[tag_name] = raw_data
                            
                            # 辅助模型分析
                            aux_analysis = None
                            try:
                                data_list = json.loads(raw_data)
                                if isinstance(data_list, list) and len(data_list) > 0:
                                    if on_status: await on_status("thinking", "正在分析搜索结果...")
                                    aux_analysis = await self._analyze_file_results_with_aux(user_message, data_list)
                            except Exception as e:
                                print(f"[Agent] Failed to trigger aux analysis: {e}")

                            try:
                                data_list = json.loads(raw_data)
                                count = len(data_list) if isinstance(data_list, list) else 1
                            except: count = "若干"
                            
                            aux_msg = ""
                            if aux_analysis:
                                aux_msg = f"\n\n[辅助模型分析结果]:\n{aux_analysis}"
                            
                            function_response = f"System: 已成功处理。获取到 {count} 条数据，UI 列表已在后台准备就绪。{aux_msg}\n请结合辅助模型的分析结果（如果有），告知用户你已经处理完成，并可以简要复述分析结论。"
                            print(f"[Agent] {function_name} intercepted. {count} items hidden from LLM context.")
                        except Exception as e:
                            function_response = f"Error during intercepted tool execution: {e}"

                        final_messages.append({
                            "tool_call_id": tool_call["id"],
                            "role": "tool",
                            "name": function_name,
                            "content": function_response,
                        })
                        continue

                    elif function_name == "take_screenshot" or function_name == "see_screen":
                        print(f"[Agent] Calling tool: {function_name}")
                        
                        # 根据多模态状态决定执行逻辑
                        enable_vision = config.get("enable_vision", False)
                        
                        if not enable_vision:
                            # 非多模态模式：尝试调用 MCP 视觉分析
                            if on_status: await on_status("thinking", "正在通过 MCP 分析屏幕内容...")
                            vision_description = await self._analyze_screen_with_mcp()
                            
                            function_response = f"[视觉分析报告]:\n{vision_description}"
                            print(f"[Agent] Vision analysis via MCP complete.")
                        else:
                            # 多模态模式：直接注入截图
                            if on_status: await on_status("thinking", "正在查看截图池...")
                            try:
                                from services.screenshot_service import screenshot_manager
                                
                                # 1. 获取请求的数量
                                count = function_args.get("count", 1)
                                if not isinstance(count, int): count = 1
                                count = max(1, min(10, count))

                                # 2. 捕获最新截图
                                # 强制捕获一张最新的，确保“所见即所得”，避免读取缓存池中的旧图
                                latest_shot = screenshot_manager.capture()
                                
                                final_screenshots = []
                                
                                if count == 1:
                                    # 如果只需要一张，直接使用刚刚捕获的这张，确保最新
                                    if latest_shot:
                                        final_screenshots = [latest_shot]
                                else:
                                    # 如果需要多张（回溯），则从池子中取
                                    # 使用较短的有效期（如 15 秒），确保获取到的是刚刚截取的
                                    recent_screenshots = screenshot_manager.get_recent(count, max_age=15)
                                    final_screenshots = recent_screenshots
                                
                                if not final_screenshots:
                                    function_response = "❌ 无法获取最新截图（可能截图失败）。"
                                else:
                                    # 3. 将截图注入到下一轮的上下文中
                                    content = [{"type": "text", "text": f"系统提示：以下是最近捕获的 {len(final_screenshots)} 张屏幕截图（按时间顺序排列）："}]
                                    
                                    for i, shot in enumerate(final_screenshots):
                                        content.append({
                                            "type": "text", 
                                            "text": f"--- 截图 {i+1} (捕获时间: {shot['time_str']}) ---"
                                        })
                                        content.append({
                                            "type": "image_url",
                                            "image_url": {
                                                "url": f"data:image/png;base64,{shot['base64']}"
                                            }
                                        })
                                    
                                    screenshot_msg = {
                                        "role": "user",
                                        "content": content
                                    }
                                    final_messages.append(screenshot_msg)
                                    print(f"[Agent] {len(final_screenshots)} screenshots injected into context. (Newest: {final_screenshots[-1]['time_str']})")
                                    
                                    function_response = f"已成功获取并发送了最近的 {len(final_screenshots)} 张截图。请查看最新的消息中的图片进行分析。"
                            except Exception as e:
                                 function_response = f"截图工具执行出错: {e}"

                        final_messages.append({
                            "tool_call_id": tool_call["id"],
                            "role": "tool",
                            "name": function_name,
                            "content": function_response,
                        })
                        continue

                    # --- NIT Dispatcher Integration ---
                    from nit_core.dispatcher import get_dispatcher
                    nit_dispatcher = get_dispatcher()
                    
                    # 归一化工具名
                    normalized_name = nit_dispatcher.parser.normalize_key(function_name)
                    
                    # 信任 Dispatcher 的注册表
                    if normalized_name in nit_dispatcher.list_plugins():
                        print(f"[Agent] Delegating tool {function_name} to NITDispatcher (Unified Flow)...")
                        if on_status: await on_status("thinking", f"正在调用能力: {function_name}...")
                        
                        try:
                            # NIT 插件统一接口：接收 params 字典
                            result = await nit_dispatcher._execute_plugin(function_name, function_args)
                            
                            # 如果结果是复杂对象，Dispatcher 里的插件应该已经处理成了字符串或特定结构
                            # 这里我们只负责转为字符串回传给 LLM
                            function_response = str(result)
                            print(f"[Agent] NIT tool {function_name} executed successfully.")
                            
                            # [Feature] 实时状态同步
                            # 如果是 update_character_status，解析其返回的 triggers 并立即推送到前端
                            if function_name in ["update_character_status", "update_status", "set_status"]:
                                try:
                                    import json
                                    triggers = json.loads(str(result))
                                    
                                    # 1. 构造 SSE 格式的 JSON 数据
                                    sse_payload = json.dumps({"triggers": triggers}, ensure_ascii=False)
                                    sse_message = f"data: {sse_payload}\n\n"
                                    
                                    # 2. 推送到前端 (通过 yield SSE)
                                    yield sse_message
                                    
                                    # 3. 尝试广播给 VoiceManager (双保险，适用于语音模式)
                                    try:
                                        from services.voice_manager import voice_manager
                                        await voice_manager.broadcast({"type": "triggers", "data": triggers})
                                    except:
                                        pass
                                        
                                    print(f"[Agent] Status update pushed to frontend: {sse_payload[:50]}...")
                                except Exception as e:
                                    print(f"[Agent] Failed to push status update: {e}")

                            # 特殊处理：如果是 search_files，且返回结果很大，可能需要截断或由辅助模型处理
                            # 思路是插件内部自己处理好返回内容
                            # 这里保留一个简单的截断保护
                            if len(function_response) > 10000:
                                function_response = function_response[:10000] + "\n... (result truncated)"

                        except Exception as e:
                            print(f"[Agent] NIT tool {function_name} failed: {e}")
                            function_response = f"Error executing tool: {e}"
                            
                        final_messages.append({
                            "tool_call_id": tool_call["id"],
                            "role": "tool",
                            "name": function_name,
                            "content": function_response,
                        })
                        continue
                    
                    # --- MCP Tool Handling ---
                    if function_name.startswith("mcp_") and mcp_tool_map:
                        real_tool_name = function_name[4:]
                        client = mcp_tool_map.get(function_name)
                        if not client:
                            print(f"[Agent] MCP tool {function_name} not found in map")
                            mcp_response = f"Error: MCP tool {function_name} not found."
                        else:
                            print(f"[Agent] Calling MCP tool: {real_tool_name} on {client.name}")
                            if on_status: await on_status("thinking", f"正在调用插件 ({client.name}): {real_tool_name}...")
                            
                            import time
                            start_time = time.time()
                            try:
                                mcp_response = await client.call_tool(real_tool_name, function_args)
                                duration = time.time() - start_time
                                print(f"[Agent] MCP tool {real_tool_name} executed in {duration:.2f}s")
                            except Exception as e:
                                print(f"[Agent] MCP tool {real_tool_name} failed: {e}")
                                mcp_response = f"Error: {e}"

                        final_messages.append({
                            "tool_call_id": tool_call["id"],
                            "role": "tool",
                            "name": function_name,
                            "content": str(mcp_response),
                        })

                    else:
                        # --- Fallback for Unknown Tools ---
                        print(f"[Agent] Tool {function_name} not found in NIT Registry or MCP.")
                        final_messages.append({
                            "tool_call_id": tool_call["id"],
                            "role": "tool",
                            "name": function_name,
                            "content": f"Error: Tool '{function_name}' not found or not supported.",
                        })

                # 3. 触发按需反思机制
                last_tool_response = final_messages[-1].get("content", "")
                is_tool_error = "error" in str(last_tool_response).lower() or "fail" in str(last_tool_response).lower()
                
                if is_tool_error:
                    consecutive_error_count += 1
                    print(f"[Agent] Tool error detected. Consecutive count: {consecutive_error_count}")
                else:
                    consecutive_error_count = 0

                # [Feature] 连续错误 3 次熔断机制
                if consecutive_error_count >= 3:
                    print(f"⚠️ [Agent] Consecutive errors ({consecutive_error_count}) reached limit. Forcing stop.")
                    final_messages.append({
                        "role": "system",
                        "content": "【系统紧急干预】监测到你已经连续操作失败 3 次。请立即停止任何后续的思考与工具调用，放弃当前任务，并主动向主人汇报失败原因。"
                    })
                    # 禁用工具，强制 LLM 只能回复文本
                    tools_to_pass = None

                if is_tool_error:
                    print(f"⚠️ [Agent] Tool execution error detected, triggering reflection...")
                    history_context = "\n".join([f"{m['role']}: {str(m.get('content',''))[:200]}" for m in final_messages[-5:]])
                    # 尝试获取最新截图供反思使用
                    latest_screenshot = None
                    try:
                        from services.screenshot_service import screenshot_manager
                        shot = screenshot_manager.capture()
                        if shot: latest_screenshot = shot["base64"]
                    except: pass
                    
                    reflection_advice = await self._run_reflection(user_message, history_context, latest_screenshot)
                    
                    if reflection_advice and "NORMAL" not in reflection_advice:
                        final_messages.append({
                            "role": "system",
                            "content": f"[反思助手提示]: 检测到上一步操作可能存在问题。建议参考：{reflection_advice}"
                        })

                # 4. Yield UI Tags Immediately
                if intercepted_ui_data:
                    for tag_name, raw_json in intercepted_ui_data.items():
                        tag = f"\n<{tag_name}>{raw_json}</{tag_name}>"
                        full_response_text += tag
                        yield tag
                        print(f"[Agent] Appended hidden {tag_name} tag to response.")
                
                if should_terminate_loop:
                    print("[Agent] Loop terminated by finish_task.")
                    break
                
                # Loop continues to next turn...

            try:
                # 5. 最终合并所有轮次的内容用于持久化
                full_response_text = accumulated_full_response + full_response_text
                
                # Capture raw text before post-processing
                raw_full_text = full_response_text

                # Post-process full response text (Batch mode) before saving
                # This ensures memory and downstream services get clean text without protocol markers
                if full_response_text:
                    try:
                        full_response_text = await self.postprocessor_manager.process(
                            full_response_text, 
                            context={"source": source, "session_id": session_id}
                        )
                    except Exception as pp_e:
                        print(f"[Agent] Postprocessor failed: {pp_e}. Using raw text.")

                # 仅在正常生成回复（且不是报错）时才保存对话记录
                # 用户消息与 Pero 回复进行原子性绑定保存
                
                # [Robustness] Fallback extraction for user_message if missing
                if not user_message:
                    # Priority 1: Check override (Voice Mode)
                    if user_text_override:
                        user_message = user_text_override
                        print(f"[Agent] User message restored from override: '{user_message[:20]}...'")
                    else:
                        # Priority 2: Search in messages
                        print(f"[Agent] User message missing. Searching in {len(messages)} input messages...")
                        for m in reversed(messages):
                            if m.get("role") == "user":
                                content = m.get("content", "")
                                if isinstance(content, str):
                                    user_message = content
                                elif isinstance(content, list):
                                    texts = [item["text"] for item in content if item.get("type") == "text"]
                                    user_message = " ".join(texts)
                                break
                        if user_message:
                            print(f"[Agent] Fallback extracted user message: '{user_message[:20]}...'")
                        else:
                            print(f"[Agent] CRITICAL: Failed to extract user message from input. Logs will NOT be saved.")

                should_save = not skip_save and user_message and full_response_text
                print(f"[Agent] Log Save Check: save={should_save} (skip_save={skip_save}, has_user_msg={bool(user_message)}, resp_len={len(full_response_text) if full_response_text else 0})")
                
                if should_save:
                    # 如果有覆盖文本，优先使用覆盖文本（确保音频输入时也能存下文本）
                    final_user_msg = user_text_override if user_text_override else user_message
                    try:
                        await self.memory_service.save_log_pair(
                            self.session, 
                            source, 
                            session_id, 
                            final_user_msg, 
                            full_response_text, 
                            pair_id,
                            assistant_raw_content=raw_full_text
                        )
                        print(f"[Agent] Conversation log pair saved (pair_id: {pair_id})")
                    except Exception as e:
                         print(f"[Agent] Failed to save log pair: {e}")
                else:
                     if not skip_save:
                         print(f"[Agent] Skipping save. Reason: user_msg={bool(user_message)}, resp_valid={bool(full_response_text and not full_response_text.startswith('Error:'))}")
                
                if full_response_text:
                    await self._save_parsed_metadata(full_response_text, source, mcp_clients if 'mcp_clients' in locals() else None, execute_nit=False)
                
                # 触发 Scorer 服务进行记忆提取 (职责分离 - 后台异步执行)
                # [Optimization] Do not run scorer if the response is an error
                is_error_response = (
                    full_response_text.startswith("Error:") or 
                    full_response_text.startswith("Network Error") or
                    full_response_text.startswith("⚠️")
                )

                if not skip_save and user_message and full_response_text and not is_error_response:
                    final_user_msg = user_text_override if user_text_override else user_message
                    if len(full_response_text) > 5:
                        # 使用 background_task 包装以确保独立 Session
                        asyncio.create_task(self._run_scorer_background(final_user_msg, full_response_text, source, pair_id=pair_id))

                # 显式提交，确保在流式响应的上下文中数据已持久化
                await self.session.commit()
                
                # [Trigger Dream] 3% probability to trigger background memory consolidation
                import random
                if random.random() < 0.03:
                     asyncio.create_task(self._trigger_dream())

            except Exception as log_err:
                print(f"Failed to save conversation log (success path): {log_err}")

        except Exception as e:
            import traceback
            error_msg = f"Error: {str(e)}"
            print(f"Agent Chat Error (Inner): {traceback.format_exc()}")
            # [Troubleshooting] Attempt to save log even on error (User request: logs missing)
            try:
                # Ensure user_message is available
                final_u_msg = user_message
                if not final_u_msg and user_text_override:
                    final_u_msg = user_text_override
                
                # Append error to response so it's recorded
                final_response = full_response_text + f"\n\n[System Error]: {error_msg}"
                
                if final_u_msg:
                     await self.memory_service.save_log_pair(
                        self.session, 
                        source, 
                        session_id, 
                        final_u_msg, 
                        final_response, 
                        pair_id
                    )
                     print(f"[Agent] Error log saved (pair_id: {pair_id})")
            except Exception as save_err:
                print(f"[Agent] Failed to save error log: {save_err}")

            yield error_msg
        finally:
            if session_id:
                task_manager.unregister(session_id)

            # 最后的兜底处理，清理 MCP 客户端资源
            if 'mcp_clients' in locals():
                for client in mcp_clients:
                    try:
                        await client.close()
                    except:
                        pass
            pass
