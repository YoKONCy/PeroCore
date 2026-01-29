import os
import json
import time
from typing import List, Dict, Any, Optional, Tuple
from services.embedding_service import embedding_service

# 尝试导入 Rust 核心
try:
    # 引入 Rust 核心模块 `pero_memory_core`。
    # 该模块实现了定制化的 HNSW 索引，针对增量更新、SIMD 性能优化及嵌入式部署进行了专门设计，
    # 相比 FAISS/Milvus 更适合本项目的轻量级、零依赖需求。
    from pero_memory_core import SemanticVectorIndex
    RUST_AVAILABLE = True
except ImportError:
    RUST_AVAILABLE = False
    # Define dummy class to prevent NameError in type hints
    class SemanticVectorIndex: pass
    print("[VectorStore] ❌ Critical: pero_memory_core not found! Vector search will be disabled.")

class VectorStoreService:
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(VectorStoreService, cls).__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized: return
        
        base_dir = os.environ.get("PERO_DATA_DIR", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        data_dir = os.path.join(base_dir, "data")
        self.data_dir = os.path.join(data_dir, "rust_db")
        if not os.path.exists(self.data_dir):
            os.makedirs(self.data_dir, exist_ok=True)

        # [Multi-Agent Refactor]
        # 不再使用单一的 memory_index_path，而是维护一个 agent_id -> Index 的映射
        self.indices: Dict[str, SemanticVectorIndex] = {}
        
        # Tags 索引目前是全局共享还是隔离？
        # 考虑到 Tags 是对概念的抽象，建议保持全局共享 (Global Concept Space)
        # 或者也进行隔离。为了架构一致性，我们暂且保持 Tags 为全局，因为它们通常是通用的。
        self.tag_index_path = os.path.join(self.data_dir, "tags.index")
        self.tag_map_path = os.path.join(self.data_dir, "tags.json")
        
        self.dimension = 384 
        
        self.tag_index = None
        
        # 标签映射
        self.tag_map: Dict[str, int] = {} 
        self.tag_map_rev: Dict[int, str] = {}
        self.next_tag_id = 1
        
        self._initialized = True
        self._lazy_loaded = False

    def _get_agent_index_path(self, agent_id: str) -> str:
        """获取指定 Agent 的索引文件路径"""
        agent_dir = os.path.join(self.data_dir, "agents", agent_id)
        if not os.path.exists(agent_dir):
            os.makedirs(agent_dir, exist_ok=True)
        return os.path.join(agent_dir, "memory.index")

    def _get_index(self, agent_id: str) -> Optional[SemanticVectorIndex]:
        """获取或加载指定 Agent 的索引实例"""
        if not RUST_AVAILABLE: return None
        
        if agent_id not in self.indices:
            path = self._get_agent_index_path(agent_id)
            if os.path.exists(path):
                try:
                    index = SemanticVectorIndex.load_index(path, self.dimension)
                    self.indices[agent_id] = index
                except Exception as e:
                    print(f"[VectorStore] Failed to load index for {agent_id}: {e}")
                    # Backup and recreate
                    try:
                        import shutil
                        shutil.copy2(path, path + f".bak.{int(time.time())}")
                    except: pass
                    self.indices[agent_id] = SemanticVectorIndex(self.dimension, 10000)
            else:
                self.indices[agent_id] = SemanticVectorIndex(self.dimension, 10000)
        
        return self.indices[agent_id]

    def _ensure_loaded(self):
        if not RUST_AVAILABLE: return
        if self._lazy_loaded: return
        
        # 如果可能，从 embedding service 检测维度
        try:
            dummy_vec = embedding_service.encode_one("test")
            self.dimension = len(dummy_vec)
        except Exception as e:
            print(f"[VectorStore] Failed to detect dimension: {e}. Using default 384.")
            self.dimension = 384

        # 加载标签索引 (全局)
        if os.path.exists(self.tag_index_path):
            try:
                self.tag_index = SemanticVectorIndex.load_index(self.tag_index_path, self.dimension)
            except Exception as e:
                print(f"[VectorStore] Failed to load tag index: {e}.")
                try:
                    import shutil
                    shutil.copy2(self.tag_index_path, self.tag_index_path + f".bak.{int(time.time())}")
                except Exception: pass
                self.tag_index = SemanticVectorIndex(self.dimension, 1000)
        else:
            self.tag_index = SemanticVectorIndex(self.dimension, 1000)

        # 加载标签映射
        if os.path.exists(self.tag_map_path):
            try:
                with open(self.tag_map_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.tag_map = data.get("map", {})
                    self.next_tag_id = data.get("next_id", 1)
                    self.tag_map_rev = {int(v): k for k, v in self.tag_map.items()}
            except Exception as e:
                print(f"[VectorStore] Failed to load tag map: {e}")
        
        # 兼容旧数据迁移: 检查是否存在根目录下的 memory.index (属于 Pero)
        # 如果存在，将其移动到 agents/pero/memory.index
        legacy_path = os.path.join(self.data_dir, "memory.index")
        if os.path.exists(legacy_path):
            print("[VectorStore] Detected legacy index. Migrating to 'pero' agent namespace...")
            pero_path = self._get_agent_index_path("pero")
            if not os.path.exists(pero_path):
                try:
                    import shutil
                    shutil.move(legacy_path, pero_path)
                    print("[VectorStore] Migration successful.")
                except Exception as e:
                    print(f"[VectorStore] Migration failed: {e}")

        self._lazy_loaded = True

    def save(self):
        if not RUST_AVAILABLE or not self._lazy_loaded: return
        try:
            # Save all loaded agent indices
            for agent_id, index in self.indices.items():
                path = self._get_agent_index_path(agent_id)
                temp_path = path + ".tmp"
                index.persist_index(temp_path)
                if os.path.exists(path):
                    os.replace(temp_path, path)
                else:
                    os.rename(temp_path, path)

            # Atomic save for tag index
            temp_tag_path = self.tag_index_path + ".tmp"
            self.tag_index.persist_index(temp_tag_path)
            if os.path.exists(self.tag_index_path):
                os.replace(temp_tag_path, self.tag_index_path)
            else:
                os.rename(temp_tag_path, self.tag_index_path)
            
            # Atomic save for tag map
            temp_map_path = self.tag_map_path + ".tmp"
            with open(temp_map_path, 'w', encoding='utf-8') as f:
                json.dump({
                    "map": self.tag_map,
                    "next_id": self.next_tag_id
                }, f, ensure_ascii=False, indent=2)
            if os.path.exists(self.tag_map_path):
                os.replace(temp_map_path, self.tag_map_path)
            else:
                os.rename(temp_map_path, self.tag_map_path)
        except Exception as e:
            print(f"[VectorStore] Save failed: {e}")

    # --- Memory Operations ---

    def add_memory(self, memory_id: int, embedding: List[float], metadata: Dict[str, Any] = None):
        """
        添加记忆向量
        :param metadata: 必须包含 agent_id
        """
        self._ensure_loaded()
        
        agent_id = "pero"
        if metadata and "agent_id" in metadata:
            agent_id = metadata["agent_id"]
            
        index = self._get_index(agent_id)
        if not index: return
        
        try:
            index.insert_vector(memory_id, embedding)
            self.save() # TODO: Optimize save frequency
        except Exception as e:
            print(f"[VectorStore] Add memory failed for {agent_id}: {e}")

    def add_memories_batch(self, ids: List[int], embeddings: List[List[float]], agent_id: str = "pero"):
        """批量添加记忆"""
        self._ensure_loaded()
        index = self._get_index(agent_id)
        if not index: return
        
        try:
            index.batch_insert_vectors(ids, embeddings)
            self.save()
        except Exception as e:
            print(f"[VectorStore] Batch add failed for {agent_id}: {e}")

    def search_memory(self, query_vector: List[float], limit: int = 10, agent_id: str = "pero") -> List[Dict]:
        """
        搜索记忆
        :param agent_id: 指定 Agent ID 进行隔离搜索
        """
        self._ensure_loaded()
        index = self._get_index(agent_id)
        if not index: return []
        
        try:
            results = index.search_similar_vectors(query_vector, limit)
            # results format: [(id, score), ...]
            return [{"id": int(r[0]), "score": float(r[1])} for r in results]
        except Exception as e:
            print(f"[VectorStore] Search failed for {agent_id}: {e}")
            return []

    def count_memories(self, agent_id: str = "pero") -> int:
        self._ensure_loaded()
        index = self._get_index(agent_id)
        if not index: return 0
        return index.size()

    # --- Tag Operations ---

    def add_tag(self, tag_name: str, embedding: List[float]):
        self._ensure_loaded()
        if not self.tag_index: return
        
        tag_name = tag_name.strip()
        if not tag_name: return
        
        if tag_name in self.tag_map:
            # 已存在，也许更新向量？
            tid = self.tag_map[tag_name]
            # self.tag_index.add(tid, embedding) # 更新
        else:
            tid = self.next_tag_id
            self.next_tag_id += 1
            self.tag_map[tag_name] = tid
            self.tag_map_rev[tid] = tag_name
            try:
                self.tag_index.insert_vector(tid, embedding)
                self.save()
            except Exception as e:
                print(f"[VectorStore] Add tag failed: {e}")

    def search_tags(self, query_vec: List[float], limit: int = 5) -> List[Dict]:
        self._ensure_loaded()
        if not self.tag_index: return []
        
        try:
            results = self.tag_index.search_similar_vectors(query_vec, limit)
            output = []
            for tid, score in results:
                tag_name = self.tag_map_rev.get(tid, f"Unknown_{tid}")
                # Rust core returns cosine similarity directly
                output.append({
                    "tag": tag_name,
                    "score": max(0.0, float(score))
                })
            return output
        except Exception as e:
            print(f"[VectorStore] Search tags failed: {e}")
            return []

vector_store = VectorStoreService()
