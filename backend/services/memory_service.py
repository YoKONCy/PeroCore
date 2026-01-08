from typing import List, Optional, Dict, Any
from datetime import datetime
from sqlmodel import select, delete, desc, and_
from sqlmodel.ext.asyncio.session import AsyncSession
from models import Memory, ConversationLog, MemoryRelation
import re
import json

# [Global State] 高性能 Rust 引擎单例
_rust_engine = None

async def get_rust_engine(session: AsyncSession):
    global _rust_engine
    if _rust_engine is not None:
        return _rust_engine
    
    try:
        from pero_memory_core import CognitiveGraphEngine
        print("[Memory] Initializing Global Rust Cognitive Engine...", flush=True)
        _rust_engine = CognitiveGraphEngine()
        _rust_engine.configure(max_active_nodes=10000, max_fan_out=20)
        
        # 预加载所有关系 (全量加载至内存 CSR 结构)
        statement = select(MemoryRelation)
        relations = (await session.exec(statement)).all()
        rust_relations = [(rel.source_id, rel.target_id, rel.strength) for rel in relations]
        
        # 同时加载 Prev/Next 链表关系
        statement_mem = select(Memory.id, Memory.prev_id, Memory.next_id).where((Memory.prev_id != None) | (Memory.next_id != None))
        mem_links = (await session.exec(statement_mem)).all()
        for mid, prev_id, next_id in mem_links:
            if prev_id: rust_relations.append((mid, prev_id, 0.2))
            if next_id: rust_relations.append((mid, next_id, 0.2))
            
        _rust_engine.batch_add_connections(rust_relations)
        print(f"[Memory] Rust Engine Loaded with {len(rust_relations)} connections.", flush=True)
    except Exception as e:
        print(f"[Memory] Failed to init Rust engine: {e}")
        _rust_engine = False # 标记为不可用
        
    return _rust_engine

