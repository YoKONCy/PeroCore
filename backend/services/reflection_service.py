import asyncio
from typing import List, Optional
from sqlmodel import select, desc
from sqlmodel.ext.asyncio.session import AsyncSession
from models import Memory, MemoryRelation, Config, AIModelConfig, MaintenanceRecord, ConversationLog
from services.llm_service import LLMService
import json
import random
from datetime import datetime, timedelta
from collections import defaultdict

class ReflectionService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def _get_reflection_config(self):
        """获取反思模型配置 (通常是更强大的模型，如 GPT-4/Claude-3.5)"""
        # 复用 AgentService 中的逻辑，或者直接查询 Config
        # 这里简化处理，直接查 Config
        configs = {c.key: c.value for c in (await self.session.exec(select(Config))).all()}
        
        reflection_model_id = configs.get("reflection_model_id")
        
        # 默认回退
        api_key = configs.get("global_llm_api_key", "")
        api_base = configs.get("global_llm_api_base", "https://api.openai.com")
        model = "gpt-4o" # 默认高智商模型

        if reflection_model_id:
            model_config = await self.session.get(AIModelConfig, int(reflection_model_id))
            if model_config:
                api_key = model_config.api_key if model_config.provider_type == 'custom' else api_key
                api_base = model_config.api_base if model_config.provider_type == 'custom' else api_base
                model = model_config.model_id
        
        return {
            "api_key": api_key,
            "api_base": api_base,
            "model": model,
            "temperature": 0.4 # 需要一定的创造力来发现关联，但不能太发散
        }

    async def backfill_failed_scorer_tasks(self, retry_limit: int = 3, concurrency_limit: int = 5):
        """
        [补录记忆]
        处理失败的Scorer分析任务
        """
        print("[Reflection] Starting failed Scorer tasks backfill...", flush=True)
        
        semaphore = asyncio.Semaphore(concurrency_limit)
        
        async def retry_task(task):
            async with semaphore:
                print(f"[Reflection] Backfilling failed task (ID: {task.id})...")
                # Local import to avoid circular dependency
                from services.scorer_service import ScorerService
                scorer_service = ScorerService(self.session)
                await scorer_service.retry_interaction(task.id)
        
        # 1. 查找失败的分析任务
        statement = select(ConversationLog).where(
            (ConversationLog.analysis_status == "failed") &
            (ConversationLog.retry_count < retry_limit)
        ).order_by(desc(ConversationLog.timestamp))
        
        failed_tasks = (await self.session.exec(statement)).all()
        if not failed_tasks:
            print("[Reflection] No failed Scorer tasks to backfill.")
            return
        
        # 2. 并发处理失败任务
        tasks = [retry_task(task) for task in failed_tasks]
        await asyncio.gather(*tasks)
        
        await self.session.commit()
        print(f"[Reflection] Backfilled {len(failed_tasks)} failed Scorer tasks.")

    async def consolidate_memories(self, lookback_days: int = 3, importance_threshold: int = 4):
        """
        [Memory Consolidation]
        压缩低重要性、陈旧的记忆为陈述性总结。
        """
        print(f"[Reflection] Starting memory consolidation (older than {lookback_days} days, importance < {importance_threshold})...", flush=True)
        
        # 1. 查找候选记忆
        cutoff_time = datetime.now() - timedelta(days=lookback_days)
        cutoff_timestamp = cutoff_time.timestamp() * 1000
        
        statement = select(Memory).where(
            (Memory.type == "event") & 
            (Memory.timestamp < cutoff_timestamp) & 
            (Memory.importance < importance_threshold)
        ).order_by(Memory.timestamp)
        
        candidates = (await self.session.exec(statement)).all()
        
        if not candidates:
            print("[Reflection] No memories to consolidate.")
            return

        # 2. 按日期分组
        grouped = defaultdict(list)
        for m in candidates:
            # key by YYYY-MM-DD
            date_key = m.realTime.split(" ")[0] if m.realTime else "unknown"
            grouped[date_key].append(m)
            
        config = await self._get_reflection_config()
        if not config["api_key"]:
            print("[Reflection] No API Key, skipping consolidation.")
            return

        llm = LLMService(
            api_key=config["api_key"],
            api_base=config["api_base"],
            model=config["model"]
        )

        # 3. 处理每一组
        for date_key, group in grouped.items():
            if len(group) < 3:
                continue # 跳过太少的组
            
            print(f"[Reflection] Consolidating {len(group)} memories from {date_key}...")
            
            # 生成总结
            summary_text = await self._generate_summary(llm, group, date_key)
            if not summary_text:
                continue
                
            # 创建总结性记忆
            # 我们将其插入到该组第一条记忆的位置
            first_mem = group[0]
            last_mem = group[-1]
            
            # 计算平均重要性并略微提升
            avg_imp = sum(m.importance for m in group) / len(group)
            new_importance = min(10, int(avg_imp) + 1)
            
            # 生成 Embedding
            from services.embedding_service import embedding_service
            embedding_json = "[]"
            try:
                vec = embedding_service.encode_one(summary_text)
                embedding_json = json.dumps(vec)
            except: pass

            summary_mem = Memory(
                content=summary_text,
                tags="summary,consolidated",
                importance=new_importance,
                base_importance=float(new_importance),
                sentiment="neutral", 
                timestamp=first_mem.timestamp, # 使用第一条的时间
                realTime=first_mem.realTime,
                source="system",
                type="summary",
                embedding_json=embedding_json
            )
            self.session.add(summary_mem)
            await self.session.flush() # 获取 ID
            await self.session.refresh(summary_mem)
            
            # 更新链表 (Bypass the group)
            # A -> [B -> ... -> D] -> E
            # 变为: A -> S -> E
            
            prev_node = None
            if first_mem.prev_id:
                prev_node = await self.session.get(Memory, first_mem.prev_id)
                
            next_node = None
            if last_mem.next_id:
                next_node = await self.session.get(Memory, last_mem.next_id)
                
            if prev_node:
                prev_node.next_id = summary_mem.id
                summary_mem.prev_id = prev_node.id
                self.session.add(prev_node)
            
            # 如果 group 包含了 next_node (逻辑上不可能，因为我们是按时间排序的一组)，但为了安全
            if next_node and next_node.id != summary_mem.id:
                next_node.prev_id = summary_mem.id
                summary_mem.next_id = next_node.id
                self.session.add(next_node)
                
            # 归档原始记忆
            archived_ids = []
            for m in group:
                m.type = "archived_event"
                self.session.add(m)
                archived_ids.append(m.id)
                
            # 记录维护日志
            record = MaintenanceRecord(
                consolidated=len(group),
                created_ids=json.dumps([summary_mem.id]),
                modified_data=json.dumps({"archived_ids": archived_ids})
            )
            self.session.add(record)
            
            # 立即提交，释放写锁，防止长事务阻塞
            await self.session.commit()
            print(f"[Reflection] Consolidated {len(group)} memories into ID {summary_mem.id}: {summary_text[:50]}...")
            
        print("[Reflection] Memory consolidation complete.")

    async def _generate_summary(self, llm: LLMService, memories: List[Memory], date_str: str) -> str:
        mem_text = "\n".join([f"- {m.realTime.split(' ')[1] if m.realTime else ''}: {m.content}" for m in memories])
        prompt = f"""
请将以下发生在 {date_str} 的一系列琐碎记忆片段，合并为一条连贯的、陈述性的关键记忆。
忽略无关紧要的细节（如"吃了苹果"），重点保留具有长期价值的信息（如"开始注重健康饮食"）。
如果都是无意义的废话，请总结为"度过了平淡的一天"。

记忆片段：
{mem_text}

输出要求：
直接输出总结后的文本，不要包含任何前缀或解释。
"""
        try:
            res = await llm.chat([{"role": "user", "content": prompt}], temperature=0.3)
            return res["choices"][0]["message"]["content"].strip()
        except Exception as e:
            print(f"Summary generation failed: {e}")
            return None

    async def dream_and_associate(self, limit: int = 10):
        """
        [梦境机制]
        扫描最近的无关联记忆，尝试发现它们之间的联系。
        升级版：使用向量检索 + 扩散激活 (Spreading Activation) 寻找潜在关联
        """
        from services.memory_service import MemoryService
        
        print("[Reflection] Entering dream mode (scanning for associations)...", flush=True)
        
        # 1. 获取最近的 N 条记忆 (Event 类型) 作为"梦境锚点"
        statement = select(Memory).where(Memory.type == "event").order_by(desc(Memory.timestamp)).limit(limit)
        anchors = (await self.session.exec(statement)).all()
        
        if len(anchors) < 1:
            print("[Reflection] Not enough memories to associate.")
            return

        config = await self._get_reflection_config()
        if not config["api_key"]:
            print("[Reflection] No API Key, skipping.")
            return

        llm = LLMService(
            api_key=config["api_key"],
            api_base=config["api_base"],
            model=config["model"]
        )

        # 2. 针对每个锚点，使用记忆检索算法寻找相关记忆
        # 这比简单的滑动窗口更智能，能发现跨度很大的深层联系
        processed_pairs = set()

        for target_memory in anchors:
            print(f"[Reflection] Dreaming about: {target_memory.content[:30]}...")
            
            # 使用 MemoryService 的高级检索 (Vector + Graph)
            # 排除掉自己，且不限制时间范围 (exclude_after_time=None) 以允许连接过去
            candidates = await MemoryService.get_relevant_memories(
                self.session, 
                target_memory.content, 
                limit=5
            )
            
            for candidate in candidates:
                if candidate.id == target_memory.id:
                    continue
                    
                # 避免重复处理同一对 (A, B) 和 (B, A)
                pair_key = tuple(sorted((target_memory.id, candidate.id)))
                if pair_key in processed_pairs:
                    continue
                processed_pairs.add(pair_key)

                # 检查数据库中是否已经存在关联
                existing = await self.session.exec(
                    select(MemoryRelation).where(
                        ((MemoryRelation.source_id == target_memory.id) & (MemoryRelation.target_id == candidate.id)) |
                        ((MemoryRelation.source_id == candidate.id) & (MemoryRelation.target_id == target_memory.id))
                    )
                )
                if existing.first():
                    continue # 已关联，跳过
            
                # 3. 调用 LLM 判断关联
                relation = await self._analyze_relation(llm, target_memory, candidate)
                
                if relation:
                    # 4. 写入数据库
                    new_relation = MemoryRelation(
                        source_id=target_memory.id,
                        target_id=candidate.id,
                        relation_type=relation["type"],
                        strength=relation["strength"],
                        description=relation["description"]
                    )
                    self.session.add(new_relation)
                    await self.session.commit() # 发现一个关联就提交一个，避免长事务
                    print(f"[Reflection] New association found: {relation['description']} (Strength: {relation['strength']})")
                
        print("[Reflection] Dream cycle complete.")

    async def scan_lonely_memories(self, limit: int = 5):
        """
        [孤独记忆扫描器]
        寻找那些没有关联 (MemoryRelation) 的孤立记忆，并尝试将它们织入关系网。
        """
        from services.memory_service import MemoryService
        
        print("[Reflection] Scanning for lonely memories...", flush=True)
        
        # 1. 查找孤立记忆 (没有作为 source 或 target 出现在 Relation 表中)
        # SQLModel 不支持直接的 except/minus，我们用 python 集合处理 (小数据量可行) 或子查询
        # 这里为了兼容性，先查出所有有关系的 ID，再排除
        
        # 获取所有有关系的 ID
        rel_statement = select(MemoryRelation.source_id, MemoryRelation.target_id)
        relations = (await self.session.exec(rel_statement)).all()
        connected_ids = set()
        for src, tgt in relations:
            connected_ids.add(src)
            connected_ids.add(tgt)
            
        # 查找不在 connected_ids 中的 Event 记忆
        # 优先处理最近的孤独记忆
        statement = select(Memory).where(Memory.type == "event").order_by(desc(Memory.timestamp))
        all_memories = (await self.session.exec(statement)).all()
        
        lonely_memories = [m for m in all_memories if m.id not in connected_ids][:limit]
        
        if not lonely_memories:
            print("[Reflection] No lonely memories found.")
            return

        config = await self._get_reflection_config()
        if not config["api_key"]:
            print("[Reflection] No API Key, skipping.")
            return

        llm = LLMService(
            api_key=config["api_key"],
            api_base=config["api_base"],
            model=config["model"]
        )

        # 2. 为每个孤独记忆寻找归宿
        for lonely_mem in lonely_memories:
            print(f"[Reflection] Trying to connect lonely memory: {lonely_mem.content[:30]}...")
            
            # 使用向量检索寻找相似记忆
            candidates = await MemoryService.get_relevant_memories(
                self.session, 
                lonely_mem.content, 
                limit=5
            )
            
            for candidate in candidates:
                if candidate.id == lonely_mem.id:
                    continue
                
                # 双重检查是否已存在关联 (虽然前面过滤了，但为了并发安全)
                existing = await self.session.exec(
                    select(MemoryRelation).where(
                        ((MemoryRelation.source_id == lonely_mem.id) & (MemoryRelation.target_id == candidate.id)) |
                        ((MemoryRelation.source_id == candidate.id) & (MemoryRelation.target_id == lonely_mem.id))
                    )
                )
                if existing.first():
                    continue

                # 分析关联
                relation = await self._analyze_relation(llm, lonely_mem, candidate)
                
                if relation:
                    new_relation = MemoryRelation(
                        source_id=lonely_mem.id,
                        target_id=candidate.id,
                        relation_type=relation["type"],
                        strength=relation["strength"],
                        description=relation["description"]
                    )
                    self.session.add(new_relation)
                    await self.session.commit()
                    print(f"[Reflection] Connected lonely memory! {relation['description']}")
                    # 找到一个关联就跳出当前候选循环，继续下一个孤独记忆 (避免过度连接)
                    # 或者也可以继续找，看策略。这里选择继续找，织网越密越好。
        
        await self.session.commit()
        print(f"[Reflection] Lonely memory scan complete. Processed {len(lonely_memories)} items.")

    async def _analyze_relation(self, llm: LLMService, m1: Memory, m2: Memory) -> Optional[dict]:
        """让 LLM 分析两条记忆的关系"""
        prompt = f"""
请分析以下两条记忆之间是否存在深层关联（如因果、主题相似、矛盾、递进等）。

记忆 A ({m1.realTime}): {m1.content} (Tags: {m1.tags})
记忆 B ({m2.realTime}): {m2.content} (Tags: {m2.tags})

如果存在关联，请输出 JSON：
{{
    "has_relation": true,
    "type": "associative" | "causal" | "thematic" | "contradictory",
    "strength": 0.1-1.0,
    "description": "简短描述关联内容"
}}

如果没有明显关联，仅输出: {{"has_relation": false}}
"""
        try:
            response = await llm.chat([{"role": "user", "content": prompt}], temperature=0.1, response_format={"type": "json_object"})
            content = response["choices"][0]["message"]["content"]
            
            # Parse JSON (Simple)
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0]
            elif "```" in content:
                content = content.split("```")[1].split("```")[0]
            
            data = json.loads(content)
            if data.get("has_relation"):
                return data
            return None
        except Exception as e:
            print(f"[Reflection] Error analyzing relation: {e}")
            return None
