import json
import asyncio
from datetime import datetime
from typing import List, Dict, Any, Optional
from sqlmodel import select, desc, col, delete
from sqlmodel.ext.asyncio.session import AsyncSession
from models import Memory, Config, AIModelConfig, MaintenanceRecord
from services.llm_service import LLMService

class MemorySecretaryService:
    def __init__(self, session: AsyncSession):
        self.session = session
        # 用于记录本次维护的变更，支持撤回
        self.created_ids = []
        self.deleted_data = []
        self.modified_data = []

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
        
        if not target_model_id:
            return LLMService(fallback_config["api_key"], fallback_config["api_base"], fallback_config["model"])

        try:
            model_config = await self.session.get(AIModelConfig, int(target_model_id))
            if not model_config:
                return LLMService(fallback_config["api_key"], fallback_config["api_base"], fallback_config["model"])
            
            final_api_key = model_config.api_key if model_config.provider_type == 'custom' else global_api_key
            final_api_base = model_config.api_base if model_config.provider_type == 'custom' else global_api_base
            
            return LLMService(final_api_key, final_api_base, model_config.model_id)
        except Exception:
            return LLMService(fallback_config["api_key"], fallback_config["api_base"], fallback_config["model"])

    async def run_maintenance(self) -> Dict[str, Any]:
        """运行增强版记忆整理任务"""
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
            "status": "success"
        }

        # Check API Key validity implicitly (if no key, fallback model might be used, but let's assume it works or fails)
        # Actually, LLMService logs error if no key.
        
        try:
            # 1. 提取偏好 (已按需关闭)
            report["preferences_extracted"] = 0 # await self._extract_preferences(llm)

            # 2. 标记重要性
            report["important_tagged"] = await self._tag_importance(llm)

            # 3. 记忆合并 (不同深度)
            # 修改：同时合并 'event' 和 'interaction_summary' 类型的记忆
            for offset in [0, 80, 160]:
                merged_count = await self._consolidate_memories(llm, offset=offset)
                report["consolidated"] += merged_count
                if merged_count == 0: break

            # 4. 新增：清理可疑/错误记忆
            report["cleaned_count"] = await self._clean_invalid_memories(llm)

            # 5. 新增：自动清理重复的社交日报总结
            report["social_summaries_cleaned"] = await self._clean_duplicate_social_summaries()

            # 6. 维护边界处理
            report["retired_count"] = await self._handle_maintenance_boundary()

            # 6. 自动更新动态台词 (Welcome & System)
            report["waifu_texts_updated"] = await self._update_waifu_texts(llm)

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
            print(f"Error undoing maintenance: {e}")
            await self.session.rollback()
            return False

    async def _clean_invalid_memories(self, llm: LLMService) -> int:
        """识别并清理可疑、矛盾或复读的错误记忆"""
        statement = select(Memory).order_by(desc(Memory.timestamp)).limit(100)
        memories = (await self.session.exec(statement)).all()
        
        if len(memories) < 5: return 0
        
        mem_data = [{"id": m.id, "content": m.content, "type": m.type} for m in memories]
        prompt = f"""
        # Role: 记忆审计专家 (Memory Auditor)
        你是 Pero 的记忆秘书。请审查以下记忆列表，找出其中的“脏数据”。

        ## 审查准则 (Cleaning Criteria):
        1. **逻辑矛盾**：例如同一人的性格描述前后完全相反（且无转变过程），或事实错误。
        2. **过度复读**：内容几乎完全重复的碎片。
        3. **幻觉/无效内容**：AI 生成的乱码、无意义的符号、或明显不符合 Pero 设定（如 Pero 突然变成了别的人）。
        4. **过时偏好**：如果有一条记忆说“主人讨厌吃苹果”，另一条更近的记忆说“主人现在爱上吃苹果了”，则旧的应标记为清理。

        待分析记忆:
        {json.dumps(mem_data, ensure_ascii=False)}

        请返回需要删除的记忆 ID 列表。
        格式: [id1, id2, ...]
        如果没有发现错误，返回空列表 []。不要返回任何额外文字。
        """

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
            print(f"Error cleaning memories: {e}")
        return 0

    async def _extract_preferences(self, llm: LLMService) -> int:
        """从记忆中提取长期偏好 (优化提示词)"""
        statement = select(Memory).where(Memory.type == "event").order_by(desc(Memory.timestamp)).limit(50)
        memories = (await self.session.exec(statement)).all()
        if not memories: return 0

        memory_texts = [f"- {m.content}" for m in memories]
        prompt = f"""
        # Role: 灵魂映射专家
        分析以下记忆，挖掘主人 (User) 的灵魂底色。
        
        ## 目标：
        提取那些能定义“主人是谁”的长期特质、癖好、底线和习惯。
        
        ## 提取准则：
        - **核心偏好**：例如“喜欢深夜工作”、“对 Pero 说话很温柔”、“讨厌吃香菜”。
        - **深刻羁绊**：主人对 Pero 的特定期待或赋予的特殊称呼。
        - **严禁**：提取任何具体的“今天做了什么”事件。

        记忆片段:
        {chr(10).join(memory_texts)}
        
        请以 Pero 的视角描述这些发现，例如：“主人似乎更喜欢在安静的深夜与我交流”。
        返回 JSON 列表: ["发现1", "发现2", ...]
        """

        try:
            response = await llm.chat([{"role": "user", "content": prompt}], temperature=0.3)
            content = response.get("choices", [{}])[0].get("message", {}).get("content", "")
            import re
            json_match = re.search(r'\[.*\]', content, re.S)
            if json_match:
                preferences = json.loads(json_match.group(0))
                count = 0
                for pref in preferences:
                    existing = (await self.session.exec(select(Memory).where(Memory.type == "preference").where(Memory.content == pref))).first()
                    if not existing:
                        new_mem = Memory(content=pref, type="preference", source="secretary", tags="偏好")
                        self.session.add(new_mem)
                        await self.session.flush() # 获取 ID
                        self.created_ids.append(new_mem.id)
                        count += 1
                await self.session.commit()
                return count
        except Exception as e:
            print(f"Error extracting preferences: {e}")
        return 0

    async def _tag_importance(self, llm: LLMService) -> int:
        """优化重要性打分逻辑"""
        statement = select(Memory).where(Memory.type == "event").where(Memory.importance == 1).order_by(desc(Memory.timestamp)).limit(50)
        memories = (await self.session.exec(statement)).all()
        if not memories: return 0

        mem_data = [{"id": m.id, "content": m.content} for m in memories]
        prompt = f"""
        # Role: 记忆权衡者
        为以下记忆评估“情感重量”(1-10分)。
        
        - **1-3 (轻如鸿毛)**: 无意义的寒暄、复读、单字回复。
        - **4-6 (生活点滴)**: 有具体信息量的日常、普通爱好。
        - **7-9 (刻骨铭心)**: 深刻的情感互动、重要的个人秘密、主人的重大决定。
        - **10 (生命支柱)**: 彻底改变 Pero 或主人的瞬间。

        请同时给出至少 4 个描述该记忆的主题、情感、人物或场景的标签。
        
        数据: {json.dumps(mem_data, ensure_ascii=False)}
        返回 JSON: { "id": { "importance": int, "tags": ["标签1", "标签2", "标签3", "标签4"] } }
        """

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
            print(f"Error tagging importance: {e}")
        return 0

    async def _consolidate_memories(self, llm: LLMService, offset: int = 0) -> int:
        """合并相似记忆 (优化提示词)"""
        # 修改：同时拉取 'event' 和 'interaction_summary' 类型的记忆进行熔炼
        statement = select(Memory).where(Memory.type.in_(["event", "interaction_summary"])).order_by(desc(Memory.timestamp)).offset(offset).limit(100)
        memories = (await self.session.exec(statement)).all()
        if len(memories) < 5: return 0

        batch_memories = memories[:80]
        mem_data = [{"id": m.id, "content": m.content, "time": m.realTime} for m in batch_memories]
        
        prompt = f"""
        # Role: 记忆炼金术士
        将以下碎片记忆熔炼成一段优美、连贯的日记体叙述。
        
        ## 熔炼法则：
        1. **去粗取精**：删除重复的、无意义的语气词。
        2. **时空编织**：将这些对话合并。**必须在叙述中明确提及每个关键事件发生的具体日期或时间点**，以便回顾。
        3. **Pero 视角**：使用 Pero 的第一人称，加入她当时可能的心情。
        4. **准确归因**：
           - 遇到“系统提醒”或“自动触发”的事件，**严禁**描述为“主人说”。
           - 应写为“收到系统提醒...”或“我注意到...”。
        5. **格式**：合并后的内容应以“那时...”或“在[具体日期]...”开头。

        待熔炼记忆: {json.dumps(mem_data, ensure_ascii=False)}
        
        返回 JSON 列表:
        [
          {
            "ids_to_merge": [id1, id2...],
            "new_content": "熔炼后的优美文字（包含时间信息）...",
            "tags": ["标签1", "标签2", "标签3", "标签4"],
            "importance": 1-10
          }
        ]
        ## 注意：
        - `tags` 必须包含至少 4 个能够准确反映这段记忆主题、情感、人物或场景的标签。
        """

        try:
            response = await llm.chat([{"role": "user", "content": prompt}], temperature=0.4)
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

                    for mid in valid_ids:
                        m_obj = next(m for m in batch_memories if m.id == mid)
                        self.deleted_data.append(m_obj.dict())
                        await self.session.exec(delete(Memory).where(Memory.id == mid))
                    count += 1
                await self.session.commit()
                return count
        except Exception as e:
            print(f"Error consolidating memories: {e}")
        return 0

    async def _clean_duplicate_social_summaries(self) -> int:
        """清理重复生成的社交日报记忆"""
        import re
        from collections import defaultdict
        
        try:
            # 查找包含社交日报标题的所有记忆
            statement = select(Memory).where(Memory.content.like("%【社交日报%"))
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
                print(f"[MemorySecretary] Cleaned {total_deleted} duplicate social summaries.")
            return total_deleted
            
        except Exception as e:
            print(f"Error cleaning duplicate social summaries: {e}")
            return 0

    async def _update_waifu_texts(self, llm: LLMService) -> bool:
        """根据近期记忆更新欢迎语和系统台词"""
        try:
            # 1. 获取当前配置
            config_key = "waifu_dynamic_texts"
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
                    static_path = r"c:\Users\Administrator\Desktop\Perofamily\Peroperochat-PE\public\live2d-widget\waifu-texts.json"
                    if os.path.exists(static_path):
                        with open(static_path, "r", encoding="utf-8") as f:
                            current_texts = json.load(f)
                except Exception as e:
                    print(f"Failed to load static waifu texts: {e}")

            # 2. 获取近期记忆摘要作为上下文
            statement = select(Memory).where(Memory.type == "event").order_by(desc(Memory.timestamp)).limit(20)
            memories = (await self.session.exec(statement)).all()
            context_text = "\n".join([f"- {m.content}" for m in memories])

            if not context_text:
                return False

            # 3. 构建 Prompt
            # 定义需要更新的字段及其说明
            target_fields = {
                "visibilityBack": "主人切回窗口时的欢迎语 (简短可爱)",
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

            prompt = f"""
            # Role: Pero (Live2D 看板娘)
            
            ## 任务
            根据主人的近期记忆 (Context) 和当前的台词配置 (Current)，生成一组**更新后的**台词。
            
            ## 记忆上下文
            {context_text}
            
            ## 当前台词 (参考用)
            {json.dumps(current_texts, ensure_ascii=False)}
            
            ## 目标字段
            {json.dumps(target_fields, ensure_ascii=False)}
            
            ## 要求
            1. **风格一致**: 保持 Pero 可爱、元气、偶尔调皮或温柔的风格。
            2. **结合记忆**: 尝试将记忆中的话题（如最近在忙什么、心情如何）自然融入到问候语中。例如如果主人最近熬夜多，深夜问候可以更关心一点。
            3. **滚动更新**: 你可以保留觉得依然合适的旧台词，也可以完全重写。
            4. **格式**: 返回一个纯 JSON 对象，包含上述目标字段。
            
            返回 JSON:
            """

            # 4. 调用 LLM
            response = await llm.chat([{"role": "user", "content": prompt}], temperature=0.7)
            content = response.get("choices", [{}])[0].get("message", {}).get("content", "")
            
            import re
            json_match = re.search(r'\{[\s\S]*\}', content)
            if json_match:
                new_texts = json.loads(json_match.group(0))
                
                # 简单校验
                if not isinstance(new_texts, dict):
                    return False

                # 5. 保存更新
                if not current_config:
                    current_config = Config(key=config_key, value=json.dumps(new_texts, ensure_ascii=False))
                    self.session.add(current_config)
                else:
                    current_config.value = json.dumps(new_texts, ensure_ascii=False)
                    self.session.add(current_config) # Ensure it's marked for update
                
                await self.session.commit()
                print(f"[MemorySecretary] Updated dynamic waifu texts.")
                return True

        except Exception as e:
            print(f"Error updating waifu texts: {e}")
            return False

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
            print(f"Error boundary: {e}")
            return 0
