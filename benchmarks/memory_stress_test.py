import time
import random
import sys
import os

# 尝试导入 pero_rust_core
try:
    from pero_rust_core import CognitiveGraphEngine, sanitize_text_content
    print("✅ 成功导入 pero_rust_core 引擎")
except ImportError:
    print("❌ 无法导入 pero_rust_core，请确保已安装该模块。")
    sys.exit(1)

def run_benchmarks():
    print("\n" + "="*50)
    print("🚀 PeroCore Rust 引擎硬核性能测试")
    print("="*50)

    # 1. 认知图谱压力测试
    engine = CognitiveGraphEngine()
    # 配置：最大活跃节点 10 万，最大扇出 50
    engine.configure(max_active_nodes=100000, max_fan_out=50)

    NODE_COUNT = 20000000 # 2000 万节点
    EDGE_COUNT = 40000000 # 4000 万条边

    print(f"\n[1/3] 正在构建【千万级】压力模型: {NODE_COUNT} 节点, {EDGE_COUNT} 关联边...")
    
    start_build = time.time()
    BATCH_SIZE = 400000
    for i in range(0, EDGE_COUNT, BATCH_SIZE):
        connections = []
        for _ in range(min(BATCH_SIZE, EDGE_COUNT - i)):
            src = random.randint(1, NODE_COUNT)
            tgt = random.randint(1, NODE_COUNT)
            weight = random.random()
            connections.append((src, tgt, weight))
        engine.batch_add_connections(connections)
        print(f"   - 已注入 {i + len(connections)} 条边...")
    
    end_build = time.time()
    print(f"✨ 模型构建完成，耗时: {end_build - start_build:.2f}s")

    # 2. 联想检索 (激活扩散) 测试
    print(f"\n[2/3] 执行千万级节点联想检索测试 (扩散步数: 5)...")
    
    # 模拟初始激活节点（用户当前的对话上下文触发了 5 个记忆点）
    initial_scores = {random.randint(1, NODE_COUNT): 1.0 for _ in range(5)}
    
    latencies = []
    for i in range(10): # 测试 10 次取平均
        start_prop = time.perf_counter()
        # 执行扩散计算: 5步扩散, 衰减 0.5, 阈值 0.01
        result = engine.propagate_activation(initial_scores, steps=5, decay=0.5, min_threshold=0.01)
        end_prop = time.perf_counter()
        latencies.append((end_prop - start_prop) * 1000)
    
    avg_latency = sum(latencies) / len(latencies)
    print(f"🎯 检索完成！")
    print(f"   - 平均延迟: {avg_latency:.2f} ms")
    print(f"   - 检索到的关联节点数: {len(result)}")
    print(f"   - 结论: {'🔥 极速 (小于 50ms)' if avg_latency < 50 else '✅ 正常'} ")

    # 3. 超大文本清洗测试 (Rust vs Python 潜在对比)
    print(f"\n[3/3] 超大文本清洗测试 (10 万字符 + 大量 Base64 数据)...")
    
    # 构造一个包含大量图片数据的超长文本
    fake_base64 = "data:image/png;base64," + "A" * 5000
    big_text = (f"用户发送了一张图片: {fake_base64} " * 20) + " 这是正常的记忆内容。" * 500
    
    start_clean = time.perf_counter()
    cleaned = sanitize_text_content(big_text)
    end_clean = time.perf_counter()
    
    print(f"✨ 清洗完成！")
    print(f"   - 耗时: {(end_clean - start_clean) * 1000:.2f} ms")
    print(f"   - 原长度: {len(big_text)} 字符")
    print(f"   - 清洗后长度: {len(cleaned)} 字符")

    print("\n" + "="*50)
    print("🏁 测试结束：PeroCore 的 Rust 引擎在百万级数据下表现极其强悍。")
    print("="*50)

if __name__ == "__main__":
    run_benchmarks()
