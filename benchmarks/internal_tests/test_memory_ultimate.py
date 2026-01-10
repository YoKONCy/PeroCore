import sys
import os
import json
import random
import time
import psutil
import numpy as np
import asyncio
from typing import List, Dict, Tuple

# 添加路径
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# 尝试导入真实模型
try:
    from sentence_transformers import SentenceTransformer
    REAL_MODEL = True
    print("✅ 使用真实模型: all-MiniLM-L6-v2 (或类似)")
except ImportError:
    REAL_MODEL = False
    print("⚠️ 未找到 sentence_transformers，将使用高级 Mock")

# 尝试导入 Rust 核心
try:
    from pero_memory_core import CognitiveGraphEngine
    RUST_AVAILABLE = True
    print("✅ Rust 核心引擎就绪")
except ImportError:
    RUST_AVAILABLE = False
    print("❌ Rust 核心未找到！测试将失去意义！")

# --- 数据生成器 ---

class LifeSimulator:
    def __init__(self):
        self.themes = {
            "Work": [
                "Fixed a critical bug in production", "Meeting with product manager dragged on",
                "Deployed new feature successfully", "Server crashed at 3 AM",
                "Got a promotion!", "Feeling burnout from coding",
                "Learned Rust programming", "Wrote documentation all day",
                "Interviewed a new candidate", "Office coffee machine broke"
            ],
            "Life": [
                "Moved to a new apartment", "Cooked spaghetti for dinner",
                "Had a terrible flu", "Insomnia again, watched ceiling till 4 AM",
                "Cleaned the whole house", "Paid electricity bills",
                "Cat is sick, went to vet", "Bought new furniture",
                "Neighbor is too noisy", "Grocery shopping at Walmart"
            ],
            "Hobby": [
                "Played Black Myth: Wukong for 5 hours", "Took photos of sunset",
                "Practiced guitar chords", "Reading 'Three Body Problem'",
                "Went hiking in the mountains", "Watched a sci-fi movie",
                "Drawing sketches on iPad", "Listening to Jazz music",
                "Building a mechanical keyboard", "Coding a side project"
            ],
            "Emotion": [
                "Feeling anxious about deadline", "Super happy today!",
                "Feeling lonely in the city", "Excited for the weekend",
                "Frustrated with myself", "Peaceful morning",
                "Angry at rude driver", "Grateful for friends",
                "Confused about future", "Nostalgic about childhood"
            ]
        }
        
        if REAL_MODEL:
            # 加载一个小模型，速度快
            self.model = SentenceTransformer('all-MiniLM-L6-v2')
        else:
            self.model = None

    def generate_memories(self, count: int) -> Tuple[List[dict], List[tuple]]:
        """生成记忆和关系"""
        memories = []
        relations = []
        
        print(f"   正在生成 {count} 条记忆 (这可能需要一点时间)...")
        start_gen = time.time()
        
        # 1. 生成节点
        for i in range(count):
            theme = random.choice(list(self.themes.keys()))
            base_text = random.choice(self.themes[theme])
            # 添加随机变体以避免重复
            content = f"{base_text} (Day {i})"
            
            memories.append({
                "id": i,
                "content": content,
                "theme": theme,
                "vector": None # 稍后批量生成
            })
            
        # 2. 批量生成向量 (如果是真实模型)
        if REAL_MODEL:
            print("   正在批量计算向量 (Batch Encoding)...")
            texts = [m["content"] for m in memories]
            # 分批处理以防 OOM
            batch_size = 500 # 增大 batch size
            vectors = []
            for i in range(0, len(texts), batch_size):
                batch_texts = texts[i:i+batch_size]
                batch_vecs = self.model.encode(batch_texts, show_progress_bar=False)
                vectors.extend(batch_vecs)
            
            for i, m in enumerate(memories):
                m["vector"] = vectors[i]
        else:
            # Mock 向量
            for m in memories:
                # 简单的哈希投影
                np.random.seed(hash(m["theme"]) % 2**32)
                base = np.random.rand(384)
                m["vector"] = base / np.linalg.norm(base)

        print(f"   数据生成完成: {time.time() - start_gen:.2f}s")
        
        # 3. 生成关系 (The Web)
        print("   正在编织关系网...")
        # 策略:
        # - 相邻 ID (时间序) 弱关联
        # - 同 Theme 随机强关联
        # - 跨 Theme 特定规则 (Work -> Emotion, Life -> Hobby)
        
        # 按 Theme 分组
        theme_groups = {t: [] for t in self.themes}
        for m in memories:
            theme_groups[m["theme"]].append(m["id"])
            
        rel_count = 0
        
        # A. 时序链 (The Timeline)
        for i in range(count - 1):
            relations.append((i, i+1, 0.3)) # 弱时序
            rel_count += 1
            
        # B. 主题簇 (The Clusters)
        for theme, ids in theme_groups.items():
            # 每个节点随机连接同主题的 3-5 个节点
            for src in ids:
                targets = random.sample(ids, min(len(ids), 5))
                for dst in targets:
                    if src != dst:
                        relations.append((src, dst, random.uniform(0.6, 0.9)))
                        rel_count += 1
                        
        # C. 跨域联想 (The Cross-Over)
        # Work -> Emotion (压力 -> 焦虑)
        work_ids = theme_groups["Work"]
        emo_ids = theme_groups["Emotion"]
        hobby_ids = theme_groups["Hobby"]
        
        # 随机建立 5000 条跨域连接 (增加密度)
        for _ in range(5000):
            # Work -> Emotion
            s = random.choice(work_ids)
            t = random.choice(emo_ids)
            relations.append((s, t, 0.8)) # 增强连接强度
            
            # Emotion -> Hobby (治愈)
            s = random.choice(emo_ids)
            t = random.choice(hobby_ids)
            relations.append((s, t, 0.8)) # 增强连接强度
            
        print(f"   关系网构建完成: {rel_count} 条边")
        return memories, relations

