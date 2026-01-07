import time
import random
import numpy as np
from typing import List

# 模拟 N.E.K.O 的检索逻辑 (向量检索 + LLM Rerank)
class NEKOSimulator:
    def __init__(self, size):
        # 模拟百万级向量数据 (128 维)
        self.size = size
        self.vectors = np.random.rand(size, 128).astype(np.float32)
        print(f"✅ N.E.K.O 模拟器已初始化 {size} 条向量数据")

    def search(self, query_vec, k=10):
        # 1. 模拟向量相似度计算 (这是最耗时的部分)
        # 即使使用高效的 FAISS，百万级数据通常也需要几毫秒到几十毫秒
        start = time.perf_counter()
        similarities = np.dot(self.vectors, query_vec)
        top_indices = np.argsort(similarities)[-k:]
        search_time = (time.perf_counter() - start) * 1000
        
        # 2. 模拟 LLM Rerank 耗时
        # N.E.K.O 会调用 LLM 进行重排，这涉及到网络 IO 和模型推理
        # 我们这里保守估计一个极速响应为 500ms
        rerank_time = 500.0 
        
        return search_time, rerank_time

# 模拟 PeroCore 的 Rust 引擎
class PeroCoreSimulator:
    def __init__(self):
        try:
            from pero_rust_core import CognitiveGraphEngine
            self.engine = CognitiveGraphEngine()
            self.engine.configure(max_active_nodes=100000, max_fan_out=50)
            print("✅ PeroCore Rust 引擎已就绪")
        except ImportError:
            self.engine = None

    def benchmark(self, size):
        if not self.engine: return None
        # 注入数据
        connections = [(random.randint(1, size), random.randint(1, size), random.random()) for _ in range(size * 2)]
        self.engine.batch_add_connections(connections)
        
        # 测试检索
        initial_scores = {random.randint(1, size): 1.0 for _ in range(5)}
        latencies = []
        for _ in range(5):
            start = time.perf_counter()
            self.engine.propagate_activation(initial_scores, steps=5, decay=0.5, min_threshold=0.01)
            latencies.append((time.perf_counter() - start) * 1000)
        return sum(latencies) / len(latencies)

def run_comparison():
    print("\n" + "="*60)
    print("🏁 跨项目技术深度对比测试：N.E.K.O (模拟) vs PeroCore (实测)")
    print("="*60)

    SIZE = 1000000 # 百万级
    
    # 1. N.E.K.O 性能分析
    neko = NEKOSimulator(SIZE)
    query_vec = np.random.rand(128).astype(np.float32)
    search_ms, rerank_ms = neko.search(query_vec)
    
    print(f"\n[N.E.K.O 方案预测结果]:")
    print(f"   - 向量检索耗时: {search_ms:.2f} ms")
    print(f"   - LLM Rerank 耗时: {rerank_ms:.2f} ms (核心瓶颈)")
    print(f"   - 总计延迟: {search_ms + rerank_ms:.2f} ms")

    # 2. PeroCore 性能分析
    pero = PeroCoreSimulator()
    pero_ms = pero.benchmark(SIZE)
    
    print(f"\n[PeroCore 方案实测结果]:")
    if pero_ms:
        print(f"   - Rust 引擎联想检索耗时: {pero_ms:.2f} ms")
        print(f"   - 总计延迟: {pero_ms:.2f} ms")
    else:
        print("   - PeroCore 引擎不可用")

    print("\n" + "="*60)
    print("📊 锐评结论：")
    if pero_ms:
        speedup = (search_ms + rerank_ms) / pero_ms
        print(f"   PeroCore 的手搓引擎比 N.E.K.O 的标准方案快了约 {speedup:.0f} 倍！")
        print("   原因：N.E.K.O 依赖外部模型进行重排(Rerank)，这在交互中会产生明显的‘断点’。")
        print("   而 PeroCore 将联想逻辑下沉到 Rust 侧，实现了‘神经级’的闪电响应。")
    print("="*60)

if __name__ == "__main__":
    run_comparison()
