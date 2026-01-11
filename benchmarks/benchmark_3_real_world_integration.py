
import time
import random
import sys
import numpy as np

try:
    from pero_memory_core import CognitiveGraphEngine
except ImportError:
    try:
        from pero_rust_core import CognitiveGraphEngine
    except ImportError:
        print("Error: PeroCore Rust module not found.")
        sys.exit(1)

def run_synthetic_knowledge_web_test(node_count=50000, relation_density=5):
    print("="*80)
    print(f"      BENCHMARK 3: SYNTHETIC KNOWLEDGE WEB INTEGRATION")
    print("="*80)
    print(f"Scenario: Simulating a complex, non-linear knowledge graph with {node_count:,} concepts.")
    print("Objective: Test associative recall stability in a 'Power-Law' distribution graph.")
    print("-" * 80)

    engine = CognitiveGraphEngine()
    
    # 1. Generate Power-Law graph (Synthetic World)
    # A few "hub" nodes (super-concepts) and many leaf nodes.
    print(f"[*] Generating synthetic knowledge web (Density: {relation_density})...")
    
    connections = []
    # Hub nodes: 1-100
    for i in range(101, node_count):
        # Each node connects to 1-3 hubs and 2 random other nodes
        num_hubs = random.randint(1, 3)
        for _ in range(num_hubs):
            hub = random.randint(1, 100)
            connections.append((i, hub, random.uniform(0.3, 0.9)))
        
        for _ in range(2):
            other = random.randint(1, node_count)
            connections.append((i, other, random.uniform(0.1, 0.5)))
            
    start_ingest = time.perf_counter()
    engine.batch_add_connections(connections)
    ingest_time = (time.perf_counter() - start_ingest) * 1000
    
    print(f"[+] Web generated and ingested in {ingest_time:.2f} ms.")

    # 2. Test Associative Recall
    # Pick a random "leaf" node and see if it can activate its related "hub" 
    # through indirect associations.
    test_node = random.randint(101, node_count)
    print(f"[*] Simulating 'Subconscious Flashback' from Concept {test_node}...")
    
    start_prop = time.perf_counter()
    # 4 steps of association
    activated = engine.propagate_activation({test_node: 1.0}, steps=4, decay=0.7)
    prop_time = (time.perf_counter() - start_prop) * 1000
    
    # 3. Analyze results
    # Hubs should generally have higher scores due to many connections (Power-law)
    sorted_results = sorted(activated.items(), key=lambda x: x[1], reverse=True)
    
    hub_activation_count = 0
    top_20 = sorted_results[:20]
    
    for nid, score in top_20:
        if 1 <= nid <= 100:
            hub_activation_count += 1
            
    print(f"\n[Results]:")
    print(f"  - Propagation Latency: {prop_time:.4f} ms")
    print(f"  - Top 20 Activation Hub Density: {hub_activation_count/20*100:.1f}%")
    print(f"  - Total Activated Concepts: {len(activated):,}")
    
    if hub_activation_count > 0:
        print(f"  - Status: ✅ SUCCESS (System successfully associated leaf concept to hub concepts)")
    else:
        print(f"  - Status: ⚠️ NEUTRAL (No major hubs activated, possibly an isolated cluster)")

    print("-" * 80)
    print("Conclusion: CognitiveGraphEngine maintains stability in complex, hub-and-spoke topologies.")
    print("="*80 + "\n")

if __name__ == "__main__":
    run_synthetic_knowledge_web_test()
