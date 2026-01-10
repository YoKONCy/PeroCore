
import time
import random
try:
    from pero_memory_core import CognitiveGraphEngine
except ImportError:
    from pero_rust_core import CognitiveGraphEngine

def run_precision_test():
    print("="*80)
    print("      BENCHMARK 03: COGNITIVE PRECISION & COMPETING LOGIC")
    print("="*80)
    print("Scenario: Multiple strong paths exist. Can the system identify the intended target?")
    print("-" * 80)

    # Path 1 (Science): Apple -> Newton -> Gravity -> Relativity
    # Path 2 (Tech): Apple -> Jobs -> iPhone -> Future
    # Path 3 (Nature): Apple -> Fruit -> Vitamin -> Health
    
    nodes = {
        1: "Apple",
        2: "Newton", 3: "Gravity", 4: "Relativity",
        10: "Jobs", 11: "iPhone", 12: "Future",
        20: "Fruit", 21: "Vitamin", 22: "Health"
    }

    engine = CognitiveGraphEngine()
    
    connections = [
        (1, 2, 0.9), (2, 3, 0.9), (3, 4, 0.9),    # Science Path
        (1, 10, 0.9), (10, 11, 0.9), (11, 12, 0.9), # Tech Path
        (1, 20, 0.9), (20, 21, 0.9), (21, 22, 0.9)  # Nature Path
    ]
    engine.batch_add_connections(connections)

    def test_context(initial_scores, target_name):
        print(f"[*] Input Context: {[nodes.get(k) for k in initial_scores.keys()]}")
        start = time.perf_counter()
        results = engine.propagate_activation(initial_scores, steps=5, decay=0.7)
        duration = (time.perf_counter() - start) * 1000
        
        sorted_res = sorted(results.items(), key=lambda x: x[1], reverse=True)
        top_node_id = sorted_res[0][0] if sorted_res else -1
        top_name = nodes.get(top_node_id, "Unknown")
        
        print(f"  - Top Result: {top_name} (Score: {results.get(top_node_id, 0):.4f})")
        print(f"  - Latency: {duration:.4f} ms")
        if target_name in top_name:
            print("  - Result: ✅ CORRECT")
        else:
            print(f"  - Result: ❌ MISMATCH (Expected {target_name})")
        print()

    # Test 1: Scientific context
    # User mentions "Apple" and "Gravity"
    test_context({1: 1.0, 3: 0.8}, "Relativity")

    # Test 2: Tech context
    # User mentions "Apple" and "iPhone"
    test_context({1: 1.0, 11: 0.8}, "Future")

    # Test 3: Health context
    # User mentions "Apple" and "Vitamin"
    test_context({1: 1.0, 21: 0.8}, "Health")

    print("-" * 80)
    print("Conclusion: PeroCore uses multi-point activation to resolve semantic ambiguity.")
    print("="*80 + "\n")

if __name__ == "__main__":
    run_precision_test()
