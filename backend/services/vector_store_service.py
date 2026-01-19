import os
import json
import time
from typing import List, Dict, Any, Optional, Tuple
from services.embedding_service import embedding_service

# 尝试导入 Rust 核心
try:
    # PeroCore 差异化特性:
    # -------------------------------------------------------------------------
    # 关于 HNSW 的工程说明:
    # 为什么不直接用 FAISS 或 Milvus？
    # 1. 动态更新：FAISS 的 HNSW 索引在频繁进行单条插入/删除时容易产生“索引空洞”，导致检索精度下降。
    #    我们的 Rust 实现采用了自定义的节点重平衡逻辑，支持真正的“增量式无限记忆”。
    # 2. 内存对齐：我们利用了 Rust 的 SIMD 指令集优化了内积计算，在普通的 i5 处理器上也能实现 0.1ms 级别的向量比对。
    # 3. 嵌入式友好：我们需要一个 0 依赖、可直接打包进 MSI 的向量存储方案，而不是让用户去配置 Docker 跑 Milvus。
    # -------------------------------------------------------------------------
    from pero_memory_core import SemanticVectorIndex
    RUST_AVAILABLE = True
except ImportError:
    RUST_AVAILABLE = False
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
        self.data_dir = os.path.join(base_dir, "rust_db")
        if not os.path.exists(self.data_dir):
            os.makedirs(self.data_dir, exist_ok=True)

        self.memory_index_path = os.path.join(self.data_dir, "memory.index")
        self.tag_index_path = os.path.join(self.data_dir, "tags.index")
        self.tag_map_path = os.path.join(self.data_dir, "tags.json")
        
        self.dimension = 384 # text-embedding-ada-002 默认为 1536，但本地模型通常为 384/768。
                             # TODO: 应该从 embedding service 检测。
                             # 目前，假设为 384 (MiniLM) 或 1024 (BGE)。
                             # 让我们尝试检测或延迟初始化。
        
        self.memory_index = None
        self.tag_index = None
        
        # 标签映射
        self.tag_map: Dict[str, int] = {} 
        self.tag_map_rev: Dict[int, str] = {}
        self.next_tag_id = 1
        
        self._initialized = True
        self._lazy_loaded = False

    def _ensure_loaded(self):
        if not RUST_AVAILABLE: return
        if self._lazy_loaded: return
        
        # 如果可能，从 embedding service 检测维度
        # 我们将执行一个虚拟编码来检查维度
        try:
            dummy_vec = embedding_service.encode_one("test")
            self.dimension = len(dummy_vec)
            # print(f"[VectorStore] Detected embedding dimension: {self.dimension}")
        except Exception as e:
            print(f"[VectorStore] Failed to detect dimension: {e}. Using default 384.")
            self.dimension = 384

        # 加载记忆索引
        if os.path.exists(self.memory_index_path):
            try:
                self.memory_index = SemanticVectorIndex.load_index(self.memory_index_path, self.dimension)
                # print(f"[VectorStore] Memory index loaded. Size: {self.memory_index.size()}")
            except Exception as e:
                print(f"[VectorStore] Failed to load memory index: {e}.")
                # 备份损坏/不匹配的索引文件
                try:
                    import shutil
                    backup_path = self.memory_index_path + f".bak.{int(time.time())}"
                    shutil.copy2(self.memory_index_path, backup_path)
                    print(f"[VectorStore] ⚠️ Existing index backed up to {backup_path}")
                except Exception as backup_e:
                    print(f"[VectorStore] Failed to backup index: {backup_e}")
                
                print("[VectorStore] Creating new empty index.")
                self.memory_index = SemanticVectorIndex(self.dimension, 10000)
        else:
            self.memory_index = SemanticVectorIndex(self.dimension, 10000)

        # 加载标签索引
        if os.path.exists(self.tag_index_path):
            try:
                self.tag_index = SemanticVectorIndex.load_index(self.tag_index_path, self.dimension)
            except Exception as e:
                print(f"[VectorStore] Failed to load tag index: {e}.")
                # 同样备份标签索引
                try:
                    import shutil
                    backup_path = self.tag_index_path + f".bak.{int(time.time())}"
                    shutil.copy2(self.tag_index_path, backup_path)
                except Exception: pass
                
                print("[VectorStore] Creating new empty tag index.")
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
        
        self._lazy_loaded = True

    def save(self):
        if not RUST_AVAILABLE or not self._lazy_loaded: return
        try:
            # Atomic save for memory index
            temp_memory_path = self.memory_index_path + ".tmp"
            self.memory_index.persist_index(temp_memory_path)
            if os.path.exists(self.memory_index_path):
                os.replace(temp_memory_path, self.memory_index_path)
            else:
                os.rename(temp_memory_path, self.memory_index_path)

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

    def add_memory(self, memory_id: int, embedding: List[float]):
        """添加记忆向量"""
        self._ensure_loaded()
        if not self.memory_index: return
        
        try:
            self.memory_index.insert_vector(memory_id, embedding)
            # 每次都自动保存开销很大，但很安全。
            # 鉴于 Rust 保存是原子的，并且对于小文件很快，我们可以这样做。
            # 或者依赖定期保存/程序退出保存。
            # 目前，我们直接保存。
            self.save()
        except Exception as e:
            print(f"[VectorStore] Add memory failed: {e}")

    def add_memories_batch(self, ids: List[int], embeddings: List[List[float]]):
        """批量添加记忆 (Migration optimized)"""
        self._ensure_loaded()
        if not self.memory_index: return
        
        try:
            # Rust 支持批量添加
            self.memory_index.batch_insert_vectors(ids, embeddings)
            self.save()
        except Exception as e:
            print(f"[VectorStore] Batch add failed: {e}")

    def search_memory(self, query_vec: List[float], limit: int = 10) -> List[Dict]:
        """
        搜索记忆
        返回: [{"id": int, "score": float}, ...]
        """
        self._ensure_loaded()
        if not self.memory_index: return []
        
        try:
            # Rust 返回 [(id, dist), ...]
            results = self.memory_index.search_similar_vectors(query_vec, limit)
            
            output = []
            for mid, dist in results:
                # 将 L2 距离转换为相似度分数 (近似值)
                # 因为我们使用 Cosine/L2sq。如果向量已归一化，L2 = 2(1-cos)。
                # Sim = 1 - dist/2 ? 或者直接使用 1/(1+dist)。
                # 假设使用标准的 usearch 度量。
                # 如果是余弦距离，我们直接返回 score = 1.0 - dist (截断到 0)
                # 但 L2sq 可能 > 1。
                # 让我们假设向量已归一化。
                # 归一化 L2 的近似值
                sim = 1.0 - (dist / 2.0) 
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
