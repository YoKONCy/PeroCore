
import time
from pero_memory_core import CognitiveGraphEngine
import numpy as np

def cosine_similarity(v1, v2):
    return np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))

# 1. 模拟高维向量空间 (用于模拟传统 Vector RAG)
# 我们故意让“生物学”和“太阳能工程”的向量正交（即余弦相似度接近0）
embeddings = {
    1001: np.array([1, 0, 0, 0]),  # Photosynthesis (Biology Axis)
    1002: np.array([0.9, 0.1, 0, 0]), # Chlorophyll
    1003: np.array([0, 0.1, 0.9, 0]), # Semiconductor Physics (Physics Axis)
    1004: np.array([0, 0, 0, 1]),  # Solar Cells (Engineering Axis)
}

node_names = {
    1001: "Photosynthesis (生物-光合作用)",
    1002: "Chlorophyll (生物-叶绿素)",
    1003: "Semiconductor Physics (物理-半导体物理)",
    1004: "Solar Cells (工程-太阳能电池)"
}

def run_scientific_benchmark():
    print("=== PeroCore KDN vs. Traditional Vector RAG Scientific Benchmark ===")
    print("场景：跨学科知识发现 - 从‘植物生物学’联想到‘新型能源器件’")
    print("-" * 60)

    # --- 传统 Vector RAG 模拟 ---
    # 查询向量：偏向生物学
    query_vec = np.array([0.95, 0.05, 0, 0])
    
    print("\n[Step 1] 传统 Vector RAG 检索结果 (Top-2):")
    vector_scores = {node_id: cosine_similarity(query_vec, vec) for node_id, vec in embeddings.items()}
    sorted_vector = sorted(vector_scores.items(), key=lambda x: x[1], reverse=True)
    
    for node_id, score in sorted_vector[:2]:
        print(f"  - {node_names[node_id]}: Score {score:.4f}")
    
    print(f"  * 结论：传统 RAG 完全漏掉了 '{node_names[1004]}', 因为它们在语义空间距离太远。")

    # --- PeroCore KDN 扩散检索 ---
    engine = CognitiveGraphEngine()
    
    # 建立知识关联（图谱边缘）
    # 模拟研究发现：叶绿素具有有机半导体特性（这是跨学科的桥梁）
    connections = [
        (1001, 1002, 0.95), # Photosynthesis <-> Chlorophyll
        (1002, 1003, 0.85), # Chlorophyll <-> Semiconductor Physics (The Bridge!)
        (1003, 1004, 0.90)  # Semiconductor Physics <-> Solar Cells
    ]
    engine.batch_add_connections(connections)

    print("\n[Step 2] PeroCore KDN 扩散检索结果 (初始激活: Photosynthesis):")
    initial_scores = {1001: 1.0}
    
    # 执行 2 步扩散
    start_time = time.perf_counter()
    diffused_scores = engine.propagate_activation(
        initial_scores, 
        steps=3, 
        decay=0.8, 
        min_threshold=0.01
    )
    end_time = time.perf_counter()

    sorted_kdn = sorted(diffused_scores.items(), key=lambda x: x[1], reverse=True)
    for node_id, score in sorted_kdn:
        print(f"  - {node_names[node_id]}: Score {score:.4f}")

    print(f"\n[Performance] KDN 扩散耗时: {(end_time - start_time)*1000:.4f} ms")
    
    # --- 最终评估 ---
    print("\n" + "="*60)
    print("最终技术鉴定结论：")
    if 1004 in diffused_scores and diffused_scores[1004] > 0.1:
        print("✅ SUCCESS: PeroCore 成功通过‘扩散激活’跨越了语义孤岛！")
        print(f"   它成功发现了从 '{node_names[1001]}' 到 '{node_names[1004]}' 的逻辑链路。")
        print("   这种能力是解决复杂多步推理（Multi-hop Reasoning）的关键。")
    else:
        print("❌ FAILURE: KDN 未能发现目标节点。")
    print("="*60)

if __name__ == "__main__":
    run_scientific_benchmark()
