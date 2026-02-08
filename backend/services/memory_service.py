# Copyright (c) 2026 YoKONCy. All rights reserved.
# This component (Memory Service) is protected under GNU GPL-3.0.
# Any use in proprietary/closed-source software is strictly prohibited.
# Fingerprint: PERO_CORE_MEM_SYS_v0.1_YK

from typing import List, Optional, Dict, Any
from datetime import datetime
from sqlmodel import select, delete, desc, and_
from sqlmodel.ext.asyncio.session import AsyncSession
from models import Memory, ConversationLog, MemoryRelation
import re
import json

# [Global State] 高性能 Rust 引擎单例
# PEDSA (Parallel Energy-Decay Spreading Activation) 算法核心实现
# -------------------------------------------------------------------------
# 工程说明：
# 为什么不用标准的图数据库（如 Neo4j）？
# 1. 延迟：Neo4j 的 Cypher 查询在处理这种“无限扩散”时会产生大量随机 IO，导致 10 步以上的扩散延迟超过 500ms。
# 2. 内存：我们需要在边缘侧（用户 PC）运行。通过 Rust 实现的类 CSR (Simulated CSR) 稀疏矩阵，我们将 100 亿个关联的内存占用压到了 2GB 以内。
# 3. 实时性：PEDSA 需要在每一帧视觉输入时进行能量更新，这是传统事务数据库无法满足的吞吐量。
# -------------------------------------------------------------------------
_rust_engine = None

