import os
from typing import List, Dict, Any
from services.vector_store_service import vector_store

class VectorService:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(VectorService, cls).__new__(cls)
        return cls._instance

    # --- Memory Operations ---

    def add_memory(self, memory_id: int, content: str, embedding: List[float], metadata: Dict[str, Any] = None):
        """
        添加或更新记忆向量
        Note: Metadata and Content are NO LONGER stored in VectorDB (Rust).
        They are stored in SQLite managed by MemoryService.
        """
        if not embedding: return
        vector_store.add_memory(memory_id, embedding)

    def delete_memory(self, memory_id: int):
        """删除记忆向量"""
        # Rust index currently doesn't support delete easily (HNSW append-only optimized).
        # We can implement a tombstone list or rebuild index.
        # For now, we ignore delete or TODO: implement delete in Rust core.
        print(f"[VectorService] Warning: delete_memory not fully implemented for Rust index yet.")
        pass

    def search(self, query_embedding: List[float], limit: int = 10, filter_criteria: Dict = None) -> List[Dict]:
        """
        向量检索
        返回: [{"id": int, "score": float}]
        注意：不再返回 "document" 和 "metadata"，调用者需要回查数据库。
        """
        if filter_criteria:
            print(f"[VectorService] Warning: 'filter_criteria' is NOT supported in Rust Vector Search. Ignored.")
        
        return vector_store.search_memory(query_embedding, limit)

    def query_memories(self, limit: int = 10, filter_criteria: Dict = None) -> List[Dict]:
        """
        DEPRECATED: Use MemoryService.get_memories_by_filter instead.
        """
        print("[VectorService] Error: query_memories is deprecated. Please use MemoryService.")
        return []

    def count(self) -> int:
        return vector_store.count_memories()

    def get_all_ids(self) -> List[int]:
        # Not easily supported by HNSW without iteration
        return []

    # --- Tag Operations ---

    def add_tag(self, tag_name: str, embedding: List[float]):
        vector_store.add_tag(tag_name, embedding)

    def search_tags(self, query_embedding: List[float], limit: int = 5) -> List[Dict]:
        return vector_store.search_tags(query_embedding, limit)

vector_service = VectorService()