def run_ultimate_test():
    print("\n🌌 万念回响 (Echo of 10,000 Thoughts) - 终极压力测试")
    print("=" * 60)
    
    if not RUST_AVAILABLE:
        return

    sim = LifeSimulator()
    
    # 1. 生成数据
    MEMORY_COUNT = 10000
    memories, relations = sim.generate_memories(MEMORY_COUNT)
    
    # 2. Rust 引擎性能测试
    print("\n[Phase 1] Rust 引擎性能测试")
    print("-" * 40)
    
    engine = CognitiveGraphEngine()
    engine.configure(max_active_nodes=20000, max_fan_out=50) # 放宽限制
    
    # 内存监控
    process = psutil.Process(os.getpid())
    mem_before = process.memory_info().rss / 1024 / 1024
    
    # A. 构建图谱
    t_start = time.time()
    engine.batch_add_connections(relations)
    t_build = time.time() - t_start
    
    mem_after = process.memory_info().rss / 1024 / 1024
    print(f"✅ 图谱构建: {t_build*1000:.2f}ms")
    print(f"   节点数: {MEMORY_COUNT}")
    print(f"   边数: {len(relations)}")
    print(f"   内存增长: {mem_after - mem_before:.2f} MB")
    
    # 3. 模拟复杂查询
    print("\n[Phase 2] 复杂查询模拟")
    print("-" * 40)
    query = "I feel so tired recently, maybe I need some distraction."
    print(f"🗣️ 用户: \"{query}\"")
    
    # A. 向量检索 (Python侧模拟)
    print("   -> 1. Vector Search (Top-50)...")
    t_vec_start = time.time()
    
    if REAL_MODEL:
        q_vec = sim.model.encode(query)
        # 使用 numpy 矩阵运算加速
        # stack all vectors
        all_vecs = np.stack([m["vector"] for m in memories])
        # cosine similarity
        sims = np.dot(all_vecs, q_vec) # 假设已归一化
        # top-k
        top_k_indices = np.argsort(sims)[-50:][::-1]
        initial_nodes = {int(idx): float(sims[idx]) for idx in top_k_indices}
    else:
        # Mock: 随机选 50 个 Work/Emotion 相关的
        initial_nodes = {}
        for m in memories:
            if "tired" in m["content"] or "anxious" in m["content"]:
                initial_nodes[m["id"]] = 0.8
            if len(initial_nodes) >= 50: break
            
    t_vec = time.time() - t_vec_start
    print(f"      耗时: {t_vec*1000:.2f}ms")
    
    # B. 扩散激活 (Rust)
    print("   -> 2. Rust Diffusion (Spreading Activation)...")
    t_diff_start = time.time()
    
    activated_scores = engine.propagate_activation(
        initial_nodes,
        steps=4,       # 增加步数
        decay=0.8,     # 减少衰减 (能量传递更远)
        min_threshold=0.01
    )
    
    t_diff = time.time() - t_diff_start
    print(f"      耗时: {t_diff*1000:.2f}ms ⚡")
    print(f"      激活节点: {len(initial_nodes)} -> {len(activated_scores)}")
    
    # 4. 结果分析
    print("\n[Phase 3] 结果深度分析")
    print("-" * 40)
    
    # 找出 Top-10 激活
    top_activated = sorted(activated_scores.items(), key=lambda x: x[1], reverse=True)[:10]
    
    report_lines = []
    report_lines.append(f"Query: {query}")
    report_lines.append("-" * 40)
    
    hobby_count = 0
    work_count = 0
    
    for mid, score in top_activated:
        mem = memories[mid]
        content = mem["content"]
        theme = mem["theme"]
        
        is_direct = mid in initial_nodes
        source_tag = "Direct" if is_direct else "Diffusion"
        
        line = f"[{score:.4f}] [{theme}] {content[:50]}... ({source_tag})"
        print(line)
        report_lines.append(line)
        
        if theme == "Hobby": hobby_count += 1
        if theme == "Work": work_count += 1
        
    print("-" * 40)
    
    # 验证逻辑：是否推荐了 Hobby (Distraction)?
    if hobby_count > 0:
        print(f"✨ 成功联想到 {hobby_count} 个爱好活动！(蝴蝶效应生效)")
        print("   路径推测: Tired(Query) -> Work(Direct) -> Emotion(Link) -> Hobby(Diffusion)")
    else:
        print("⚠️ 未能联想到爱好，可能关联强度不足。")
        
    # 性能评价
    if t_diff < 0.1: # 100ms
        print("🚀 Rust 引擎性能评级: SSS (极速)")
    elif t_diff < 0.5:
        print("🚀 Rust 引擎性能评级: S (流畅)")
    else:
        print("🐢 Rust 引擎性能评级: B (需优化)")
        
    # 保存报告
    with open("ultimate_report.md", "w", encoding="utf-8") as f:
        f.write("\n".join(report_lines))

if __name__ == "__main__":
    run_ultimate_test()