async def get_rust_engine(session: AsyncSession):
    global _rust_engine
    if _rust_engine is not None:
        return _rust_engine
    
    try:
        from pero_memory_core import CognitiveGraphEngine
        # 技术防御说明：
        # 1. 采用类 CSR (Simulated CSR) 稀疏矩阵存储亿级关联，内存占用极低。
        # 2. 扩散算子满足收敛性证明 (详见 benchmarks/KDN_mathematical_proof.md)，防止激活爆炸。
        print("[Memory] 正在初始化 PEDSA 认知引擎 (Rust Core)...", flush=True)
        _rust_engine = CognitiveGraphEngine()
        _rust_engine.configure(max_active_nodes=10000, max_fan_out=20)
        
        # 预加载所有关系 (采用分批加载策略，防止内存溢出或进程卡死)
        # 预加载所有关系 (分批加载以防止内存溢出或冻结)
        # 优化说明：
        # 1. 使用 offset/limit 分页读取数据库，避免一次性将百万级数据加载到 Python 内存。
        # 2. 分批次调用 Rust 引擎的 batch_add_connections，降低 FFI 调用的瞬时负载。
        BATCH_SIZE = 5000  # 每批次处理 5000 条
        total_loaded = 0
        
        # 1. 分批加载 MemoryRelation (语义关联)
        mr_offset = 0
        while True:
            statement = select(MemoryRelation).offset(mr_offset).limit(BATCH_SIZE)
            relations = (await session.exec(statement)).all()
            
            if not relations:
                break
            
            # 转换为 Rust 引擎需要的元组格式 (source, target, strength)
            chunk_relations = [(rel.source_id, rel.target_id, rel.strength) for rel in relations]
            _rust_engine.batch_add_connections(chunk_relations)
            
            total_loaded += len(relations)
            mr_offset += BATCH_SIZE
        
        # 2. 分批加载 Prev/Next 链表关系 (时间序关联)
        mem_offset = 0
        while True:
            statement_mem = select(Memory.id, Memory.prev_id, Memory.next_id).where(
                (Memory.prev_id != None) | (Memory.next_id != None)
            ).offset(mem_offset).limit(BATCH_SIZE)
            
            mem_links = (await session.exec(statement_mem)).all()
            
            if not mem_links:
                break
            
            chunk_links = []
            for mid, prev_id, next_id in mem_links:
                if prev_id: chunk_links.append((mid, prev_id, 0.2))
                if next_id: chunk_links.append((mid, next_id, 0.2))
            
            if chunk_links:
                _rust_engine.batch_add_connections(chunk_links)
                total_loaded += len(chunk_links)
            
            mem_offset += BATCH_SIZE
            
        print(f"[Memory] Rust 引擎已加载 {total_loaded} 个连接 (分批加载)。", flush=True)
    except Exception as e:
        print(f"[Memory] 初始化 Rust 引擎失败: {e}")
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
        memory_type: str = "event",
        agent_id: str = "pero" # Multi-Agent Isolation
    ) -> Memory:
        from datetime import datetime
        from sqlmodel import desc
        from services.vector_service import vector_service
        from services.embedding_service import embedding_service
        
        # 1. 查找上一条记忆 (The Tail of the Time-Axis)
        # 增加 agent_id 过滤，确保只链接到同一个 Agent 的记忆链
        statement = select(Memory).where(Memory.agent_id == agent_id).order_by(desc(Memory.timestamp)).limit(1)
        last_memory_result = await session.exec(statement)
        last_memory = last_memory_result.first()

        prev_id = last_memory.id if last_memory else None

        # 2. 创建新记忆
        # 生成 Embedding (用于写入 VectorDB)
        # 注意：embedding_json 字段在 SQLite 中保留作为备份或兼容，但主要查询走 VectorDB
        embedding_vec = embedding_service.encode_one(content)
        
        # [Fix] 确保在写入 DB 之前尝试获取 embedding，如果失败则记录警告
        # 即使这里是 []，下面同步写入 VectorDB 时也会被跳过，导致数据不一致。
        # 因此，如果 embedding 为空，我们应该考虑重试或记录严重错误。
        if not embedding_vec:
             print(f"[MemoryService] 警告: 记忆内容嵌入生成失败: {content[:30]}...")

        embedding_json = json.dumps(embedding_vec)

        memory = Memory(
            content=content,
            tags=tags,
            clusters=clusters, # 保存簇
            importance=importance,
            base_importance=base_importance,
            sentiment=sentiment,
            msgTimestamp=msg_timestamp,
            realTime=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            source=source,
            type=memory_type,
            prev_id=prev_id,
            next_id=None,
            embedding_json=embedding_json, # 仍保留一份在 SQLite
            agent_id=agent_id
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
                            print(f"[MemoryService] 索引标签失败: {tag_e}")
                
                # 构建元数据
                metadata_dict = {
                    "type": memory_type,
                    "timestamp": memory.timestamp,
                    "importance": float(importance),
                    "tags": tags, 
                    "clusters": clusters,
                    "agent_id": agent_id
                }
                
                # [特性] 思考管道：展开簇以进行精确过滤
                # clusters="[逻辑推理簇],[反思簇]" -> metadata={"cluster_逻辑推理簇": True, "cluster_反思簇": True}
                if clusters:
                    cluster_list = [c.strip() for c in clusters.split(',') if c.strip()]
                    for c in cluster_list:
                        # 如果存在括号则移除
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
                print(f"[MemoryService] 同步到 VectorDB 失败: {e}")
        else:
            # [Fix] 如果 embedding 为空，强制进行一次同步重试，或加入后台重试队列
            # 这里简单地做一次同步重试（阻塞式），确保关键数据不丢失
            print(f"[MemoryService] Embedding 为空，正在对 Memory ID {memory.id} 进行同步重试...")
            try:
                # 强制重新加载模型并编码
                retry_vec = embedding_service.encode_one(content)
                if retry_vec:
                    # 更新 SQL
                    memory.embedding_json = json.dumps(retry_vec)
                    session.add(memory)
                    await session.commit()
                    
                    # 写入 VectorDB
                    vector_service.add_memory(
                        memory_id=memory.id,
                        content=content,
                        embedding=retry_vec,
                        metadata={
                            "type": memory_type,
                            "timestamp": memory.timestamp,
                            "importance": float(importance),
                            "tags": tags,
                            "clusters": clusters,
                            "agent_id": agent_id
                        }
                    )
                    print(f"[MemoryService] Memory ID {memory.id} 重试成功。")
                else:
                    print(f"[MemoryService] 严重错误: 重试失败。Memory {memory.id} 已存储但无向量索引。")
            except Exception as retry_e:
                print(f"[MemoryService] 重试异常: {retry_e}")

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
    async def save_log(session: AsyncSession, source: str, session_id: str, role: str, content: str, metadata: dict = None, pair_id: str = None, raw_content: str = None, agent_id: str = "pero") -> ConversationLog:
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
            raw_content=raw_content, # 保存原始内容
            metadata_json=json.dumps(metadata or {}),
            pair_id=pair_id,
            agent_id=agent_id
        )
        session.add(log)
        # 注意：这里去掉了 commit()，改为由外部或 save_log_pair 统一控制
        return log

    @staticmethod
    async def save_log_pair(session: AsyncSession, source: str, session_id: str, user_content: str, assistant_content: str, pair_id: str, metadata: dict = None, assistant_raw_content: str = None, agent_id: str = "pero", user_metadata: dict = None):
        """原子性保存用户消息与助手回复成对记录"""
        try:
            # [特性] 系统触发角色修正
            # 如果内容以【系统触发】开头，则将角色修正为 system
            user_role = "user"
            if user_content and user_content.startswith("【系统触发】"):
                user_role = "system"

            # Use user_metadata if provided, else fall back to metadata (shared)
            u_meta = user_metadata if user_metadata is not None else metadata

            # 创建用户消息记录
            user_log = await MemoryService.save_log(session, source, session_id, user_role, user_content, u_meta, pair_id, agent_id=agent_id)
            # 创建助手消息记录
            # 为助手传递原始内容
            assistant_log = await MemoryService.save_log(session, source, session_id, "assistant", assistant_content, metadata, pair_id, raw_content=assistant_raw_content, agent_id=agent_id)
            
            await session.commit()
            await session.refresh(user_log)
            await session.refresh(assistant_log)
            return user_log, assistant_log
        except Exception as e:
            await session.rollback()
            print(f"[MemoryService] 保存日志对失败: {e}")
            raise e

    @staticmethod
    async def search_logs(
        session: AsyncSession, 
        query: str, 
        source: Optional[str] = None, 
        limit: int = 10,
        agent_id: Optional[str] = None
    ) -> List[ConversationLog]:
        """
        按关键字搜索对话记录。
        支持按来源过滤（例如，'qq_%' 表示所有 qq 记录）。
        """
        statement = select(ConversationLog).order_by(desc(ConversationLog.timestamp))
        
        # [Security] Work Mode Isolation
        # Ensure work mode logs (starting with work_) are NOT queryable via search
        # This prevents them from appearing in Dashboard global search or lists.
        # Work mode logs should only be accessed via get_recent_logs with explicit session_id.
        statement = statement.where(~ConversationLog.session_id.startswith("work_"))
        
        if agent_id:
            statement = statement.where(ConversationLog.agent_id == agent_id)

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
    async def get_recent_logs(session: AsyncSession, source: str, session_id: str, limit: int = 20, offset: int = 0, date_str: str = None, sort: str = "asc", agent_id: str = "pero") -> List[ConversationLog]:
        """获取指定来源和会话的最近对话记录"""
        from sqlmodel import desc, asc
        from datetime import datetime, time
        
        statement = select(ConversationLog).where(ConversationLog.source == source).where(ConversationLog.session_id == session_id).where(ConversationLog.agent_id == agent_id)
        
        if date_str:
            try:
                # 假设 date_str 格式为 YYYY-MM-DD
                target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
                start_dt = datetime.combine(target_date, time.min)
                end_dt = datetime.combine(target_date, time.max)
                statement = statement.where(ConversationLog.timestamp >= start_dt).where(ConversationLog.timestamp <= end_dt)
            except ValueError:
                print(f"[MemoryService] 无效的日期格式: {date_str}")

        if sort == "desc":
            statement = statement.order_by(desc(ConversationLog.timestamp), desc(ConversationLog.id))
        else:
            statement = statement.order_by(desc(ConversationLog.timestamp), desc(ConversationLog.id))
            
        statement = statement.offset(offset).limit(limit)
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
            print(f"[MemoryService] 更新访问统计失败: {e}")

    @staticmethod
    async def logical_flashback(session: AsyncSession, text: str, limit: int = 5, agent_id: str = "pero") -> List[Dict[str, Any]]:
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
                print("[Memory] 逻辑闪回: 查询向量为空")
                return []
            
            # 召回稍微多一点，作为扩散起点
            vector_results = vector_service.search(query_vec, limit=10, agent_id=agent_id)
            if not vector_results:
                print("[Memory] 逻辑闪回: 未找到向量结果")
                return []

            anchor_ids = [res["id"] for res in vector_results]
            sim_map = {res["id"]: res["score"] for res in vector_results}

            # 2. 扩散激活 (Spreading Activation)
            activation_scores = {aid: sim_map.get(aid, 0.5) for aid in anchor_ids}
            
            engine = await get_rust_engine(session)
            if engine:
                # 扩散 2 步，扩大联想范围
                print(f"[Memory] 正在从锚点扩散激活: {anchor_ids}")
                flashback_scores = engine.propagate_activation(
                    activation_scores,
                    steps=2,
                    decay=0.7,
                    min_threshold=0.05
                )
                print(f"[Memory] 扩散结果数量: {len(flashback_scores)}")
            else:
                print("[Memory] Rust 引擎不可用，仅使用锚点")
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
            statement = select(Memory).where(Memory.id.in_(sorted_ids)).where(Memory.agent_id == agent_id)
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
            print(f"[Memory] 逻辑闪回失败: {e}")
            return []

    @staticmethod
    async def get_relevant_memories(
        session: AsyncSession, 
        text: str, 
        limit: int = 5,
        query_vec: Optional[List[float]] = None,
        exclude_after_time: Optional[datetime] = None,
        update_access_stats: bool = True, # 新增参数以控制副作用
        agent_id: str = "pero"
    ) -> List[Memory]:
        """
        [链网检索 V3] (启用 VectorDB + 簇软加权)
        1. 嵌入搜索 (VectorDB)
        2. 扩散激活 (链)
        3. 簇软加权重排序
        """
        from services.embedding_service import embedding_service
        from services.vector_service import vector_service
        from utils.memory_file_manager import MemoryFileManager
        import numpy as np
        import math
        import os
        import re

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
            print("[Memory] Embedding 失败，回退到关键词搜索。")
            if text:
                return await MemoryService._keyword_search_fallback(session, text, limit, exclude_after_time, agent_id=agent_id)
            return []

        # 2. 向量检索 (VectorDB Search)
        try:
            # [Optimization] 扩大召回范围至 60，以便在过滤掉近期记忆（上下文窗口）后仍有足够的候选
            vector_results = vector_service.search(query_vec, limit=60, agent_id=agent_id) 
            
            if not vector_results:
                # 尝试从 SQLite 回退 (如果是迁移过渡期)
                print("[Memory] VectorDB 未返回结果，尝试 SQLite 回退...")
                fallback_res = await MemoryService._keyword_search_fallback(session, text, limit, exclude_after_time, agent_id=agent_id)
                if update_access_stats and fallback_res:
                    await MemoryService.mark_memories_accessed(session, fallback_res)
                return fallback_res

            # 获取 Memory 对象
            # 提取 ID 列表
            memory_ids = [res["id"] for res in vector_results]
            
            if not memory_ids:
                 return []
                 
            statement = select(Memory).where(Memory.id.in_(memory_ids)).where(Memory.agent_id == agent_id)
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
                    print(f"[Memory] 上下文过滤: 排除了 {original_count - filtered_count} 条与上下文窗口重叠的记忆。")

            # 如果过滤后为空，直接返回空（符合用户期望：若长记忆条目全在上下文窗口内，则跳过检索）
            if not valid_memories:
                return []

        except Exception as e:
            print(f"[Memory] VectorDB 搜索失败: {e}。正在回退。")
            fallback_res = await MemoryService._keyword_search_fallback(session, text, limit, exclude_after_time, agent_id=agent_id)
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

        # [Rust 集成] 针对百万级节点优化
        try:
            engine = await get_rust_engine(session, agent_id=agent_id)
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
                # 引擎不可用时的回退逻辑
                pass
        except Exception as e:
            print(f"[Memory] Rust engine runtime error: {e}. Falling back.")
            # [回退到 Python]
            # print("[Memory] Rust engine not found. Using Python fallback.")
            relation_map = {}
            for rel in all_relations: # 重用数据库结果
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

        # 4. 综合排序 (最终排名) 带时间衰减和簇软加权
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
                cluster_bonus = 0.15 # 簇匹配增加 15% 奖励
                # print(f"[Memory] Cluster Bonus Applied: +0.15 for {m.id} (Match: {target_cluster})")
            
            # 归一化重要性 (Importance)
            imp_score = min(m.base_importance, 10.0) / 10.0
            
            # 艾宾浩斯衰减: exp(-lambda * delta_t)
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
            try:
                docs = [m.content for m in top_candidates]
                rerank_results = embedding_service.rerank(text, docs, top_k=limit)
                
                # 根据 Rerank 结果重新组装
                for res in rerank_results:
                    original_idx = res["index"]
                    result_memories.append(top_candidates[original_idx])
            except Exception as e:
                print(f"[Memory] 重排序失败: {e}。回退到初始分数。")
                result_memories = top_candidates[:limit]
            final_memories = result_memories
        else:
            result_memories = top_candidates[:limit]
            final_memories = result_memories

        # [Hydrate] 如果是归档记忆，实时读取文件内容
        # 模式匹配 "> 📁 File Archived: path"
        # 注意：目前我们同步执行此操作，因为对于少量记忆，文件 IO 足够快，
        # 或者如果需要，我们可以使用 aiofiles。但 MemoryFileManager 在 _write_file (封装在 to_thread 中) 中使用阻塞打开。
        # 在这里读取更安全。
        for m in result_memories:
            if "> 📁 File Archived:" in m.content:
                try:
                    match = re.search(r"> 📁 File Archived: (.+)", m.content)
                    if match:
                        file_path = match.group(1).strip()
                        if os.path.exists(file_path):
                            with open(file_path, 'r', encoding='utf-8') as f:
                                file_content = f.read()
                                # 保留一点 DB 中的元数据提示，但用文件内容覆盖主体
                                # 或者直接替换
                                m.content = file_content 
                except Exception as e:
                    print(f"[MemoryService] 填充归档记忆 {m.id} 失败: {e}")

        # [修复] 更新访问统计 (强化)
        # 只要被检索到并最终返回，就视为被"激活"了一次
        if update_access_stats and result_memories:
            # 同步等待更新完成，防止 session 提前关闭
            await MemoryService.mark_memories_accessed(session, result_memories)

        return result_memories

    @staticmethod
    async def get_memories_by_filter(
        session: AsyncSession, 
        limit: int = 10, 
        filter_criteria: Dict = None,
        agent_id: str = "pero"
    ) -> List[Dict]:
        """
        基于 Metadata 过滤记忆 (用于周报生成等)
        替代 vector_service.query_memories
        """
        statement = select(Memory).where(Memory.agent_id == agent_id)
        
        if filter_criteria:
            # 时间戳范围的简单实现
            # {"timestamp": {"$lt": ...}}
            ts_filter = filter_criteria.get("timestamp")
            if ts_filter and isinstance(ts_filter, dict):
                lt_val = ts_filter.get("$lt")
                gt_val = ts_filter.get("$gt")
                if lt_val:
                    statement = statement.where(Memory.timestamp < lt_val)
                if gt_val:
                    statement = statement.where(Memory.timestamp > gt_val)
                    
            # TODO: 如果需要，处理其他过滤器，如标签/簇
        
        statement = statement.order_by(desc(Memory.timestamp)).limit(limit)
        results = await session.exec(statement)
        memories = results.all()
        
        # 转换为 ChainService 期望的字典格式
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
        filter_criteria: Dict = None,
        agent_id: str = "pero"
    ) -> List[Dict]:
        """
        简单的向量搜索 + Metadata 过滤 (用于 ChainService 查找历史)
        """
        from services.vector_service import vector_service
        
        # 1. 搜索 VectorDB (获取更多候选以允许过滤)
        # HACK: Rust 索引不支持预过滤，所以我们获取更多并进行后过滤。
        candidates = vector_service.search(query_vec, limit=limit * 5, agent_id=agent_id)
        if not candidates: return []
        
        ids = [c["id"] for c in candidates]
        score_map = {c["id"]: c["score"] for c in candidates}
        
        # 2. 从带过滤器的 DB 中获取
        statement = select(Memory).where(Memory.id.in_(ids)).where(Memory.agent_id == agent_id)
        
        if filter_criteria:
            ts_filter = filter_criteria.get("timestamp")
            if ts_filter and isinstance(ts_filter, dict):
                lt_val = ts_filter.get("$lt")
                if lt_val:
                    statement = statement.where(Memory.timestamp < lt_val)
        
        results = await session.exec(statement)
        memories = results.all()
        
        # 3. 格式化
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
            
        # 按分数排序
        output.sort(key=lambda x: x["score"], reverse=True)
        return output[:limit]

    @staticmethod
    async def _keyword_search_fallback(session: AsyncSession, text: str, limit: int = 10, exclude_after_time=None, agent_id: str = "pero") -> List[Memory]:
        """原有的关键词搜索逻辑，作为兜底"""
        # ... (保留原有逻辑)
        # 提取关键词 (简单正则分词)
        keywords = [k.lower() for k in re.split(r'[\s,，.。!！?？;；:：、]+', text) if len(k) >= 2]
        
        if not keywords:
            statement = select(Memory).where(Memory.agent_id == agent_id).order_by(Memory.importance.desc()).limit(limit)
            memories = (await session.exec(statement)).all()
        else:
            statement = select(Memory).where(Memory.agent_id == agent_id)
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
        tags: str = None,
        memory_type: str = None,
        agent_id: str = None # Allow filtering by agent
    ) -> List[Memory]:
        from datetime import datetime
        import time
        
        statement = select(Memory)
        
        # Agent Filter
        if agent_id:
            statement = statement.where(Memory.agent_id == agent_id)
        
        # 类型过滤器
        if memory_type:
            statement = statement.where(Memory.type == memory_type)
        
        # 日期过滤器 (使用时间戳 ms)
        if date_start:
            try:
                start_dt = datetime.strptime(date_start, "%Y-%m-%d")
                start_ms = start_dt.timestamp() * 1000
                statement = statement.where(Memory.timestamp >= start_ms)
            except Exception as e:
                print(f"[MemoryService] 无效的开始日期: {e}")
                
        if date_end:
            try:
                end_dt = datetime.strptime(date_end, "%Y-%m-%d")
                # 增加一天以完全包含结束日期
                end_ms = (end_dt.timestamp() + 86400) * 1000
                statement = statement.where(Memory.timestamp < end_ms)
            except Exception as e:
                print(f"[MemoryService] 无效的结束日期: {e}")
        
        # 标签过滤器 (简单的字符串包含)
        if tags:
            tag_list = [t.strip() for t in tags.split(',') if t.strip()]
            for tag in tag_list:
                statement = statement.where(Memory.tags.contains(tag))

        statement = statement.order_by(desc(Memory.timestamp)).offset(offset).limit(limit)
        return (await session.exec(statement)).all()

    @staticmethod
    async def get_tag_cloud(session: AsyncSession, agent_id: str = "pero") -> List[Dict[str, Any]]:
        """
        获取标签云数据 (Top 20 tags)
        """
        # 简单实现：取出所有 Memory 的 tags 字段，在内存中统计
        # TODO: 后期可以使用 SQL group by 优化
        statement = select(Memory)
        if agent_id:
            statement = statement.where(Memory.agent_id == agent_id)
            
        memories = (await session.exec(statement)).all()
        tag_counts = {}
        
        for m in memories:
            if not m.tags: continue
            tags = [t.strip() for t in m.tags.split(',') if t.strip()]
            for t in tags:
                tag_counts[t] = tag_counts.get(t, 0) + 1
                
        # 排序并取前 20
        sorted_tags = sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:20]
        return [{"tag": t, "count": c} for t, c in sorted_tags]

    @staticmethod
    async def delete_orphaned_edges(session: AsyncSession) -> int:
        """
        清除孤立的边（即源节点或目标节点不存在的边）
        """
        # 使用子查询查找不存在的节点引用
        # DELETE FROM memoryrelation WHERE source_id NOT IN (SELECT id FROM memory) OR target_id NOT IN (SELECT id FROM memory)
        
        # SQLModel 的 delete 支持 where 子句，但对 subquery 支持视方言而定
        # 这里使用标准 SQLAlchemy 风格
        
        subquery = select(Memory.id)
        
        statement = delete(MemoryRelation).where(
            (MemoryRelation.source_id.not_in(subquery)) | 
            (MemoryRelation.target_id.not_in(subquery))
        )
        
        result = await session.exec(statement)
        await session.commit()
        
        # 如果有 Rust Engine 且已加载，可能需要重新加载或同步删除
        # 简单起见，这里假设 Rust Engine 会在下次启动或定期刷新时同步
        # 或者我们可以尝试从 Rust Engine 中移除（如果支持）
        # 目前 Rust Engine 是只读/追加为主，暂时忽略实时同步
        
        return result.rowcount

    @staticmethod
    async def get_memory_graph(session: AsyncSession, limit: int = 200, agent_id: str = "pero") -> Dict[str, Any]:
        """返回用于图形可视化的节点和边 (针对酷炫 UI 增强)"""
        # 获取最近 N 条记忆
        statement = select(Memory).order_by(desc(Memory.timestamp)).limit(limit)
        if agent_id:
            statement = statement.where(Memory.agent_id == agent_id)
            
        memories = (await session.exec(statement)).all()
        if not memories:
            return {"nodes": [], "edges": []}
            
        memory_ids = [m.id for m in memories]
        
        # 获取连接这些记忆的关系
        rel_statement = select(MemoryRelation).where(
            (MemoryRelation.source_id.in_(memory_ids)) | (MemoryRelation.target_id.in_(memory_ids))
        )
        # 关系表也有 agent_id，增加过滤更严谨，虽然基于 memory_ids 过滤已经隐含了隔离
        if agent_id:
            rel_statement = rel_statement.where(MemoryRelation.agent_id == agent_id)
            
        relations = (await session.exec(rel_statement)).all()
        
        # 格式化为前端格式 (ECharts 力导向图)
        nodes = []
        for m in memories:
            # 根据重要性和访问计数计算符号大小
            # 基础大小 10，最大重要性 10 -> +20，最大访问对数刻度 -> +10
            import math
            size = 10 + (m.importance * 2) + (math.log(m.access_count + 1) * 5)
            size = min(size, 60) # 限制大小

            nodes.append({
                "id": m.id,
                "name": str(m.id), # ECharts 的唯一名称
                "label": {
                    "show": size > 15, # 仅显示重要节点的标签
                    "formatter": m.content[:10] + "..." if len(m.content) > 10 else m.content
                },
                "full_content": m.content,
                "category": m.type, # 事件、事实等
                "value": m.importance,
                "symbolSize": size,
                "sentiment": m.sentiment,
                "tags": m.tags,
                "realTime": m.realTime,
                "access_count": m.access_count,
                # 如果需要，可以在此处添加每个节点的 ECharts 特定样式，
                # 但最好在前端使用 categories/visualMap 处理
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
                            "width": 1 + (r.strength * 4), # 1px 到 5px
                            "curveness": 0.2
                        },
                        "tooltip": {
                            "formatter": f"{r.relation_type}: {r.description or 'No desc'}"
                        }
                    })
                    added_edges.add(edge_key)
                
        # 时间顺序边 (Next/Prev) - 使它们变得微妙
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

