
import time
import random
from pero_memory_core import CognitiveGraphEngine
import psutil
import os

def get_memory_usage():
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / 1024 / 1024 / 1024  # GB

def run_lateral_test():
    engine = CognitiveGraphEngine()
    
    print("--- 构造高复杂度测试场景 (10M 噪音 + 2个超级节点) ---")
    
    # 1. 构造 7 步真实逻辑链 (Truth Chain)
    chain_nodes = [999999, 1000001, 1000002, 1000003, 1000004, 1000005, 1000006, 8888888]
    chain_edges = []
    for i in range(len(chain_nodes) - 1):
        chain_edges.append((chain_nodes[i], chain_nodes[i+1], 0.85))
    
    # 2. 构造超级节点陷阱
    hub_node_1 = 555555
    hub_node_2 = 666666
    hub_edges = []
    hub_edges.append((999999, hub_node_1, 0.99))
    hub_edges.append((999999, hub_node_2, 0.99))
    
    print(f"正在注入超级节点 (各 100k 邻居)...")
    for i in range(100000):
        hub_edges.append((hub_node_1, random.randint(2000000, 3000000), 0.5))
        hub_edges.append((hub_node_2, random.randint(3000000, 4000000), 0.5))
    
    # 3. 注入 1000 万条背景噪音
    print("正在注入 10M 背景噪音...")
    for b in range(10):
        noise = []
        for _ in range(1_000_000):
            noise.append((random.randint(1, 10_000_000), random.randint(1, 10_000_000), random.random() * 0.3))
        engine.batch_add_connections(noise)
        print(f"  已注入 {b+1}M 噪音...")

    engine.batch_add_connections(chain_edges + hub_edges)
    
    target_node = 8888888
    
    def test_with_inhibition(inh_value):
        print(f"\n>>> 测试侧抑制系数: {inh_value}")
        start = time.perf_counter()
        results = engine.propagate_activation(
            {999999: 1.0}, 
            steps=8, 
            decay=0.7, 
            min_threshold=0.0001,
            inhibition=inh_value
        )
        end = time.perf_counter()
        latency = (end - start) * 1000
        
        sorted_results = sorted(results.items(), key=lambda x: x[1], reverse=True)
        
        rank = -1
        score = 0
        for i, (node_id, s) in enumerate(sorted_results):
            if node_id == target_node:
                rank = i + 1
                score = s
                break
        
        print(f"耗时: {latency:.4f}ms")
        print(f"激活节点数: {len(results)}")
        if rank != -1:
            print(f"目标节点 {target_node} 排名: {rank}, 分数: {score:.6e}")
        else:
            print(f"目标节点 {target_node} 未能被激活")
        
        return rank, score

    # 对比测试
    rank0, _ = test_with_inhibition(0.0)
    rank1, _ = test_with_inhibition(0.00001)
    rank2, _ = test_with_inhibition(0.0001)
    rank3, _ = test_with_inhibition(0.001)

    print("\n--- 实验总结 ---")
    ranks = {"无抑制": rank0, "弱抑制(0.0001)": rank1, "中抑制(0.01)": rank2, "强抑制(1.0)": rank3}
    for k, v in ranks.items():
        print(f"{k}: 排名 {v}")

if __name__ == "__main__":
    run_lateral_test()
