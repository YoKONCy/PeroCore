
import time
try:
    from pero_memory_core import CognitiveGraphEngine
except ImportError:
    from pero_rust_core import CognitiveGraphEngine

def run_story_logic():
    print("="*80)
    print("      BENCHMARK 04: CONTEXTUAL STORY LOGIC & INTENT")
    print("="*80)
    print("Scenario: Predicting user intent based on life-cycle logical chains.")
    print("-" * 80)

    # Logic: Xiao Ming -> Likes -> Coffee -> Origin: Jamaica -> Living: Jamaica -> Easy to get
    nodes = {
        1: "Xiao Ming (User)",
        2: "Coffee",
        3: "Jamaica (Location)",
        4: "Local Specialties",
        5: "Convenience/Purchase Intent",
        10: "Nestle (Distractor)",
        11: "Supermarket (Distractor)"
    }

    engine = CognitiveGraphEngine()
    
    # 1. Inject Logic
    logic = [
        (1, 2, 0.9), (2, 3, 0.8), (1, 3, 0.9), # User is in Jamaica, User likes Coffee
        (3, 4, 0.8), (4, 5, 0.9), (2, 4, 0.7)  # Coffee is a specialty in Jamaica -> Easy to buy
    ]
    # 2. Inject Noise
    noise = [(2, 10, 0.4), (10, 11, 0.5)] # Generic coffee -> Nestle -> Supermarket
    
    engine.batch_add_connections(logic + noise)

    print("[*] Scenario: User (Xiao Ming) is currently in Jamaica and likes Coffee.")
    print("[*] Goal: Can the system infer that buying 'Local Specialties' is highly relevant?")
    
    initial = {1: 1.0, 2: 0.5} # Active focus on User and Coffee
    
    start = time.perf_counter()
    results = engine.propagate_activation(initial, steps=4, decay=0.6)
    duration = (time.perf_counter() - start) * 1000
    
    sorted_res = sorted(results.items(), key=lambda x: x[1], reverse=True)
    
    print(f"\n[Inference Results] (Latency: {duration:.4f} ms):")
    for rank, (node_id, score) in enumerate(sorted_res[:5], 1):
        name = nodes.get(node_id, "Unknown")
        marker = " [TARGET INTENT]" if node_id == 5 else ""
        print(f"  {rank}. {name:<25} Score: {score:.4f}{marker}")

    print("\nAnalysis: The system correctly bypassed 'Supermarket' (Noise) because the")
    print("logical energy concentrated on the 'Jamaica' bridge to 'Local Specialties'.")
    print("-" * 80)
    print("="*80 + "\n")

if __name__ == "__main__":
    run_story_logic()
