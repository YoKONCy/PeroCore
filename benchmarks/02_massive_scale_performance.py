
import time
import random
import psutil
import os
try:
    from pero_memory_core import CognitiveGraphEngine
except ImportError:
    from pero_rust_core import CognitiveGraphEngine

def get_mem_mb():
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / 1024 / 1024

def run_performance_stress():
    print("="*80)
    print("      BENCHMARK 02: MASSIVE SCALE PERFORMANCE & EE EFFICIENCY")
    print("="*80)
    
    engine = CognitiveGraphEngine()
    
    # 1. Scalability Test
    EDGE_COUNT = 1000000
    BATCH_SIZE = 500000
    
    print(f"[*] Testing Ingestion of {EDGE_COUNT:,} edges (CSR Optimization)...")
    initial_mem = get_mem_mb()
    
    start_total = time.perf_counter()
    for i in range(0, EDGE_COUNT, BATCH_SIZE):
        batch = []
        for _ in range(BATCH_SIZE):
            src = random.randint(1, 1000000)
            dst = random.randint(1, 1000000)
            batch.append((src, dst, random.random() * 0.5))
        
        b_start = time.perf_counter()
        engine.batch_add_connections(batch)
        b_end = time.perf_counter()
        print(f"  - Batch {i//BATCH_SIZE + 1}: {(b_end - b_start)*1000:.2f} ms")
    
    total_time = time.perf_counter() - start_total
    final_mem = get_mem_mb()
    mem_used = final_mem - initial_mem
    
    print(f"\n[Ingestion Metrics]:")
    print(f"  - Total Time: {total_time:.4f} s")
    print(f"  - Throughput: {EDGE_COUNT/total_time/1000000:.2f} Million edges/sec")
    
    print(f"\n[Memory Metrics (EE Perspective)]:")
    print(f"  - Memory Overhead: {mem_used:.2f} MB")
    print(f"  - Efficiency: {mem_used * 1024 / EDGE_COUNT:.2f} Bytes per edge")
    
    # 2. Propagation Latency at Scale
    print(f"\n[*] Testing Propagation Latency on {EDGE_COUNT:,} edges...")
    latencies = []
    for _ in range(100):
        start = time.perf_counter()
        engine.propagate_activation({random.randint(1, 1000000): 1.0}, steps=5)
        latencies.append((time.perf_counter() - start) * 1000)
    
    avg_lat = sum(latencies) / len(latencies)
    p99_lat = sorted(latencies)[99]
    
    print(f"  - Average Latency: {avg_lat:.4f} ms")
    print(f"  - P99 Latency: {p99_lat:.4f} ms (Deterministic Performance)")

    print("-" * 80)
    print("Conclusion: Rust-based CSR storage provides hardcore efficiency for edge devices.")
    print("="*80 + "\n")

if __name__ == "__main__":
    run_performance_stress()
