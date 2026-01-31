import os
import logging

logger = logging.getLogger(__name__)
import re
from typing import List, Dict, Any
from datetime import datetime
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession
from models import Config, PetState
from services.mdp.manager import mdp
from nit_core.dispatcher import get_dispatcher
from core.config_manager import get_config_manager
from services.agent_manager import get_agent_manager

class PromptManager:
    """
    提示词管理组件，负责编排人设、上下文、记忆、时间等信息。
    已迁移至 MDP (Modular Dynamic Prompts) 系统。
    """
    
    def __init__(self):
        # Use singleton MDP manager
        self.mdp = mdp
        self.agent_manager = get_agent_manager()

    def _enrich_variables(self, variables: Dict[str, Any], is_social_mode: bool, is_work_mode: bool):
        """
        丰富和处理变量，从配置和Agent状态中填充缺失信息
        """
        # 0. 检查轻量级模式
        config = get_config_manager()
        is_lightweight = config.get("lightweight_mode", False)
        
        # [Multi-Agent Integration]
        # 获取当前活跃 Agent 的配置，并将其合并到 variables 中
        # 注意：variables 中的临时变量（如用户输入）优先级高于 Agent 配置
        active_agent = self.agent_manager.get_active_agent()
        agent_config = {}
        if active_agent:
            # 将 AgentProfile 转换为字典
            agent_config = {
                "agent_name": active_agent.name,
                "agent_id": active_agent.id,
                "work_custom_persona": active_agent.work_custom_persona,
                "work_traits": active_agent.work_traits,
                "social_custom_persona": active_agent.social_custom_persona,
                "social_traits": active_agent.social_traits,
            }
        
        # 合并配置 (variables 优先)
        # 我们使用 setdefault 确保如果不传 agent_name，则使用 Agent 的名字
        for k, v in agent_config.items():
            variables.setdefault(k, v)

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
            # 简化 NIT 能力（移除 ReAct 流程/逻辑）
            nit_prompt = self.mdp.get_prompt("core/abilities/ability_nit")
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
                prompt = self.mdp.get_prompt("core/abilities/ability_vision")
                if prompt:
                    abilities_parts.append(prompt.content)
            else:
                prompt = self.mdp.get_prompt("core/abilities/ability_vision_placeholder")
                if prompt:
                    abilities_parts.append(prompt.content)

            # 语音
            if enable_voice:
                prompt = self.mdp.get_prompt("core/abilities/ability_voice")
                if prompt:
                    abilities_parts.append(prompt.content)
            else:
                prompt = self.mdp.get_prompt("core/abilities/ability_voice_placeholder")
                if prompt:
                    abilities_parts.append(prompt.content)

            # 视频
            if enable_video:
                prompt = self.mdp.get_prompt("core/abilities/ability_video")
                if prompt:
                    abilities_parts.append(prompt.content)
        
        variables["ability_sensory"] = "\n".join(abilities_parts)

        # [Core Abilities Loading]
        # 显式加载 ability 和 ability_nit，以支持新版目录结构 (core/abilities/...)
        if "ability" not in variables:
            prompt = self.mdp.get_prompt("core/abilities/ability")
            variables["ability"] = prompt.content if prompt else ""
            
        if "ability_nit" not in variables:
            prompt = self.mdp.get_prompt("core/abilities/ability_nit")
            variables["ability_nit"] = prompt.content if prompt else ""

        # [Core Rules Loading]
        if "system_core" not in variables:
            prompt = self.mdp.get_prompt("core/rules/system_core")
            variables["system_core"] = prompt.content if prompt else ""

        if "output_constraint" not in variables:
            prompt = self.mdp.get_prompt("core/rules/output_constraint")
            variables["output_constraint"] = prompt.content if prompt else ""
        
        # [Social Identity Injection]
        default_name = config.get("bot_name", "Pero")
        bot_name = default_name
        try:
            from nit_core.plugins.social_adapter.social_service import get_social_service
            social_service = get_social_service()
            if social_service and social_service.bot_info:
                bot_name = social_service.bot_info.get("nickname", default_name)
        except ImportError:
            pass
        
        variables["bot_name"] = bot_name # 保留 bot_name 以兼容旧的 Prompt
        variables.setdefault("agent_name", bot_name) # 仅当未设定时使用 bot_name 作为 agent_name

        # [Work Mode Decoupling]
        variables["custom_persona"] = config.get("work_custom_persona", "你是一个全能的 AI 助手，你的名字是 {{ agent_name }}。")
        variables["work_traits"] = config.get("work_traits", ["mode:concise"])

        # [Persona Loading]
        agent_id = variables.get("agent_id") or config.get("agent_id", "pero")
        agent_id = str(agent_id).lower()
        persona_template = config.get("persona_template", f"{agent_id}/system_prompt")
        
        render_context = {"agent_name": variables.get("agent_name", bot_name)}
        if "owner_name" in variables:
            render_context["owner_name"] = variables["owner_name"]
            
        variables["persona_definition"] = self.mdp.render(persona_template, render_context)
        
        # 注入 NIT 工具描述
        try:
            if not is_social_mode:
                dispatcher = get_dispatcher()
                tools_desc = dispatcher.get_tools_description(category_filter='core')
                if variables.get("work_mode_enabled", False):
                    tools_desc += "\n\n" + dispatcher.get_tools_description(category_filter='work')
                variables["nit_tools_description"] = tools_desc
            else:
                variables["nit_tools_description"] = ""
        except Exception as e:
            print(f"[PromptManager] 注入 NIT 工具描述错误: {e}")
            variables["nit_tools_description"] = "加载工具出错。"

        # 注入链逻辑（思维链）
        chain_name = variables.get("chain_name", "default")
        chain_prompt = self.mdp.get_prompt(f"chains/{chain_name}")
        variables["chain_logic"] = chain_prompt.content if chain_prompt else ""
        
        # 2. 默认值
        variables.setdefault("owner_name", "主人")
        variables.setdefault("user_persona", "未设定")
        variables.setdefault("mood", "开心")
        variables.setdefault("vibe", "活泼")
        variables.setdefault("mind", "正在想主人...")
        variables.setdefault("vision_status", "")
        variables.setdefault("memory_context", "")
        
        # [社交模式/轻量模式特殊处理]
        if is_social_mode or is_lightweight:
            variables["chain_logic"] = ""

    def build_system_prompt(self, variables: Dict[str, Any], is_social_mode: bool = False, is_work_mode: bool = False) -> str:
        # 0. 丰富变量
        self._enrich_variables(variables, is_social_mode, is_work_mode)
        
        # [工作模式专用构建]
        if is_work_mode:
            # 1. 覆盖 NIT 工具描述 (只用核心工具)
            try:
                dispatcher = get_dispatcher()
                tools_desc = dispatcher.get_tools_description(category_filter='core')
                if not tools_desc or len(tools_desc) < 10:
                    tools_desc = dispatcher.get_tools_description()
                variables["nit_tools_description"] = tools_desc
            except Exception as e:
                logger.error(f"加载工作工具错误: {e}")

            # 2. 简化 Ability NIT (移除 ReAct 思考步骤，同轻量模式)
            nit_prompt = self.mdp.get_prompt("core/abilities/ability_nit")
            if nit_prompt:
                content = nit_prompt.content
                content = re.sub(r'### 3\. 执行逻辑与思考[\s\S]*?(?=### 4\.|$)', '', content)
                content = content.replace("在执行任何外部操作时，必须遵循‘思考-行动-观察’的循环。", "")
                variables["ability_nit"] = content
            
            # 4. 渲染工作模式专用模板
            return self.mdp.render("core/templates/system_work", variables)

        # 1. 渲染模板
        final_prompt = self.mdp.render("core/templates/system_template", variables)
        
        # [轻量级模式提醒]
        config = get_config_manager()
        is_lightweight = config.get("lightweight_mode", False)
        if is_lightweight and not is_social_mode:
            lightweight_reminder = "\n\n【重要系统提醒：轻量聊天模式已开启。为了节省系统资源，目前除了“视觉感知(ScreenVision)”、“形象管理(CharacterOps)”和“核心记忆(MemoryOps)”之外的所有高级工具已被临时禁用。此外，为了保持极速响应，请你跳过复杂的思考过程（Thinking），直接输出回复内容。如果你需要调用工具，请直接在回复中编写 NIT 脚本，无需多余的解释或分析。】"
            final_prompt += lightweight_reminder
            
        return final_prompt

    def build_instruction_prompt(self, variables: Dict[str, Any], is_social_mode: bool = False, is_work_mode: bool = False) -> str:
        """
        构建指令部分的 Prompt (Rules, Tools, COT)
        通常放在消息列表的最后，作为 System Message 提醒模型
        """
        # [工作模式]
        # 工作模式通常在 system_work 中包含了必要的指令，或者需要专门的 instruction_work
        # 目前暂不追加 instruction_work，以免重复
        if is_work_mode:
            return ""
            
        # [主程序模式] (非社交, 非工作)
        # 渲染 core/templates/instruction_default
        # 包含: ability, ability_nit, output_constraint
        if not is_social_mode:
            return self.mdp.render("core/templates/instruction_default", variables)
            
        # [社交模式]
        # 社交模式目前暂不追加额外的指令，以免引入不必要的复杂性 (如 Thinking/Monologue 可能不适合 QQ)
        # 如果未来需要，可以创建 instruction_social.md
        
        return ""

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
                         is_social_mode: bool = False,
                         is_work_mode: bool = False) -> List[Dict[str, str]]:
        """
        组装完整的消息列表（System + History + Instruction）
        """
        # 1. 丰富变量
        self._enrich_variables(variables, is_social_mode, is_work_mode)
        
        # [Social Mode MDP Route]
        if is_social_mode:
            # 社交模式使用独立的 MDP 模板
            base_prompt = self.mdp.render("core/templates/system_social", variables)
            
            # 社交模式下，Instruction 通常已经包含在 system_social 模板中（通过 social_rules 等变量）
            # 或者通过 variables["instruction_prompt"] 传递
            # 因此这里不需要额外构建 instruction_prompt，也不需要 cleaned_history（因为已经在 xml_context 中了）
            
            messages = [{"role": "system", "content": base_prompt}]
            
            # 如果 history 中包含了用户传来的非 XML 消息（例如图片或其他临时消息），可以追加
            # 但目前 SocialService 将所有内容都打包进了 xml_context 变量中
            # 除了可能的最后一条用户消息（如果是纯文本交互）
            # 但 SocialService 的设计是完全通过 System Prompt 传递上下文。
            # 为了兼容性，如果 history 不为空，我们追加它（通常是空的，因为 Preprocessor 把它清空了）
            if history:
                 messages.extend(history)
                 
            return messages

        # 2. 构建基础 System Prompt (Identity, Context)
        base_prompt = ""
        if is_work_mode:
            base_prompt = self.mdp.render("core/templates/system_work", variables)
        else:
            base_prompt = self.mdp.render("core/templates/system_template", variables)
            
        # 3. 构建指令 Prompt (Rules, Tools, COT)
        instruction_prompt = self.build_instruction_prompt(variables, is_social_mode, is_work_mode)

        if is_voice_mode:
            # 在语音模式下，增加关于语音输入的提醒
            enable_voice = variables.get("enable_voice", False)
            if enable_voice:
                voice_reminder = "\n\n【系统提醒: 当前主人正在使用原生语音进行交流。你已获得主人的原生音频输入（Multimodal Audio），这能让你感受到主人的语气、情感和环境背景。请优先基于你听到的音频内容进行回复。】"
            else:
                voice_reminder = "\n\n【系统提醒: 当前主人正在使用语音输入，但你目前只能接收到 ASR (自动语音识别) 转录后的文本。由于 ASR 可能存在同音错别字，请你结合上下文进行合理推测，并以可爱的语气给予回应。】"
            # 语音提醒附在指令之后
            instruction_prompt += voice_reminder
        
        # 对历史记录进行清洗
        cleaned_history = []
        for msg in history:
            cleaned_msg = msg.copy()
            if msg.get("role") == "assistant":
                cleaned_msg["content"] = self.clean_history_for_api(msg.get("content", ""))
            cleaned_history.append(cleaned_msg)
            
        # 组装：[System(Base)] + History + [System(Instruction)]
        messages = [{"role": "system", "content": base_prompt}] + cleaned_history + [{"role": "system", "content": instruction_prompt}]
        
        return messages
