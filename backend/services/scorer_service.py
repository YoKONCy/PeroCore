from typing import Optional, List, Dict, Any
from sqlmodel.ext.asyncio.session import AsyncSession
from services.llm_service import LLMService
from services.memory_service import MemoryService
from models import Config, AIModelConfig, ConversationLog, Memory
from sqlmodel import select
from sqlalchemy import update
import json
import asyncio
import os
import re

class ScorerService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.memory_service = MemoryService()
        self.prompt_path = os.path.join(os.path.dirname(__file__), "mdp", "scorer", "scorer_prompt.md")

    def _smart_clean_text(self, text: str) -> str:
        """
        智能清洗文本：
        - 移除大数据量的系统注入标签 (如 FILE_RESULTS)
        - 保留有助于判断语气的 NIT 协议块和关键性格标签
        """
        if not text:
            return ""
        
        # 1. 移除大数据量的系统注入标签 (数据垃圾/系统噪音)
        remove_tags = [
            "FILE_RESULTS", 
            "SEARCH_RESULTS", 
            "RETRIEVED_CONTEXT",
            "SYSTEM_INJECTION"
        ]
        
        cleaned = text
        for tag in remove_tags:
            pattern = f"<{tag}>[\\s\\S]*?</{tag}>"
            cleaned = re.sub(pattern, f"[{tag} Data Omitted]", cleaned)
            
        # 2. 保留逻辑：
        # 我们默认保留所有 NIT 协议块 [[[NIT_CALL]]]...[[[NIT_END]]] 
        # 以及可能残留的性格相关标签 (PEROCUE, TOPIC 等)，因为它们包含关键的语气和状态信息。
            
        return cleaned

    async def _get_scorer_config(self) -> Dict[str, Any]:
        """获取秘书专用模型配置，如果未配置则回退到全局配置"""
        # 1. 尝试查找名为 "秘书" 的模型配置
        statement = select(AIModelConfig).where(AIModelConfig.name == "秘书")
        result = await self.session.exec(statement)
        model_config = result.first()
        
        # 2. 获取全局配置作为回退
        configs = {c.key: c.value for c in (await self.session.exec(select(Config))).all()}
        global_api_key = configs.get("global_llm_api_key", "")
        global_api_base = configs.get("global_llm_api_base", "https://api.openai.com")

        if model_config:
            return {
                "api_key": model_config.api_key if model_config.provider_type == 'custom' else global_api_key,
                "api_base": model_config.api_base if model_config.provider_type == 'custom' else global_api_base,
                "model": model_config.model_id,
                "temperature": 0.3 # Scorer 需要相对客观
            }
        else:
            # 如果没有特定于评分者的配置，则回退到默认的低成本模型或用户的主模型
            return {
                "api_key": global_api_key,
                "api_base": global_api_base,
                "model": "gpt-4o-mini", # 默认假设用户有这个模型
                "temperature": 0.3
            }

    async def _update_log_status(self, pair_id: str, status: str, error: str = None, increment_retry: bool = False):
        """更新日志的分析状态"""
        if not pair_id:
            return
        
        try:
            # 构建更新语句
            # 兼容性修复：SQLModel/SQLAlchemy update 语句在不同版本中的行为差异
            # 使用 session.execute + update() 对象是比较稳妥的方式
            
            stmt = update(ConversationLog).where(ConversationLog.pair_id == pair_id)
            
            update_values = {
                "analysis_status": status # 直接使用字符串键名
            }
            
            if error:
                update_values["last_error"] = str(error)[:500]
            
            if increment_retry:
                # 对于自增操作，需要特殊处理，或者先读后写。
                # 简单起见，这里我们不使用原子自增，因为 retry_count 不会高并发竞争
                # 实际上 ScorerService 是单线程消费的
                pass 
                # 如果确实需要自增，最好是先查出来再更新，或者使用 ConversationLog.retry_count + 1
                # 但在 values() 中使用表达式可能需要 synchronize_session=False
            
            stmt = stmt.values(**update_values)
            
            # 手动处理 retry_count 自增 (如果需要)
            if increment_retry:
                 stmt = update(ConversationLog).where(ConversationLog.pair_id == pair_id).values(
                     retry_count=ConversationLog.retry_count + 1,
                     **update_values
                 )
            else:
                 stmt = stmt.values(**update_values)

            await self.session.execute(stmt)
            await self.session.commit()
            
        except Exception as e:
            print(f"[秘书] Failed to update status for {pair_id}: {e}")

    async def retry_interaction(self, log_id: int):
        """重试指定日志的分析任务"""
        # 查找日志
        log = await self.session.get(ConversationLog, log_id)
        if not log:
            print(f"[秘书] Log {log_id} not found")
            return False
        
        if not log.pair_id:
            print(f"[秘书] Log {log_id} has no pair_id, cannot retry")
            return False
            
        # 查找配对
        statement = select(ConversationLog).where(ConversationLog.pair_id == log.pair_id)
        results = (await self.session.exec(statement)).all()
        
        user_msg = next((r for r in results if r.role == 'user'), None)
        assistant_msg = next((r for r in results if r.role == 'assistant'), None)
        
        if not user_msg or not assistant_msg:
             print(f"[秘书] Incomplete pair for {log.pair_id}")
             # 如果我们至少有一个，我们可能会尝试？但是 user_content 和 assistant_content 是必需的。
             # 如果只有一个存在，我们实际上无法进行“交互分析”。
             return False
             
        await self.process_interaction(
            user_msg.content, 
            assistant_msg.content, 
            source=log.source, 
            pair_id=log.pair_id
        )
        return True

    async def process_interaction(self, user_content: str, assistant_content: str, source: str = "desktop", pair_id: str = None):
        """
        处理一次交互：调用秘书分析，然后存入 Memory
        """
        print(f"[秘书] Starting interaction analysis... (pair_id: {pair_id})", flush=True)
        
        # 智能清理助手内容以删除数据转储
        assistant_content = self._smart_clean_text(assistant_content)
        
        if pair_id:
            await self._update_log_status(pair_id, "processing")

        config = await self._get_scorer_config()
        
        if not config.get("api_key"):
            print("[秘书] No API Key configured, skipping analysis.")
            if pair_id:
                await self._update_log_status(pair_id, "failed", "No API Key configured", increment_retry=True)
            return

        llm = LLMService(
            api_key=config["api_key"],
            api_base=config["api_base"],
            model=config["model"]
        )
        
        # 从文件加载系统提示或回退到默认值
        try:
            if os.path.exists(self.prompt_path):
                with open(self.prompt_path, "r", encoding="utf-8") as f:
                    system_prompt = f.read()
            else:
                raise FileNotFoundError("Prompt file not found")
        except Exception as e:
            print(f"[秘书] Warning: Failed to load prompt from file ({e}), using fallback.")
            system_prompt = """你是一个专业的记忆记录员 (秘书)。
你的任务是分析用户与 AI 助手之间的对话，提取核心记忆信息。

请输出一个 JSON 对象，包含以下字段：
1. content (string): 对话的核心事实摘要。请以第三人称描述用户发生了什么或说了什么。例如 "用户提到他今天去吃了拉面，觉得很咸"。
            2. type (string): 记忆类型。可选值：
               - event (事件): 一般性的经历、发生的事情。
               - fact (事实): 客观事实、知识点、信息。
               - preference (偏好): 用户的喜好、厌恶、习惯、性格特征。
               - promise (承诺): 约定、计划、待办事项、承诺要做的事。
               - inspiration (灵感): 用户的想法、创意、脑洞。
            3. tags (list[string]): 至少 4 个描述性关键语义标签（如：约会、天气、心情、礼物）。
            4. importance (int): 记忆重要性评分 (1-10)。
            5. sentiment (string): 用户的情感极性 (positive, negative, neutral, happy, sad, angry, etc.)。

            # 重要性评分 (importance) 指南:
            - 1-3分: 日常闲聊、无特殊意义的问候、琐碎对话。
            - 4-6分: 包含有效信息、主人的小偏好、有一定参考价值的对话。
            - 7-8分: 重要约定、主人深刻的情感表达、关键的个人信息、需要长期记住的事件。
            - 9-10分: 极少数情况！如重大承诺、人生转折点、极其珍贵的瞬间。
            *请严格评分，不要过度给高分*

            如果对话纯粹是无意义的闲聊，且不包含任何值得记忆的事实，请返回 null 或空 JSON。
            """
        
        # Determine the role label and process user content if it's a system trigger
        owner_name = "用户"
        try:
            # Query Config table for owner_name
            result = await self.session.exec(select(Config).where(Config.key == "owner_name"))
            config_entry = result.first()
            if config_entry and config_entry.value:
                owner_name = config_entry.value
        except Exception as e:
            print(f"[秘书] Failed to fetch owner_name: {e}")

        user_label = f"{owner_name} (主人)"
        
        # Check for System Reminders (e.g. from Companion Service or Scheduled Tasks)
        if user_content.strip().startswith("【管理系统提醒"):
            user_label = "系统事件 (非用户本人发言)"
            # Optional: You might want to strip the wrapper to help the LLM, 
            # but keeping it might be better so LLM knows context.
            # Let's keep it but emphasize the label.
        
        user_prompt = f"""
{user_label}: {user_content}
AI (Pero): {assistant_content}

请分析上述对话并生成记忆摘要。
注意：
1. 如果是【系统事件】触发的对话，请在摘要中明确指出是“系统提醒”或“Pero主动观察到”，而不是“用户说”。
2. 即使是系统触发，重点关注用户的后续反应（如果有）或 Pero 的行为逻辑。
"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        try:
            # 使用 response_format={"type": "json_object"} 来强制 JSON 输出
            response = await llm.chat(messages, temperature=config["temperature"], response_format={"type": "json_object"})
            content = response["choices"][0]["message"]["content"]
            
            # Parse JSON
            data = None
            try:
                data = json.loads(content)
            except json.JSONDecodeError:
                # 尝试修复 markdown json code block
                if "```json" in content:
                    content = content.split("```json")[1].split("```")[0].strip()
                    try:
                        data = json.loads(content)
                    except:
                        print(f"[秘书] Failed to parse JSON even after cleanup: {content}")
                else:
                    print(f"[秘书] Failed to parse JSON: {content}")
            
            if not data or not data.get("content"):
                # 如果是 null 或没有内容，尝试更新日志元数据（即使没有记忆摘要）
                if pair_id:
                    try:
                        await self.session.execute(
                            update(ConversationLog)
                            .where(ConversationLog.pair_id == pair_id)
                            .values(
                                sentiment=data.get("sentiment") if data else None,
                                analysis_status="completed",
                                last_error=None
                            )
                        )
                        await self.session.commit()
                        print(f"[秘书] Updated ConversationLog metadata (sentiment only) for pair_id: {pair_id}")
                    except Exception as meta_err:
                        print(f"[秘书] Failed to update log metadata: {meta_err}")
                
                print("[秘书] No meaningful memory content extracted (ignored).")
                return

            # 使用服务保存到内存（处理 VectorDB 和聚类索引）
            clusters_list = data.get("clusters", [])
            clusters_str = ",".join(clusters_list) if isinstance(clusters_list, list) else str(clusters_list)
            tags_str = ",".join(data.get("tags", [])) if isinstance(data.get("tags"), list) else str(data.get("tags", ""))

            memory = await MemoryService.save_memory(
                session=self.session,
                content=data["content"],
                tags=tags_str,
                clusters=clusters_str,
                importance=data.get("importance", 5),
                base_importance=data.get("importance", 5),
                sentiment=data.get("sentiment", "neutral"),
                source=source,
                memory_type=data.get("type", "event")
            )
            
            # 3. 如果有 pair_id，更新对话日志的元数据
            if pair_id:
                try:
                    await self.session.execute(
                        update(ConversationLog)
                        .where(ConversationLog.pair_id == pair_id)
                        .values(
                            sentiment=data.get("sentiment"),
                            importance=data.get("importance"),
                            memory_id=memory.id,
                            analysis_status="completed",
                            last_error=None
                        )
                    )
                except Exception as meta_err:
                    print(f"[秘书] Failed to update log metadata: {meta_err}")

            # 注意：save_memory 已经提交，但如果未包含，update_log 需要提交
            await self.session.commit()
            print(f"[秘书] Memory saved successfully: {data['content']}")
            
        except Exception as e:
            print(f"[秘书] Error processing interaction: {e}")
            if pair_id:
                await self._update_log_status(pair_id, "failed", str(e), increment_retry=True)
