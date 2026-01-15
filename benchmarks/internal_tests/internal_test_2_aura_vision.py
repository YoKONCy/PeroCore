"""
AuraVision 模型推理性能与准确度测试 (Internal Test 2)

测试内容:
1. 推理延迟 (Latency Benchmark)
2. 向量质量 (Vector Quality)
3. 意图匹配准确度 (搜索性能)
4. 端到端性能
"""

import sys
import os
import time
import statistics
from pathlib import Path

# 添加 backend 目录到路径
BACKEND_DIR = Path(__file__).parent.parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

import numpy as np

# 尝试加载 Rust 模块
try:
    from pero_vision_core import VisionIntentMemoryManager
    RUST_AVAILABLE = True
    print("✅ Rust 模块加载成功")
except ImportError as e:
    print(f"❌ Rust 模块加载失败: {e}")
    RUST_AVAILABLE = False

# 尝试加载 OpenCV
try:
    import cv2
    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False
    print("⚠️ OpenCV 不可用，部分测试将跳过")


class AuraVisionBenchmark:
    """AuraVision 性能测试套件"""
    
    def __init__(self):
        self.model_path = BACKEND_DIR / "models" / "AuraVision" / "weights" / "auravision_v1.onnx"
        self.manager = None
        self.results = {}
        
    def setup(self) -> bool:
        """初始化测试环境"""
        if not RUST_AVAILABLE:
            print("❌ 无法初始化: Rust 模块不可用")
            return False
            
        print(f"\n📁 模型路径: {self.model_path}")
        
        if not self.model_path.exists():
            print(f"⚠️ 模型文件不存在，将使用无模型模式进行基础测试")
            self.manager = VisionIntentMemoryManager(None, 384)
            return True
        
        try:
            print("⏳ 加载模型中...")
            start = time.perf_counter()
            self.manager = VisionIntentMemoryManager(str(self.model_path), 384)
            load_time = (time.perf_counter() - start) * 1000
            print(f"✅ 模型加载成功 (耗时: {load_time:.2f}ms)")
            self.results["model_load_time_ms"] = load_time
            return True
        except Exception as e:
            print(f"❌ 模型加载失败: {e}")
            return False

    def generate_random_pixels(self, seed: int = None) -> list:
        """生成随机测试像素数据 (64x64, 归一化到 [-1, 1])"""
        if seed is not None:
            np.random.seed(seed)
        return np.random.uniform(-1, 1, 64 * 64).astype(np.float32).tolist()

    def generate_edge_like_pixels(self, pattern: str = "horizontal") -> list:
        """生成模拟边缘检测后的像素数据"""
        img = np.zeros((64, 64), dtype=np.float32)
        
        if pattern == "horizontal":
            # 水平线条 (模拟代码编辑器)
            for i in range(0, 64, 8):
                img[i:i+2, :] = 1.0
        elif pattern == "grid":
            # 网格 (模拟宫格布局)
            for i in range(0, 64, 16):
                img[i:i+2, :] = 1.0
                img[:, i:i+2] = 1.0
        elif pattern == "vertical":
            # 垂直线条 (模拟侧边栏)
            for j in range(0, 64, 12):
                img[:, j:j+2] = 1.0
        elif pattern == "dense":
            # 密集纹理 (模拟代码块)
            img = np.random.choice([0.0, 1.0], size=(64, 64), p=[0.7, 0.3]).astype(np.float32)
        else:
            # 随机
            img = np.random.uniform(0, 1, (64, 64)).astype(np.float32)
            
        # 归一化到 [-1, 1]
        pixels = (img - 0.5) / 0.5
        return pixels.flatten().tolist()

    def benchmark_intent_engine(self, num_anchors: int = 100, num_queries: int = 100):
        """测试意图引擎 (IntentEngine) 的搜索性能"""
        print(f"\n{'='*60}")
        print(f"📊 意图引擎搜索性能测试 (锚点数: {num_anchors}, 查询数: {num_queries})")
        print("="*60)
        
        if not self.manager:
            print("❌ 管理器未初始化")
            return
        
        # 1. 添加测试锚点
        print(f"\n⏳ 添加 {num_anchors} 个测试锚点...")
        add_times = []
        for i in range(num_anchors):
            vector = np.random.randn(384).astype(np.float32).tolist()
            start = time.perf_counter()
            self.manager.add_intent_anchor(
                id=i,
                vector=vector,
                description=f"测试锚点 {i}",
                importance=np.random.uniform(0.5, 1.0),
                tags="test"
            )
            add_times.append((time.perf_counter() - start) * 1000)
        
        avg_add_time = statistics.mean(add_times)
        print(f"✅ 锚点添加完成 (平均耗时: {avg_add_time:.4f}ms/个)")
        self.results["anchor_add_avg_ms"] = avg_add_time
        print(f"   总锚点数: {self.manager.anchor_count()}")
        
        # 2. 如果模型已加载，测试完整的推理+搜索链路
        if self.manager.is_model_loaded():
            print(f"\n⏳ 测试完整推理链路 ({num_queries} 次)...")
            
            latencies = []
            for i in range(num_queries):
                pixels = self.generate_edge_like_pixels("horizontal" if i % 2 == 0 else "grid")
                
                start = time.perf_counter()
                result = self.manager.process_visual_input(
                    pixels=pixels,
                    propagation_steps=2,
                    propagation_decay=0.5
                )
                latency = (time.perf_counter() - start) * 1000
                latencies.append(latency)
            
            avg_latency = statistics.mean(latencies)
            p50 = statistics.median(latencies)
            p95 = latencies[int(len(latencies) * 0.95)] if len(latencies) > 20 else max(latencies)
            p99 = latencies[int(len(latencies) * 0.99)] if len(latencies) > 100 else max(latencies)
            
            print(f"\n✅ 完整推理链路性能:")
            print(f"   平均延迟: {avg_latency:.2f}ms")
            print(f"   P50: {p50:.2f}ms")
            print(f"   P95: {p95:.2f}ms")
            print(f"   P99: {p99:.2f}ms")
            
            self.results["full_pipeline_avg_ms"] = avg_latency
            self.results["full_pipeline_p50_ms"] = p50
            self.results["full_pipeline_p95_ms"] = p95
        
        else:
            print("\n⚠️ 模型未加载，跳过推理性能测试")

    def benchmark_vector_quality(self, num_samples: int = 50):
        """测试向量质量 (L2 范数、稳定性)"""
        print(f"\n{'='*60}")
        print(f"📊 向量质量测试 (样本数: {num_samples})")
        print("="*60)
        
        if not self.manager or not self.manager.is_model_loaded():
            print("⚠️ 模型未加载，跳过向量质量测试")
            return
        
        # 测试向量稳定性 (相同输入应产生相同输出)
        print("\n⏳ 测试向量稳定性...")
        pixels_fixed = self.generate_edge_like_pixels("horizontal")
        results = []
        for _ in range(10):
            result = self.manager.search_intent(pixels_fixed, top_k=3)
            results.append(result)
        
        # 检查所有结果是否一致
        all_same = all(r == results[0] for r in results)
        stability = "✅ 稳定" if all_same else "❌ 不稳定"
        print(f"   向量稳定性: {stability}")
        self.results["vector_stability"] = all_same

    def benchmark_preprocessing(self, num_iterations: int = 100):
        """测试预处理性能 (Python 侧)"""
        print(f"\n{'='*60}")
        print(f"📊 预处理性能测试 (迭代次数: {num_iterations})")
        print("="*60)
        
        if not CV2_AVAILABLE:
            print("⚠️ OpenCV 不可用，跳过预处理测试")
            return
        
        # 创建模拟的原始截图 (假设 1920x1080)
        dummy_screenshot = np.random.randint(0, 255, (1080, 1920, 3), dtype=np.uint8)
        
        print(f"\n⏳ 测试预处理延迟 ({num_iterations} 次)...")
        latencies = []
        
        for _ in range(num_iterations):
            start = time.perf_counter()
            
            # 1. 缩放
            img_resized = cv2.resize(dummy_screenshot, (64, 64), interpolation=cv2.INTER_AREA)
            # 2. 灰度化
            img_gray = cv2.cvtColor(img_resized, cv2.COLOR_BGR2GRAY)
            # 3. Canny 边缘检测
            img_edges = cv2.Canny(img_gray, 100, 200)
            # 4. 归一化
            pixels = (img_edges.astype(np.float32) / 255.0 - 0.5) / 0.5
            _ = pixels.flatten().tolist()
            
            latency = (time.perf_counter() - start) * 1000
            latencies.append(latency)
        
        avg_latency = statistics.mean(latencies)
        p50 = statistics.median(latencies)
        
        print(f"\n✅ 预处理性能:")
        print(f"   平均延迟: {avg_latency:.3f}ms")
        print(f"   P50: {p50:.3f}ms")
        
        self.results["preprocess_avg_ms"] = avg_latency
        self.results["preprocess_p50_ms"] = p50

    def benchmark_cold_vs_warm(self, num_warmup: int = 10, num_measure: int = 50):
        """测试冷启动 vs 热启动性能"""
        print(f"\n{'='*60}")
        print(f"📊 冷启动 vs 热启动测试")
        print("="*60)
        
        if not self.manager or not self.manager.is_model_loaded():
            print("⚠️ 模型未加载，跳过此测试")
            return
        
        pixels = self.generate_edge_like_pixels("grid")
        
        # 冷启动 (第一次推理)
        print("\n⏳ 测试冷启动...")
        start = time.perf_counter()
        _ = self.manager.search_intent(pixels, top_k=5)
        cold_latency = (time.perf_counter() - start) * 1000
        print(f"   冷启动延迟: {cold_latency:.2f}ms")
        
        # 预热
        print(f"\n⏳ 预热 ({num_warmup} 次)...")
        for _ in range(num_warmup):
            _ = self.manager.search_intent(pixels, top_k=5)
        
        # 热启动
        print(f"\n⏳ 测试热启动 ({num_measure} 次)...")
        warm_latencies = []
        for _ in range(num_measure):
            start = time.perf_counter()
            _ = self.manager.search_intent(pixels, top_k=5)
            warm_latencies.append((time.perf_counter() - start) * 1000)
        
        avg_warm = statistics.mean(warm_latencies)
        print(f"   热启动平均延迟: {avg_warm:.2f}ms")
        print(f"   加速比: {cold_latency / avg_warm:.2f}x")
        
        self.results["cold_start_ms"] = cold_latency
        self.results["warm_avg_ms"] = avg_warm

    def run_all(self):
        """运行所有测试"""
        print("\n" + "="*60)
        print("🚀 AuraVision 推理性能与准确度测试")
        print("="*60)
        
        if not self.setup():
            print("\n❌ 测试环境初始化失败，退出")
            return
        
        # 运行各项测试
        self.benchmark_preprocessing()
        self.benchmark_intent_engine(num_anchors=100, num_queries=100)
        self.benchmark_vector_quality()
        self.benchmark_cold_vs_warm()
        
        # 汇总结果
        self.print_summary()

    def print_summary(self):
        """打印测试汇总"""
        print("\n" + "="*60)
        print("📋 测试结果汇总")
        print("="*60)
        
        for key, value in self.results.items():
            if isinstance(value, float):
                print(f"   {key}: {value:.4f}")
            else:
                print(f"   {key}: {value}")
        
        # 检查是否达到性能目标
        print("\n" + "-"*60)
        print("🎯 性能目标检查 (目标: <15ms 推理延迟)")
        print("-"*60)
        
        if "full_pipeline_avg_ms" in self.results:
            avg = self.results["full_pipeline_avg_ms"]
            status = "✅ 达标" if avg < 15 else "❌ 未达标"
            print(f"   完整链路平均延迟: {avg:.2f}ms - {status}")
        
        if "preprocess_avg_ms" in self.results:
            avg = self.results["preprocess_avg_ms"]
            status = "✅ 达标" if avg < 5 else "⚠️ 偏慢"
            print(f"   预处理平均延迟: {avg:.3f}ms - {status}")


def main():
    benchmark = AuraVisionBenchmark()
    benchmark.run_all()


if __name__ == "__main__":
    main()
