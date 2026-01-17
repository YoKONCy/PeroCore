import os
import logging

logger = logging.getLogger(__name__)
import re
from typing import List, Dict, Any
from datetime import datetime
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from models import Config, PetState
from services.mdp import MDPManager
from nit_core.dispatcher import get_dispatcher
from core.config_manager import get_config_manager

class PromptManager:
    """
    提示词管理组件，负责编排人设、上下文、记忆、时间等信息。
    已迁移至 MDP (Modular Dynamic Prompts) 系统。
    """
    
    def __init__(self):
        # 初始化 MDP
        # 假设提示位于相对于此文件的 ./mdp/prompts 中
        mdp_dir = os.path.join(os.path.dirname(__file__), "mdp", "prompts")
        self.mdp = MDPManager(mdp_dir)

    def build_system_prompt(self, variables: Dict[str, Any], is_social_mode: bool = False) -> str:
        # 0. 检查轻量级模式
        config = get_config_manager()
        is_lightweight = config.get("lightweight_mode", False)

        # 1. 构建能力字符串
        enable_vision = variables.get("enable_vision", False)
        enable_voice = variables.get("enable_voice", False)
        enable_video = variables.get("enable_video", False)
        
        # [社交模式覆盖]
        if is_social_mode:
            # 禁用 NIT 协议和思考约束
            variables["ability_nit"] = ""
            variables["output_constraint"] = ""
            variables["ability"] = "" # 同时禁用工作区工具
            # 如果启用了感官（视觉/语音），我们保留这些能力，因为 Pero 仍然可能“看到”聊天中发送的图像
            # 但我们抑制复杂的工具描述
        
        # [轻量级模式覆盖]
        if is_lightweight and not is_social_mode:
            # 禁用 COT（思考块）
            variables["output_constraint"] = ""
            
            # 简化 NIT 能力（移除 ReAct 流程/逻辑）
            nit_prompt = self.mdp.get_prompt("ability_nit")
            if nit_prompt:
                content = nit_prompt.content
                # 移除 "### 3. 执行逻辑与思考" 部分及其内容
                content = re.sub(r'### 3\. 执行逻辑与思考[\s\S]*?(?=### 4\.|$)', '', content)
                # 如果文本中有提及，则移除“Thinking”或“Reasoning”
                content = content.replace("在执行任何外部操作时，必须遵循‘思考-行动-观察’的循环。", "")
                variables["ability_nit"] = content
        
        abilities_parts = []
        
        # [修改] 仅在非社交模式下注入感官能力
        if not is_social_mode:
            # 视觉
            if enable_vision:
                # 检查提示是否存在以避免错误，如果需要则回退
                prompt = self.mdp.get_prompt("ability_vision")
                if prompt:
                    abilities_parts.append(prompt.content)
            else:
                prompt = self.mdp.get_prompt("ability_vision_placeholder")
                if prompt:
                    abilities_parts.append(prompt.content)

            # 语音
            if enable_voice:
                prompt = self.mdp.get_prompt("ability_voice")
                if prompt:
                    abilities_parts.append(prompt.content)
            
            # 视频
            if enable_video:
                prompt = self.mdp.get_prompt("ability_video")
                if prompt:
                    abilities_parts.append(prompt.content)

        variables["abilities"] = "\n".join(abilities_parts)
        
        # 2. 默认值
        variables.setdefault("owner_name", "主人")
        variables.setdefault("user_persona", "未设定")
        variables.setdefault("mood", "开心")
        variables.setdefault("vibe", "活泼")
        variables.setdefault("mind", "正在想主人...")
        variables.setdefault("vision_status", "")
        variables.setdefault("memory_context", "")
        # output_constraint 由 system_template 内的 {{output_constraint}} 处理
        
        # [Social Identity Injection]
        # 尝试从 SocialService 获取当前 Bot 的昵称 (QQ昵称)
        try:
            from services.social_service import get_social_service
            social_service = get_social_service()
            if social_service and social_service.bot_info:
                variables["bot_name"] = social_service.bot_info.get("nickname", "Pero")
            else:
                variables["bot_name"] = "Pero"
        except ImportError:
            variables["bot_name"] = "Pero"
        
        # 注入 NIT 工具描述
        try:
            if not is_social_mode:
                dispatcher = get_dispatcher()
                # 默认为核心工具
                tools_desc = dispatcher.get_tools_description(category_filter='core')
                
                # 检查工作模式
                # 假设变量或配置中有 'work_mode' 布尔值
                if variables.get("work_mode_enabled", False):
                    tools_desc += "\n\n" + dispatcher.get_tools_description(category_filter='work')
                    
                variables["nit_tools_description"] = tools_desc
            else:
                variables["nit_tools_description"] = ""
        except Exception as e:
            print(f"[PromptManager] Error injecting NIT tools description: {e}")
            variables["nit_tools_description"] = "Error loading tools."

        # 注入链逻辑（思维链）
        chain_name = variables.get("chain_name", "default")
        chain_content = ""
        try:
            chain_path = os.path.join(os.path.dirname(__file__), "mdp", "chains", f"{chain_name}.md")
            if os.path.exists(chain_path):
                with open(chain_path, "r", encoding="utf-8") as f:
                    chain_content = f.read()
            else:
                logger.warning(f"Chain prompt not found: {chain_path}")
        except Exception as e:
            logger.error(f"Error loading chain prompt: {e}")
            
        variables["chain_logic"] = chain_content

        # 3. 渲染
        final_prompt = self.mdp.render("system_template", variables)
        
        # [轻量级模式提醒]
        if is_lightweight:
            lightweight_reminder = "\n\n【重要系统提醒：轻量聊天模式已开启。为了节省系统资源，目前除了“视觉感知(ScreenVision)”、“形象管理(CharacterOps)”和“核心记忆(MemoryOps)”之外的所有高级工具已被临时禁用。此外，为了保持极速响应，请你跳过复杂的思考过程（Thinking），直接输出回复内容。如果你需要调用工具，请直接在回复中编写 NIT 脚本，无需多余的解释或分析。】"
            final_prompt += lightweight_reminder
            
        return final_prompt

    async def get_rendered_system_prompt(self, session: AsyncSession, is_social_mode: bool = False) -> str:
        """
        获取渲染后的完整 System Prompt。
        1. 加载所有组件
        2. 合并变量
        3. 渲染
        """
        # 获取配置
        configs = {c.key: c.value for c in (await session.exec(select(Config))).all()}
        
        owner_name = configs.get("owner_name", "主人")
        user_persona = configs.get("user_persona", "未设定")
        
        # 获取宠物状态
        from sqlmodel import desc
        import json
        state = (await session.exec(select(PetState).order_by(desc(PetState.updated_at)).limit(1))).first()
        state = state or PetState()
        
        # 清洗状态字段，防止旧格式的 JSON/XML 污染提示词
        def clean_state_field(val: str, field_name: str) -> str:
            if not val: return ""
            val = val.strip()
            # 1. 尝试解析 JSON (针对旧数据 {"mood": "..."} 的情况)
            if val.startswith("{") and val.endswith("}"):
                try:
                    data = json.loads(val)
                    if isinstance(data, dict):
                        # 优先取同名 key，否则取第一个字符串值
                        return str(data.get(field_name) or next((v for v in data.values() if isinstance(v, str)), val))
                except:
                    pass
            # 2. 移除 XML 标签
            if "<" in val:
                val = re.sub(r'<[^>]+>', '', val)
            return val

        variables = {
            "owner_name": owner_name,
            "user_persona": user_persona,
            "current_time": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "mood": clean_state_field(state.mood, "mood") or "开心",
            "vibe": clean_state_field(state.vibe, "vibe") or "活泼",
            "mind": clean_state_field(state.mind, "mind") or "正在想主人...",
            "memory_context": "", # Companion mode doesn't need complex RAG for now
            "graph_context": "", # Placeholder for Knowledge Graph context
        }
        
        return self.build_system_prompt(variables, is_social_mode=is_social_mode)

    def clean_history_for_api(self, content: str) -> str:
        """
        清理历史记录中的冗余标签，仅保留 PEROCUE
        """
        if not content:
            return ""
        # 移除 MEMORY, CLICK_MESSAGES, IDLE_MESSAGES, BACK_MESSAGES, REMINDER, TOPIC
        content = re.sub(r'<MEMORY>[\s\S]*?<\/MEMORY>', '', content)
        content = re.sub(r'<CLICK_MESSAGES>[\s\S]*?<\/CLICK_MESSAGES>', '', content)
        content = re.sub(r'<IDLE_MESSAGES>[\s\S]*?<\/IDLE_MESSAGES>', '', content)
        content = re.sub(r'<BACK_MESSAGES>[\s\S]*?<\/BACK_MESSAGES>', '', content)
        content = re.sub(r'<FILE_RESULTS>[\s\S]*?<\/FILE_RESULTS>', '', content)
        content = re.sub(r'<REMINDER>[\s\S]*?<\/REMINDER>', '', content)
        content = re.sub(r'<TOPIC>[\s\S]*?<\/TOPIC>', '', content)
        return content.strip()

    def compose_messages(self, 
                         history: List[Dict[str, str]], 
                         variables: Dict[str, Any],
                         is_voice_mode: bool = False,
                         is_social_mode: bool = False) -> List[Dict[str, str]]:
        """
        组装完整的消息列表（System + History）
        """
        if is_voice_mode:
            # 在语音模式下，增加关于语音输入的提醒
            enable_voice = variables.get("enable_voice", False)
            # 只有当模型配置启用了语音模态，且确实处于语音模式时，才认为是原生语音输入
            if enable_voice:
                voice_reminder = "\n\n【系统提醒: 当前主人正在使用原生语音进行交流。你已获得主人的原生音频输入（Multimodal Audio），这能让你感受到主人的语气、情感和环境背景。请优先基于你听到的音频内容进行回复。】"
            else:
                voice_reminder = "\n\n【系统提醒: 当前主人正在使用语音输入，但你目前只能接收到 ASR (自动语音识别) 转录后的文本。由于 ASR 可能存在同音错别字，请你结合上下文进行合理推测，并以可爱的语气给予回应。】"
            system_content = self.build_system_prompt(variables, is_social_mode=is_social_mode) + voice_reminder
        else:
            system_content = self.build_system_prompt(variables, is_social_mode=is_social_mode)
        
        # 对历史记录进行清洗
        cleaned_history = []
        for msg in history:
            cleaned_msg = msg.copy()
            if msg.get("role") == "assistant":
                cleaned_msg["content"] = self.clean_history_for_api(msg.get("content", ""))
            cleaned_history.append(cleaned_msg)
            
        return [{"role": "system", "content": system_content}] + cleaned_history
