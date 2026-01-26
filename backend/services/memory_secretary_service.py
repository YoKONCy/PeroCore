import json
import asyncio
from datetime import datetime
from typing import List, Dict, Any, Optional
from sqlmodel import select, desc, col, delete
from sqlmodel.ext.asyncio.session import AsyncSession
from models import Memory, MemoryRelation, Config, AIModelConfig, MaintenanceRecord
from services.llm_service import LLMService
from services.mdp.manager import MDPManager
import os

class MemorySecretaryService:
    def __init__(self, session: AsyncSession):
        self.session = session
        # 用于记录本次维护的变更，支持撤回
        self.created_ids = []
        self.deleted_data = []
        self.modified_data = []
        
        # Initialize MDPManager
        import os
        # Point to the root mdp directory, usually backend/services/mdp
        # mdp/manager.py is in backend/services/mdp
        # so os.path.dirname(__file__) in memory_secretary_service.py is backend/services
        # We need backend/services/mdp/prompts
        mdp_dir = os.path.join(os.path.dirname(__file__), "mdp", "prompts")
        self.mdp = MDPManager(mdp_dir)

    async def _get_llm_service(self) -> LLMService:
        """获取配置并初始化 LLM 服务"""
        result = await self.session.exec(select(Config))
        configs = {c.key: c.value for c in result.all()}
        
        global_api_key = configs.get("global_llm_api_key", "")
        global_api_base = configs.get("global_llm_api_base", "https://api.openai.com")
        secretary_model_id = configs.get("secretary_model_id")

        fallback_config = {
            "api_key": global_api_key or configs.get("ppc.apiKey", ""),
            "api_base": global_api_base or configs.get("ppc.apiBase", "https://api.openai.com"),
            "model": configs.get("ppc.modelName", "gpt-4o-mini"),
            "temperature": 0.3
        }

        target_model_id = secretary_model_id or configs.get("current_model_id")
        
        # 如果没有目标模型，回退到 fallback_config (但 fallback_config 本身可能包含 ppc.modelName)
        if not target_model_id:
            # 如果 fallback_config['model'] 也是默认的 gpt-4o-mini 且没有明确配置，这可能是一个问题
            # 但我们保留它作为最后的防线
            return LLMService(fallback_config["api_key"], fallback_config["api_base"], fallback_config["model"])

        try:
            model_config = await self.session.get(AIModelConfig, int(target_model_id))
            if not model_config:
                 # ID 存在但找不到配置，回退
                return LLMService(fallback_config["api_key"], fallback_config["api_base"], fallback_config["model"])
            
            final_api_key = model_config.api_key if model_config.provider_type == 'custom' else global_api_key
            final_api_base = model_config.api_base if model_config.provider_type == 'custom' else global_api_base
            
            return LLMService(final_api_key, final_api_base, model_config.model_id)
        except Exception:
            return LLMService(fallback_config["api_key"], fallback_config["api_base"], fallback_config["model"])

    async def run_maintenance(self) -> Dict[str, Any]:
        """运行增强版记忆整理任务 (Multi-Agent Support)"""
        llm = await self._get_llm_service()
        self.created_ids = []
        self.deleted_data = []
        self.modified_data = []
        
        report = {
            "preferences_extracted": 0,
            "important_tagged": 0,
            "consolidated": 0,
            "cleaned_count": 0,
            "retired_count": 0,
            "social_summaries_cleaned": 0,
            "waifu_texts_updated": 0,
            "status": "success",
            "agents_processed": []
        }

        try:
            # 0. Identify Agents
            from sqlalchemy import distinct
            stmt = select(distinct(Memory.agent_id))
            agent_ids = (await self.session.exec(stmt)).all()
            # Ensure at least 'pero' is processed if DB is empty or has nulls
            agent_ids = [aid for aid in agent_ids if aid]
            if not agent_ids: agent_ids = ["pero"]
            
            report["agents_processed"] = agent_ids
            print(f"[MemorySecretary] Running maintenance for agents: {agent_ids}")

            for agent_id in agent_ids:
                print(f"[MemorySecretary] Processing Agent: {agent_id}")
                # 1. 提取偏好 (已按需关闭)
                report["preferences_extracted"] += 0 # await self._extract_preferences(llm, agent_id)

                # 2. 标记重要性
                report["important_tagged"] += await self._tag_importance(llm, agent_id)

                # 3. 记忆合并
                for _ in range(3):
                    merged_count = await self._consolidate_memories(llm, offset=0, agent_id=agent_id)
                    report["consolidated"] += merged_count
                    if merged_count == 0: break

                # 4. 新增：清理可疑/错误记忆
                report["cleaned_count"] += await self._clean_invalid_memories(llm, agent_id)

                # 5. 新增：自动清理重复的社交日报总结
                report["social_summaries_cleaned"] += await self._clean_duplicate_social_summaries(agent_id)

                # 6. 维护边界处理 (Wait, does this need agent_id? Probably)
                # report["retired_count"] += await self._handle_maintenance_boundary(agent_id) # Need to check this method

            # 6. 自动更新动态台词 (Welcome & System) - per agent
            report["waifu_texts_updated"] += await self._update_waifu_texts(llm, agent_id)

            # 7. 保存维护记录用于撤回
            record = MaintenanceRecord(
                preferences_extracted=report["preferences_extracted"],
                important_tagged=report["important_tagged"],
                consolidated=report["consolidated"],
                cleaned_count=report["cleaned_count"],
                created_ids=json.dumps(self.created_ids),
                deleted_data=json.dumps(self.deleted_data, ensure_ascii=False, default=str),
                modified_data=json.dumps(self.modified_data, ensure_ascii=False, default=str)
            )
            self.session.add(record)
            await self.session.commit()
            
            return report
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            return {"status": "error", "error": str(e)}
        await self.session.refresh(record)
        
        report["record_id"] = record.id
        print(f"[MemorySecretary] Maintenance finished. Record ID: {record.id}, Report: {report}")
        return report

    async def undo_maintenance(self, record_id: int) -> bool:
        """撤回指定的维护任务"""
        try:
            record = await self.session.get(MaintenanceRecord, record_id)
            if not record: return False

            # 1. 删除本次维护生成的新记忆
            created_ids = json.loads(record.created_ids)
            for mid in created_ids:
                mem = await self.session.get(Memory, mid)
                if mem: await self.session.delete(mem)

            # 2. 恢复被删除的记忆
            deleted_data = json.loads(record.deleted_data)
            for m_dict in deleted_data:
                # 移除 ID 让数据库重新生成或手动指定 ID
                m_id = m_dict.pop('id', None)
                new_mem = Memory(**m_dict)
                if m_id: new_mem.id = m_id
                self.session.add(new_mem)

            # 3. 恢复被修改的记忆
            modified_data = json.loads(record.modified_data)
            for m_dict in modified_data:
                m_id = m_dict.get('id')
                if m_id:
                    existing = await self.session.get(Memory, m_id)
                    if existing:
                        for key, value in m_dict.items():
                            setattr(existing, key, value)
                        self.session.add(existing)

            # 4. 删除这条记录
            await self.session.delete(record)
            await self.session.commit()
            return True
        except Exception as e:
            print(f"撤销维护时出错: {e}")
            await self.session.rollback()
            return False

    async def _get_bot_name(self) -> str:
        try:
            config_entry = await self.session.get(Config, "bot_name")
            return config_entry.value if config_entry and config_entry.value else "Pero"
        except:
            return "Pero"

    async def _clean_invalid_memories(self, llm: LLMService, agent_id: str) -> int:
        """识别并清理可疑、矛盾或复读的错误记忆"""
        statement = select(Memory).where(Memory.agent_id == agent_id).order_by(desc(Memory.timestamp)).limit(100)
        memories = (await self.session.exec(statement)).all()
        
        if len(memories) < 5: return 0
        
        mem_data = [{"id": m.id, "content": m.content, "type": m.type} for m in memories]
        
        # Use agent_id as name if not Pero
        bot_name = await self._get_bot_name()
        if agent_id != "pero": bot_name = agent_id.capitalize()

        prompt = self.mdp.render("services/memory/maintenance/memory_auditor", {
            "agent_name": bot_name,
            "memory_data": json.dumps(mem_data, ensure_ascii=False)
        })

        try:
            response = await llm.chat([{"role": "user", "content": prompt}], temperature=0.2)
            content = response.get("choices", [{}])[0].get("message", {}).get("content", "")
            
            import re
            match = re.search(r'\[.*\]', content, re.S)
            if match:
                ids_to_delete = json.loads(match.group(0))
                count = 0
                for mid in ids_to_delete:
                    mem = await self.session.get(Memory, int(mid))
                    if mem:
                        self.deleted_data.append(mem.dict())
                        await self.session.delete(mem)
                        count += 1
                await self.session.commit()
                return count
        except Exception as e:
            print(f"清理记忆时出错: {e}")
        return 0

    async def _extract_preferences(self, llm: LLMService, agent_id: str) -> int:
        """从记忆中提取长期偏好 (优化提示词)"""
        statement = select(Memory).where(Memory.type == "event").where(Memory.agent_id == agent_id).order_by(desc(Memory.timestamp)).limit(50)
        memories = (await self.session.exec(statement)).all()
        if not memories: return 0

        memory_texts = [f"- {m.content}" for m in memories]
        
        bot_name = await self._get_bot_name()
        if agent_id != "pero": bot_name = agent_id.capitalize()

        prompt = self.mdp.render("services/memory/maintenance/preference_extractor", {
            "agent_name": bot_name,
            "memory_texts": chr(10).join(memory_texts)
        })

        try:
            response = await llm.chat([{"role": "user", "content": prompt}], temperature=0.3)
            content = response.get("choices", [{}])[0].get("message", {}).get("content", "")
            import re
            json_match = re.search(r'\[.*\]', content, re.S)
            if json_match:
                preferences = json.loads(json_match.group(0))
                count = 0
                for pref in preferences:
                    existing = (await self.session.exec(select(Memory).where(Memory.type == "preference").where(Memory.content == pref).where(Memory.agent_id == agent_id))).first()
                    if not existing:
                        new_mem = Memory(content=pref, type="preference", source="secretary", tags="偏好", agent_id=agent_id)
                        self.session.add(new_mem)
                        await self.session.flush() # 获取 ID
                        self.created_ids.append(new_mem.id)
                        count += 1
                await self.session.commit()
                return count
        except Exception as e:
            print(f"提取偏好时出错: {e}")
        return 0

    async def _tag_importance(self, llm: LLMService, agent_id: str = "pero") -> int:
        """优化重要性打分逻辑"""
        statement = select(Memory).where(Memory.type == "event").where(Memory.importance == 1).where(Memory.agent_id == agent_id).order_by(desc(Memory.timestamp)).limit(50)
        memories = (await self.session.exec(statement)).all()
        if not memories: return 0

        mem_data = [{"id": m.id, "content": m.content} for m in memories]
        
        bot_name = await self._get_bot_name()
        prompt = self.mdp.render("services/memory/maintenance/importance_tagger", {
            "agent_name": bot_name,
            "memory_data": json.dumps(mem_data, ensure_ascii=False)
        })

        try:
            response = await llm.chat([{"role": "user", "content": prompt}], temperature=0.2)
            content = response.get("choices", [{}])[0].get("message", {}).get("content", "")
            import re
            json_match = re.search(r'\{.*\}', content, re.S)
            if json_match:
                updates = json.loads(json_match.group(0))
                count = 0
                for m in memories:
                    if str(m.id) in updates:
                        self.modified_data.append(m.dict())
                        info = updates[str(m.id)]
                        m.importance = info.get("importance", m.importance)
                        new_tags = info.get("tags", [])
                        if not new_tags and "tag" in info:
                            new_tags = [info["tag"]]
                        
                        if new_tags:
                            current_tags = set(m.tags.split(',')) if m.tags else set()
                            for t in new_tags:
                                if t: current_tags.add(t)
                            m.tags = ",".join(filter(None, current_tags))
                        self.session.add(m)
                        count += 1
                await self.session.commit()
                return count
        except Exception as e:
            print(f"标记重要性时出错: {e}")
        return 0

    async def _consolidate_memories(self, llm: LLMService, offset: int = 0, agent_id: str = "pero") -> int:
        """合并相似记忆 (优化提示词)"""
        # 修改：同时拉取 'event' 和 'interaction_summary' 类型的记忆进行熔炼
        # 排除 source='secretary_merge' 的记忆，避免递归合并已生成的总结
        statement = select(Memory).where(
            Memory.type.in_(["event", "interaction_summary"]),
            Memory.source != "secretary_merge",
            Memory.agent_id == agent_id
        ).order_by(desc(Memory.timestamp)).offset(offset).limit(100)
        
        memories = (await self.session.exec(statement)).all()
        if len(memories) < 5: return 0

        batch_memories = memories[:80]
        mem_data = [{"id": m.id, "content": m.content, "time": m.realTime} for m in batch_memories]
        
        prompt = self.mdp.render("services/memory/maintenance/memory_consolidator", {
            "memory_data": json.dumps(mem_data, ensure_ascii=False)
        })

        try:
            response = await llm.chat([{"role": "user", "content": prompt}], temperature=0.2)
            content = response.get("choices", [{}])[0].get("message", {}).get("content", "")
            import re
            json_match = re.search(r'\[.*\]', content, re.S)
            if json_match:
                merges = json.loads(json_match.group(0))
                count = 0
                for merge in merges:
                    valid_ids = [int(mid) for mid in merge.get("ids_to_merge", []) if any(m.id == int(mid) for m in batch_memories)]
                    if len(valid_ids) < 2: continue

                    new_tags = merge.get("tags", [])
                    if not new_tags and "tag" in merge:
                        new_tags = [merge["tag"]]
                    if not new_tags:
                        new_tags = ["回忆"]

                    new_mem = Memory(
                        content=merge["new_content"],
                        tags=",".join(filter(None, new_tags)),
                        importance=merge.get("importance", 3),
                        source="secretary_merge",
                        type="event",
                        realTime=batch_memories[0].realTime
                    )
                    self.session.add(new_mem)
                    await self.session.flush()
                    self.created_ids.append(new_mem.id)

                    # [Enhancement] 关系迁移：将旧节点的连接继承给新节点
                    try:
                        # 1. 查找所有涉及 valid_ids 的关系
                        stmt_rel = select(MemoryRelation).where(
                            (col(MemoryRelation.source_id).in_(valid_ids)) | 
                            (col(MemoryRelation.target_id).in_(valid_ids))
                        )
                        existing_relations = (await self.session.exec(stmt_rel)).all()
                        
                        processed_pairs = set() # (source, target) 用于去重

                        for rel in existing_relations:
                            # Case 1: 内部关系 (Source 和 Target 都在合并范围内) -> 丢弃 (已内化)
                            if rel.source_id in valid_ids and rel.target_id in valid_ids:
                                continue
                            
                            # Case 2: 对外关系 (Source 在范围内 -> 变为 New -> Target)
                            if rel.source_id in valid_ids:
                                new_source = new_mem.id
                                new_target = rel.target_id
                            # Case 3: 被引用关系 (Target 在范围内 -> 变为 Source -> New)
                            else: # rel.target_id in valid_ids
                                new_source = rel.source_id
                                new_target = new_mem.id
                            
                            # 去重检查
                            if (new_source, new_target) not in processed_pairs:
                                processed_pairs.add((new_source, new_target))
                                self.session.add(MemoryRelation(
                                    source_id=new_source,
                                    target_id=new_target,
                                    relation_type=rel.relation_type,
                                    strength=rel.strength,
                                    description=rel.description
                                ))
                        
                        # 显式删除旧关系 (防止僵尸数据)
                        if existing_relations:
                             rel_ids = [r.id for r in existing_relations]
                             if rel_ids:
                                 await self.session.exec(delete(MemoryRelation).where(col(MemoryRelation.id).in_(rel_ids)))

                    except Exception as e:
                        print(f"[MemorySecretary] 关系迁移失败: {e}")

                    for mid in valid_ids:
                        m_obj = next(m for m in batch_memories if m.id == mid)
                        self.deleted_data.append(m_obj.dict())
                        await self.session.exec(delete(Memory).where(Memory.id == mid))
                    count += 1
                await self.session.commit()
                return count
        except Exception as e:
            print(f"整合记忆时出错: {e}")
        return 0

    async def _clean_duplicate_social_summaries(self, agent_id: str) -> int:
        """清理重复生成的社交日报记忆"""
        import re
        from collections import defaultdict
        
        try:
            # 查找包含社交日报标题的所有记忆
            statement = select(Memory).where(Memory.content.like("%【社交日报%")).where(Memory.agent_id == agent_id)
            memories = (await self.session.exec(statement)).all()
            
            if len(memories) < 2:
                return 0
                
            # 按日期分组
            date_groups = defaultdict(list)
            pattern = re.compile(r"【社交日报 (\d{4}-\d{2}-\d{2})】")
            
            for mem in memories:
                match = pattern.search(mem.content)
                if match:
                    date_str = match.group(1)
                    date_groups[date_str].append(mem)
            
            total_deleted = 0
            for date_str, mem_list in date_groups.items():
                if len(mem_list) > 1:
                    # 按 ID 排序，保留最新的（ID 最大的）
                    mem_list.sort(key=lambda x: x.id)
                    to_delete = mem_list[:-1]
                    
                    for mem in to_delete:
                        self.deleted_data.append(mem.dict())
                        await self.session.delete(mem)
                        total_deleted += 1
            
            if total_deleted > 0:
                await self.session.commit()
                print(f"[MemorySecretary] 清理了 {total_deleted} 条重复的社交摘要。")
            return total_deleted
            
        except Exception as e:
            print(f"清理重复社交摘要时出错: {e}")
            return 0

    async def _update_waifu_texts(self, llm: LLMService, agent_id: str = "pero") -> int:
        """根据近期记忆更新欢迎语和系统台词"""
        try:
            # 1. 获取当前配置
            # 兼容旧 key: pero 使用 "waifu_dynamic_texts"，其他 agent 使用 "waifu_dynamic_texts_{agent_id}"
            config_key = "waifu_dynamic_texts" if agent_id == "pero" else f"waifu_dynamic_texts_{agent_id}"
            
            current_config = await self.session.get(Config, config_key)
            current_texts = {}
            if current_config:
                try:
                    current_texts = json.loads(current_config.value)
                except:
                    pass
            
            # 如果没有动态配置，尝试读取静态文件作为初始参考
            if not current_texts:
                try:
                    import os
                    # 假设相对路径或绝对路径
                    # [Fix] 指向 PeroCore 自己的台词文件，而不是 Peroperochat-PE 的
                    static_path = r"c:\Users\Administrator\Desktop\Perofamily\PeroCore\public\live2d-widget\waifu-texts.json"
                    if os.path.exists(static_path):
                        with open(static_path, "r", encoding="utf-8") as f:
                            current_texts = json.load(f)
                except Exception as e:
                    print(f"加载静态 Waifu 文本失败: {e}")

            # 2. 获取近期记忆摘要作为上下文 (Filter by agent_id)
            statement = select(Memory).where(Memory.type == "event").where(Memory.agent_id == agent_id).order_by(desc(Memory.timestamp)).limit(20)
            memories = (await self.session.exec(statement)).all()
            context_text = "\n".join([f"- {m.content}" for m in memories])

            if not context_text:
                return 0

            # 3. 构建 Prompt
            # 定义需要更新的字段及其说明
            target_fields = {
                "visibilityBack": "主人切回窗口时的欢迎语 (简短可爱)",
                "idleMessages": "挂机时的随机闲聊 (数组，3-5句)",
                "welcome_timeRanges_morningEarly": "清晨 (4:00-7:00) 问候",
                "welcome_timeRanges_morning": "上午 (7:00-11:00) 问候",
                "welcome_timeRanges_noon": "中午 (11:00-13:00) 问候",
                "welcome_timeRanges_afternoon": "下午 (13:00-17:00) 问候",
                "welcome_timeRanges_eveningSunset": "傍晚 (17:00-19:00) 问候",
                "welcome_timeRanges_night": "晚上 (19:00-22:00) 问候",
                "welcome_timeRanges_lateNight": "深夜 (22:00-24:00) 问候 (可以是数组)",
                "welcome_timeRanges_midnight": "凌晨 (0:00-4:00) 问候",
                "randTexturesNoClothes": "换装失败/没衣服时的吐槽",
                "randTexturesSuccess": "换装成功时的撒娇"
            }

            bot_name = await self._get_bot_name()
            if agent_id != "pero":
                 bot_name = agent_id.capitalize()

            # 获取风格描述 (从 AgentProfile 或配置中获取，目前先从 Identity.md 中提取或默认)
            # 暂时使用默认风格
            tone_style = "可爱、元气、偶尔调皮或温柔"

            # [Fix] 显式禁止使用 Pio/Tia 等默认名，强制使用 bot_name
            # 在 Prompt 中已添加 "禁止使用其他名字" 的约束

            prompt = self.mdp.render("services/memory/maintenance/waifu_text_updater", {
                "agent_name": bot_name,
                "tone_style": tone_style,
                "context_text": context_text,
                "current_texts": json.dumps(current_texts, ensure_ascii=False),
                "target_fields": json.dumps(target_fields, ensure_ascii=False)
            })

            # 4. 调用 LLM
            response = await llm.chat([{"role": "user", "content": prompt}], temperature=0.7, timeout=300.0)
            content = response.get("choices", [{}])[0].get("message", {}).get("content", "")
            
            import re
            # 优先匹配 Markdown 代码块
            code_block_match = re.search(r'```json\s*(\{[\s\S]*?\})\s*```', content)
            if code_block_match:
                json_str = code_block_match.group(1)
            else:
                # 备用：寻找最外层的 {}，但为了防止前文干扰，我们尝试从后往前找或者使用非贪婪？
                # 贪婪匹配 {.*} 确实容易把前文包含进去。
                # 简单修复：如果贪婪匹配失败，尝试寻找第一个 { 和最后一个 }
                json_match = re.search(r'\{[\s\S]*\}', content)
                if json_match:
                    json_str = json_match.group(0)
                else:
                    json_str = None

            if json_str:
                new_texts = json.loads(json_str)
                
                # 简单校验
                if not isinstance(new_texts, dict):
                    return 0

                # 5. 保存更新到 Config (Welcome/System)
                if not current_config:
                    current_config = Config(key=config_key, value=json.dumps(new_texts, ensure_ascii=False))
                    self.session.add(current_config)
                else:
                    current_config.value = json.dumps(new_texts, ensure_ascii=False)
                    self.session.add(current_config) # Ensure it's marked for update
                
                # 6. [Feature] 同步更新 PetState (Idle/Back/Click)
                # 这样前端 PetView 通过 get_pet_state 就能获取到最新的动态台词
                from models import PetState
                state = (await self.session.exec(select(PetState).where(PetState.agent_id == agent_id))).first()
                if not state:
                     # Create if not exists (though usually it should exist)
                     state = PetState(agent_id=agent_id)
                     self.session.add(state)
                
                if state:
                    # Update Back Messages (visibilityBack -> back_messages_json)
                    if "visibilityBack" in new_texts:
                        # PetState expects a JSON list string
                        state.back_messages_json = json.dumps([new_texts["visibilityBack"]], ensure_ascii=False)
                    
                    # Update Idle Messages
                    if "idleMessages" in new_texts:
                        msgs = new_texts["idleMessages"]
                        if isinstance(msgs, str): msgs = [msgs]
                        if isinstance(msgs, list):
                            state.idle_messages_json = json.dumps(msgs, ensure_ascii=False)
                    
                    # Note: Click messages are complex (head/body/chest), currently prompt doesn't generate them structurely.
                    # We skip click_messages for now or add them later.

                    self.session.add(state)

                await self.session.commit()
                print(f"[MemorySecretary] 已更新动态 Waifu 文本 (Agent: {agent_id})。")
                return 1

        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"更新 Waifu 文本时出错: {e!r}")
            return 0

    async def _handle_maintenance_boundary(self) -> int:
        """处理 1000 条维护边界"""
        try:
            statement = select(Memory).where(Memory.type == "event").order_by(desc(Memory.timestamp))
            all_events = (await self.session.exec(statement)).all()
            if len(all_events) <= 1000: return 0
            
            old_memories = all_events[1000:]
            count = 0
            for m in old_memories:
                if m.importance < 7:
                    self.modified_data.append(m.dict())
                    m.type = "archived"
                    self.session.add(m)
                    count += 1
            await self.session.commit()
            return count
        except Exception as e:
            print(f"维护边界处理错误: {e}")
            return 0
