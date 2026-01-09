
import time
import json
from pero_rust_core import CognitiveGraphEngine

def test_story_reasoning():
    print("="*70)
    print("PeroCore Story Reasoning Test - Multi-hop Logic Closure")
    print("="*70)
    
    engine = CognitiveGraphEngine()
    
    # 定义语义节点
    nodes = {
        1: "Xiao Ming (Friend)",
        2: "Blue Mountain Coffee",
        3: "Jamaica",
        4: "Living/Residence",
        5: "Origin/Source",
        6: "Convenience/Easy to get",
        
        # 噪音节点
        10: "Nestle Coffee",
        11: "Supermarket",
        20: "Usain Bolt",
        21: "World Record",
        22: "Running"
    }
    
    # 建立逻辑链条
    logic_edges = [
        (1, 2, 0.9),  # 小明 -> 喜欢 -> 蓝山咖啡
        (1, 4, 0.8),  # 小明 -> 居住
        (4, 3, 0.9),  # 居住 -> 牙买加
        (2, 5, 0.8),  # 蓝山咖啡 -> 原产地
        (5, 3, 0.9),  # 原产地 -> 牙买加
        (3, 6, 0.7),  # 牙买加 -> 方便 (核心推理：在原产地买特产方便)
    ]
    
    # 建立噪音干扰
    noise_edges = [
        (2, 10, 0.5), # 咖啡 -> 联想到 -> 雀巢 (弱关联)
        (10, 11, 0.6),# 雀巢 -> 超市
        (3, 20, 0.8), # 牙买加 -> 联想到 -> 博尔特 (强关联干扰)
        (20, 21, 0.9),# 博尔特 -> 世界纪录
        (21, 22, 0.7),# 世界纪录 -> 跑步
    ]
    
    engine.batch_add_connections(logic_edges + noise_edges)
    
    print("[*] Knowledge injected. Starting reasoning from 'Xiao Ming'...")
    
    # 模拟问题：“为什么小明现在喝咖啡更方便了？”
    # 我们只给“小明”和“咖啡”初始权重，看系统能否收敛到“方便”
    initial_scores = {1: 1.0, 2: 0.5} 
    
    start_time = time.perf_counter()
    result = engine.propagate_activation(
        initial_scores, 
        steps=3, 
        decay=0.5, 
        min_threshold=0.01
    )
    duration = (time.perf_counter() - start_time) * 1000
    
    # 排序结果
    sorted_results = sorted(result.items(), key=lambda x: x[1], reverse=True)
    
    print(f"\n[Result] Latency: {duration:.4f} ms")
    print("-" * 40)
    print("Top Activated Nodes:")
    
    found_target = False
    target_rank = -1
    
    for rank, (node_id, score) in enumerate(sorted_results, 1):
        name = nodes.get(node_id, f"Unknown_{node_id}")
        marker = ""
        if node_id == 6:
            marker = " <--- TARGET REACHED!"
            found_target = True
            target_rank = rank
        
        if rank <= 10:
            print(f"{rank:2d}. {name:<25} Score: {score:.4f} {marker}")

    # 验证逻辑：Jamaica 应该是关键中转站
    jamaica_score = result.get(3, 0)
    bolt_score = result.get(20, 0)
    
    print("\n[Analysis]")
    print(f"- Jamaica (Bridge) Score: {jamaica_score:.4f}")
    print(f"- Usain Bolt (Noise) Score: {bolt_score:.4f}")
    
    if found_target and target_rank <= 10:
        print("\n✅ TEST PASSED: System successfully performed multi-hop reasoning to 'Convenience'.")
        if jamaica_score > bolt_score:
            print("   The reasoning path (Xiao Ming -> Jamaica) successfully suppressed the noise path (Jamaica -> Bolt).")
    else:
        print("\n❌ TEST FAILED: System could not close the logic loop.")

if __name__ == "__main__":
    test_story_reasoning()
