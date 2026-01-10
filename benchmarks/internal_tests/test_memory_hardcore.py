import sys
import os
import json
import random
import numpy as np
import asyncio
from datetime import datetime, timedelta
from sqlmodel import SQLModel, Session, create_engine, select, Field
from typing import List, Dict, Optional

# 添加路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# --- 简化的模型定义 (为了独立运行，不依赖 backend 复杂的 import) ---
# 我们重新定义最小化的模型，以免引入不必要的依赖报错

def get_local_now():
    return datetime.now()

def get_local_timestamp():
    return datetime.now().timestamp() * 1000

class Memory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    content: str
    tags: str = ""
    importance: int = 1
    timestamp: float = Field(default_factory=get_local_timestamp)
    embedding_json: str = "[]" 

class MemoryRelation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    source_id: int = Field(index=True)
    target_id: int = Field(index=True)
    relation_type: str = "associative"
    strength: float = 0.5
    created_at: datetime = Field(default_factory=get_local_now)

# --- 模拟服务 ---

class MockEmbeddingService:
    def __init__(self):
        self.dim = 384
        # 预定义一些簇中心 (随机向量)
        np.random.seed(42)
        self.clusters = {
            "preparation": np.random.rand(384) - 0.5,
            "beach": np.random.rand(384) - 0.5,
            "food": np.random.rand(384) - 0.5,
            "accident": np.random.rand(384) - 0.5,
        }
    
    def encode_one(self, text: str) -> List[float]:
        # 简单的关键词匹配来决定向量位置
        base = (np.random.rand(384) - 0.5) * 0.1 # 噪声
        text_lower = text.lower()
        
        if any(w in text_lower for w in ["pack", "ticket", "ready", "flight", "airport"]):
            base += self.clusters["preparation"]
        if any(w in text_lower for w in ["swim", "sand", "sun", "sea", "beach", "ocean"]):
            base += self.clusters["beach"]
        if any(w in text_lower for w in ["eat", "food", "delicious", "seafood", "fish", "shrimp"]):
            base += self.clusters["food"]
        if any(w in text_lower for w in ["lost", "rain", "hurt", "delay", "broke"]):
            base += self.clusters["accident"]
            
        # 归一化
        norm = np.linalg.norm(base)
        if norm > 0:
            base = base / norm
        return base.tolist()

class MockReranker:
    def compute_score(self, query: str, doc: str) -> float:
        # 简单的关键词重叠打分
        q_words = set(query.lower().split())
        d_words = set(doc.lower().replace("(", "").replace(")", "").split())
        if not q_words: return 0.0
        overlap = len(q_words.intersection(d_words))
        return overlap / len(q_words)

# --- 主测试逻辑 ---

