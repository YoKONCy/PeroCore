import time
import random
from pero_rust_core import CognitiveGraphEngine

def run_high_complexity_test():
    engine = CognitiveGraphEngine()
    
    print("=== PeroCore 高复杂度拓扑测试 (10M 规模 + 超级节点陷阱) ===")
    
    # 1. 构造“长链真相” (7步跳跃，极其隐蔽)
    # Start -> A -> B -> C -> D -> E -> F -> Target
    chain_nodes = [999999, 1000001, 1000002, 1000003, 1000004, 1000005, 1000006, 8888888]
    chain_edges = []
    for i in range(len(chain_nodes) - 1):
        chain_edges.append((chain_nodes[i], chain_nodes[i+1], 0.85))
    
    # 2. 构造“超级节点陷阱” (Hub Nodes)
    # 模拟像“的”、“是”或者“人”这种连接极广但逻辑意义薄弱的节点
    # 这些节点会瞬间吸干扩散能量并向外无差别喷射噪音
    hub_node_1 = 555555
    hub_node_2 = 666666
    hub_edges = []
    
    # 让查询点 999999 强行连接到超级节点
    hub_edges.append((999999, hub_node_1, 0.99))
    hub_edges.append((999999, hub_node_2, 0.99))
    
    # 超级节点连接到 100,000 个无用噪音点
    for i in range(100000):
        hub_edges.append((hub_node_1, random.randint(2000000, 3000000), 0.5))
        hub_edges.append((hub_node_2, random.randint(3000000, 4000000), 0.5))
    
    # 3. 填充 10,000,000 条背景噪音
    print("正在注入 10M 噪音边...")
    batch_size = 1_000_000
    for b in range(10):
        noise = []
        for _ in range(batch_size):
            noise.append((random.randint(1, 10_000_000), random.randint(1, 10_000_000), random.random() * 0.3))
        engine.batch_add_connections(noise)
        print(f"  已注入 { (b+1) }M...")

    engine.batch_add_connections(chain_edges + hub_edges)
    
    print("\n--- 开始极限压力查询 ---")
    print("测试目标：在超级节点吸走能量的情况下，7步跳跃的长链真相能否被召回？")
    
    latencies = []
    for i in range(10):
        start = time.perf_counter()
        # 增加扩散步数到 8 步，以覆盖 7 步长链
        results = engine.propagate_activation(
            {999999: 1.0}, 
            steps=8, 
            decay=0.7, 
            min_threshold=0.0001 # 降低阈值以捕捉深层微弱信号
        )
        end = time.perf_counter()
        latencies.append((end - start) * 1000)
    
    avg_latency = sum(latencies) / len(latencies)
    print(f"\n平均延迟: {avg_latency:.4f} ms")
    
    # 结果分析
    sorted_res = sorted(results.items(), key=lambda x: x[1], reverse=True)
    
    target_rank = -1
    for rank, (node_id, score) in enumerate(sorted_res):
        if node_id == 8888888:
            target_rank = rank + 1
            break
            
    print(f"真相节点 (8888888) 排名: {target_rank if target_rank != -1 else '未召回'}")
    if target_rank != -1:
        print(f"得分: {results[8888888]:.8f}")
        print(f"Top 1 节点 ID: {sorted_res[0][0]} (得分: {sorted_res[0][1]:.4f})")
    
    if target_rank != -1 and target_rank < 100:
        print("\n[评价] 极其震撼：PeroCore 在超级节点“能量轰炸”下，依然保住了深层逻辑链！")
    elif target_rank != -1:
        print("\n[评价] 算法稳健：虽然排名靠后，但在海量噪音中依然实现了长程召回。")
    else:
        print("\n[评价] 到达极限：需要调整衰减系数或增加初始能量。")

if __name__ == "__main__":
    run_high_complexity_test()
