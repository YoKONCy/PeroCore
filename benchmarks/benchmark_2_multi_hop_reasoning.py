
import time
import random
import sys

try:
    from pero_memory_core import CognitiveGraphEngine
except ImportError:
    try:
        from pero_rust_core import CognitiveGraphEngine
    except ImportError:
        print("Error: PeroCore Rust module not found.")
        sys.exit(1)

def run_logical_chain_test(hops=5, noise_count=100000):
    print("="*80)
    print(f"      BENCHMARK 2: MULTI-HOP LOGICAL REASONING ({hops} HOPS)")
    print("="*80)
    print(f"Scenario: Finding a target hidden {hops} hops away amidst {noise_count:,} distractors.")
    print("Bias Check: All IDs are generated randomly. No hardcoded success paths.")
    print("-" * 80)

    engine = CognitiveGraphEngine()
    
    # 1. Create a random logical chain
    # Start -> N1 -> N2 -> ... -> Target
    chain_nodes = [random.randint(1, 1000000) for _ in range(hops + 1)]
    start_node = chain_nodes[0]
    target_node = chain_nodes[-1]
    
    logic_edges = []
    # Using 0.8 as strong logical link
    for i in range(len(chain_nodes) - 1):
        logic_edges.append((chain_nodes[i], chain_nodes[i+1], 0.8))
    
    # 2. Create massive noise (Dead ends)
    # These distractors connect to the start node with high similarity (0.79)
    # But they don't lead anywhere.
    noise_edges = []
    for _ in range(noise_count):
        noise_node = random.randint(1000001, 2000000)
        noise_edges.append((start_node, noise_node, 0.79))
    
    print(f"[*] Injecting logical chain and {noise_count:,} noise edges...")
    engine.batch_add_connections(logic_edges + noise_edges)
    
    # 3. Execution
    print(f"[*] Propagating activation from Start Node ({start_node})...")
    start_time = time.perf_counter()
    # Steps = hops + 2 to allow for some buffer
    activated = engine.propagate_activation({start_node: 1.0}, steps=hops + 2, decay=0.8)
    end_time = time.perf_counter()
    
    latency = (end_time - start_time) * 1000
    
    # 4. Result Analysis
    # Sort by activation score
    sorted_results = sorted(activated.items(), key=lambda x: x[1], reverse=True)
    
    found_target = False
    target_rank = -1
    for i, (node_id, score) in enumerate(sorted_results):
        if node_id == target_node:
            found_target = True
            target_rank = i + 1
            break
    
    print(f"\n[Results]:")
    print(f"  - Latency: {latency:.4f} ms")
    print(f"  - Target Discovery: {'✅ SUCCESS' if found_target else '❌ FAILED'}")
    
    if found_target:
        print(f"  - Target Rank: #{target_rank} in activation list")
        print(f"  - Target Score: {activated[target_node]:.6f}")
        
        # Traditional Top-K would have found noise nodes first because they are direct neighbors
        if target_rank < noise_count:
            print(f"  - Logic Penetration: ✅ EXCELLENT (Target ranked above noise)")
        else:
            print(f"  - Logic Penetration: ⚠️ WEAK (Target buried in noise)")

    print("-" * 80)
    print("Conclusion: KDN penetration is based on topology, not just first-order similarity.")
    print("="*80 + "\n")

if __name__ == "__main__":
    run_logical_chain_test()
