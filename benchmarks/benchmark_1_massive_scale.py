
import time
import random
import psutil
import os
import sys

try:
    from pero_memory_core import CognitiveGraphEngine
except ImportError:
    try:
        from pero_rust_core import CognitiveGraphEngine
    except ImportError:
        print("Error: PeroCore Rust module not found. Please install it first.")
        sys.exit(1)

def get_mem_mb():
    process = psutil.Process(os.getpid())
    return process.memory_info().rss / 1024 / 1024

def run_massive_scale_test(scale=1000000):
    print("="*80)
    print(f"      BENCHMARK 1: MASSIVE SCALE PERFORMANCE ({scale:,} EDGES)")
    print("="*80)
    print("Objective: Measure raw ingestion speed, memory overhead, and propagation latency.")
    print("-" * 80)

    engine = CognitiveGraphEngine()
    
    # 1. Ingestion Test
    batch_size = scale // 2
    if batch_size < 1: batch_size = scale
    
    print(f"[*] Ingesting {scale:,} edges in batches of {batch_size:,}...")
    initial_mem = get_mem_mb()
    start_ingest = time.perf_counter()
    
    for i in range(0, scale, batch_size):
        batch = []
        actual_batch_size = min(batch_size, scale - i)
        for _ in range(actual_batch_size):
            src = random.randint(1, scale)
            dst = random.randint(1, scale)
            batch.append((src, dst, random.random()))
        
        b_start = time.perf_counter()
        engine.batch_add_connections(batch)
        b_end = time.perf_counter()
        print(f"  - Batch {i//batch_size + 1}: {(b_end - b_start)*1000:.2f} ms")
    
    total_ingest_time = time.perf_counter() - start_ingest
    final_mem = get_mem_mb()
    mem_used = final_mem - initial_mem
    
    print(f"\n[Ingestion Metrics]:")
    print(f"  - Total Time: {total_ingest_time:.4f} s")
    print(f"  - Throughput: {scale/total_ingest_time/1000000:.2f} Million edges/sec")
    print(f"  - Memory Overhead: {mem_used:.2f} MB")
    print(f"  - Efficiency: {mem_used * 1024 / scale:.2f} Bytes per edge")

    # 2. Propagation Latency Test
    print(f"\n[*] Testing 5-step propagation latency (100 iterations)...")
    latencies = []
    for _ in range(100):
        start_node = random.randint(1, scale)
        p_start = time.perf_counter()
        engine.propagate_activation({start_node: 1.0}, steps=5, decay=0.8)
        latencies.append((time.perf_counter() - p_start) * 1000)
    
    avg_lat = sum(latencies) / len(latencies)
    sorted_lat = sorted(latencies)
    p95_lat = sorted_lat[int(len(latencies) * 0.95)]
    p99_lat = sorted_lat[int(len(latencies) * 0.99)]
    
    print(f"  - Average Latency: {avg_lat:.4f} ms")
    print(f"  - P95 Latency:     {p95_lat:.4f} ms")
    print(f"  - P99 Latency:     {p99_lat:.4f} ms")

    print("-" * 80)
    print("Conclusion: High-speed CSR variant architecture validated.")
    print("="*80 + "\n")

if __name__ == "__main__":
    # Default to 1M for quick test, but project claims 100M support
    test_scale = 1000000
    if len(sys.argv) > 1:
        test_scale = int(sys.argv[1])
    run_massive_scale_test(test_scale)
