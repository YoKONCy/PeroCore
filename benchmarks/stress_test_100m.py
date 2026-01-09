import time
import random
import sys
import psutil
import os
from pero_rust_core import CognitiveGraphEngine

def get_memory_usage():
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / 1024 / 1024 / 1024  # GB

def run_100m_stress_test():
    engine = CognitiveGraphEngine()
    
    total_edges = 100_000_000
    batch_size = 5_000_000
    num_batches = total_edges // batch_size
    
    print(f"=== PeroCore 亿级压力测试 (目标: {total_edges} 条边) ===")
    print(f"初始内存占用: {get_memory_usage():.2f} GB")
    
    start_ingestion = time.perf_counter()
    
    # 1. 预埋一条长逻辑链，用于最后的检索验证
    # 链条：Query -> A -> B -> C -> D -> Truth
    target_chain = [
        (999, 1000, 0.9),
        (1000, 1001, 0.8),
        (1001, 1002, 0.8),
        (1002, 1003, 0.8),
        (1003, 7777777, 0.9) # 7777777 是我们的终极答案
    ]
    engine.batch_add_connections(target_chain)
    
    # 2. 分批注入一亿条随机边
    try:
        for i in range(num_batches):
            batch_start = time.perf_counter()
            noise_edges = []
            for _ in range(batch_size):
                # 随机生成节点 ID (1 到 1亿之间)
                src = random.randint(1, 100_000_000)
                dst = random.randint(1, 100_000_000)
                noise_edges.append((src, dst, random.random() * 0.2))
            
            engine.batch_add_connections(noise_edges)
            
            batch_end = time.perf_counter()
            current_mem = get_memory_usage()
            print(f"已注入 { (i+1) * batch_size / 1_000_000 :.0f}M 条边... "
                  f"当前批次耗时: {batch_end - batch_start:.2f}s, "
                  f"内存占用: {current_mem:.2f} GB")
            
            # 如果内存占用过高（例如超过机器限制，假设为 16GB），则停止注入
            if current_mem > 24: 
                print("警告：内存占用过高，停止注入。")
                break
                
    except Exception as e:
        print(f"注入过程中发生错误: {e}")
    
    end_ingestion = time.perf_counter()
    print(f"\n数据注入完成！总耗时: {end_ingestion - start_ingestion:.2f}s")
    print(f"最终内存占用: {get_memory_usage():.2f} GB")
    
    # 3. 执行扩散查询测试
    print("\n--- 执行扩散查询 (5步跳跃) ---")
    
    # 我们测试 10 次取平均值，看看是否能稳在 1ms 左右
    latencies = []
    for i in range(10):
        query_start = time.perf_counter()
        results = engine.propagate_activation(
            {999: 1.0}, 
            steps=5, 
            decay=0.7, 
            min_threshold=0.001
        )
        query_end = time.perf_counter()
        latencies.append((query_end - query_start) * 1000)
    
    avg_latency = sum(latencies) / len(latencies)
    print(f"平均查询延迟: {avg_latency:.4f} ms")
    print(f"最大查询延迟: {max(latencies):.4f} ms")
    print(f"最小查询延迟: {min(latencies):.4f} ms")
    
    # 4. 验证正确性
    if 7777777 in results:
        print(f"验证成功：在亿级噪音中找到了隐藏答案 (得分: {results[7777777]:.4f})")
    else:
        print("验证失败：未能召回隐藏答案。")

if __name__ == "__main__":
    run_100m_stress_test()
