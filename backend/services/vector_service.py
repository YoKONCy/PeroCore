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
        注意：元数据和内容不再存储在 VectorDB (Rust) 中。
        它们存储在由 MemoryService 管理的 SQLite 中。
        """
        if not embedding: return
        vector_store.add_memory(memory_id, embedding, metadata)

    def delete_memory(self, memory_id: int):
        """删除记忆向量"""
        # Rust 索引目前不容易支持删除 (HNSW 针对仅追加进行了优化)。
        # 我们可以实现一个墓碑列表或重建索引。
        # 目前，我们忽略删除或 TODO: 在 Rust 核心中实现删除。
        print(f"[VectorService] 警告: delete_memory 在 Rust 索引中尚未完全实现。")
        pass

    def search(self, query_embedding: List[float], limit: int = 10, filter_criteria: Dict = None, agent_id: str = "pero") -> List[Dict]:
        """
        向量检索
        返回: [{"id": int, "score": float}]
        注意：不再返回 "document" 和 "metadata"，调用者需要回查数据库。
        """
        if filter_criteria:
            print(f"[VectorService] 警告: 'filter_criteria' 在 Rust 向量搜索中不受支持。已忽略。")
        
        return vector_store.search_memory(query_embedding, limit, agent_id)

    def query_memories(self, limit: int = 10, filter_criteria: Dict = None) -> List[Dict]:
        """
        DEPRECATED: Use MemoryService.get_memories_by_filter instead.
        """
        print("[VectorService] 错误: query_memories 已弃用。请使用 MemoryService。")
        return []

    def count(self) -> int:
        return vector_store.count_memories()

    def get_all_ids(self) -> List[int]:
        # HNSW 不容易支持（如果不进行遍历）
        return []

    # --- Tag Operations ---

    def add_tag(self, tag_name: str, embedding: List[float]):
        vector_store.add_tag(tag_name, embedding)

    def search_tags(self, query_embedding: List[float], limit: int = 5) -> List[Dict]:
        return vector_store.search_tags(query_embedding, limit)

vector_service = VectorService()
