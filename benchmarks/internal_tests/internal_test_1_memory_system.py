
import sys
import os
import time
import random
import asyncio
import numpy as np
from datetime import datetime, timedelta
from typing import List, Dict, Tuple, Optional

# Add paths for both backend and local imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
sys.path.insert(0, BACKEND_DIR)

# --- Imports and Mocking ---
try:
    from pero_memory_core import CognitiveGraphEngine
    RUST_AVAILABLE = True
except ImportError:
    RUST_AVAILABLE = False
    print("⚠️ PeroCore Rust engine not found. Using fallback mock.")

# Mocking parts of the backend for standalone logic testing
class MockEmbeddingService:
    def __init__(self, dim=384):
        self.dim = dim
    def encode_one(self, text: str) -> List[float]:
        return [random.random() for _ in range(self.dim)]
    def rerank(self, query: str, docs: List[str]) -> List[dict]:
        return [{"index": i, "score": random.random()} for i in range(len(docs))]

# --- 1. Life Simulator (from ultimate test) ---
class LifeSimulator:
    def __init__(self):
        self.themes = {
            "Work": ["Fixed a bug", "Meeting", "Rust programming", "Documentation"],
            "Life": ["Moved house", "Cooked dinner", "Sick flu", "Grocery shopping"],
            "Hobby": ["Played games", "Photography", "Guitar", "Hiking"],
            "Emotion": ["Anxious", "Happy", "Lonely", "Excited"]
        }
        
    def generate_data(self, count: int) -> List[dict]:
        data = []
        for i in range(count):
            theme = random.choice(list(self.themes.keys()))
            content = f"{random.choice(self.themes[theme])} (Event {i})"
            data.append({"id": i, "content": content, "theme": theme})
        return data

# --- 2. Memory System Internal Test Suite ---
class MemorySystemTest:
    def __init__(self):
        self.engine = CognitiveGraphEngine() if RUST_AVAILABLE else None
        self.simulator = LifeSimulator()
        
    async def run_logic_validation(self):
        """Validates the scoring and association logic (from service_logic test)"""
        print("\n[Phase 1] Logic Validation (Scoring & Multi-hop)")
        print("-" * 60)
        
        if not RUST_AVAILABLE:
            print("Skipping logic validation (Rust engine missing)")
            return

        # Setup a specific logic chain
        # A (Old, Important) -> B (New, Low Importance)
        # We want to see if B can activate A even if A is old.
        nodes = [
            (1, 2, 0.9), # Strong link
            (2, 3, 0.8), # Chain
        ]
        self.engine.batch_add_connections(nodes)
        
        # Test propagation
        results = self.engine.propagate_activation({1: 1.0}, steps=3, decay=0.8)
        
        print(f"   Node 1 (Source) score: {results.get(1, 0):.4f}")
        print(f"   Node 3 (2-hop target) score: {results.get(3, 0):.4f}")
        
        if results.get(3, 0) > 0:
            print("   ✅ Logic Chain Discovery: SUCCESS")
        else:
            print("   ❌ Logic Chain Discovery: FAILED")

    async def run_stress_simulation(self, scale=1000):
        """Runs a large scale life simulation (from ultimate test)"""
        print(f"\n[Phase 2] Stress Simulation ({scale} memories)")
        print("-" * 60)
        
        if not RUST_AVAILABLE: return

        data = self.simulator.generate_data(scale)
        
        print(f"   Injecting {scale} random memories and cross-theme relations...")
        start_time = time.perf_counter()
        
        # Create random relations within and between themes
        relations = []
        for i in range(scale):
            # Same theme relation
            target = random.randint(0, scale - 1)
            relations.append((i, target, random.uniform(0.5, 0.9)))
            # Random jump
            if i % 10 == 0:
                jump_target = random.randint(0, scale - 1)
                relations.append((i, jump_target, 0.4))
        
        self.engine.batch_add_connections(relations)
        ingest_time = (time.perf_counter() - start_time) * 1000
        print(f"   ✅ Ingestion completed in {ingest_time:.2f}ms")

        # Test mass activation
        print(f"   Simulating massive associative recall...")
        start_prop = time.perf_counter()
        active_results = self.engine.propagate_activation({random.randint(0, scale-1): 1.0}, steps=5)
        prop_time = (time.perf_counter() - start_prop) * 1000
        
        print(f"   ✅ Recall completed in {prop_time:.2f}ms")
        print(f"   Total nodes activated: {len(active_results)}")

    async def run_story_context_test(self):
        """Validates story context and logical jumps (from hardcore test)"""
        print("\n[Phase 3] Story Context & Logical Jumps")
        print("-" * 60)
        
        if not RUST_AVAILABLE: return

        # "The Beach Trip" scenario
        # 1: Buying tickets -> 2: Packing -> 3: Airport -> 4: Beach -> 5: Sunburn
        story = [
            (1, 2, 0.8), (2, 3, 0.8), (3, 4, 0.9), (4, 5, 0.7)
        ]
        # Noise that looks like 'Beach' but isn't part of the trip
        noise = [(100, 101, 0.8) for _ in range(500)] 
        
        self.engine.batch_add_connections(story + noise)
        
        print("   Triggering recall from 'Buying tickets'...")
        results = self.engine.propagate_activation({1: 1.0}, steps=5, decay=0.9)
        
        # Check if we reached 'Sunburn' (4 hops away)
        sunburn_score = results.get(5, 0)
        print(f"   'Sunburn' activation score: {sunburn_score:.4f}")
        
        if sunburn_score > 0.1:
            print("   ✅ Long-range story link preserved: SUCCESS")
        else:
            print("   ❌ Long-range story link lost: FAILED")

async def main():
    print("=" * 60)
    print("   PEROCORE INTERNAL SYSTEM TEST (CONSOLIDATED)")
    print("=" * 60)
    
    suite = MemorySystemTest()
    await suite.run_logic_validation()
    await suite.run_stress_simulation(2000)
    await suite.run_story_context_test()
    
    print("\n" + "=" * 60)
    print("   INTERNAL TESTING COMPLETED")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(main())
