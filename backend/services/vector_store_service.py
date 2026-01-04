import os
import json
import time
from typing import List, Dict, Any, Optional, Tuple
from services.embedding_service import embedding_service

# 尝试导入 Rust 核心
try:
    from pero_rust_core import VectorIndex
    RUST_AVAILABLE = True
except ImportError:
    RUST_AVAILABLE = False
    print("[VectorStore] ❌ Critical: pero_rust_core not found! Vector search will be disabled.")

class VectorStoreService:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(VectorStoreService, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized: return
        
        self.data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "rust_db")
        if not os.path.exists(self.data_dir):
            os.makedirs(self.data_dir)

        self.memory_index_path = os.path.join(self.data_dir, "memory.index")
        self.tag_index_path = os.path.join(self.data_dir, "tags.index")
        self.tag_map_path = os.path.join(self.data_dir, "tags.json")
        
        self.dimension = 384 # Default for text-embedding-ada-002 is 1536, but local models usually 384/768. 
                             # TODO: Should detect from embedding service.
                             # For now, assume 384 (MiniLM) or 1024 (BGE). 
                             # Let's try to detect or lazy init.
        
        self.memory_index = None
        self.tag_index = None
        
        # Tag Mapping
        self.tag_map: Dict[str, int] = {} 
        self.tag_map_rev: Dict[int, str] = {}
        self.next_tag_id = 1
        
        self._initialized = True
        self._lazy_loaded = False

    def _ensure_loaded(self):
        if not RUST_AVAILABLE: return
        if self._lazy_loaded: return
        
        # Detect dimension from embedding service if possible
        # We'll do a dummy encode to check dimension
        try:
            dummy_vec = embedding_service.encode_one("test")
            self.dimension = len(dummy_vec)
            # print(f"[VectorStore] Detected embedding dimension: {self.dimension}")
        except Exception as e:
            print(f"[VectorStore] Failed to detect dimension: {e}. Using default 384.")
            self.dimension = 384

        # Load Memory Index
        if os.path.exists(self.memory_index_path):
            try:
                self.memory_index = VectorIndex.load(self.memory_index_path, self.dimension)
                # print(f"[VectorStore] Memory index loaded. Size: {self.memory_index.size()}")
            except Exception as e:
                print(f"[VectorStore] Failed to load memory index: {e}. Creating new.")
                self.memory_index = VectorIndex(self.dimension, 10000)
        else:
            self.memory_index = VectorIndex(self.dimension, 10000)

        # Load Tag Index
        if os.path.exists(self.tag_index_path):
            try:
                self.tag_index = VectorIndex.load(self.tag_index_path, self.dimension)
            except Exception as e:
                print(f"[VectorStore] Failed to load tag index: {e}. Creating new.")
                self.tag_index = VectorIndex(self.dimension, 1000)
        else:
            self.tag_index = VectorIndex(self.dimension, 1000)

        # Load Tag Map
        if os.path.exists(self.tag_map_path):
            try:
                with open(self.tag_map_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.tag_map = data.get("map", {})
                    self.next_tag_id = data.get("next_id", 1)
                    self.tag_map_rev = {int(v): k for k, v in self.tag_map.items()}
            except Exception as e:
                print(f"[VectorStore] Failed to load tag map: {e}")
        
        self._lazy_loaded = True

    def save(self):
        if not RUST_AVAILABLE or not self._lazy_loaded: return
        try:
            self.memory_index.save(self.memory_index_path)
            self.tag_index.save(self.tag_index_path)
            
            with open(self.tag_map_path, 'w', encoding='utf-8') as f:
                json.dump({
                    "map": self.tag_map,
                    "next_id": self.next_tag_id
                }, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[VectorStore] Save failed: {e}")

    # --- Memory Operations ---

    def add_memory(self, memory_id: int, embedding: List[float]):
        """添加记忆向量"""
        self._ensure_loaded()
        if not self.memory_index: return
        
        try:
            self.memory_index.add(memory_id, embedding)
            # Auto-save is expensive if done every time, but safe. 
            # Given Rust save is atomic and fast for small files, we can do it.
            # Or rely on periodic save / application exit save.
            # For now, let's just save.
            self.save()
        except Exception as e:
            print(f"[VectorStore] Add memory failed: {e}")

    def add_memories_batch(self, ids: List[int], embeddings: List[List[float]]):
        """批量添加记忆 (Migration optimized)"""
        self._ensure_loaded()
        if not self.memory_index: return
        
        try:
            # Rust supports batch add
            self.memory_index.add_batch(ids, embeddings)
            self.save()
        except Exception as e:
            print(f"[VectorStore] Batch add failed: {e}")

    def search_memory(self, query_vec: List[float], limit: int = 10) -> List[Dict]:
        """
        Search memory
        Returns: [{"id": int, "score": float}, ...]
        """
        self._ensure_loaded()
        if not self.memory_index: return []
        
        try:
            # Rust returns [(id, dist), ...]
            results = self.memory_index.search(query_vec, limit)
            
            output = []
            for mid, dist in results:
                # Convert L2 distance to similarity score (approx)
                # Since we use Cosine/L2sq. If vectors are normalized, L2 = 2(1-cos).
                # Sim = 1 - dist/2 ? Or just use 1/(1+dist).
                # Assuming standard usearch metric.
                # Let's just return score = 1.0 - dist (clamped to 0) if it's cosine distance
                # But L2sq can be > 1.
                # Let's assume normalized vectors.
                sim = 1.0 - (dist / 2.0) # Approx for normalized L2
                output.append({
                    "id": mid,
                    "score": max(0.0, sim),
                    "dist": dist
                })
            return output
        except Exception as e:
            print(f"[VectorStore] Search failed: {e}")
            return []
            
    def count_memories(self) -> int:
        self._ensure_loaded()
        if not self.memory_index: return 0
        return self.memory_index.size()

    # --- Tag Operations ---

    def add_tag(self, tag_name: str, embedding: List[float]):
        self._ensure_loaded()
        if not self.tag_index: return
        
        tag_name = tag_name.strip()
        if not tag_name: return
        
        if tag_name in self.tag_map:
            # Already exists, maybe update vector?
            tid = self.tag_map[tag_name]
            # self.tag_index.add(tid, embedding) # Update
        else:
            tid = self.next_tag_id
            self.next_tag_id += 1
            self.tag_map[tag_name] = tid
            self.tag_map_rev[tid] = tag_name
            try:
                self.tag_index.add(tid, embedding)
                self.save()
            except Exception as e:
                print(f"[VectorStore] Add tag failed: {e}")

    def search_tags(self, query_vec: List[float], limit: int = 5) -> List[Dict]:
        self._ensure_loaded()
        if not self.tag_index: return []
        
        try:
            results = self.tag_index.search(query_vec, limit)
            output = []
            for tid, dist in results:
                tag_name = self.tag_map_rev.get(tid, f"Unknown_{tid}")
                sim = 1.0 - (dist / 2.0)
                output.append({
                    "tag": tag_name,
                    "score": max(0.0, sim)
                })
            return output
        except Exception as e:
            print(f"[VectorStore] Search tags failed: {e}")
            return []

vector_store = VectorStoreService()
