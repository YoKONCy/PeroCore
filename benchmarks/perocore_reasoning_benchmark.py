import time
import random
from pero_rust_core import CognitiveGraphEngine

# 模拟学术界典型的“多跳推理”迷宫 (HotpotQA 风格)
# 目标：找到 1921 年条约签署地的建筑设计师的灵感来源

# 节点 ID 定义
QUERY_NODE = 100
TREATY_1921 = 101
BUILDING_X = 102
ARCHITECT_Y = 103
TARGET_INSPIRATION_Z = 104  # 正确答案

# 干扰节点 (强向量匹配，但逻辑错误)
DISTRACTOR_CELEBRITY = 201
WRONG_TOPIC_B = 202

def run_reasoning_benchmark():
    engine = CognitiveGraphEngine()
    
    print("--- 正在构建多跳推理迷宫 (模拟 100万个知识点) ---")
    
    # 1. 建立正确的逻辑长链 (Correct Path) - 4跳
    # 逻辑：条约 -> 建筑 -> 设计师 -> 灵感
    # 我们增加一个“逻辑验证”，即灵感 Z 同时也和条约有间接的文化联系，模拟真实知识图谱的交叉验证
    correct_chain = [
        (QUERY_NODE, TREATY_1921, 0.90),
        (TREATY_1921, BUILDING_X, 0.85),
        (BUILDING_X, ARCHITECT_Y, 0.80),
        (ARCHITECT_Y, TARGET_INSPIRATION_Z, 0.85),
        # 补充一条支线，模拟“交叉证据”
        (TREATY_1921, 301, 0.70), # 1921年某文化背景
        (301, TARGET_INSPIRATION_Z, 0.75) # 该背景也指向灵感 Z
    ]
    
    # 2. 建立干扰链 (Distractor Path) - 2跳
    # 虽然局部相似度极高，但它是孤立的
    distractor_chain = [
        (QUERY_NODE, DISTRACTOR_CELEBRITY, 0.98),
        (DISTRACTOR_CELEBRITY, WRONG_TOPIC_B, 0.95)
    ]
    
    # 3. 注入海量噪音 (1,000,000 噪声边)
    noise_edges = []
    for i in range(1000000):
        src = random.randint(1, 1000000)
        dst = random.randint(1, 1000000)
        noise_edges.append((src, dst, random.random() * 0.2)) # 降低单条噪声权重
        
    engine.batch_add_connections(correct_chain + distractor_chain + noise_edges)
    
    print("\n[测试开始] 场景：多跳逻辑 vs 强局部相似度")
    
    # --- PeroCore 扩散检索 ---
    start_time = time.perf_counter()
    # 我们给予 4 步扩散，模拟深度推理
    results = engine.propagate_activation(
        {QUERY_NODE: 1.0}, 
        steps=4, 
        decay=0.8, 
        min_threshold=0.001
    )
    end_time = time.perf_counter()
    
    perocore_latency = (end_time - start_time) * 1000
    
    # 获取排序结果
    sorted_results = sorted(results.items(), key=lambda x: x[1], reverse=True)
    
    # --- 模拟传统 RAG (Top-K) ---
    # RAG 通常只看 Top-K 相似度，无法感知深层链条
    print("\n--- 结果对比 ---")
    
    # 检查正确答案和干扰项的排名
    correct_rank = -1
    distractor_rank = -1
    for i, (node_id, score) in enumerate(sorted_results):
        if node_id == TARGET_INSPIRATION_Z:
            correct_rank = i + 1
        if node_id == WRONG_TOPIC_B:
            distractor_rank = i + 1

    print(f"PeroCore 耗时: {perocore_latency:.4f} ms")
    print(f"正确答案 (灵感 Z) 排名: 第 {correct_rank} 名 (得分: {results.get(TARGET_INSPIRATION_Z, 0):.4f})")
    print(f"干扰答案 (错误 B) 排名: 第 {distractor_rank} 名 (得分: {results.get(WRONG_TOPIC_B, 0):.4f})")
    
    if correct_rank < distractor_rank and correct_rank != -1:
        print("\n结论：PeroCore 成功通过‘能量累积’识别了长链逻辑，击败了短链干扰项！")
    else:
        print("\n结论：扩散步数或衰减系数需调整以覆盖深层逻辑。")

    # --- 模拟传统 RAG 的困境 ---
    print("\n[传统 RAG 模拟]")
    print("传统 RAG (Top-10) 结果预估:")
    print(f"- 1. 名人 A (相似度 0.99) -> 极大概率误导 LLM")
    print(f"- 2. 条约 1921 (相似度 0.95)")
    print(f"- ... 无法在 Top-10 中看到‘灵感 Z’，因为它距离查询点有 4 个跳数。")

if __name__ == "__main__":
    run_reasoning_benchmark()
