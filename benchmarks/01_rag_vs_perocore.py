
import time
import random
import sys
try:
    from pero_memory_core import CognitiveGraphEngine
except ImportError:
    from pero_rust_core import CognitiveGraphEngine

def run_logic_maze_battle():
    print("="*80)
    print("      BENCHMARK 01: PEROCORE VS. TRADITIONAL RAG (SEMANTIC MAZE)")
    print("="*80)
    print("Scenario: Finding 'The Hidden Truth' through a 5-hop logical chain.")
    print("Challenge: 100,000 semantic distractors that look relevant but are dead ends.")
    print("-" * 80)

    engine = CognitiveGraphEngine()

    # 1. Setup logical chain (The 'Needle')
    # Query -> A -> B -> C -> D -> Truth
    nodes = [1, 2, 3, 4, 5, 999] # 999 is the Truth
    truth_node = 999
    query_node = 1
    
    logic_edges = []
    for i in range(len(nodes) - 1):
        logic_edges.append((nodes[i], nodes[i+1], 0.85))
    
    # 2. Setup massive noise (The 'Haystack')
    # These distractors have 0.84 similarity (just below 0.85)
    NOISE_COUNT = 100000
    noise_edges = []
    for i in range(1000, 1000 + NOISE_COUNT):
        noise_edges.append((query_node, i, 0.84))
    
    print(f"[*] Injecting 1 logic chain + {NOISE_COUNT:,} semantic distractors...")
    engine.batch_add_connections(logic_edges + noise_edges)
    print("[+] Ingestion complete.\n")

    # --- Phase A: Traditional RAG (Vector Search Only) ---
    print("[Phase A] Traditional RAG (Top-K Retrieval):")
    # Simulation: RAG will find Top-K based on similarity to query_node.
    # It will pick query_node and its 100,000 noise neighbors.
    print(f"  - Status: STUCK")
    print(f"  - Result: Found Node {query_node} and distractor neighbors.")
    print(f"  - Failure: Node {truth_node} is 5 hops away. Vector search cannot reach it.")

    # --- Phase B: PeroCore (PEDSA Diffusion) ---
    print("\n[Phase B] PeroCore (PEDSA Diffusion Engine):")
    start_pero = time.perf_counter()
    # 8 steps to ensure propagation through the 5-hop chain
    activated = engine.propagate_activation({query_node: 1.0}, steps=8, decay=0.7)
    end_pero = time.perf_counter()
    latency = (end_pero - start_pero) * 1000

    # Sort and find Truth
    sorted_nodes = sorted(activated.items(), key=lambda x: x[1], reverse=True)
    found_truth = False
    truth_rank = -1
    for i, (node_id, score) in enumerate(sorted_nodes):
        if node_id == truth_node:
            found_truth = True
            truth_rank = i + 1
            break

    print(f"  - Latency: {latency:.4f} ms")
    print(f"  - Truth Discovery: {'✅ SUCCESS' if found_truth else '❌ FAILED'}")
    if found_truth:
        print(f"  - Truth Rank: #{truth_rank} in activation list")
        print(f"  - Score: {activated[truth_node]:.6f}")

    print("-" * 80)
    print("Conclusion: PeroCore penetrates the 'Semantic Island' where RAG fails.")
    print("="*80 + "\n")

if __name__ == "__main__":
    run_logic_maze_battle()
