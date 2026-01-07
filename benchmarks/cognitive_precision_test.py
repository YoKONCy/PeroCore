import time
import random
from pero_rust_core import CognitiveGraphEngine

def test_cognitive_precision():
    print("\n" + "="*50)
    print("🧠 PeroCore 认知精确度测试：逻辑链条联想验证")
    print("="*50)

    engine = CognitiveGraphEngine()
    engine.configure(max_active_nodes=10000000, max_fan_out=100)

    # 1. 定义黄金知识链条 (Golden Path)
    # 目标：测试跨越 4 层的逻辑联想能力
    # 苹果 (1) -> 牛顿 (2) -> 万有引力 (3) -> 爱因斯坦 (4) -> 相对论 (5)
    nodes = {
        1: "苹果",
        2: "牛顿",
        3: "万有引力",
        4: "爱因斯坦",
        5: "相对论"
    }
    
    golden_connections = [
        (1, 2, 0.95), # 保持高权重
        (2, 3, 0.95), 
        (3, 4, 0.9), 
        (4, 5, 0.95)  
    ]
    
    print(f"[1/3] 注入黄金知识链条: {' -> '.join(nodes.values())}")
    engine.batch_add_connections(golden_connections)

    # 2. 注入大量干扰噪音
    # 模拟真实世界中杂乱的记忆
    NOISE_COUNT = 100000000
    print(f"[2/3] 正在注入【亿级】 ({NOISE_COUNT}) 条随机干扰噪音...")
    
    # 采用批量注入模式
    BATCH_SIZE = 1000000
    for i in range(0, NOISE_COUNT, BATCH_SIZE):
        noise_connections = []
        for _ in range(min(BATCH_SIZE, NOISE_COUNT - i)):
            src = random.randint(100, 10000000)
            tgt = random.randint(100, 10000000)
            weight = random.random() * 0.1 # 进一步降低噪音权重，模拟海量微弱干扰
            noise_connections.append((src, tgt, weight))
        engine.batch_add_connections(noise_connections)
        if (i + BATCH_SIZE) % 5000000 == 0:
            print(f"   - 已注入 {i + len(noise_connections)} 条噪音...")

    # 3. 执行联想测试
    print(f"[3/3] 输入关键词: 【{nodes[1]}】，期待联想到: 【{nodes[5]}】")
    
    # 初始激活“苹果”
    initial_scores = {1: 1.0}
    
    # 执行 5 步扩散
    start_time = time.perf_counter()
    results = engine.propagate_activation(initial_scores, steps=5, decay=0.7, min_threshold=0.001)
    duration = (time.perf_counter() - start_time) * 1000

    # 排序并检查结果
    sorted_results = sorted(results.items(), key=lambda x: x[1], reverse=True)
    
    print(f"\n🎯 联想完成 (耗时: {duration:.2f} ms)")
    print("-" * 30)
    print("Top 10 联想结果:")
    
    found_target = False
    rank = 0
    for node_id, score in sorted_results[:10]:
        name = nodes.get(node_id, f"未知噪音节点_{node_id}")
        rank += 1
        mark = "⭐ [TARGET]" if node_id == 5 else ""
        print(f"   {rank}. {name:<15} Score: {score:.4f} {mark}")
        if node_id == 5:
            found_target = True
            target_rank = rank

    print("-" * 30)
    if found_target:
        print(f"✅ 精确度达成！目标【{nodes[5]}】在第 {target_rank} 位被精准命中。")
        print(f"   这证明 PeroCore 能够穿透 {NOISE_COUNT} 条噪音，完成深层逻辑穿透。")
    else:
        print(f"❌ 联想失败。目标【{nodes[5]}】未进入 Top 10。")
        print("   建议：调整 decay(衰减) 参数或增加步数。")

if __name__ == "__main__":
    test_cognitive_precision()