async def run_hardcore_test():
    print("🔥 PeroCore 记忆系统硬核压力测试")
    print("=" * 60)

    # 1. 初始化数据库 (In-Memory SQLite)
    engine = create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(engine)
    
    embedding_service = MockEmbeddingService()
    reranker = MockReranker()
    
    # 2. 生成 100 条记忆 (The Story of a Beach Trip)
    print("[Phase 1] 生成 100 条记忆网络...")
    
    base_time = datetime.now() - timedelta(days=10)
    
    # 定义故事线片段
    story_clusters = [
        ("preparation", [
            "Buying plane tickets to Hawaii", "Packing swimsuits and sunscreen", 
            "Checking passport validity", "Booking the hotel with sea view",
            "Asking neighbor to water plants", "Driving to the airport",
            "Checking in luggage", "Waiting at the gate", "Boarding the plane",
            "Watching movies on flight"
        ]),
        ("beach", [
            "Arrived at the sunny beach", "The ocean is so blue", 
            "Building a huge sandcastle", "Swimming in the cool water",
            "Sunbathing on the deck chair", "Playing beach volleyball",
            "Collecting seashells", "Watching the sunset", "Taking photos by the sea",
            "Surfing for the first time"
        ]),
        ("food", [
            "Eating fresh lobster at a local restaurant", "Drinking coconut water",
            "Trying the famous shrimp taco", "Having ice cream for dessert",
            "Breakfast buffet at the hotel", "Spicy seafood soup",
            "Grilled fish on the beach", "Tropical fruit platter",
            "Drinking cocktails at the bar", "Late night snacks"
        ]),
        ("accident", [
            "Suddenly started raining heavily", "Forgot the umbrella",
            "Lost the room key card", "Got a minor sunburn",
            "Mosquito bites are itchy", "Flight delayed on return",
            "Traffic jam to the airport", "Luggage handle broke",
            "Phone battery died", "Forgot to buy souvenirs"
        ])
    ]
    
    generated_ids = []
    
    with Session(engine) as session:
        count = 0
        for cluster_name, texts in story_clusters:
            for text in texts:
                # 每个核心文本生成 2-3 个变体以填充数量
                for i in range(3): 
                    content = f"{text} (Detail {i})"
                    vec = embedding_service.encode_one(content)
                    mem = Memory(
                        content=content,
                        tags=cluster_name,
                        importance=random.randint(1, 10),
                        timestamp=base_time.timestamp() + count * 3600, # 每小时一条
                        embedding_json=json.dumps(vec)
                    )
                    session.add(mem)
                    session.commit() # Commit to get ID
                    session.refresh(mem)
                    generated_ids.append((mem.id, cluster_name))
                    count += 1
                    if count >= 100: break
            if count >= 100: break
            
        print(f"✅ 已存入 {count} 条记忆")
        
        # 3. 构建关系网络 (模拟 LLM 总结)
        print("[Phase 2] 构建记忆关联图谱...")
        
        # 按 Cluster 分组
        clusters = {}
        for mid, c_name in generated_ids:
            if c_name not in clusters: clusters[c_name] = []
            clusters[c_name].append(mid)
            
        # Cluster 内部连接 (随机选取一些边，避免完全图太密集)
        rel_count = 0
        for c_name, ids in clusters.items():
            for i in range(len(ids)):
                # 连接到同簇的其他 3 个节点
                targets = random.sample(ids, min(len(ids), 4))
                for tid in targets:
                    if tid != ids[i]:
                        session.add(MemoryRelation(
                            source_id=ids[i], target_id=tid, 
                            strength=random.uniform(0.7, 0.9), relation_type="associative"
                        ))
                        rel_count += 1
        
        # Cluster 之间连接 (模拟故事推进)
        # Prep -> Beach -> Food -> Accident
        flow = ["preparation", "beach", "food", "accident"]
        for i in range(len(flow)-1):
            src_c = flow[i]
            dst_c = flow[i+1]
            # 随机连接 10 条边
            src_ids = clusters[src_c]
            dst_ids = clusters[dst_c]
            for _ in range(10):
                s = random.choice(src_ids)
                t = random.choice(dst_ids)
                session.add(MemoryRelation(
                    source_id=s, target_id=t,
                    strength=0.5, relation_type="sequential"
                ))
                rel_count += 1
                
        session.commit()
        print(f"✅ 已建立 {rel_count} 条关联")

        # 4. 模拟检索全流程
        print("\n[Phase 3] 模拟对话检索...")
        query = "Do you remember the delicious seafood we had?"
        print(f"🗣️ 用户提问: \"{query}\"")
        
        # Step A: 向量检索 (Vector Search)
        print("   -> 1. 执行向量检索 (Top-20)...")
        query_vec = embedding_service.encode_one(query)
        
        # 简单的余弦相似度搜索
        candidates = []
        all_mems = session.exec(select(Memory)).all()
        for m in all_mems:
            m_vec = json.loads(m.embedding_json)
            sim = np.dot(query_vec, m_vec) # 假设已归一化
            candidates.append((m.id, sim))
            
        candidates.sort(key=lambda x: x[1], reverse=True)
        top_20 = candidates[:20]
        
        # Step B: 扩散激活 (Spreading Activation)
        print("   -> 2. 执行扩散激活 (Rust Engine)...")
        try:
            from pero_memory_core import CognitiveGraphEngine
            engine = CognitiveGraphEngine()
            
            # 加载图谱
            all_rels = session.exec(select(MemoryRelation)).all()
            rust_rels = [(r.source_id, r.target_id, r.strength) for r in all_rels]
            engine.batch_add_connections(rust_rels)
            
            # 初始激活
            initial_scores = {mid: float(score) for mid, score in top_20}
            
            # 扩散
            activated_scores = engine.propagate_activation(
                initial_scores, steps=2, decay=0.5, min_threshold=0.01
            )
            print(f"      扩散前节点数: {len(initial_scores)}")
            print(f"      扩散后节点数: {len(activated_scores)}")
            
        except ImportError:
            print("❌ Rust 引擎未找到，无法进行扩散测试！")
            return False
            
        # Step C: 混合排序与 Rerank
        print("   -> 3. 执行混合排序与 Rerank...")
        final_candidates = []
        for mid, score in activated_scores.items():
            mem = session.get(Memory, mid)
            if not mem: continue
            
            # 混合分数 = 激活分数 * 0.7 + Rerank分数 * 0.3
            rerank_score = reranker.compute_score(query, mem.content)
            final_score = score * 0.7 + rerank_score * 0.3
            final_candidates.append((mem, final_score, score, rerank_score))
            
        final_candidates.sort(key=lambda x: x[1], reverse=True)
        top_10 = final_candidates[:10]
        
        # 5. 结果展示与自我评估
        report_lines = []
        report_lines.append("\n[Phase 4] 检索结果评估")
        report_lines.append("-" * 60)
        for i, (mem, f_score, a_score, r_score) in enumerate(top_10):
            report_lines.append(f"{i+1}. [Score: {f_score:.4f}] {mem.content}")
            report_lines.append(f"   (Activation: {a_score:.4f}, Rerank: {r_score:.4f}, Tags: {mem.tags})")
            
        # 验证逻辑
        food_count = sum(1 for m, _, _, _ in top_10 if "food" in m.tags)
        report_lines.append("-" * 60)
        report_lines.append(f"📊 统计: Top-10 中有 {food_count} 条关于 'food' 的记忆")
        
        if food_count >= 3:
            report_lines.append("✅ 成功召回大量相关记忆")
        else:
            report_lines.append("⚠️ 召回相关性不足")
            
        diffusion_wins = []
        for m, f, a, r in top_10:
            if r < 0.1 and a > 0.2: 
                diffusion_wins.append(m.content)
                
        if diffusion_wins:
            report_lines.append(f"✨ 发现扩散惊喜 (非关键词匹配):")
            for c in diffusion_wins:
                report_lines.append(f"   - {c}")
        else:
            report_lines.append("   (本次未发现明显的非关键词扩散惊喜)")

        # 写入文件
        with open("hardcore_report.md", "w", encoding="utf-8") as f:
            f.write("\n".join(report_lines))
        
        print("✅ 测试完成，结果已写入 hardcore_report.md")
        return True

if __name__ == "__main__":
    asyncio.run(run_hardcore_test())
