
import os
import json
import asyncio
from typing import List, Dict, Optional, Tuple, Set
from datetime import datetime
from sqlmodel import select, col, desc
from sqlmodel.ext.asyncio.session import AsyncSession
from sqlalchemy.orm import sessionmaker

from .database import social_engine, get_social_db_session
from .models_db import SocialMemory, SocialMemoryRelation, QQMessage, SocialDailyReport

# 独立的 Vector Service (Simplified implementation for Social)
# 我们将使用 ChromaDB 或 FAISS，但为了保持与 Core 一致性，我们可能复用 embedding_service
# 并在这里管理独立的索引。
# 简单起见，我们假设有一个独立的 social_vector_store 目录。

class SocialMemoryService:
    _instance = None
    _rust_engine = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(SocialMemoryService, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self.vector_store_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))), "data", "social_vector_store")
        # 确保目录存在
        os.makedirs(self.vector_store_path, exist_ok=True)
        
        # 内存中的关键词索引 (Keyword -> List[MemoryID])
        # 用于快速串线
        self.keyword_index: Dict[str, Set[int]] = {}
        
    async def initialize(self):
        """初始化 Rust 引擎和加载索引"""
        print("[SocialMemory] Initializing...", flush=True)
        await self._init_rust_engine()
        await self._load_keyword_index()
        
    async def _init_rust_engine(self):
        """初始化独立的 Rust 认知引擎"""
        try:
            from pero_memory_core import CognitiveGraphEngine
            self._rust_engine = CognitiveGraphEngine()
            self._rust_engine.configure(max_active_nodes=5000, max_fan_out=15)
            
            # 加载现有关系
            async for session in get_social_db_session():
                statement = select(SocialMemoryRelation)
                relations = (await session.exec(statement)).all()
                if relations:
                    chunk_relations = [(rel.source_id, rel.target_id, rel.strength) for rel in relations]
                    self._rust_engine.batch_add_connections(chunk_relations)
            
            print(f"[SocialMemory] Rust Engine initialized with {len(relations) if 'relations' in locals() else 0} connections.", flush=True)
        except Exception as e:
            print(f"[SocialMemory] Failed to init Rust engine: {e}")
            self._rust_engine = None

    async def _load_keyword_index(self):
        """加载关键词索引到内存"""
        async for session in get_social_db_session():
            statement = select(SocialMemory.id, SocialMemory.keywords)
            results = (await session.exec(statement)).all()
            for mid, kw_str in results:
                if kw_str:
                    for kw in kw_str.split(','):
                        kw = kw.strip()
                        if kw:
                            if kw not in self.keyword_index:
                                self.keyword_index[kw] = set()
                            self.keyword_index[kw].add(mid)

    async def add_summary(self, content: str, keywords: List[str], session_id: str, session_type: str, msg_range: Tuple[int, int] = None, agent_id: str = "pero") -> SocialMemory:
        """
        添加一条新的会话总结，并自动建立关联
        """
        # 1. 保存到数据库
        async for session in get_social_db_session():
            # Embedding (调用 Core 的 EmbeddingService)
            vec = []
            try:
                from services.embedding_service import embedding_service
                vec = embedding_service.encode_one(content)
            except Exception as e:
                # 允许 Embedding 失败，不阻断流程
                print(f"[SocialMemory] Warning: Embedding generation failed: {e}")
                vec = []
            
            memory = SocialMemory(
                content=content,
                keywords=",".join(keywords),
                source_session_id=str(session_id),
                source_session_type=session_type,
                embedding_json=json.dumps(vec),
                msg_start_id=msg_range[0] if msg_range else None,
                msg_end_id=msg_range[1] if msg_range else None,
                agent_id=agent_id
            )
            session.add(memory)
            await session.commit()
            await session.refresh(memory)
            
            # 2. 自动串线 (Auto-Linking)
            # 查找包含相同关键词的旧记忆
            related_ids = set()
            for kw in keywords:
                kw = kw.strip()
                if not kw: continue
                
                # 更新内存索引
                if kw not in self.keyword_index:
                    self.keyword_index[kw] = set()
                
                # 查找现有 ID
                existing_ids = self.keyword_index[kw]
                related_ids.update(existing_ids)
                
                # 将自己加入索引
                self.keyword_index[kw].add(memory.id)
            
            # 建立关联
            new_relations = []
            for rid in related_ids:
                if rid == memory.id: continue
                
                # 创建双向关联
                # New -> Old
                rel1 = SocialMemoryRelation(
                    source_id=memory.id,
                    target_id=rid,
                    relation_type="thematic",
                    strength=0.8 # 关键词命中的强度较高
                )
                session.add(rel1)
                new_relations.append((memory.id, rid, 0.8))
                
                # Old -> New (可选，Rust 引擎通常是有向图，但扩散激活可能是双向传播需求)
                # 为了简化，我们只存一条，但在 Rust 引擎中可能视为无向或双向
                # 这里的 Rust 引擎是单向的，所以如果需要双向激活，需要加两条
                rel2 = SocialMemoryRelation(
                    source_id=rid,
                    target_id=memory.id,
                    relation_type="thematic",
                    strength=0.8
                )
                session.add(rel2)
                new_relations.append((rid, memory.id, 0.8))
            
            await session.commit()
            
            # 3. 更新 Rust 引擎
            if self._rust_engine and new_relations:
                self._rust_engine.batch_add_connections(new_relations)
                
            # 4. 写入独立 Vector Store (这里简化处理，暂未实现独立 VectorDB 写入，仅依赖 DB 检索或 Keyword)
            # TODO: Implement independent Chroma/FAISS add
            
            return memory

    async def retrieve_context(self, query: str, current_session_id: str, agent_id: str = "pero") -> str:
        """
        检索上下文：
        1. 关键词/向量检索找到入口节点
        2. Rust 引擎扩散激活
        3. 格式化输出
        """
        # 简单实现：仅基于关键词匹配 + 扩散
        # 在实际中，应该先做 embedding search 找到入口
        
        # 1. 提取 Query 关键词 (Mock，实际应调用 LLM 或分词)
        # 这里为了演示，我们假设 query 本身可能包含关键词
        # 或者我们遍历 keyword_index 看看 query 是否包含
        entry_points = []
        for kw, mids in self.keyword_index.items():
            if kw in query:
                entry_points.extend(list(mids))
        
        if not entry_points:
            return ""
            
        # 2. 扩散激活
        activated_ids = set(entry_points)
        if self._rust_engine:
            # 传入入口节点，进行 2 步扩散
            # rust_engine.spread_activation(start_nodes, steps, decay)
            # 假设 Rust 接口支持 list input
            # 注意：Rust 接口可能需要 list[int]
            try:
                # Rust 引擎返回 dict {id: energy}
                # 参数: entry_points(List[int]), steps(int), decay(float)
                # 注意：entry_points 必须是 int 列表
                entry_point_ids = [int(mid) for mid in entry_points]
                spread_result = self._rust_engine.spread(entry_point_ids, 2, 0.5)
                activated_ids = set(spread_result.keys())
            except Exception as e:
                print(f"[SocialMemory] Rust engine spread failed: {e}")
                # Fallback: 仅使用直接命中的节点
                pass
        
        # 3. 读取内容
        if not activated_ids:
            return ""
            
        async for session in get_social_db_session():
            statement = select(SocialMemory).where(col(SocialMemory.id).in_(activated_ids)).where(SocialMemory.agent_id == agent_id).limit(5)
            memories = (await session.exec(statement)).all()
            
            if not memories:
                return ""
                
            # 过滤：优先显示非当前 Session 的记忆（为了跨会话信息增益），或者很久以前的
            result = "【相关记忆回忆】:\n"
            for mem in memories:
                # 加上来源标注
                source_label = "私聊" if mem.source_session_type == 'private' else f"群{mem.source_session_id}"
                result += f"- [{source_label}] {mem.content}\n"
                
            return result

    async def generate_daily_report(self, date_str: str = None):
        """生成并保存社交日报"""
        if not date_str:
            date_str = datetime.now().strftime("%Y-%m-%d")
            
        async for session in get_social_db_session():
            # 1. 检查今日是否已生成
            statement_check = select(SocialDailyReport).where(SocialDailyReport.date_str == date_str)
            existing = (await session.exec(statement_check)).first()
            if existing:
                return existing

            # 2. 统计当日消息
            # 假设 timestamp 是 datetime 对象
            # SQLite 中可能需要字符串比较或 func.date
            # 这里简单起见，我们查询所有并过滤（量大时需优化）
            # 或者使用 between
            start_dt = datetime.strptime(f"{date_str} 00:00:00", "%Y-%m-%d %H:%M:%S")
            end_dt = datetime.strptime(f"{date_str} 23:59:59", "%Y-%m-%d %H:%M:%S")
            
            # 消息总数
            count_stmt = select(col(QQMessage.id)).where(
                col(QQMessage.timestamp) >= start_dt,
                col(QQMessage.timestamp) <= end_dt
            )
            total_messages = len((await session.exec(count_stmt)).all())
            
            # 活跃群组
            group_stmt = select(QQMessage.session_id).where(
                col(QQMessage.timestamp) >= start_dt,
                col(QQMessage.timestamp) <= end_dt,
                QQMessage.session_type == "group"
            ).distinct()
            active_groups = (await session.exec(group_stmt)).all()
            
            # 新加好友 (需要 FriendRequest 表支持，暂时 Mock)
            new_friends = 0
            
            # 3. 汇总当日生成的记忆总结
            mem_stmt = select(SocialMemory).where(
                col(SocialMemory.created_at) >= start_dt,
                col(SocialMemory.created_at) <= end_dt
            )
            daily_memories = (await session.exec(mem_stmt)).all()
            
            summary_content = "今日无重要记忆。"
            if daily_memories:
                summary_content = "\n".join([f"- {m.content}" for m in daily_memories])
            
            # 4. 生成日报内容 (LLM)
            # 这里的 agent_name 暂时硬编码为 Pero，或者应该引入 ConfigManager 获取？
            # 简单起见，这里先默认 Pero，如果需要动态，需要在 SocialMemoryService 初始化时注入 ConfigManager
            # 鉴于这是一个 Singleton，我们可以尝试 lazy import get_config_manager
            
            try:
                from core.config_manager import get_config_manager
                config = get_config_manager()
                bot_name = config.get("bot_name", "Pero")
            except:
                bot_name = "Pero"

            report_prompt = mdp.render("tasks/social/daily_report_generator", {
                "agent_name": bot_name,
                "date_str": date_str,
                "total_messages": total_messages,
                "active_groups_count": len(active_groups),
                "summary_content": summary_content
            })
            
            from services.llm_service import llm_service
            report_text = await llm_service.chat_completion(
                messages=[{"role": "user", "content": report_prompt}],
                temperature=0.7
            )
            
            # Save report
            report = SocialDailyReport(
                date_str=date_str,
                content=report_text,
                total_messages=total_messages,
                active_groups=",".join([str(g) for g in active_groups]),
                new_friends=new_friends,
                agent_id=agent_id
            )
            session.add(report)
            await session.commit()
            
            print(f"[SocialMemory] Daily report generated for {date_str}")
            return report

def get_social_memory_service():
    return SocialMemoryService()