class MemoryService:
    @staticmethod
    async def save_memory(
        session: AsyncSession, 
        content: str, 
        tags: str = "", 
        clusters: str = "", # 新增 clusters 参数
        importance: int = 1, 
        base_importance: float = 1.0, 
        sentiment: str = "neutral",
        msg_timestamp: Optional[str] = None, 
        source: str = "desktop", 
        memory_type: str = "event"
    ) -> Memory:
        from datetime import datetime
        from sqlmodel import desc
        from services.vector_service import vector_service
        from services.embedding_service import embedding_service
        
        # 1. 查找上一条记忆 (The Tail of the Time-Axis)
        # 我们需要找到当前最新的记忆，将其作为 prev
        # 注意：这里假设时间轴是单线的。如果未来支持多时间线（如平行世界），需要加过滤条件。
        statement = select(Memory).order_by(desc(Memory.timestamp)).limit(1)
        last_memory_result = await session.exec(statement)
        last_memory = last_memory_result.first()

        prev_id = last_memory.id if last_memory else None

        # 2. 创建新记忆
        # 生成 Embedding (用于写入 VectorDB)
        # 注意：embedding_json 字段在 SQLite 中保留作为备份或兼容，但主要查询走 VectorDB
        embedding_vec = embedding_service.encode_one(content)
        embedding_json = json.dumps(embedding_vec)

        memory = Memory(
            content=content,
            tags=tags,
            clusters=clusters, # Save clusters
            importance=importance,
            base_importance=base_importance,
            sentiment=sentiment,
            msgTimestamp=msg_timestamp,
            realTime=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            source=source,
            type=memory_type,
            prev_id=prev_id,
            next_id=None,
            embedding_json=embedding_json # 仍保留一份在 SQLite
        )
        session.add(memory)
        await session.commit()
        await session.refresh(memory)

        # 3. 同步写入 VectorDB
        if embedding_vec:
            try:
                # [Feature] 标签加权向量 (Tag Weighted Embedding)
                # 将 tags 附加到内容中进行向量化，虽然这里 vector_service.add_memory 接收的是 embedding_vec
                # 但我们在 embedding_service.encode_one(content) 时传入的只是 content
                # 
                # 改进方案：
                # 实际上，我们在 step 2 已经生成了 embedding_vec (只基于 content)。
                # 为了增强标签权重，我们应该生成一个 "enriched_embedding" 仅用于 VectorDB 索引，
                # 而 content 保持原样用于展示。
                # 
                # 但为了不破坏现有逻辑 (sqlite 里的 embedding_json 也是基于 content)，
                # 我们这里做一个策略：
                # 如果有 tags，我们生成一个混合文本 "tags: ... content: ..." 重新生成向量用于 VectorDB。
                
                final_embedding = embedding_vec
                if tags:
                    # 简单加权策略：将 tags 放在前面，重复 2 次以增加权重
                    # enriched_text = f"{tags} {tags} {content}"
                    # 或者更自然的:
                    enriched_text = f"{tags} {tags} {content}"
                    final_embedding = embedding_service.encode_one(enriched_text)
                    
                    # [Feature] TagMemo Indexing
                    # 将标签独立存入 Tag Index
                    tag_list = [t.strip() for t in tags.split(',') if t.strip()]
                    if tag_list:
                        try:
                            tag_embeddings = embedding_service.encode(tag_list)
                            for i, tag_name in enumerate(tag_list):
                                vector_service.add_tag(tag_name, tag_embeddings[i])
                        except Exception as tag_e:
                            print(f"[MemoryService] Failed to index tags: {tag_e}")
                
                # Construct metadata
                metadata_dict = {
                    "type": memory_type,
                    "timestamp": memory.timestamp,
                    "importance": float(importance),
                    "tags": tags, 
                    "clusters": clusters
                }
                
                # [Feature] Thinking Pipeline: Explode clusters for precise filtering
                # clusters="[逻辑推理簇],[反思簇]" -> metadata={"cluster_逻辑推理簇": True, "cluster_反思簇": True}
                if clusters:
                    cluster_list = [c.strip() for c in clusters.split(',') if c.strip()]
                    for c in cluster_list:
                        # Remove brackets if present
                        clean_c = c.replace('[', '').replace(']', '')
                        if clean_c:
                            metadata_dict[f"cluster_{clean_c}"] = True

                vector_service.add_memory(
                    memory_id=memory.id,
                    content=content,
                    embedding=final_embedding,
                    metadata=metadata_dict
                )
            except Exception as e:
                print(f"[MemoryService] Failed to sync to VectorDB: {e}")

        # 4. 更新上一条记忆的 next_id (双向链表维护)
        if last_memory:
            last_memory.next_id = memory.id
            session.add(last_memory)
            await session.commit()
            
            # [Optimization] 同步更新全局 Rust 引擎单例
            try:
                engine = await get_rust_engine(session)
                if engine:
                    # 添加 prev/next 双向链接权重
                    engine.batch_add_connections([
                        (memory.id, last_memory.id, 0.2),
                        (last_memory.id, memory.id, 0.2)
                    ])
            except: pass

        return memory

    @staticmethod
    async def save_log(session: AsyncSession, source: str, session_id: str, role: str, content: str, metadata: dict = None, pair_id: str = None) -> ConversationLog:
        """保存原始对话记录到 ConversationLog"""
        # 1. 移除 NIT 协议标记 (Non-invasive Integration Tools)
        from nit_core.dispatcher import remove_nit_tags
        cleaned_content = remove_nit_tags(content)

        # 2. 清洗真正意义上的大数据量技术标签
        big_data_tags = ['FILE_RESULTS', 'MEMORY_LIST', 'SEARCH_RESULTS']
        for tag in big_data_tags:
            # 仅在内容确实很长时才折叠技术标签，避免误伤
            pattern = rf'<{tag}>([\s\S]{{1000,}}?)</{tag}>'
            cleaned_content = re.sub(pattern, f'<{tag}>[已折叠大数据量内容]</{tag}>', cleaned_content)
        
        log = ConversationLog(
            source=source,
            session_id=session_id,
            role=role,
            content=cleaned_content,
            metadata_json=json.dumps(metadata or {}),
            pair_id=pair_id
        )
        session.add(log)
        # 注意：这里去掉了 commit()，改为由外部或 save_log_pair 统一控制
        return log

    @staticmethod
    async def save_log_pair(session: AsyncSession, source: str, session_id: str, user_content: str, assistant_content: str, pair_id: str, metadata: dict = None):
        """原子性保存用户消息与助手回复成对记录"""
        try:
            # [Feature] System Trigger Role Correction
            # 如果内容以【系统触发】开头，则将角色修正为 system
            user_role = "user"
            if user_content and user_content.startswith("【系统触发】"):
                user_role = "system"

            # 创建用户消息记录
            user_log = await MemoryService.save_log(session, source, session_id, user_role, user_content, metadata, pair_id)
            # 创建助手消息记录
            assistant_log = await MemoryService.save_log(session, source, session_id, "assistant", assistant_content, metadata, pair_id)
            
            await session.commit()
            await session.refresh(user_log)
            await session.refresh(assistant_log)
            return user_log, assistant_log
        except Exception as e:
            await session.rollback()
            print(f"[MemoryService] Failed to save log pair: {e}")
            raise e

    @staticmethod
    async def search_logs(
        session: AsyncSession, 
        query: str, 
        source: Optional[str] = None, 
        limit: int = 10
    ) -> List[ConversationLog]:
        """
        Search conversation logs by keyword.
        Supports filtering by source (e.g., 'qq_%' for all qq logs).
        """
        statement = select(ConversationLog).order_by(desc(ConversationLog.timestamp))
        
        if source:
            if "%" in source:
                statement = statement.where(ConversationLog.source.like(source))
            else:
                statement = statement.where(ConversationLog.source == source)
                
        if query:
            statement = statement.where(ConversationLog.content.contains(query))
            
        statement = statement.limit(limit)
        return (await session.exec(statement)).all()

    @staticmethod
    async def get_recent_logs(session: AsyncSession, source: str, session_id: str, limit: int = 20, date_str: str = None, sort: str = "asc") -> List[ConversationLog]:
        """获取指定来源和会话的最近对话记录"""
        from sqlmodel import desc, asc
        from datetime import datetime, time
        
        statement = select(ConversationLog).where(ConversationLog.source == source).where(ConversationLog.session_id == session_id)
        
        if date_str:
            try:
                # 假设 date_str 格式为 YYYY-MM-DD
                target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
                start_dt = datetime.combine(target_date, time.min)
                end_dt = datetime.combine(target_date, time.max)
                statement = statement.where(ConversationLog.timestamp >= start_dt).where(ConversationLog.timestamp <= end_dt)
            except ValueError:
                print(f"[MemoryService] Invalid date format: {date_str}")

        if sort == "desc":
            statement = statement.order_by(desc(ConversationLog.timestamp), desc(ConversationLog.id))
        else:
            statement = statement.order_by(desc(ConversationLog.timestamp), desc(ConversationLog.id))
            
        statement = statement.limit(limit)
        logs = (await session.exec(statement)).all()
        
        # 如果是正序排列，我们需要反转结果，因为 limit 是取最新的
        if sort == "asc":
            return list(reversed(logs))
        return list(logs)

    @staticmethod
    async def delete_log(session: AsyncSession, log_id: int):
        """删除指定的对话记录 (如果属于成对记录，则成对删除)"""
        log = await session.get(ConversationLog, log_id)
        if not log:
            return
            
        if log.pair_id:
            # 如果有 pair_id，删除该组内的所有记录
            statement = delete(ConversationLog).where(ConversationLog.pair_id == log.pair_id)
        else:
            # 否则仅删除单条
            statement = delete(ConversationLog).where(ConversationLog.id == log_id)
            
        await session.exec(statement)
        await session.commit()

    @staticmethod
    async def update_log(session: AsyncSession, log_id: int, content: str) -> Optional[ConversationLog]:
        """更新指定的对话记录内容"""
        log = await session.get(ConversationLog, log_id)
        if log:
            log.content = content
            session.add(log)
            await session.commit()
            await session.refresh(log)
        return log

    @staticmethod
    async def delete_by_msg_timestamp(session: AsyncSession, msg_timestamp: str):
        statement = delete(Memory).where(Memory.msgTimestamp == msg_timestamp)
        await session.exec(statement)
        await session.commit()

    @staticmethod
    async def mark_memories_accessed(session: AsyncSession, memories: List[Memory]):
        """
        [Reinforcement]
        标记记忆被访问，增加 access_count 并小幅提升 base_importance
        """
        from datetime import datetime
        if not memories:
            return

        for m in memories:
            if m.access_count is None:
                m.access_count = 0
            m.access_count += 1
            m.last_accessed = datetime.now()
            # 每次访问提升 0.1，上限 10.0
            if m.base_importance < 10.0:
                m.base_importance = min(10.0, m.base_importance + 0.1)
                m.importance = int(m.base_importance) # 同步整数 importance
            session.add(m)
        
        try:
            await session.commit()
        except Exception as e:
            print(f"[MemoryService] Failed to update access stats: {e}")

    @staticmethod
    async def logical_flashback(session: AsyncSession, text: str, limit: int = 5) -> List[Dict[str, Any]]:
        """
        [Brain-Net Flashback] 
        基于当前对话关键词，在记忆图谱中进行联想闪回，找回关联的碎片信息。
        """
        if not text or len(text.strip()) < 2:
            return []

        from services.embedding_service import embedding_service
        from services.vector_service import vector_service
        import numpy as np

        try:
            # 1. 向量搜索找到初始锚点 (Anchors)
            query_vec = embedding_service.encode_one(text)
            if not query_vec:
                return []
            
            # 召回稍微多一点，作为扩散起点
            vector_results = vector_service.search(query_vec, limit=10)
            if not vector_results:
                return []

            anchor_ids = [res["id"] for res in vector_results]
            sim_map = {res["id"]: res["score"] for res in vector_results}

            # 2. 扩散激活 (Spreading Activation)
            activation_scores = {aid: sim_map.get(aid, 0.5) for aid in anchor_ids}
            
            engine = await get_rust_engine(session)
            if engine:
                # 扩散 2 步，扩大联想范围
                flashback_scores = engine.propagate_activation(
                    activation_scores,
                    steps=2,
                    decay=0.7,
                    min_threshold=0.05
                )
            else:
                flashback_scores = activation_scores

            # 3. 提取 Top 关联记忆并转换为碎片标签
            # 排除掉初始锚点，寻找被“联想”出来的东西
            associated_ids = [mid for mid in flashback_scores.keys() if mid not in anchor_ids]
            if not associated_ids:
                # 如果没有联想出新东西，就用初始锚点中分数最高的
                associated_ids = anchor_ids

            # 按分数排序
            sorted_ids = sorted(associated_ids, key=lambda x: flashback_scores.get(x, 0), reverse=True)[:limit]
            
            if not sorted_ids:
                return []

            # 获取记忆详情
            statement = select(Memory).where(Memory.id.in_(sorted_ids))
            memories = (await session.exec(statement)).all()
            
            # 转换为碎片格式 (主要是标签或短句)
            results = []
            seen_tags = set()
            for m in memories:
                # 优先使用标签
                if m.tags:
                    tags = [t.strip() for t in m.tags.split(",") if t.strip()]
                    for tag in tags:
                        if tag not in seen_tags:
                            results.append({"id": m.id, "name": tag, "type": "tag"})
                            seen_tags.add(tag)
                
                # 如果标签不够，或者为了丰富度，加入内容摘要
                if len(results) < limit:
                    summary = m.content[:20] + "..." if len(m.content) > 20 else m.content
                    results.append({"id": m.id, "name": summary, "type": "memory"})
            
            return results[:limit]

        except Exception as e:
            print(f"[Memory] Logical flashback failed: {e}")
            return []

    @staticmethod
    async def get_relevant_memories(
        session: AsyncSession, 
        text: str, 
        limit: int = 5,
        query_vec: Optional[List[float]] = None,
        exclude_after_time: Optional[datetime] = None,
        update_access_stats: bool = True # New param to control side effects
    ) -> List[Memory]:
        """
        [Chain-Net Retrieval V3] (VectorDB Enabled + Cluster Soft-Weighted)
        1. Embedding Search (VectorDB)
        2. Spreading Activation (Chain)
        3. Reranking with Cluster Soft-Weighted
        """
        from services.embedding_service import embedding_service
        from services.vector_service import vector_service
        import numpy as np
        import math

        # --- 0. 意图识别与簇感知 (Intent Detection) ---
        # 简单规则匹配：根据 Query 关键词预测当前意图簇
        # 在未来可以替换为轻量级分类模型
        target_cluster = None
        cluster_keywords = {
            "逻辑推理簇": ["怎么", "为什么", "如何", "代码", "bug", "逻辑", "分析", "原理", "解释", "define", "function"],
            "情感偏好簇": ["喜欢", "讨厌", "爱", "恨", "感觉", "心情", "开心", "难过", "觉得", "want", "hate", "love"],
            "计划意图簇": ["打算", "计划", "准备", "明天", "下周", "未来", "目标", "todo", "plan", "will"],
            "创造灵感簇": ["想法", "点子", "故事", "如果", "假设", "脑洞", "idea", "imagine", "story"],
            "反思簇": ["错了", "改进", "反省", "不好", "烂", "修正", "sorry", "mistake", "fix"]
        }
        
        if text:
            for cluster, keywords in cluster_keywords.items():
                if any(k in text.lower() for k in keywords):
                    target_cluster = cluster
                    break
        
        if target_cluster:
            # print(f"[Memory] Detected Intent Cluster: {target_cluster}")
            pass

        # 1. 向量化 Query (如果没有传入预计算的向量)
        if query_vec is None:
            if not text:
                return []
            query_vec = embedding_service.encode_one(text)
            
        if not query_vec:
            print("[Memory] Embedding failed, falling back to keyword search.")
            if text:
                return await MemoryService._keyword_search_fallback(session, text, limit, exclude_after_time)
            return []

        # 2. 向量检索 (VectorDB Search)
        try:
            # [Optimization] 扩大召回范围至 60，以便在过滤掉近期记忆（上下文窗口）后仍有足够的候选
            vector_results = vector_service.search(query_vec, limit=60) 
            
            if not vector_results:
                # 尝试从 SQLite 回退 (如果是迁移过渡期)
                print("[Memory] VectorDB returned no results, trying SQLite fallback...")
                fallback_res = await MemoryService._keyword_search_fallback(session, text, limit, exclude_after_time)
                if update_access_stats and fallback_res:
                    await MemoryService.mark_memories_accessed(session, fallback_res)
                return fallback_res

            # 获取 Memory 对象
            # 提取 ID 列表
            memory_ids = [res["id"] for res in vector_results]
            
            if not memory_ids:
                 return []
                 
            statement = select(Memory).where(Memory.id.in_(memory_ids))
            valid_memories = (await session.exec(statement)).all()
            
            # 建立 ID -> Similarity 映射
            sim_map = {res["id"]: res["score"] for res in vector_results}
            
            # [Context Awareness] 过滤掉 exclude_after_time (即上下文窗口内的记忆)
            if exclude_after_time:
                exclude_ts = exclude_after_time.timestamp() * 1000
                original_count = len(valid_memories)
                valid_memories = [m for m in valid_memories if m.timestamp < exclude_ts]
                filtered_count = len(valid_memories)
                if original_count != filtered_count:
                    print(f"[Memory] Context Filter: Excluded {original_count - filtered_count} memories overlapping with context window.")

            # 如果过滤后为空，直接返回空（符合用户期望：若长记忆条目全在上下文窗口内，则跳过检索）
            if not valid_memories:
                return []

        except Exception as e:
            print(f"[Memory] VectorDB search failed: {e}. Falling back.")
            fallback_res = await MemoryService._keyword_search_fallback(session, text, limit, exclude_after_time)
            if update_access_stats and fallback_res:
                await MemoryService.mark_memories_accessed(session, fallback_res)
            return fallback_res
        
        # 3. 扩散激活 (Spreading Activation)
        # 初始激活值 = VectorDB Similarity
        activation_scores = {m.id: sim_map.get(m.id, 0.0) for m in valid_memories}
        
        # 获取所有关联 (一次性拉取，避免 N+1)
        # 简单起见，这里只对 Top N 的 Anchor 进行扩散
        # 选出 Top 20 Anchors (这里 valid_memories 已经是 Top N 了)
        anchors = valid_memories
        anchor_ids = [m.id for m in anchors]
        
        # [Optimized] 批量拉取所有相关关系
        rust_relations = []
        
        if anchor_ids:
            # 查找所有 source 或 target 在 anchor_ids 中的关系
            statement = select(MemoryRelation).where(
                (MemoryRelation.source_id.in_(anchor_ids)) | 
                (MemoryRelation.target_id.in_(anchor_ids))
            )
            all_relations = (await session.exec(statement)).all()
            
            # 构建关系列表 (source, target, weight)
            for rel in all_relations:
                rust_relations.append((rel.source_id, rel.target_id, rel.strength * 0.5))
        
        # 添加 Prev/Next 关系
        for anchor in anchors:
            if anchor.prev_id:
                rust_relations.append((anchor.id, anchor.prev_id, 0.2))
            if anchor.next_id:
                rust_relations.append((anchor.id, anchor.next_id, 0.2))

        # [Rust Integration] Optimized for 1M+ nodes
        try:
            engine = await get_rust_engine(session)
            if engine:
                # 执行扩散：引入动态阈值 min_threshold
                # 如果是重要查询，可以调低阈值以获取更多联想；否则保持 0.01 保证性能
                new_scores = engine.propagate_activation(
                    activation_scores, 
                    steps=1, 
                    decay=1.0, 
                    min_threshold=0.01
                )
                activation_scores = new_scores
            else:
                # Fallback logic if engine is unavailable
                pass
        except Exception as e:
            print(f"[Memory] Rust engine runtime error: {e}. Falling back.")
            # [Fallback to Python]
            # print("[Memory] Rust engine not found. Using Python fallback.")
            relation_map = {}
            for rel in all_relations: # Re-use DB results
                if rel.source_id in activation_scores:
                    relation_map.setdefault(rel.source_id, []).append(rel)
                if rel.target_id in activation_scores:
                    relation_map.setdefault(rel.target_id, []).append(rel)

            for anchor in anchors:
                base_score = activation_scores[anchor.id]
                if base_score < 0.3: continue

                # A. 时间轴扩散 (Prev/Next)
                if anchor.prev_id and anchor.prev_id in activation_scores:
                    activation_scores[anchor.prev_id] += base_score * 0.2
                if anchor.next_id and anchor.next_id in activation_scores:
                    activation_scores[anchor.next_id] += base_score * 0.2

                # B. 关系网扩散
                relations = relation_map.get(anchor.id, [])
                for rel in relations:
                    target_id = rel.target_id if rel.source_id == anchor.id else rel.source_id
                    if target_id in activation_scores:
                        activation_scores[target_id] += base_score * rel.strength * 0.5
        except Exception as e:
            # 极致稳定性：如果 Rust 引擎运行报错（如 OOM），记录日志并继续，不中断对话
            print(f"[Memory] Rust engine runtime error: {e}. Falling back to initial scores.")
            # 此时保持 activation_scores 不变（即仅使用向量搜索结果）

        # 4. 综合排序 (Final Ranking) with Time Decay & Cluster Soft-Weighting
        # Score = (Sim * w1) + (ClusterBonus) + (Importance * w2) * Decay(t) + (Recency * w3)
        final_candidates = []
        current_time = datetime.now().timestamp() * 1000
        
        for m in valid_memories:
            # 基础相关度分数 (Sim)
            act_score = activation_scores.get(m.id, 0.0)
            
            # [Feature] Cluster Soft-Weighting (簇感知软加权)
            # 如果记忆的簇与当前意图簇匹配，给予额外加分
            cluster_bonus = 0.0
            if target_cluster and m.clusters and target_cluster in m.clusters:
                cluster_bonus = 0.15 # +15% bonus for cluster match
                # print(f"[Memory] Cluster Bonus Applied: +0.15 for {m.id} (Match: {target_cluster})")
            
            # 归一化重要性 (Importance)
            imp_score = min(m.base_importance, 10.0) / 10.0
            
            # Ebbinghaus Decay: exp(-lambda * delta_t)
            time_diff_ms = max(0, current_time - m.timestamp)
            time_diff_days = time_diff_ms / (1000 * 3600 * 24)
            decay_factor = math.exp(-0.023 * time_diff_days) # 30天约衰减至 0.5
            
            # Recency Bonus (近期性奖励): 越新的记忆奖励越高
            # 设定 1 小时内的记忆奖励 0.2，随时间线性衰减至 0
            recency_bonus = max(0, 0.2 * (1 - time_diff_days / 1.0)) if time_diff_days < 1.0 else 0
            
            # 严格遵循设计公式:
            # Score = (相关度 * 0.7) + ClusterBonus + (重要性 * 0.3 * 衰减) + 近期奖励
            final_score = (act_score * 0.7) + cluster_bonus + (imp_score * 0.3 * decay_factor) + recency_bonus
            
            if final_score > 0.1: # 略微降低阈值，允许更多候选进入 Rerank
                final_candidates.append((m, final_score))

        # 5. Rerank
        # 按综合得分初步筛选
        final_candidates.sort(key=lambda x: x[1], reverse=True)
        top_candidates = [item[0] for item in final_candidates[:limit*2]]
        
        result_memories = []
        if top_candidates:
            docs = [m.content for m in top_candidates]
            rerank_results = embedding_service.rerank(text, docs, top_k=limit)
            
            # 根据 Rerank 结果重新组装
            for res in rerank_results:
                original_idx = res["index"]
                result_memories.append(top_candidates[original_idx])
        else:
            result_memories = top_candidates[:limit]

        # [Fix] Update Access Stats (Reinforcement)
        # 只要被检索到并最终返回，就视为被"激活"了一次
        if update_access_stats and result_memories:
            # 同步等待更新完成，防止 session 提前关闭
            await MemoryService.mark_memories_accessed(session, result_memories)

        return result_memories

    @staticmethod
    async def get_memories_by_filter(
        session: AsyncSession, 
        limit: int = 10, 
        filter_criteria: Dict = None
    ) -> List[Dict]:
        """
        基于 Metadata 过滤记忆 (用于周报生成等)
        替代 vector_service.query_memories
        """
        statement = select(Memory)
        
        if filter_criteria:
            # Simple implementation for timestamp range
            # {"timestamp": {"$lt": ...}}
            ts_filter = filter_criteria.get("timestamp")
            if ts_filter and isinstance(ts_filter, dict):
                lt_val = ts_filter.get("$lt")
                gt_val = ts_filter.get("$gt")
                if lt_val:
                    statement = statement.where(Memory.timestamp < lt_val)
                if gt_val:
                    statement = statement.where(Memory.timestamp > gt_val)
                    
            # TODO: Handle other filters like tags/clusters if needed
        
        statement = statement.order_by(desc(Memory.timestamp)).limit(limit)
        results = await session.exec(statement)
        memories = results.all()
        
        # Convert to dict format expected by ChainService
        output = []
        for m in memories:
            output.append({
                "id": m.id,
                "document": m.content,
                "metadata": {
                    "timestamp": m.timestamp,
                    "importance": m.importance,
                    "tags": m.tags,
                    "type": m.type
                }
            })
        return output

    @staticmethod
    async def search_memories_simple(
        session: AsyncSession,
        query_vec: List[float],
        limit: int = 5,
        filter_criteria: Dict = None
    ) -> List[Dict]:
        """
        简单的向量搜索 + Metadata 过滤 (用于 ChainService 查找历史)
        """
        from services.vector_service import vector_service
        
        # 1. Search VectorDB (Get more candidates to allow filtering)
        # HACK: Rust index doesn't support pre-filter, so we fetch more and post-filter.
        candidates = vector_service.search(query_vec, limit=limit * 5)
        if not candidates: return []
        
        ids = [c["id"] for c in candidates]
        score_map = {c["id"]: c["score"] for c in candidates}
        
        # 2. Fetch from DB with Filter
        statement = select(Memory).where(Memory.id.in_(ids))
        
        if filter_criteria:
            ts_filter = filter_criteria.get("timestamp")
            if ts_filter and isinstance(ts_filter, dict):
                lt_val = ts_filter.get("$lt")
                if lt_val:
                    statement = statement.where(Memory.timestamp < lt_val)
        
        results = await session.exec(statement)
        memories = results.all()
        
        # 3. Format
        output = []
        for m in memories:
            output.append({
                "id": m.id,
                "score": score_map.get(m.id, 0),
                "document": m.content,
                "metadata": {
                    "timestamp": m.timestamp,
                    "importance": m.importance
                }
            })
            
        # Sort by score
        output.sort(key=lambda x: x["score"], reverse=True)
        return output[:limit]

            
        return top_candidates[:limit]

    @staticmethod
    async def _keyword_search_fallback(session: AsyncSession, text: str, limit: int = 10, exclude_after_time=None) -> List[Memory]:
        """原有的关键词搜索逻辑，作为兜底"""
        # ... (保留原有逻辑)
        # 提取关键词 (简单正则分词)
        keywords = [k.lower() for k in re.split(r'[\s,，.。!！?？;；:：、]+', text) if len(k) >= 2]
        
        if not keywords:
            statement = select(Memory).order_by(Memory.importance.desc()).limit(limit)
            memories = (await session.exec(statement)).all()
        else:
            statement = select(Memory)
            all_memories = (await session.exec(statement)).all()

            scored_memories = []
            for m in all_memories:
                score = 0
                m_tags = [t.lower() for t in (m.tags.split(',') if m.tags else [])]
                
                for kw in keywords:
                    if any(kw in t or t in kw for t in m_tags):
                        score += 10
                    if kw in m.content.lower():
                        score += 5
                
                score += m.importance
                if score > 0:
                    scored_memories.append((m, score))

            scored_memories.sort(key=lambda x: x[1], reverse=True)
            memories = [m for m, s in scored_memories[:limit]]

        if exclude_after_time and memories:
            exclude_timestamp_ms = exclude_after_time.timestamp() * 1000
            memories = [m for m in memories if m.timestamp < exclude_timestamp_ms]

        return memories

    @staticmethod
    async def get_all_memories(
        session: AsyncSession, 
        limit: int = 50, 
        offset: int = 0, 
        date_start: str = None, 
        date_end: str = None, 
        tags: str = None
    ) -> List[Memory]:
        from datetime import datetime
        import time
        
        statement = select(Memory)
        
        # Date Filter (using timestamp ms)
        if date_start:
            try:
                start_dt = datetime.strptime(date_start, "%Y-%m-%d")
                start_ms = start_dt.timestamp() * 1000
                statement = statement.where(Memory.timestamp >= start_ms)
            except Exception as e:
                print(f"[MemoryService] Invalid start date: {e}")
                
        if date_end:
            try:
                end_dt = datetime.strptime(date_end, "%Y-%m-%d")
                # Add one day to include the end date fully
                end_ms = (end_dt.timestamp() + 86400) * 1000
                statement = statement.where(Memory.timestamp < end_ms)
            except Exception as e:
                print(f"[MemoryService] Invalid end date: {e}")
        
        # Tags Filter (simple string containment)
        if tags:
            tag_list = [t.strip() for t in tags.split(',') if t.strip()]
            for tag in tag_list:
                statement = statement.where(Memory.tags.contains(tag))

        statement = statement.order_by(desc(Memory.timestamp)).offset(offset).limit(limit)
        return (await session.exec(statement)).all()

    @staticmethod
    async def get_tag_cloud(session: AsyncSession) -> Dict[str, int]:
        """Fetch high frequency tags"""
        # Optimized: Fetch only tags column
        statement = select(Memory.tags)
        results = (await session.exec(statement)).all()
        
        tag_counts = {}
        for tags_str in results:
            if not tags_str: continue
            # Handle both English and Chinese commas
            normalized_tags = tags_str.replace('，', ',')
            for tag in normalized_tags.split(','):
                t = tag.strip()
                if t:
                    tag_counts[t] = tag_counts.get(t, 0) + 1
        
        # Sort by frequency desc
        return dict(sorted(tag_counts.items(), key=lambda item: item[1], reverse=True))

    @staticmethod
    async def get_memory_graph(session: AsyncSession, limit: int = 200) -> Dict[str, Any]:
        """Return nodes and edges for graph visualization (Enhanced for Cool UI)"""
        # Fetch recent N memories
        memories = (await session.exec(select(Memory).order_by(desc(Memory.timestamp)).limit(limit))).all()
        if not memories:
            return {"nodes": [], "edges": []}
            
        memory_ids = [m.id for m in memories]
        
        # Fetch relations connecting these memories
        relations = (await session.exec(select(MemoryRelation).where(
            (MemoryRelation.source_id.in_(memory_ids)) | (MemoryRelation.target_id.in_(memory_ids))
        ))).all()
        
        # Format for frontend (ECharts Force Graph)
        nodes = []
        for m in memories:
            # Calculate symbol size based on importance and access_count
            # Base size 10, max importance 10 -> +20, max access log scale -> +10
            import math
            size = 10 + (m.importance * 2) + (math.log(m.access_count + 1) * 5)
            size = min(size, 60) # Cap size

            nodes.append({
                "id": m.id,
                "name": str(m.id), # Unique name for ECharts
                "label": {
                    "show": size > 15, # Only show label for important nodes
                    "formatter": m.content[:10] + "..." if len(m.content) > 10 else m.content
                },
                "full_content": m.content,
                "category": m.type, # event, fact, etc.
                "value": m.importance,
                "symbolSize": size,
                "sentiment": m.sentiment,
                "tags": m.tags,
                "realTime": m.realTime,
                "access_count": m.access_count,
                # ECharts specific styles per node can be added here if needed, 
                # but better handled in frontend with categories/visualMap
            })
            
        edges = []
        added_edges = set()

        for r in relations:
            if r.source_id in memory_ids and r.target_id in memory_ids:
                edge_key = f"{r.source_id}-{r.target_id}"
                if edge_key not in added_edges:
                    edges.append({
                        "source": str(r.source_id),
                        "target": str(r.target_id),
                        "value": r.strength,
                        "relation_type": r.relation_type,
                        "lineStyle": {
                            "width": 1 + (r.strength * 4), # 1px to 5px
                            "curveness": 0.2
                        },
                        "tooltip": {
                            "formatter": f"{r.relation_type}: {r.description or 'No desc'}"
                        }
                    })
                    added_edges.add(edge_key)
                
        # Chronological edges (Next/Prev) - Make them subtle
        for m in memories:
            if m.prev_id and m.prev_id in memory_ids:
                 edge_key = f"{m.prev_id}-{m.id}"
                 if edge_key not in added_edges:
                    edges.append({
                        "source": str(m.prev_id),
                        "target": str(m.id),
                        "value": 1,
                        "relation_type": "temporal",
                        "lineStyle": {
                            "width": 1,
                            "color": "#cccccc",
                            "opacity": 0.3,
                            "type": "dashed",
                            "curveness": 0.1
                        }
                    })
                    added_edges.add(edge_key)
        
        return {"nodes": nodes, "edges": edges}

